// Extension icon click → inject/toggle the Sentinel floating widget in the active tab.
console.log('[Sentinel] Background service worker loaded')

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Sentinel] Icon clicked on tab:', tab.id, tab.url)

  if (!tab.id) {
    console.warn('[Sentinel] No tab.id available')
    return
  }

  async function tryToggle() {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' })
      console.log('[Sentinel] Toggle response:', response)
      return true
    } catch {
      return false
    }
  }

  // First attempt — works on pages where the content script is already injected
  if (await tryToggle()) return

  // Content script not ready (fresh tab, extension reload) — inject programmatically then retry
  console.log('[Sentinel] Content script not ready, injecting programmatically...')
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    })
    // Allow script to initialize its message listeners
    await new Promise(resolve => setTimeout(resolve, 80))
    await tryToggle()
  } catch (err) {
    console.log('[Sentinel] Injection failed — restricted page:', err.message)
  }
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message || 'Screenshot capture failed'
        const isRestricted = /cannot.*captured|chrome:\/\/|edge:\/\/|about:|devtools|extension page|webstore/i.test(err)
        sendResponse({
          ok: false,
          error: isRestricted
            ? 'Cannot capture this page — browser-internal or restricted pages are not accessible.'
            : err,
          restricted: isRestricted,
        })
        return
      }
      if (!dataUrl) {
        sendResponse({ ok: false, error: 'Capture returned empty data' })
        return
      }
      sendResponse({ ok: true, dataUrl })
    })
    return true
  }

  if (msg.type === 'CAPTURE_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ ok: false, error: 'No active tab found' })
        return
      }

      const tabId = tabs[0].id

      chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          dom: document.documentElement.outerHTML,
          url: window.location.href,
          title: document.title,
        }),
      }).then((results) => {
        if (results && results[0]?.result) {
          sendResponse({ ok: true, ...results[0].result })
        } else {
          sendResponse({ ok: false, error: 'Script execution returned no result' })
        }
      }).catch((err) => {
        sendResponse({ ok: false, error: err.message })
      })
    })
    return true
  }
})
