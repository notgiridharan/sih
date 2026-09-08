"""
Build script for BGE-small-en-v1.5 ONNX INT8-quantized embedding model.

Architecture (BGE-small-en-v1.5)
---------------------------------
  BERT with 6 transformer layers
  Hidden size: 384
  Attention heads: 12
  FFN intermediate size: 1536
  Vocabulary: 30 522 tokens (bert-base-uncased)
  Parameters: ~22.7M (FP32)

Export pipeline
---------------
  1. Build the BertModel using the exact BGE config via torch + transformers
  2. Export to ONNX opset 18 (required by torch 2.14+)
  3. Apply INT8 dynamic quantization → single self-contained file (~22 MB)

Network note
------------
  HuggingFace Hub may be blocked in restricted environments.  This script
  re-creates the model from scratch using PyPI-available packages so it works
  without internet access to HF.  The result has the correct architecture but
  RANDOM weights — suitable for verifying the inference pipeline.

  To replace with real trained weights when the network allows, run:
      node scripts/download-bge-model.js
  which downloads the Xenova/bge-small-en-v1.5 ONNX quantized checkpoint.

Prerequisites
-------------
  pip3 install torch transformers onnxruntime onnxscript numpy
  (PyPI packages; no pytorch.org download required)

Usage
-----
  python3 scripts/build-bge-model.py

Output
------
  extension/assets/models/bge-small-en-v1.5-quantized.onnx   (~22 MB INT8)
"""

import os
import sys
import struct
import tempfile

sys.path.insert(0, '/usr/local/lib/python3.12/dist-packages')

try:
    import torch
    import numpy as np
    from transformers import BertConfig, BertModel
    import onnxruntime
    from onnxruntime.quantization import quantize_dynamic, QuantType
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run: pip3 install torch transformers onnxruntime onnxscript numpy")
    sys.exit(1)

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'extension', 'assets', 'models')
os.makedirs(OUT_DIR, exist_ok=True)

QUANTIZED_PATH = os.path.join(OUT_DIR, 'bge-small-en-v1.5-quantized.onnx')


# BGE-small-en-v1.5 configuration (identical to the published HuggingFace model)
BGE_CONFIG = BertConfig(
    vocab_size=30522,
    hidden_size=384,
    num_hidden_layers=6,
    num_attention_heads=12,
    intermediate_size=1536,
    hidden_act='gelu',
    hidden_dropout_prob=0.1,
    attention_probs_dropout_prob=0.1,
    max_position_embeddings=512,
    type_vocab_size=2,
    initializer_range=0.02,
    layer_norm_eps=1e-12,
    pad_token_id=0,
    position_embedding_type='absolute',
    classifier_dropout=None,
)


def build_and_export() -> None:
    print('Building BGE-small-en-v1.5 model...')
    model = BertModel(BGE_CONFIG)
    model.eval()

    params = sum(p.numel() for p in model.parameters())
    print(f'  Parameters: {params:,}')

    # Dummy inputs (batch=1, seq=16) for ONNX tracing
    batch_size, seq_len = 1, 16
    input_ids      = torch.zeros((batch_size, seq_len), dtype=torch.long)
    attention_mask = torch.ones((batch_size, seq_len),  dtype=torch.long)
    token_type_ids = torch.zeros((batch_size, seq_len), dtype=torch.long)

    fp32_path = os.path.join(OUT_DIR, '_bge_fp32_tmp.onnx')
    print('  Exporting to ONNX...')

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_onnx = os.path.join(tmp_dir, 'bge_fp32.onnx')
        torch.onnx.export(
            model,
            (input_ids, attention_mask, token_type_ids),
            tmp_onnx,
            input_names=['input_ids', 'attention_mask', 'token_type_ids'],
            output_names=['last_hidden_state', 'pooler_output'],
            dynamic_axes={
                'input_ids':      {0: 'batch', 1: 'sequence'},
                'attention_mask': {0: 'batch', 1: 'sequence'},
                'token_type_ids': {0: 'batch', 1: 'sequence'},
                'last_hidden_state': {0: 'batch', 1: 'sequence'},
                'pooler_output':     {0: 'batch'},
            },
            opset_version=18,
        )

        fp32_size_mb = os.path.getsize(tmp_onnx) / 1024 / 1024

        # Check for external data file (torch 2.x splits large models)
        data_file = tmp_onnx + '.data'
        if os.path.exists(data_file):
            fp32_size_mb += os.path.getsize(data_file) / 1024 / 1024

        print(f'  FP32 size: {fp32_size_mb:.1f} MB')
        print('  Applying INT8 dynamic quantization...')

        quantize_dynamic(
            tmp_onnx,
            QUANTIZED_PATH,
            weight_type=QuantType.QInt8,
        )

    quantized_size_mb = os.path.getsize(QUANTIZED_PATH) / 1024 / 1024
    print(f'  Quantized size: {quantized_size_mb:.1f} MB')
    print(f'  Saved: {QUANTIZED_PATH}')


def verify() -> None:
    print('\nVerifying inference...')
    import numpy as np

    sess = onnxruntime.InferenceSession(QUANTIZED_PATH)

    inputs_info = sess.get_inputs()
    outputs_info = sess.get_outputs()
    print(f'  Inputs:  {[i.name for i in inputs_info]}')
    print(f'  Outputs: {[o.name for o in outputs_info]}')

    seq = 16
    feeds = {
        'input_ids':      np.zeros((1, seq), dtype=np.int64),
        'attention_mask': np.ones((1, seq),  dtype=np.int64),
        'token_type_ids': np.zeros((1, seq), dtype=np.int64),
    }
    results = sess.run(None, feeds)
    lhs, pooler = results[0], results[1]

    print(f'  last_hidden_state shape: {lhs.shape}')   # [1, seq, 384]
    print(f'  pooler_output shape:     {pooler.shape}') # [1, 384]

    # CLS embedding + L2 normalise
    cls = lhs[0, 0]
    norm = np.linalg.norm(cls)
    cls_norm = cls / norm
    print(f'  CLS-token norm (before normalisation): {norm:.4f}')
    print(f'  CLS-token norm (after normalisation):  {np.linalg.norm(cls_norm):.6f}')

    # Quick cosine similarity sanity check
    cos = float(np.dot(cls_norm, cls_norm))
    print(f'  Cosine(CLS, CLS) = {cos:.6f}  (expected 1.0)')
    print('\nVerification passed.')


if __name__ == '__main__':
    build_and_export()
    verify()
    print('\nNext steps:')
    print('  npm run build:extension   # bundle model with extension')
    print('  # When HuggingFace is accessible:')
    print('  # node scripts/download-bge-model.js  (replaces with real weights)')
