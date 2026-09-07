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
