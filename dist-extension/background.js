// Extension icon click → inject/toggle the Sentinel floating widget in the active tab.
console.log('[Sentinel] Background service worker loaded')

// Open the Sentinel side panel (works on any page including restricted ones)
async function openSidePanel(tabId) {
  try {
    await chrome.sidePanel.open({ tabId })
    console.log('[Sentinel] Side panel opened for tab:', tabId)
  } catch (err) {
    console.warn('[Sentinel] Side panel failed:', err.message)
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Sentinel] Icon clicked on tab:', tab.id, tab.url)

  if (!tab.id) {
    console.warn('[Sentinel] No tab.id available')
    return
  }

  // Chrome internal pages (chrome://, about:, devtools://) permanently block content
  // script injection — open the side panel directly instead
  const isRestricted = !tab.url
    || tab.url.startsWith('chrome://')
    || tab.url.startsWith('about:')
    || tab.url.startsWith('devtools://')
    || tab.url.startsWith('edge://')
    || tab.url.startsWith('chrome-extension://')

  if (isRestricted) {
    console.log('[Sentinel] Restricted page — opening side panel')
    await openSidePanel(tab.id)
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
    if (await tryToggle()) return
  } catch (err) {
    console.log('[Sentinel] Injection failed:', err.message)
  }

  // Injection failed on a normal page — log and give up gracefully (no side panel)
  console.warn('[Sentinel] Could not inject widget on this page')
})

// DOM action commands forwarded from the widget iframe to the content script on the active tab
const DOM_COMMANDS = [
  'DOM_CLICK', 'DOM_FILL', 'DOM_TYPE', 'DOM_FOCUS', 'DOM_SCROLL',
  'DOM_SELECT', 'DOM_SEND_KEYS', 'DOM_ELEMENT_EXISTS', 'DOM_GET_ATTRIBUTE', 'DOM_IS_PASSWORD',
  'DOM_EXTRACT',
]

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Route DOM commands to the active tab's content script
  if (DOM_COMMANDS.includes(msg.type)) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ success: false, error: 'No active tab', detail: null })
        return
      }
      chrome.tabs.sendMessage(tabs[0].id, msg, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message, detail: null })
          return
        }
        sendResponse(response ?? { success: false, error: 'No response from content script', detail: null })
      })
    })
    return true
  }

  // Navigate the active tab to a URL
  if (msg.type === 'NAVIGATE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ success: false, error: 'No active tab', detail: null })
        return
      }
      chrome.tabs.update(tabs[0].id, { url: msg.url }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message, detail: null })
          return
        }
        sendResponse({ success: true, error: null, detail: `Navigated to ${msg.url}` })
      })
    })
    return true
  }

  // Go back in the active tab's history
  if (msg.type === 'GO_BACK') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ success: false, error: 'No active tab', detail: null })
        return
      }
      chrome.tabs.goBack(tabs[0].id, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message, detail: null })
          return
        }
        sendResponse({ success: true, error: null, detail: 'Navigated back' })
      })
    })
    return true
  }

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

      // Primary: ask the already-injected content script — no host_permissions needed
      chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_DOM' }, (response) => {
        if (!chrome.runtime.lastError && response?.ok) {
          sendResponse({ ok: true, dom: response.dom, url: response.url, title: response.title })
          return
        }

        // Fallback: content script not ready — inject it then capture via scripting API
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-script.js'],
        }).then(() => {
          chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_DOM' }, (r2) => {
            if (!chrome.runtime.lastError && r2?.ok) {
              sendResponse({ ok: true, dom: r2.dom, url: r2.url, title: r2.title })
            } else {
              // Last resort: executeScript directly (requires host_permissions)
              chrome.scripting.executeScript({
                target: { tabId },
                func: () => ({
                  dom: document.documentElement.outerHTML,
                  url: window.location.href,
                  title: document.title,
                }),
              }).then((results) => {
                if (results?.[0]?.result) {
                  sendResponse({ ok: true, ...results[0].result })
                } else {
                  sendResponse({ ok: false, error: 'DOM capture returned no result' })
                }
              }).catch((err) => {
                sendResponse({ ok: false, error: err.message })
              })
            }
          })
        }).catch((err) => {
          sendResponse({ ok: false, error: 'Content script injection failed: ' + err.message })
        })
      })
    })
    return true
  }
})
