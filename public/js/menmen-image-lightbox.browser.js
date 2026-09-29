/* menmen: 预览区图片双击放大 + 滚轮缩放（footer 独立加载） */
(function () {
  var overlay = null
  var wheelHandler = null
  var bound = false
  var ZOOM_MIN = 0.25
  var ZOOM_MAX = 8

  function isZoomable (img) {
    if (!img || img.tagName !== 'IMG') return false
    if (img.closest('.menmen-ink-pad, .menmen-ink-overlay, .menmen-img-lightbox')) return false
    if (img.classList.contains('emoji')) return false
    var src = (img.getAttribute('src') || '').trim()
    if (!src || /^data:image\/svg/i.test(src)) return false
    var rect = img.getBoundingClientRect()
    if (rect.width > 0 && rect.width < 20 && rect.height > 0 && rect.height < 20) return false
    return true
  }

  function closeLightbox () {
    if (!overlay) return
    if (wheelHandler) {
      overlay.removeEventListener('wheel', wheelHandler)
      wheelHandler = null
    }
    overlay.remove()
    overlay = null
    document.body.classList.remove('menmen-img-lightbox-open')
    document.removeEventListener('keydown', onKeydown)
  }

  function onKeydown (e) {
    if (e.key === 'Escape') closeLightbox()
  }

  function openLightbox (img) {
    closeLightbox()
    overlay = document.createElement('div')
    overlay.className = 'menmen-img-lightbox'
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    var closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'menmen-img-lightbox-close'
    closeBtn.setAttribute('aria-label', '关闭')
    closeBtn.textContent = '\u00d7'
    var stage = document.createElement('div')
    stage.className = 'menmen-img-lightbox-stage'
    var big = document.createElement('img')
    big.src = img.currentSrc || img.src
    big.alt = img.alt || ''
    overlay.appendChild(closeBtn)
    stage.appendChild(big)
    overlay.appendChild(stage)
    document.body.appendChild(overlay)
    document.body.classList.add('menmen-img-lightbox-open')

    var scale = 1
    function applyScale () {
      big.style.transform = scale === 1 ? '' : 'scale(' + scale + ')'
    }
    wheelHandler = function (e) {
      e.preventDefault()
      e.stopPropagation()
      var step = e.deltaY > 0 ? 0.9 : 1.1
      scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * step))
      applyScale()
    }
    overlay.addEventListener('wheel', wheelHandler, { passive: false })

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === closeBtn) closeLightbox()
    })
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation()
      closeLightbox()
    })
    big.addEventListener('dblclick', function (e) {
      e.stopPropagation()
      closeLightbox()
    })
    document.addEventListener('keydown', onKeydown)
  }

  function onDblClick (e) {
    if (window.__menmenCustomUI === false) return
    var root = e.target.closest('.ui-view-area, #doc, .markdown-body')
    if (!root) return
    var img = e.target.closest('img')
    if (!img || !root.contains(img) || !isZoomable(img)) return
    e.preventDefault()
    e.stopPropagation()
    openLightbox(img)
  }

  function bind () {
    if (bound) return
    bound = true
    document.addEventListener('dblclick', onDblClick, true)
  }

  function signalReady () {
    try {
      document.dispatchEvent(new CustomEvent('menmen-lightbox-ready'))
    } catch (e) { /* IE */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bind()
      signalReady()
    })
  } else {
    bind()
    signalReady()
  }
})()
