import type {
  CorrelationResult,
  CorrelationFinding,
  CorrelationSeverity,
  CorrelationEvidence,
  OCRResult,
  OCRBlock,
  PIIMatch,
  PromptInjection,
  HiddenContent,
} from '../types/scan'

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

function ocrContains(ocrText: string, keywords: string[]): { matched: boolean; matchedKeyword: string } {
  const norm = normalize(ocrText)
  for (const kw of keywords) {
    if (norm.includes(kw)) return { matched: true, matchedKeyword: kw }
  }
  return { matched: false, matchedKeyword: '' }
}

function findOCRBlock(blocks: OCRBlock[], keywords: string[]): OCRBlock | null {
  for (const block of blocks) {
    const norm = normalize(block.text)
    for (const kw of keywords) {
      if (norm.includes(kw)) return block
    }
  }
  return null
}

interface DOMInput {
  tag: string
  type: string
  name: string
  id: string
  placeholder: string
  ariaLabel: string
  autocomplete: string
}

function extractInputs(dom: string): DOMInput[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(dom, 'text/html')
  const inputs: DOMInput[] = []
  for (const el of Array.from(doc.querySelectorAll('input, textarea, select'))) {
    inputs.push({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: (el.getAttribute('name') || '').toLowerCase(),
      id: (el.id || '').toLowerCase(),
      placeholder: (el.getAttribute('placeholder') || '').toLowerCase(),
      ariaLabel: (el.getAttribute('aria-label') || '').toLowerCase(),
      autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
    })
  }
  return inputs
}

function inputSelector(inp: DOMInput): string {
  if (inp.id) return `${inp.tag}#${inp.id}`
  if (inp.name) return `${inp.tag}[name="${inp.name}"]`
  return inp.tag
}

function inputMatchesAny(inp: DOMInput, patterns: RegExp[]): boolean {
  const combined = `${inp.name} ${inp.id} ${inp.placeholder} ${inp.ariaLabel} ${inp.autocomplete}`
  return patterns.some(p => p.test(combined))
}

// Confidence formula: base * min(ocrConfidence, 1.0) * matchStrength
// base: how reliable this correlation type is (0.7–0.95)
// ocrConfidence: from the OCR result (0–1)
// matchStrength: 1.0 for exact type match, 0.8 for keyword-only match
function computeConfidence(base: number, ocrConfidence: number, matchStrength: number): number {
  return Math.round(Math.min(base * Math.min(ocrConfidence, 1) * matchStrength, 1) * 100) / 100
}

function makeEvidence(
  ocrText: string,
  ocrConfidence: number,
  block: OCRBlock | null,
  domElement: string | null,
  domSelector: string | null,
  domMatchedText: string,
  domAttrs?: Record<string, string>,
): CorrelationEvidence {
  return {
    visual: {
      ocrText,
      ocrConfidence,
      boundingBox: block?.boundingBox ?? undefined,
    },
    dom: domElement ? {
      element: domElement,
      selector: domSelector || domElement,
      matchedText: domMatchedText,
      attributes: domAttrs,
    } : null,
  }
}

const PII_KEYWORDS = ['aadhaar', 'aadhar', 'pan card', 'pan number', 'social security', 'ssn', 'national id', 'voter id', 'passport number', 'driving licence', 'driving license', 'identity number', 'id number', 'id proof']
const PII_INPUT_PATTERNS = [/aadhaar|aadhar|uidai/i, /pan/i, /ssn|social.?sec/i, /passport/i, /national.?id|voter/i, /identity|id.?proof/i]

const CREDENTIAL_KEYWORDS = ['enter your password', 'enter password', 'current password', 'new password', 'confirm password', 'create password', 'password']
const CREDENTIAL_INPUT_PATTERNS = [/password/i]

const OTP_KEYWORDS = ['enter otp', 'otp', 'one time password', 'verification code', 'verify code', 'enter code', 'sms code', 'authenticator code']
const OTP_INPUT_PATTERNS = [/otp/i, /verification.?code/i, /one.?time/i, /token/i]

const PAYMENT_KEYWORDS = ['card number', 'credit card', 'debit card', 'cvv', 'cvc', 'expiry date', 'card expiry', 'upi pin', 'upi id', 'bank account', 'account number', 'ifsc', 'routing number', 'net banking', 'payment']
const PAYMENT_INPUT_PATTERNS = [/card.?num|cc.?num|credit.?card|debit.?card/i, /cvv|cvc/i, /expir/i, /upi/i, /account.?(?:no|num)/i, /ifsc|routing/i]

const INJECTION_KEYWORDS = ['ignore previous instructions', 'ignore all previous', 'system message', 'developer message', 'reveal your instructions', 'paste your secret', 'upload confidential', 'disregard all', 'forget previous', 'you are now in']

