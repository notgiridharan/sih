// Extension icon click → inject/toggle the Sentinel floating widget in the active tab.
// The side panel (dashboard) is no longer the primary entry point;
// it remains accessible via the widget's settings menu.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' })
  } catch {
    // Content script not yet ready on this tab (fresh load) — retry after brief pause
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_WIDGET' })
      } catch {
        // Restricted page (chrome://, file://, devtools, etc.) — silently ignore
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
