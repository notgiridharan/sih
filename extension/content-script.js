(() => {
  console.log('[Sentinel] Content script loaded on:', window.location.href)

  // ─── Widget state ─────────────────────────────────────────────────────────

  let widgetMeta = null // { minimized: bool, maximized: bool, startTask: number }

  // ─── TOGGLE_WIDGET ───────────────────────────────────────────────────────

  function toggleWidget() {
    const existing = document.getElementById('__sentinel_host__')
    if (existing) {
      removeWidget()
    } else {
      injectWidget()
    }
  }

  // ─── Widget injection ─────────────────────────────────────────────────────

  function injectWidget() {
    console.log('[Sentinel] injectWidget called')
    if (document.getElementById('__sentinel_host__')) {
      console.log('[Sentinel] Widget already exists')
      return
    }

    console.log('[Sentinel] Creating widget host element')

    // Outer host — uses Shadow DOM to prevent page styles from leaking in
    const host = document.createElement('div')
    host.id = '__sentinel_host__'

    // These critical styles go on the host element (outside shadow root)
    // setProperty with 'important' flag to beat any page !important rules
    const hostStyles = {
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: '380px',
      height: '560px',
      zIndex: '2147483647',
      borderRadius: '10px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)',
      opacity: '0',
      transform: 'scale(0.96) translateY(-6px)',
      transition: 'opacity 0.2s ease, transform 0.2s ease',
    }
    Object.assign(host.style, hostStyles)

    // Use shadow DOM so page CSS cannot interfere with the title bar
    const shadow = host.attachShadow({ mode: 'open' })

    // Shadow DOM internal styles
    const style = document.createElement('style')
    style.textContent = `
      :host { display: flex; flex-direction: column; height: 100%; }

      * { box-sizing: border-box; }

      #s-titlebar {
        background: #0a0a0a;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        height: 44px;
        padding: 0 10px 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: grab;
        user-select: none;
        flex-shrink: 0;
      }
      #s-titlebar.dragging { cursor: grabbing; }

      #s-brand {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #s-brand-name {
        color: #ede9e4;
        font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      #s-controls {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .s-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.35);
        cursor: pointer;
        border-radius: 5px;
        font-size: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.12s, color 0.12s;
        line-height: 1;
        padding: 0;
        font-family: -apple-system, system-ui, sans-serif;
      }
      .s-btn:hover {
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.7);
      }
      .s-btn.s-btn-close:hover {
        background: rgba(196,107,107,0.15);
        color: #c46b6b;
      }
      .s-btn.s-btn-min:hover {
        color: rgba(255,255,255,0.65);
      }

      #s-iframe {
        flex: 1;
        border: none;
        background: #0a0a0a;
        width: 100%;
        display: block;
        min-height: 0;
      }
    `
    shadow.appendChild(style)

    // Title bar
    const titlebar = document.createElement('div')
    titlebar.id = 's-titlebar'

    const brand = document.createElement('div')
    brand.id = 's-brand'
    brand.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="#8b9d7b"/>
      </svg>
      <span id="s-brand-name">Sentinel</span>
    `

    const controls = document.createElement('div')
    controls.id = 's-controls'

    const minBtn = makeBtn('−', 's-btn-min', 'Minimize')
    const maxBtn = makeBtn('⊡', 's-btn-max', 'Expand')
    const closeBtn = makeBtn('×', 's-btn-close', 'Close')

    controls.append(minBtn, maxBtn, closeBtn)
    titlebar.append(brand, controls)

    // Iframe
    const iframe = document.createElement('iframe')
    iframe.id = 's-iframe'
    iframe.src = chrome.runtime.getURL('widget.html')
    iframe.setAttribute('frameborder', '0')
    iframe.setAttribute('scrolling', 'no')
    iframe.setAttribute('allowtransparency', 'true')
    iframe.setAttribute('title', 'Sentinel Agent')

    shadow.append(titlebar, iframe)
    document.body.appendChild(host)

    widgetMeta = { minimized: false, maximized: false }

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        host.style.opacity = '1'
        host.style.transform = 'scale(1) translateY(0)'
      })
    })

    // Wire controls
    closeBtn.addEventListener('click', removeWidget)
    minBtn.addEventListener('click', () => handleMinimize(host, iframe, shadow, minBtn))
    maxBtn.addEventListener('click', () => handleMaximize(host, maxBtn))

    // Wire dragging
    setupDrag(titlebar, host, controls)

    // Listen for messages from the widget iframe
    window.addEventListener('message', handleWidgetMessage)
  }

  function makeBtn(label, cls, title) {
    const btn = document.createElement('button')
    btn.className = `s-btn ${cls}`
    btn.textContent = label
    btn.title = title
    return btn
  }

  // ─── Widget removal ───────────────────────────────────────────────────────

  function removeWidget() {
    const host = document.getElementById('__sentinel_host__')
    if (!host) return

    host.style.opacity = '0'
    host.style.transform = 'scale(0.95) translateY(-8px)'
    setTimeout(() => {
      host.remove()
      window.removeEventListener('message', handleWidgetMessage)
      widgetMeta = null
    }, 220)
  }

  // ─── Minimize / Maximize ─────────────────────────────────────────────────

  function handleMinimize(host, iframe, shadow, minBtn) {
    if (!widgetMeta) return
    widgetMeta.minimized = !widgetMeta.minimized

    if (widgetMeta.minimized) {
      host.style.height = '44px'
      host.style.width = '220px'
      iframe.style.display = 'none'
      minBtn.textContent = '⊞'
      minBtn.title = 'Restore'
    } else {
      host.style.height = widgetMeta.maximized ? '90vh' : '560px'
      host.style.width = widgetMeta.maximized ? '480px' : '380px'
      iframe.style.display = 'block'
      minBtn.textContent = '−'
      minBtn.title = 'Minimize'
    }
  }

  function handleMaximize(host, maxBtn) {
    if (!widgetMeta || widgetMeta.minimized) return
    widgetMeta.maximized = !widgetMeta.maximized

    if (widgetMeta.maximized) {
      host.style.width = '480px'
      host.style.height = 'min(90vh, 700px)'
      maxBtn.textContent = '⊟'
      maxBtn.title = 'Restore size'
    } else {
      host.style.width = '380px'
      host.style.height = '560px'
      maxBtn.textContent = '⊡'
      maxBtn.title = 'Expand'
    }
  }

  // ─── Drag ─────────────────────────────────────────────────────────────────

  function setupDrag(handle, container, controlsEl) {
    let dragging = false
    let startX = 0, startY = 0, startLeft = 0, startTop = 0

    handle.addEventListener('mousedown', (e) => {
      // Don't initiate drag when clicking controls
      if (controlsEl.contains(e.target)) return

      dragging = true
      startX = e.clientX
      startY = e.clientY
      const rect = container.getBoundingClientRect()
      startLeft = rect.left
      startTop = rect.top
      handle.classList.add('dragging')
      e.preventDefault()
    })

    const onMove = (e) => {
      if (!dragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const maxLeft = window.innerWidth - container.offsetWidth
      const maxTop = window.innerHeight - container.offsetHeight
      const newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx))
      const newTop = Math.max(0, Math.min(maxTop, startTop + dy))
      container.style.left = `${newLeft}px`
      container.style.top = `${newTop}px`
      container.style.right = 'auto'
    }

    const onUp = () => {
      if (!dragging) return
      dragging = false
      handle.classList.remove('dragging')
    }

    document.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseup', onUp)
  }

  // ─── Messages from widget iframe ──────────────────────────────────────────

  function handleWidgetMessage(event) {
    const host = document.getElementById('__sentinel_host__')
    if (!host) return

    const shadow = host.shadowRoot
    if (!shadow) return

    const iframe = shadow.getElementById('s-iframe')
    if (!iframe || event.source !== iframe.contentWindow) return

    const { type } = event.data || {}

    switch (type) {
      case 'SENTINEL_CLOSE':
        removeWidget()
        break
      case 'SENTINEL_MINIMIZE': {
        const minBtn = shadow.querySelector('.s-btn-min')
        handleMinimize(host, iframe, shadow, minBtn)
        break
      }
      case 'SENTINEL_MAXIMIZE': {
        const maxBtn = shadow.querySelector('.s-btn-max')
        handleMaximize(host, maxBtn)
        break
      }
    }
  }

  // ─── Element finder ──────────────────────────────────────────────────────
  // Supports comma-separated selectors and :has-text("...") pseudo-selector

  function findElement(selectorStr) {
    if (!selectorStr) return null
    const selectors = selectorStr.split(',').map(s => s.trim())

    for (const sel of selectors) {
      const textMatch = sel.match(/^(.+?):has-text\("(.+?)"\)$/)
      if (textMatch) {
        const [, baseSelector, text] = textMatch
        try {
          const elements = document.querySelectorAll(baseSelector)
          for (const el of elements) {
            if (el.textContent?.trim().toLowerCase().includes(text.toLowerCase())) return el
          }
        } catch { /* invalid selector */ }
        continue
      }

      try {
        const el = document.querySelector(sel)
        if (el) return el
      } catch { /* invalid selector */ }
    }

    return null
  }

  // ─── DOM action handlers ──────────────────────────────────────────────────

  function handleDOMClick(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      sendResponse({ success: true, error: null, detail: `Clicked ${msg.selector}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMFill(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, msg.value ?? '')
      } else {
        el.value = msg.value ?? ''
      }
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      sendResponse({ success: true, error: null, detail: `Filled ${msg.selector}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMType(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
      const text = msg.text ?? ''
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        if (nativeSetter) {
          nativeSetter.call(el, (el.value || '') + char)
        } else {
          el.value = (el.value || '') + char
        }
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
      }
      sendResponse({ success: true, error: null, detail: `Typed into ${msg.selector}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMFocus(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
      sendResponse({ success: true, error: null, detail: `Focused ${msg.selector}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMScroll(msg, sendResponse) {
    try {
      const amount = msg.amount ?? 400
      const direction = msg.direction === 'up' ? -1 : 1
      window.scrollBy({ top: direction * amount, behavior: 'smooth' })
      sendResponse({ success: true, error: null, detail: `Scrolled ${msg.direction} by ${amount}px` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMSelect(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.value = msg.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      sendResponse({ success: true, error: null, detail: `Selected "${msg.value}" in ${msg.selector}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMSendKeys(msg, sendResponse) {
    try {
      const target = document.activeElement || document.body
      const keys = msg.keys ?? ''
      const keyMap = {
        'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
        'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
        'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
        'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        'Space': { key: ' ', code: 'Space', keyCode: 32 },
      }
      const mapped = keyMap[keys]
      if (mapped) {
        target.dispatchEvent(new KeyboardEvent('keydown', { ...mapped, bubbles: true }))
        target.dispatchEvent(new KeyboardEvent('keyup', { ...mapped, bubbles: true }))
      } else {
        for (const char of keys) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
          target.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))
          target.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
        }
      }
      sendResponse({ success: true, error: null, detail: `Sent keys: ${keys}` })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMElementExists(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      sendResponse({ success: !!el, error: null, detail: el ? 'Element found' : 'Element not found' })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMGetAttribute(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      const value = el.getAttribute(msg.attr)
      sendResponse({ success: true, error: null, detail: value })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMIsPassword(msg, sendResponse) {
    try {
      const el = findElement(msg.selector)
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      const isPassword = el.type === 'password' || el.getAttribute('type') === 'password'
      sendResponse({ success: isPassword, error: null, detail: isPassword ? 'Password field' : 'Not a password field' })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  function handleDOMExtract(msg, sendResponse) {
    try {
      const el = msg.selector ? findElement(msg.selector) : document.body
      if (!el) {
        sendResponse({ success: false, error: `Element not found: ${msg.selector}`, detail: null })
        return
      }
      // Use innerText for rendered text (respects CSS visibility); fall back to textContent
      const text = (el.innerText || el.textContent || '').trim()
      // Cap at 4000 chars so the detail stays readable in the widget
      const clipped = text.length > 4000 ? text.slice(0, 4000) + '\n[...truncated]' : text
      sendResponse({ success: true, error: null, detail: clipped })
    } catch (err) {
      sendResponse({ success: false, error: err.message, detail: null })
    }
  }

  // ─── Message handlers ─────────────────────────────────────────────────────

  const DOM_HANDLERS = {
    'DOM_CLICK': handleDOMClick,
    'DOM_FILL': handleDOMFill,
    'DOM_TYPE': handleDOMType,
    'DOM_FOCUS': handleDOMFocus,
    'DOM_SCROLL': handleDOMScroll,
    'DOM_SELECT': handleDOMSelect,
    'DOM_SEND_KEYS': handleDOMSendKeys,
    'DOM_ELEMENT_EXISTS': handleDOMElementExists,
    'DOM_GET_ATTRIBUTE': handleDOMGetAttribute,
    'DOM_IS_PASSWORD': handleDOMIsPassword,
    'DOM_EXTRACT':     handleDOMExtract,
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    console.log('[Sentinel] Content script received message:', msg.type)

    if (msg.type === 'TOGGLE_WIDGET') {
      console.log('[Sentinel] Toggling widget')
      toggleWidget()
      sendResponse({ ok: true })
      return true
    }

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

    const handler = DOM_HANDLERS[msg.type]
    if (handler) {
      handler(msg, sendResponse)
      return true
    }
  })
})()