const VISUAL_SENSITIVE_KEYWORDS = ['upload your identity', 'upload id', 'upload document', 'scan your', 'take a photo of', 'share your location', 'enable camera', 'enable microphone', 'grant access']

export function correlate(
  dom: string,
  ocrResult: OCRResult | null,
  _piiMatches: PIIMatch[],
  injections: PromptInjection[],
  hiddenContent: HiddenContent[],
): CorrelationResult {
  const findings: CorrelationFinding[] = []

  if (!ocrResult || ocrResult.status !== 'complete' || !ocrResult.text.trim()) {
    return { findings: [], totalCorrelations: 0, highestSeverity: 'none' }
  }

  const inputs = extractInputs(dom)
  const ocrText = ocrResult.text
  const ocrConf = ocrResult.confidence
  const blocks = ocrResult.blocks

  // A: Visual PII Request
  const piiMatch = ocrContains(ocrText, PII_KEYWORDS)
  if (piiMatch.matched) {
    const matchingInput = inputs.find(inp => inputMatchesAny(inp, PII_INPUT_PATTERNS))
    const block = findOCRBlock(blocks, [piiMatch.matchedKeyword])
    const matchStrength = matchingInput ? 1.0 : 0.7
    findings.push({
      type: 'VISUAL_PII_REQUEST',
      severity: 'high',
      confidence: computeConfidence(0.9, ocrConf, matchStrength),
      explanation: matchingInput
        ? `The page visually requests sensitive personal information ("${piiMatch.matchedKeyword}") and contains a corresponding input element.`
        : `The page visually requests sensitive personal information ("${piiMatch.matchedKeyword}") but no matching input field was found in the DOM.`,
      evidence: makeEvidence(
        piiMatch.matchedKeyword, ocrConf, block,
        matchingInput?.tag ?? null, matchingInput ? inputSelector(matchingInput) : null,
        matchingInput ? `${matchingInput.name || matchingInput.placeholder || matchingInput.id}` : '',
        matchingInput ? { type: matchingInput.type, name: matchingInput.name } : undefined,
      ),
    })
  }

  // B: Visual Credential Request
  const credMatch = ocrContains(ocrText, CREDENTIAL_KEYWORDS)
  if (credMatch.matched) {
    const matchingInput = inputs.find(inp => inp.type === 'password' || inputMatchesAny(inp, CREDENTIAL_INPUT_PATTERNS))
    const block = findOCRBlock(blocks, [credMatch.matchedKeyword])
    if (matchingInput) {
      findings.push({
        type: 'VISUAL_CREDENTIAL_REQUEST',
        severity: 'high',
        confidence: computeConfidence(0.95, ocrConf, matchingInput.type === 'password' ? 1.0 : 0.85),
        explanation: `The page visually asks for a password and contains a corresponding password input.`,
        evidence: makeEvidence(
          credMatch.matchedKeyword, ocrConf, block,
          matchingInput.tag, inputSelector(matchingInput),
          `type="${matchingInput.type}"`,
          { type: matchingInput.type, name: matchingInput.name },
        ),
      })
    }
  }

  // C: Visual OTP Request
  const otpMatch = ocrContains(ocrText, OTP_KEYWORDS)
  if (otpMatch.matched) {
    const matchingInput = inputs.find(inp =>
      inputMatchesAny(inp, OTP_INPUT_PATTERNS) ||
      inp.autocomplete.includes('one-time-code') ||
      inp.type === 'tel' || inp.type === 'number'
    )
    const block = findOCRBlock(blocks, [otpMatch.matchedKeyword])
    const matchStrength = matchingInput ? 1.0 : 0.7
    findings.push({
      type: 'VISUAL_OTP_REQUEST',
      severity: 'medium',
      confidence: computeConfidence(0.85, ocrConf, matchStrength),
      explanation: matchingInput
        ? `The page visually requests a one-time password/verification code and contains a matching input element.`
        : `The page visually mentions OTP/verification code but no matching input was found.`,
      evidence: makeEvidence(
        otpMatch.matchedKeyword, ocrConf, block,
        matchingInput?.tag ?? null, matchingInput ? inputSelector(matchingInput) : null,
        matchingInput ? `${matchingInput.name || matchingInput.placeholder || matchingInput.autocomplete}` : '',
        matchingInput ? { type: matchingInput.type, name: matchingInput.name } : undefined,
      ),
    })
  }

  // D: Visual Payment Request
  const payMatch = ocrContains(ocrText, PAYMENT_KEYWORDS)
  if (payMatch.matched) {
    const matchingInput = inputs.find(inp => inputMatchesAny(inp, PAYMENT_INPUT_PATTERNS))
    const block = findOCRBlock(blocks, [payMatch.matchedKeyword])
    const matchStrength = matchingInput ? 1.0 : 0.75
    findings.push({
      type: 'VISUAL_PAYMENT_REQUEST',
      severity: 'critical',
      confidence: computeConfidence(0.9, ocrConf, matchStrength),
      explanation: matchingInput
        ? `The page visually requests payment information ("${payMatch.matchedKeyword}") and contains a matching payment input.`
        : `The page visually mentions payment-related terms ("${payMatch.matchedKeyword}").`,
      evidence: makeEvidence(
        payMatch.matchedKeyword, ocrConf, block,
        matchingInput?.tag ?? null, matchingInput ? inputSelector(matchingInput) : null,
        matchingInput ? `${matchingInput.name || matchingInput.placeholder}` : '',
        matchingInput ? { type: matchingInput.type, name: matchingInput.name } : undefined,
      ),
    })
  }

  // E: Cross-modal Injection
  const injMatch = ocrContains(ocrText, INJECTION_KEYWORDS)
  if (injMatch.matched && injections.length > 0) {
    const block = findOCRBlock(blocks, [injMatch.matchedKeyword])
    findings.push({
      type: 'CROSS_MODAL_INJECTION',
      severity: 'critical',
      confidence: computeConfidence(0.95, ocrConf, 1.0),
      explanation: `Prompt injection language was detected both visually in the screenshot ("${injMatch.matchedKeyword}") and in the DOM. This is a strong indicator of an active prompt injection attack.`,
      evidence: makeEvidence(
        injMatch.matchedKeyword, ocrConf, block,
        'text', injections[0].location.selector ?? 'dom',
        injections[0].content.slice(0, 100),
      ),
    })
  }

  // F: Visual/DOM Mismatch — sensitive visual content with no DOM input
  const visualSensitive = ocrContains(ocrText, VISUAL_SENSITIVE_KEYWORDS)
  if (visualSensitive.matched) {
    const hasRelevantInput = inputs.some(inp =>
      inp.type === 'file' || inputMatchesAny(inp, [/upload|document|identity|photo|camera|location|microphone/i])
    )
    if (!hasRelevantInput) {
      const block = findOCRBlock(blocks, [visualSensitive.matchedKeyword])
      findings.push({
        type: 'VISUAL_DOM_MISMATCH',
        severity: 'medium',
        confidence: computeConfidence(0.75, ocrConf, 0.8),
        explanation: `The screenshot contains sensitive visual content ("${visualSensitive.matchedKeyword}") but no corresponding DOM element was found. This may indicate dynamically injected content or a rendering discrepancy.`,
        evidence: makeEvidence(
          visualSensitive.matchedKeyword, ocrConf, block, null, null, '',
        ),
      })
    }
  }

  // G: Hidden Content Mismatch — hidden DOM text not visible in OCR
  for (const hidden of hiddenContent) {
    const hiddenNorm = normalize(hidden.content).slice(0, 80)
    if (hiddenNorm.length < 5) continue
    const hiddenWords = hiddenNorm.split(' ').filter(w => w.length > 3)
    if (hiddenWords.length === 0) continue

    const wordsFoundInOCR = hiddenWords.filter(w => normalize(ocrText).includes(w)).length
    const matchRatio = wordsFoundInOCR / hiddenWords.length

    // If less than 30% of significant words appear in OCR, it's hidden from view
    if (matchRatio < 0.3) {
      const isSuspicious = INJECTION_KEYWORDS.some(kw => hiddenNorm.includes(kw))
      findings.push({
        type: 'HIDDEN_CONTENT_MISMATCH',
        severity: isSuspicious ? 'high' : 'low',
        confidence: computeConfidence(0.85, ocrConf, 1.0 - matchRatio),
        explanation: isSuspicious
          ? `Suspicious content exists in the DOM (hidden via ${hidden.technique}) but was not detected in the visible screenshot. This may be an attempt to inject instructions invisible to the user.`
          : `Content hidden via ${hidden.technique} was not detected in the visible screenshot. The hidden text may be benign (e.g. accessibility) or intentionally concealed.`,
        evidence: {
          visual: null,
          dom: {
            element: hidden.element,
            selector: hidden.selector,
            matchedText: hidden.content.slice(0, 200),
          },
        },
      })
    }
  }

  const highestSeverity = findings.reduce<CorrelationSeverity | 'none'>((max, f) => {
    const order: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 }
    return (order[f.severity] || 0) > (order[max] || 0) ? f.severity : max
  }, 'none')

  return {
    findings,
    totalCorrelations: findings.length,
    highestSeverity,
  }
}
