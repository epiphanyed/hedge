/* menmen: 划词选区 postMessage 到 Plato 父页 / React Native WebView */
;(function menmenTextSelectionBridge() {
  var MIN = 5
  var lastSent = ''

  function isMenmenGatewayHostname (host) {
    if (!host) return false
    if (host === 'localhost' || host === '127.0.0.1') return true
    if (host === 'menmendoc.com' || host === 'www.menmendoc.com') return true
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
    if (host === 'dev.menmendoc.test' || host.endsWith('.menmendoc.test')) return true
    if (host.endsWith('.menmendoc.com')) return true
    return false
  }

  function parentPostMessageTarget () {
    try {
      if (document.referrer) {
        var ref = new URL(document.referrer)
        if (isMenmenGatewayHostname(ref.hostname)) return ref.origin
      }
    } catch (e) { /* ignore */ }
    try {
      if (isMenmenGatewayHostname(window.location.hostname)) return window.location.origin
    } catch (e2) { /* ignore */ }
    return null
  }

  function readSelection() {
    try {
      return (window.getSelection && window.getSelection().toString().trim()) || ''
    } catch (e) {
      return ''
    }
  }

  function postToHost(text) {
    var payload = text.length >= MIN ? text.slice(0, 1000) : ''
    if (payload === lastSent) return
    lastSent = payload

    var msg = { type: 'menmen-hedgedoc-selection', text: payload }
    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg))
      }
      if (window.parent && window.parent !== window) {
        var target = parentPostMessageTarget()
        if (target) window.parent.postMessage(msg, target)
      }
    } catch (e) {
      /* ignore */
    }
  }

  function refresh() {
    postToHost(readSelection())
  }

  document.addEventListener('mouseup', refresh, true)
  document.addEventListener('keyup', refresh, true)
  document.addEventListener('touchend', refresh, true)
  document.addEventListener('selectionchange', refresh)
})()
