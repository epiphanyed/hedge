/* menmen: load MathJax only when the note actually contains math */
(function () {
  var loading = false
  var loaded = false
  var queue = []
  var hubQueue = []
  var realHub = null

  function serverBase () {
    try {
      if (window.location && window.location.origin && /^https?:/i.test(window.location.protocol)) {
        return window.location.origin.replace(/\/$/, '')
      }
    } catch (e) { /* ignore */ }
    var base = document.querySelector('base')
    if (base && base.href) return base.href.replace(/\/$/, '')
    if (window.config && window.config.serverURL) return window.config.serverURL
    return ''
  }

  function isRealHub (hub) {
    return hub && typeof hub.Queue === 'function' && !hub.__menmenStub
  }

  function installHubQueue () {
    if (loaded) return
    if (!window.MathJax) window.MathJax = {}
    if (isRealHub(window.MathJax.Hub)) {
      realHub = window.MathJax.Hub
      return
    }
    window.MathJax.Hub = {
      __menmenStub: true,
      Queue: function () {
        if (isRealHub(realHub)) {
          return realHub.Queue.apply(realHub, arguments)
        }
        hubQueue.push(Array.prototype.slice.call(arguments))
        if (!loaded && !loading) {
          window.menmenEnsureMathJax(flushHubQueue)
        }
      }
    }
  }

  function removeStubHub () {
    if (window.MathJax && window.MathJax.Hub && window.MathJax.Hub.__menmenStub) {
      delete window.MathJax.Hub
    }
  }

  function captureRealHub () {
    var hub = window.MathJax && window.MathJax.Hub
    if (!isRealHub(hub)) {
      return false
    }
    realHub = hub
    loaded = true
    return true
  }

  if (window.__menmenHubPending && window.__menmenHubPending.length) {
    hubQueue = hubQueue.concat(window.__menmenHubPending)
    window.__menmenHubPending = []
  }
  installHubQueue()

  function flushHubQueue () {
    if (!isRealHub(realHub)) return
    while (hubQueue.length) {
      var args = hubQueue.shift()
      try {
        realHub.Queue.apply(realHub, args)
      } catch (e) {
        console.warn('menmen: MathJax Hub.Queue replay failed', e)
      }
    }
  }

  function previewRoot () {
    return document.querySelector('.ui-view-area .markdown-body') || document.getElementById('doc')
  }

  /** 预览区是否含公式（含未包裹为 span.mathjax 的 \\[ \\]） */
  function domHintsMath (root) {
    root = root || previewRoot()
    if (!root) return false
    if (root.querySelector('span.mathjax')) return true
    var text = root.textContent || ''
    return (
      /\\[\[\(]/.test(text) ||
      /\$\$[\s\S]+?\$\$/.test(text) ||
      /(^|[^\\])\$(?!\$)[^\$\n]+?\$/.test(text)
    )
  }

  /** 协同/只读视图偶发未走 markdown-it-mathjax，将裸 TeX 包成 span.mathjax */
  function wrapOrphanLatexInRoot (root) {
    if (!root) return false
    var changed = false
    var blocks = root.querySelectorAll('p, li, blockquote, td, th, div')
    blocks.forEach(function (el) {
      if (el.closest('pre, code, textarea, .CodeMirror')) return
      if (el.querySelector('span.mathjax, pre, code')) return
      var html = el.innerHTML
      if (!html || (html.indexOf('\\[') < 0 && html.indexOf('\\(') < 0)) return
      var next = html
      next = next.replace(/\\\[([\s\S]*?)\\\]/g, '<span class="mathjax raw">\\[$1\\]</span>')
      next = next.replace(/\\\(([\s\S]*?)\\\)/g, '<span class="mathjax raw">\\($1\\)</span>')
      next = next.replace(
        /(^|[^\\])\$(?!\$)([^\$\n]+?)\$/g,
        '$1<span class="mathjax raw">\\($2\\)</span>'
      )
      if (next !== html) {
        el.innerHTML = next
        changed = true
      }
    })
    return changed
  }

  function typesetPending () {
    var root = previewRoot()
    wrapOrphanLatexInRoot(root)
    if (!isRealHub(realHub)) return
    var nodes = root
      ? root.querySelectorAll('span.mathjax')
      : document.querySelectorAll('#doc span.mathjax, .ui-view-area span.mathjax')
    if (nodes.length) {
      Array.prototype.forEach.call(nodes, function (n) {
        n.classList.remove('raw')
      })
      realHub.Queue(['Typeset', realHub, Array.prototype.slice.call(nodes)])
      return
    }
    if (root && domHintsMath(root)) {
      realHub.Queue(['Typeset', realHub, root])
    }
  }

  function scheduleMathPass () {
    var root = previewRoot()
    wrapOrphanLatexInRoot(root)
    if (domHintsMath(root)) {
      window.menmenEnsureMathJax(typesetPending)
    }
  }

  var mathRetryToken = 0
  function scheduleMathPassWithRetries () {
    var token = ++mathRetryToken
    var delays = [0, 120, 350, 700, 1500, 2800]
    delays.forEach(function (delay) {
      setTimeout(function () {
        if (token !== mathRetryToken) return
        scheduleMathPass()
      }, delay)
    })
  }

  window.menmenScheduleMathTypeset = scheduleMathPass
  window.menmenScheduleMathTypesetWithRetries = scheduleMathPassWithRetries

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

  function mathJaxBundledInPage () {
    return !!(window.__menmenMathJaxBundled || (window.MathJax && window.MathJax.Hub && !window.MathJax.Hub.__menmenStub))
  }

  window.menmenEnsureMathJax = function (cb) {
    if (loaded && isRealHub(realHub)) {
      if (cb) cb()
      return
    }
    if (mathJaxBundledInPage() && !loaded) {
      if (captureRealHub()) {
        flushHubQueue()
        flushQueue()
        if (cb) cb()
        return
      }
      loading = true
      var waitBundled = 0
      var waitTimer = setInterval(function () {
        waitBundled++
        if (captureRealHub()) {
          clearInterval(waitTimer)
          loading = false
          flushHubQueue()
          flushQueue()
        } else if (waitBundled > 80) {
          clearInterval(waitTimer)
          loading = false
        }
      }, 100)
      if (cb) queue.push(cb)
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
      removeStubHub()
      return scripts.reduce(function (chain, src) {
        return chain.then(function () { return loadScript(src) })
      }, Promise.resolve())
    }).then(function () {
      if (!captureRealHub()) {
        throw new Error('MathJax Hub unavailable after script load')
      }
      flushHubQueue()
      flushQueue()
    }).catch(function (err) {
      loading = false
      loaded = false
      realHub = null
      installHubQueue()
      console.warn('menmen: MathJax load failed', err)
      if (window.viewAjaxCallback) window.viewAjaxCallback()
    })
  }

  function shouldEagerLoadMathJax () {
    return !!(window.__menmenNeedsMathJax || window.__menmenCustomUI)
  }

  function watchPreview () {
    var attached = false
    function attach () {
      var doc = previewRoot()
      if (!doc) {
        setTimeout(attach, 150)
        return
      }
      if (attached) return
      attached = true
      var debounce = null
      function bump () {
        clearTimeout(debounce)
        debounce = setTimeout(scheduleMathPass, 80)
      }
      var obs = new MutationObserver(function () {
        bump()
      })
      obs.observe(doc, { childList: true, subtree: true, characterData: true })
      scheduleMathPass()
    }
    attach()
  }

  document.addEventListener('DOMContentLoaded', function () {
    installHubQueue()
    watchPreview()
    scheduleMathPassWithRetries()
    if (shouldEagerLoadMathJax()) {
      window.menmenEnsureMathJax(typesetPending)
    }
  })

  if (shouldEagerLoadMathJax()) {
    window.menmenEnsureMathJax(function () {})
  }

  function setupHostMathBridge () {
    function handleHostMathMessage (e) {
      var data = e.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch (err) {
          return
        }
      }
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'menmen-math-typeset') {
        scheduleMathPassWithRetries()
      }
    }
    window.addEventListener('message', handleHostMathMessage)
    document.addEventListener('message', handleHostMathMessage)
  }

  setupHostMathBridge()

  if (window.ReactNativeWebView) {
    document.addEventListener('DOMContentLoaded', function () {
      scheduleMathPassWithRetries()
      setTimeout(scheduleMathPassWithRetries, 1200)
      setTimeout(scheduleMathPassWithRetries, 3500)
    })
  }
})()
