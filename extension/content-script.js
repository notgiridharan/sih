(() => {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CAPTURE_DOM') {
      try {
        const dom = document.documentElement.outerHTML
        const url = window.location.href
        const title = document.title
        sendResponse({ ok: true, dom, url, title })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
      return true
    }

    if (msg.type === 'PING') {
      sendResponse({ ok: true })
      return true
    }
  })
})()
