/* menmen: 划词选区 postMessage 到 Plato 父页 / React Native WebView */
;(function menmenTextSelectionBridge() {
  var MIN = 5
  var lastSent = ''

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
        window.parent.postMessage(msg, '*')
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
