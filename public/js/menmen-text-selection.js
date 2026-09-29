/* menmen: 划词选区 postMessage 到 Plato 父页（跨端口 iframe 无法读 contentDocument） */
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

  function postToParent(text) {
    if (!window.parent || window.parent === window) return
    var payload = text.length >= MIN ? text.slice(0, 1000) : ''
    if (payload === lastSent) return
    lastSent = payload
    window.parent.postMessage({ type: 'menmen-hedgedoc-selection', text: payload }, '*')
  }

  function refresh() {
    postToParent(readSelection())
  }

  document.addEventListener('mouseup', refresh, true)
  document.addEventListener('keyup', refresh, true)
  document.addEventListener('selectionchange', refresh)
})()
