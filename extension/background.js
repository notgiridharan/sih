// Extension icon click → inject/toggle the Sentinel floating widget in the active tab.
console.log('[Sentinel] Background service worker loaded')

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Sentinel] Icon clicked on tab:', tab.id, tab.url)

  if (!tab.id) {
    console.warn('[Sentinel] No tab.id available')
    return
  }

  try {
    console.log('[Sentinel] Sending TOGGLE_WIDGET to tab', tab.id)
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' })
    console.log('[Sentinel] Response:', response)
  } catch (error) {
    console.log('[Sentinel] First attempt failed, retrying:', error.message)

    // Content script not yet ready on this tab (fresh load) — retry after brief pause
    setTimeout(async () => {
      try {
        console.log('[Sentinel] Retry sending TOGGLE_WIDGET to tab', tab.id)
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' })
        console.log('[Sentinel] Retry response:', response)
      } catch (retryError) {
        console.log('[Sentinel] Retry failed - likely restricted page:', retryError.message)
      }
    }, 150)
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
