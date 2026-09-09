export function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id
}

export interface TabCapture {
  dom: string
  url: string
  title: string
}

export interface ScreenshotCapture {
  dataUrl: string
}

export interface ScreenshotError {
  error: string
  restricted: boolean
}

export async function captureScreenshot(): Promise<ScreenshotCapture> {
  if (!isExtension()) {
    throw new Error('Not running as a browser extension')
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'CAPTURE_SCREENSHOT' },
      (response: { ok: boolean; dataUrl?: string; error?: string; restricted?: boolean }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response?.ok) {
          const err = new Error(response?.error || 'Screenshot capture failed') as Error & { restricted?: boolean }
          err.restricted = response?.restricted ?? false
          reject(err)
          return
        }
        resolve({ dataUrl: response.dataUrl! })
      },
    )
  })
}

export interface DOMCommandResponse {
  success: boolean
  error: string | null
  detail: string | null
}

function sendBridgeMessage(msg: Record<string, unknown>): Promise<DOMCommandResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: DOMCommandResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message ?? 'Unknown error', detail: null })
        return
      }
      resolve(response ?? { success: false, error: 'No response from background', detail: null })
    })
  })
}

export class ExtensionDOMBridge {
  async click(selector: string) {
    return sendBridgeMessage({ type: 'DOM_CLICK', selector })
  }

  async focus(selector: string) {
    return sendBridgeMessage({ type: 'DOM_FOCUS', selector })
  }

  async type(selector: string, text: string) {
    return sendBridgeMessage({ type: 'DOM_TYPE', selector, text })
  }

  async fill(selector: string, value: string) {
    return sendBridgeMessage({ type: 'DOM_FILL', selector, value })
  }

  async navigate(url: string) {
    return sendBridgeMessage({ type: 'NAVIGATE_TAB', url })
  }

  async goBack() {
    return sendBridgeMessage({ type: 'GO_BACK' })
  }

  async scroll(direction: 'up' | 'down', amount?: number) {
    return sendBridgeMessage({ type: 'DOM_SCROLL', direction, amount: amount ?? 400 })
  }

  async select(selector: string, value: string) {
    return sendBridgeMessage({ type: 'DOM_SELECT', selector, value })
  }

  async sendKeys(keys: string) {
    return sendBridgeMessage({ type: 'DOM_SEND_KEYS', keys })
  }

  async elementExists(selector: string): Promise<boolean> {
    const res = await sendBridgeMessage({ type: 'DOM_ELEMENT_EXISTS', selector })
    return res.success
  }

  async getElementAttribute(selector: string, attr: string): Promise<string | null> {
    const res = await sendBridgeMessage({ type: 'DOM_GET_ATTRIBUTE', selector, attr })
    return res.success ? (res.detail ?? null) : null
  }

  async isPasswordField(selector: string): Promise<boolean> {
    const res = await sendBridgeMessage({ type: 'DOM_IS_PASSWORD', selector })
    return res.success
  }

  async extract(selector: string): Promise<DOMCommandResponse> {
    return sendBridgeMessage({ type: 'DOM_EXTRACT', selector })
  }
}

export async function captureActiveTab(): Promise<TabCapture> {
  if (!isExtension()) {
    throw new Error('Not running as a browser extension')
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'CAPTURE_ACTIVE_TAB' },
      (response: { ok: boolean; dom?: string; url?: string; title?: string; error?: string }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'Capture failed'))
          return
        }
        resolve({
          dom: response.dom!,
          url: response.url!,
          title: response.title!,
        })
      },
    )
  })
}
