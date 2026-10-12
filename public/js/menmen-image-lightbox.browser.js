/* menmen: 预览区图片双击放大 + 滚轮缩放 + 拖动平移（footer 独立加载） */
(function () {
  var overlay = null
  var wheelHandler = null
  var panWinMove = null
  var panWinUp = null
  var bound = false
  var ZOOM_MIN = 0.25
  var ZOOM_MAX = 16

  function isZoomable (img) {
    if (!img || img.tagName !== 'IMG') return false
    if (img.closest('.menmen-ink-pad, .menmen-ink-overlay, .menmen-img-lightbox')) return false
    if (img.classList.contains('emoji')) return false
    var canEditDrawio = Boolean(window.__menmenDrawio && typeof window.__menmenDrawio.canEdit === 'function' && window.__menmenDrawio.canEdit())
    if (img.classList.contains('menmen-drawio-editable') && canEditDrawio) return false
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
    if (panWinMove) {
      window.removeEventListener('pointermove', panWinMove, true)
      window.removeEventListener('mousemove', panWinMove, true)
      window.removeEventListener('touchmove', panWinMove, true)
      panWinMove = null
    }
    if (panWinUp) {
      window.removeEventListener('pointerup', panWinUp, true)
      window.removeEventListener('pointercancel', panWinUp, true)
      window.removeEventListener('mouseup', panWinUp, true)
      window.removeEventListener('touchend', panWinUp, true)
      window.removeEventListener('touchcancel', panWinUp, true)
      panWinUp = null
    }
    overlay.remove()
    overlay = null
    document.body.classList.remove('menmen-img-lightbox-open')
    document.removeEventListener('keydown', onKeydown)
  }

  function onKeydown (e) {
    if (e.key === 'Escape') closeLightbox()
  }

  function pointFromEvent (e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY, id: 'touch' }
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY, id: 'touch' }
    }
    return { x: e.clientX, y: e.clientY, id: e.pointerId != null ? e.pointerId : 'mouse' }
  }

  function attachLightboxPanZoom (stage, panEl, overlayEl) {
    var scale = 1
    var panX = 0
    var panY = 0
    var drag = null
    var moved = false

    function applyView () {
      panEl.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')'
    }

    function setGrabbing (on) {
      overlayEl.style.cursor = on ? 'grabbing' : 'grab'
      panEl.style.cursor = overlayEl.style.cursor
    }

    function zoomAt (clientX, clientY, nextScale) {
      nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale))
      if (nextScale === scale) return
      var stageRect = stage.getBoundingClientRect()
      var cx = stageRect.left + stageRect.width / 2 + panX
      var cy = stageRect.top + stageRect.height / 2 + panY
      var ratio = nextScale / scale
      panX += (clientX - cx) * (1 - ratio)
      panY += (clientY - cy) * (1 - ratio)
      scale = nextScale
      applyView()
    }

    wheelHandler = function (e) {
      e.preventDefault()
      e.stopPropagation()
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0) {
        panX -= e.deltaX
        panY -= e.deltaY
        applyView()
        return
      }
      var step = e.deltaY > 0 ? 0.9 : 1.1
      zoomAt(e.clientX, e.clientY, scale * step)
    }
    overlayEl.addEventListener('wheel', wheelHandler, { passive: false })

    function onPointerDown (e) {
      if (e.button != null && e.button !== 0 && !(e.touches && e.touches.length)) return
      if (e.target && e.target.closest && e.target.closest('.menmen-img-lightbox-close')) return
      e.preventDefault()
      e.stopPropagation()
      var pt = pointFromEvent(e)
      drag = { id: pt.id, x: pt.x, y: pt.y, panX: panX, panY: panY }
      moved = false
      if (e.pointerId != null) {
        try { stage.setPointerCapture(e.pointerId) } catch (err) { /* noop */ }
      }
      setGrabbing(true)
    }

    function onPointerMove (e) {
      if (!drag) return
      var pt = pointFromEvent(e)
      if (pt.id !== 'touch' && drag.id !== 'mouse' && pt.id !== drag.id) return
      e.preventDefault()
      e.stopPropagation()
      var dx = pt.x - drag.x
      var dy = pt.y - drag.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true
      panX = drag.panX + dx
      panY = drag.panY + dy
      applyView()
    }

    function endDrag (e) {
      if (!drag) return
      var pt = e ? pointFromEvent(e) : null
      if (pt && pt.id !== 'touch' && drag.id !== 'mouse' && pt.id !== drag.id) return
      drag = null
      setGrabbing(false)
      if (e && e.pointerId != null) {
        try { stage.releasePointerCapture(e.pointerId) } catch (err) { /* noop */ }
      }
      if (moved) {
        window.setTimeout(function () { moved = false }, 0)
      }
    }

    setGrabbing(false)
    applyView()
    var opts = { capture: true, passive: false }
    stage.addEventListener('pointerdown', onPointerDown, opts)
    stage.addEventListener('mousedown', onPointerDown, opts)
    stage.addEventListener('touchstart', onPointerDown, opts)
    panWinMove = onPointerMove
    panWinUp = endDrag
    window.addEventListener('pointermove', panWinMove, opts)
    window.addEventListener('mousemove', panWinMove, opts)
    window.addEventListener('touchmove', panWinMove, opts)
    window.addEventListener('pointerup', panWinUp, opts)
    window.addEventListener('pointercancel', panWinUp, opts)
    window.addEventListener('mouseup', panWinUp, opts)
    window.addEventListener('touchend', panWinUp, opts)
    window.addEventListener('touchcancel', panWinUp, opts)
    overlayEl.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.menmen-img-lightbox-close')) return
      if (!moved) return
      e.preventDefault()
      e.stopPropagation()
      moved = false
    }, true)
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
    var panEl = document.createElement('div')
    panEl.className = 'menmen-img-lightbox-pan'
    var big = document.createElement('img')
    big.src = img.currentSrc || img.src
    big.alt = img.alt || ''
    big.draggable = false
    overlay.appendChild(closeBtn)
    panEl.appendChild(big)
    stage.appendChild(panEl)
    overlay.appendChild(stage)
    document.body.appendChild(overlay)
    document.body.classList.add('menmen-img-lightbox-open')

    attachLightboxPanZoom(stage, panEl, overlay)

    function dropStrayLightboxes () {
      if (!overlay) return
      var boxes = document.querySelectorAll('.menmen-img-lightbox')
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i] !== overlay) boxes[i].remove()
      }
      document.body.classList.add('menmen-img-lightbox-open')
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(dropStrayLightboxes)
    setTimeout(dropStrayLightboxes, 0)

    function onClose (e) {
      e.preventDefault()
      e.stopPropagation()
      closeLightbox()
    }
    closeBtn.addEventListener('pointerdown', onClose, true)
    closeBtn.addEventListener('click', onClose, true)
    stage.addEventListener('dblclick', function (e) {
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

  window.__menmenImageLightbox = { open: openLightbox, close: closeLightbox }

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
