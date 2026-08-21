/* menmen: load MathJax only when the note actually contains math */
(function () {
  var loading = false
  var loaded = false
  var queue = []
  var hubQueue = []
  var realHub = null

  function serverBase () {
    if (window.config && window.config.serverURL) return window.config.serverURL
    var base = document.querySelector('base')
    return base ? base.href.replace(/\/$/, '') : ''
  }

  function installHubQueue () {
    if (loaded) return
    if (!window.MathJax) window.MathJax = {}
    window.MathJax.Hub = {
      Queue: function () {
        if (loaded && realHub && typeof realHub.Queue === 'function') {
          return realHub.Queue.apply(realHub, arguments)
        }
        hubQueue.push(Array.prototype.slice.call(arguments))
        if (!loaded && !loading) {
          window.menmenEnsureMathJax(flushHubQueue)
        }
      }
    }
  }

  if (window.__menmenHubPending && window.__menmenHubPending.length) {
    hubQueue = hubQueue.concat(window.__menmenHubPending)
    window.__menmenHubPending = []
  }
  installHubQueue()

  function flushHubQueue () {
    if (!loaded || !realHub || typeof realHub.Queue !== 'function') return
    while (hubQueue.length) {
      var args = hubQueue.shift()
      try {
        realHub.Queue.apply(realHub, args)
      } catch (e) {
        console.warn('menmen: MathJax Hub.Queue replay failed', e)
      }
    }
  }

  function typesetPending () {
    if (!loaded || !realHub) return
    var nodes = document.querySelectorAll('#doc span.mathjax')
    if (!nodes.length) return
    realHub.Queue(['Typeset', realHub, Array.prototype.slice.call(nodes)])
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
    if (loaded && realHub) {
      if (cb) cb()
      return
    }
    if (cb) queue.push(cb)
    if (loading) return
    loading = true

    var base = serverBase()
    var configSrc = base + '/js/mathjax-config-extra.js'
    var scripts = [
      base + '/build/MathJax/MathJax.js',
      base + '/build/MathJax/config/TeX-AMS-MML_HTMLorMML.js',
      base + '/build/MathJax/config/Safe.js'
    ]

    loadScript(configSrc).then(function () {
      installHubQueue()
      return scripts.reduce(function (chain, src) {
        return chain.then(function () { return loadScript(src) })
      }, Promise.resolve())
    }).then(function () {
      realHub = window.MathJax && window.MathJax.Hub ? window.MathJax.Hub : null
      loaded = true
      flushHubQueue()
      flushQueue()
    }).catch(function (err) {
      loading = false
      realHub = null
      hubQueue = []
      installHubQueue()
      console.warn('menmen: MathJax load failed', err)
      if (window.viewAjaxCallback) window.viewAjaxCallback()
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
    installHubQueue()
    watchPreview()
    if (window.__menmenNeedsMathJax) {
      window.menmenEnsureMathJax(typesetPending)
    }
  })

  if (window.__menmenNeedsMathJax) {
    window.menmenEnsureMathJax(function () {})
  }
})()
