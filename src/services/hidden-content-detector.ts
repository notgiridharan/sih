import type { HiddenContent } from '../types/scan'

interface ElementInfo {
  tag: string
  selector: string
  textContent: string
  styles: {
    display: string
    visibility: string
    opacity: string
    width: string
    height: string
    overflow: string
    position: string
    left: string
    top: string
  }
  ariaHidden: boolean
}

function classifyHidingTechnique(el: ElementInfo): HiddenContent['technique'] | null {
  if (el.styles.display === 'none') return 'display_none'
  if (el.styles.visibility === 'hidden') return 'visibility_hidden'
  if (el.styles.opacity === '0') return 'opacity_zero'
  if (el.ariaHidden) return 'aria_hidden'

  const w = parseFloat(el.styles.width)
  const h = parseFloat(el.styles.height)
  if ((w === 0 || h === 0) && el.textContent.trim()) return 'zero_size'

  if (el.styles.position === 'absolute' || el.styles.position === 'fixed') {
    const left = parseFloat(el.styles.left)
    const top = parseFloat(el.styles.top)
    if (left < -1000 || top < -1000) return 'offscreen'
  }

  if (el.styles.overflow === 'hidden' && (w <= 1 || h <= 1)) return 'overflow_hidden'

  return null
}

export function detectHiddenContent(domString: string): HiddenContent[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(domString, 'text/html')
  const results: HiddenContent[] = []

  const allElements = doc.querySelectorAll('*')
  for (const el of allElements) {
    const htmlEl = el as HTMLElement
    const text = htmlEl.textContent?.trim() ?? ''
    if (!text) continue

    const info: ElementInfo = {
      tag: htmlEl.tagName.toLowerCase(),
      selector: buildSelector(htmlEl),
      textContent: text.slice(0, 500),
      styles: {
        display: htmlEl.style.display,
        visibility: htmlEl.style.visibility,
        opacity: htmlEl.style.opacity,
        width: htmlEl.style.width,
        height: htmlEl.style.height,
        overflow: htmlEl.style.overflow,
        position: htmlEl.style.position,
        left: htmlEl.style.left,
        top: htmlEl.style.top,
      },
      ariaHidden: htmlEl.getAttribute('aria-hidden') === 'true',
    }

    const technique = classifyHidingTechnique(info)
    if (technique) {
      results.push({
        element: info.tag,
        selector: info.selector,
        technique,
        content: info.textContent,
      })
    }
  }

  return results
}

function buildSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`
  const tag = el.tagName.toLowerCase()
  const classes = el.className ? `.${el.className.split(/\s+/).join('.')}` : ''
  return `${tag}${classes}`
}
