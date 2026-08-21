/* menmen: load MathJax only when the note actually contains math */
(function () {
  var loading = false
  var loaded = false
  var queue = []

  function serverBase () {
    if (window.config && window.config.serverURL) return window.config.serverURL
    var base = document.querySelector('base')
    return base ? base.href.replace(/\/$/, '') : ''
  }

  function typesetPending () {
    if (!window.MathJax || !window.MathJax.Hub) return
    var nodes = document.querySelectorAll('#doc span.mathjax')
    if (!nodes.length) return
    window.MathJax.Hub.Queue(['Typeset', window.MathJax.Hub, Array.prototype.slice.call(nodes)])
  }

  function flushQueue () {
    queue.forEach(function (fn) { fn() })
    queue = []
  }

  function loadScript (src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script')
      el.src = src
      el.onload = resolve
      el.onerror = reject
      document.head.appendChild(el)
    })
  }

  window.menmenEnsureMathJax = function (cb) {
    if (loaded && window.MathJax) {
      if (cb) cb()
      return
    }
    if (cb) queue.push(cb)
    if (loading) return
    loading = true

    var base = serverBase()
    var scripts = [
      base + '/js/mathjax-config-extra.js',
      base + '/build/MathJax/MathJax.js',
      base + '/build/MathJax/config/TeX-AMS-MML_HTMLorMML.js',
      base + '/build/MathJax/config/Safe.js'
    ]

    scripts.reduce(function (chain, src) {
      return chain.then(function () { return loadScript(src) })
    }, Promise.resolve()).then(function () {
      loaded = true
      flushQueue()
    }).catch(function (err) {
      loading = false
      console.warn('menmen: MathJax load failed', err)
    })
  }

  function watchPreview () {
    var doc = document.getElementById('doc')
    if (!doc) return
    var obs = new MutationObserver(function () {
      if (doc.querySelector('span.mathjax')) {
        window.menmenEnsureMathJax(typesetPending)
      }
    })
    obs.observe(doc, { childList: true, subtree: true })
  }

  document.addEventListener('DOMContentLoaded', function () {
    watchPreview()
    if (window.__menmenNeedsMathJax) {
      window.menmenEnsureMathJax(typesetPending)
    }
  })

  if (window.__menmenNeedsMathJax) {
    window.menmenEnsureMathJax(function () {})
  }
})()
