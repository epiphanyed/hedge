/* menmen: 手写板识别模式下拉（补齐/升级旧 UI） */
(function () {
  var MODES = [
    { id: 'latex', label: '数学公式' },
    { id: 'chem_eq', label: '化学方程式' },
    { id: 'chem', label: '化学结构式' }
  ]
  var KEY = 'menmen.ink.lastMode'

  function fillModeSelect (sel) {
    if (!sel) return
    var saved = localStorage.getItem(KEY) || 'latex'
    if (!MODES.some(function (m) { return m.id === saved })) saved = 'latex'
    var cur = sel.value
    sel.innerHTML = ''
    MODES.forEach(function (m) {
      var opt = document.createElement('option')
      opt.value = m.id
      opt.textContent = m.label
      sel.appendChild(opt)
    })
    if (MODES.some(function (m) { return m.id === cur })) sel.value = cur
    else sel.value = saved
  }

  function ensureSelect (panel) {
    if (!panel) return
    var recognizeBtn = panel.querySelector('.btn-recognize-text')
    if (!recognizeBtn || !panel.querySelector('.btn-undo')) return
    var sel = panel.querySelector('.ink-recog-mode')
    if (sel) {
      if (sel.options.length !== MODES.length) fillModeSelect(sel)
      return
    }
    sel = document.createElement('select')
    sel.className = 'ink-recog-mode'
    sel.title = '识别类型'
    fillModeSelect(sel)
    sel.addEventListener('change', function () {
      localStorage.setItem(KEY, sel.value)
    })
    panel.insertBefore(sel, recognizeBtn)
    if (recognizeBtn.textContent.indexOf('识别') >= 0) recognizeBtn.textContent = '识别并插入'
  }

  function activeMode () {
    var sel = document.querySelector('.menmen-ink-overlay .ink-recog-mode')
    return sel ? sel.value : (localStorage.getItem(KEY) || 'latex')
  }

  function scan () {
    document.querySelectorAll('.menmen-ink-panel').forEach(ensureSelect)
  }

  if (!window.__menmenInkRecogFetchPatched) {
    window.__menmenInkRecogFetchPatched = true
    var origFetch = window.fetch
    window.fetch = function (url, opts) {
      var u = typeof url === 'string' ? url : (url && url.url)
      if (u && u.indexOf('/api/vlm/recognize') >= 0 && opts && typeof opts.body === 'string') {
        try {
          var body = JSON.parse(opts.body)
          body.mode = activeMode()
          opts = Object.assign({}, opts, { body: JSON.stringify(body) })
        } catch (e) { /* ignore */ }
      }
      return origFetch.call(this, url, opts)
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
  else scan()
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.menmen-ink-toggle')) setTimeout(scan, 80)
  }, true)
  try {
    var obs = new MutationObserver(function () { scan() })
    obs.observe(document.body, { childList: true, subtree: true })
  } catch (e) { /* ignore */ }
})()
