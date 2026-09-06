import type { AnalyzedElement, DOMAnalysis, DOMAnalysisSummary, ElementCategory } from '../types/scan'

const INPUT_TAGS = new Set(['input', 'textarea', 'select', 'option', 'optgroup'])
const INTERACTIVE_TAGS = new Set(['details', 'summary', 'dialog', 'menu', 'menuitem'])
const MEDIA_TAGS = new Set(['img', 'video', 'audio', 'canvas', 'svg', 'picture', 'source'])
const STRUCTURAL_TAGS = new Set([
  'div', 'span', 'section', 'article', 'aside', 'main', 'nav',
  'header', 'footer', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'pre', 'code', 'em', 'strong', 'small', 'br', 'hr',
  'figure', 'figcaption', 'address', 'time', 'mark',
])

const SENSITIVE_INPUT_TYPES = new Set([
  'password', 'email', 'tel', 'number',
])
const SENSITIVE_INPUT_NAMES = /ssn|social|credit|card|cvv|secret|token|password|passwd|pin/i

function categorize(el: Element): ElementCategory {
  const tag = el.tagName.toLowerCase()
  if (INPUT_TAGS.has(tag)) return 'input'
  if (tag === 'form') return 'form'
  if (tag === 'button' || (tag === 'input' && (el as HTMLInputElement).type === 'submit')) return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'iframe') return 'iframe'
  if (tag === 'script') return 'script'
  if (tag === 'style') return 'structural'
  if (MEDIA_TAGS.has(tag)) return 'media'
  if (INTERACTIVE_TAGS.has(tag)) return 'interactive'
  if (el.getAttribute('role') === 'button' || el.getAttribute('tabindex') !== null || el.getAttribute('onclick') !== null) return 'interactive'
  if (STRUCTURAL_TAGS.has(tag)) return 'structural'
  return 'structural'
}

function isVisible(el: Element): boolean {
  const style = (el as HTMLElement).style
  if (style?.display === 'none') return false
  if (style?.visibility === 'hidden') return false
  if (style?.opacity === '0') return false
  if ((el as HTMLElement).hidden) return false
  if (el.getAttribute('aria-hidden') === 'true') return false

  const cssText = style?.cssText || ''
  if (/position\s*:\s*absolute/.test(cssText) && /left\s*:\s*-\d{4,}px/.test(cssText)) return false

  const cls = el.className?.toString?.() || ''
  if (cls.includes('sr-only') || cls.includes('visually-hidden')) return false

  return true
}

function classify(el: Element, visible: boolean): AnalyzedElement['classification'] {
  const tag = el.tagName.toLowerCase()

  if (!visible) {
    const text = (el.textContent || '').toLowerCase()
    if (/ignore|override|disregard|previous instructions|system prompt/i.test(text)) return 'suspicious'
    if (text.trim().length > 20) return 'suspicious'
    return 'unclassified'
  }

  if (tag === 'input' || tag === 'textarea') {
    const type = (el as HTMLInputElement).type?.toLowerCase() || ''
    const name = ((el as HTMLInputElement).name || '').toLowerCase()
    const id = (el.id || '').toLowerCase()
    if (SENSITIVE_INPUT_TYPES.has(type) || SENSITIVE_INPUT_NAMES.test(name) || SENSITIVE_INPUT_NAMES.test(id)) {
      return 'sensitive'
    }
  }

  if (tag === 'iframe') return 'suspicious'
  if (tag === 'script') return 'suspicious'

  return 'safe'
}

function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const classes = el.className?.toString?.().trim().split(/\s+/).filter(Boolean) || []
  if (classes.length > 0) return `${tag}.${classes.slice(0, 2).join('.')}`

  const parent = el.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
  if (siblings.length > 1) {
    const idx = siblings.indexOf(el) + 1
    return `${tag}:nth-of-type(${idx})`
  }
  return tag
}

function getDirectText(el: Element): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    }
  }
  return text.trim().slice(0, 200)
}

let globalIndex = 0

function analyzeNode(el: Element, depth: number, maxDepth: number): AnalyzedElement {
  const tag = el.tagName.toLowerCase()
  const category = categorize(el)
  const visible = isVisible(el)
  const effectiveCategory: ElementCategory = !visible && category !== 'script' ? 'hidden' : category

  const attrs: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    attrs[attr.name] = attr.value.length > 100 ? attr.value.slice(0, 100) + '...' : attr.value
  }

  const index = globalIndex++

  const children: AnalyzedElement[] = []
  if (depth < maxDepth) {
    const childEls = Array.from(el.children).slice(0, 30)
    for (const child of childEls) {
      children.push(analyzeNode(child, depth + 1, maxDepth))
    }
  }

  return {
    tag,
    category: effectiveCategory,
    selector: buildSelector(el),
    id: el.id || undefined,
    classes: el.className?.toString?.().trim().split(/\s+/).filter(Boolean) || [],
    attributes: attrs,
    visible,
    textContent: getDirectText(el),
    boundingBox: null,
    classification: classify(el, visible),
    children,
    depth,
    index,
  }
}

function collectFlat(node: AnalyzedElement, out: AnalyzedElement[]): void {
  out.push(node)
  for (const child of node.children) {
    collectFlat(child, out)
  }
}

export function analyzeDOM(html: string): DOMAnalysis {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const root = doc.body || doc.documentElement

  globalIndex = 0
  const tree = analyzeNode(root, 0, 8)

  const flatElements: AnalyzedElement[] = []
  collectFlat(tree, flatElements)

  const summary: DOMAnalysisSummary = {
    inputs: 0,
    forms: 0,
    buttons: 0,
    links: 0,
    visibleText: 0,
    hidden: 0,
    iframes: 0,
    scripts: 0,
    interactive: 0,
    total: flatElements.length,
  }

  for (const el of flatElements) {
    switch (el.category) {
      case 'input': summary.inputs++; break
      case 'form': summary.forms++; break
      case 'button': summary.buttons++; break
      case 'link': summary.links++; break
      case 'hidden': summary.hidden++; break
      case 'iframe': summary.iframes++; break
      case 'script': summary.scripts++; break
      case 'interactive': summary.interactive++; break
      case 'text': summary.visibleText++; break
    }
    if (el.visible && el.textContent.length > 0 && el.category !== 'script') {
      summary.visibleText++
    }
  }

  return { tree, flatElements, summary }
}
