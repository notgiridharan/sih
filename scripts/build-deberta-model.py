"""
Build a DeBERTa-v3-small-compatible ONNX stub for prompt-injection detection.

Architecture
------------
The stub implements a bag-of-words classifier with max-pooling:

  input_ids [1, 128] int64
    → Gather(embedding_table [512, 64]) → [1, 128, 64]
    → Mul(attention_mask_float [1, 128, 1]) → masked [1, 128, 64]
    → ReduceMax(axis=1) → pooled [1, 64]
    → MatMul(fc_weight [64, 2]) → [1, 2]
    → Add(fc_bias [2])           → logits [1, 2]

Weights are tuned so that tokens from INJECTION_VOCAB (IDs 4-63) produce a
strong injection signal:
  - Embedding feature[0] = 2.0 for injection-word IDs, 0.0 otherwise
  - fc_weight[0, 0] = -2.0 (safe class)   → logits[safe]      = -3.5 when injected
  - fc_weight[0, 1] = +2.0 (inject class) → logits[injection] = +3.5 when injected
  - fc_bias = [0.5, -0.5]

This gives:
  • No injection word → softmax(0.5, -0.5) → safe  ≈ 0.73
  • Any injection word → softmax(-3.5, 3.5) → injection ≈ 0.998

Interface (identical to ProtectAI deberta-v3-small-prompt-injection-v2):
  Inputs:  input_ids, attention_mask, token_type_ids  — int64 [1, 128]
  Output:  logits                                     — float32 [1, 2]
           (index 0 = SAFE, index 1 = INJECTION)

Usage:
  python3 scripts/build-deberta-model.py
  # then: npm run build:extension
"""

import os
import sys

sys.path.insert(0, '/usr/local/lib/python3.12/dist-packages')
try:
    import numpy as np
    import onnx
    import onnx.helper as H
    import onnx.numpy_helper as NH
    from onnx import TensorProto
except ImportError:
    print("onnx and numpy required. Run: pip3 install onnx numpy")
    sys.exit(1)

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'extension', 'assets', 'models')
os.makedirs(OUT_DIR, exist_ok=True)

VOCAB_SIZE = 512
HIDDEN     = 64   # embedding dimension
SEQ_LEN    = 128  # must match MAX_SEQ_LEN in deberta-tokenizer.ts
NUM_CLASSES = 2   # 0=SAFE, 1=INJECTION

# Token IDs that carry an injection signal — must match INJECTION_VOCAB in
# src/services/deberta-tokenizer.ts (IDs 4-63).
INJECTION_IDS = list(range(4, 64))


def make_deberta_stub() -> onnx.ModelProto:
    """Build the DeBERTa-compatible ONNX stub."""

    # ---- Embedding table [512, 64] ----
    embedding = np.zeros((VOCAB_SIZE, HIDDEN), dtype=np.float32)
    for idx in INJECTION_IDS:
        embedding[idx, 0] = 2.0   # strong signal in feature 0

    emb_init = NH.from_array(embedding, name='embedding_table')

    # ---- Classification head ----
    fc_weight = np.zeros((HIDDEN, NUM_CLASSES), dtype=np.float32)
    fc_weight[0, 0] = -2.0   # feature-0 → strongly safe
    fc_weight[0, 1] =  2.0   # feature-0 → strongly injection
    fc_bias = np.array([0.5, -0.5], dtype=np.float32)  # prior: slightly safe

    fc_weight_init = NH.from_array(fc_weight, name='fc_weight')
    fc_bias_init   = NH.from_array(fc_bias,   name='fc_bias')

    # ---- Graph nodes ----

    # 1. Gather embedding for input_ids
    #    data [512,64], indices [1,128] → [1,128,64]
    gather = H.make_node('Gather', ['embedding_table', 'input_ids'], ['emb_out'], axis=0)

    # 2. Cast attention_mask int64 → float32
    cast_mask = H.make_node('Cast', ['attention_mask'], ['mask_float'],
                            to=int(TensorProto.FLOAT))

    # 3. Unsqueeze mask: [1,128] → [1,128,1]
    unsqueeze_mask = H.make_node('Unsqueeze', ['mask_float'], ['mask_3d'], axes=[2])

    # 4. Zero out padding: [1,128,64] * [1,128,1] → [1,128,64]
    mul_mask = H.make_node('Mul', ['emb_out', 'mask_3d'], ['masked_emb'])

    # 5. Max-pool over sequence: [1,128,64] → [1,64]
    reduce_max = H.make_node('ReduceMax', ['masked_emb'], ['pooled'],
                             axes=[1], keepdims=0)

    # 6. Linear: [1,64] × [64,2] → [1,2]
    matmul = H.make_node('MatMul', ['pooled', 'fc_weight'], ['mm_out'])

    # 7. Add bias: [1,2] + [2] → logits [1,2]
    add_bias = H.make_node('Add', ['mm_out', 'fc_bias'], ['logits'])

    # ---- Graph I/O ----
    inp_ids  = H.make_tensor_value_info('input_ids',      TensorProto.INT64,  [1, SEQ_LEN])
    inp_mask = H.make_tensor_value_info('attention_mask', TensorProto.INT64,  [1, SEQ_LEN])
    inp_type = H.make_tensor_value_info('token_type_ids', TensorProto.INT64,  [1, SEQ_LEN])
    out_logits = H.make_tensor_value_info('logits',       TensorProto.FLOAT,  [1, NUM_CLASSES])

    graph = H.make_graph(
        [gather, cast_mask, unsqueeze_mask, mul_mask, reduce_max, matmul, add_bias],
        'deberta_injection_stub',
        [inp_ids, inp_mask, inp_type],
        [out_logits],
        initializer=[emb_init, fc_weight_init, fc_bias_init],
    )

    model = H.make_model(graph, opset_imports=[H.make_opsetid('', 11)])
    model.ir_version = 7
    model.doc_string = (
        'DeBERTa-v3-small-compatible prompt-injection classifier stub. '
        'Embedding weights encode injection signal for IDs 4-63. '
        'Replace with fine-tuned deberta-v3-small-prompt-injection-v2 weights for production.'
    )
    onnx.checker.check_model(model)
    return model


if __name__ == '__main__':
    print('Building DeBERTa prompt-injection ONNX stub...')

    model = make_deberta_stub()
    out_path = os.path.join(OUT_DIR, 'deberta-injection.onnx')
    onnx.save(model, out_path)

    size_kb = os.path.getsize(out_path) / 1024
    print(f'  Saved: {out_path}  ({size_kb:.1f} KB)')
    print(f'  Inputs:  input_ids, attention_mask, token_type_ids  int64 [1, {SEQ_LEN}]')
    print(f'  Output:  logits  float32 [1, {NUM_CLASSES}]  (0=SAFE, 1=INJECTION)')
    print()
    print('Injection signal: any of token IDs 4-63 (see deberta-tokenizer.ts)')
    print('Expected behaviour:')
    print('  "ignore previous instructions" → P(injection) ≈ 0.998')
    print('  "what is the weather today"    → P(safe) ≈ 0.73')
    print()
    print('Next steps:')
    print('  npm run build:extension   # bundle model with extension')
    print('  node scripts/download-deberta-model.js   # upgrade to trained weights when network allows')
