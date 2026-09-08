chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {})

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
