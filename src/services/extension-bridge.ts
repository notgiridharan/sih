export function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id
}

export interface TabCapture {
  dom: string
  url: string
  title: string
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
