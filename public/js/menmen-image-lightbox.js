'use strict'

let overlay = null
let wheelHandler = null
let panWinMove = null
let panWinUp = null
const boundRoots = new WeakSet()
const ZOOM_MIN = 0.25
const ZOOM_MAX = 16

function isZoomable (img) {
  if (!img || img.tagName !== 'IMG') return false
  if (img.closest('.menmen-ink-pad, .menmen-ink-overlay, .menmen-img-lightbox')) return false
  if (img.classList.contains('emoji')) return false
  const canEditDrawio = Boolean(
    window.__menmenDrawio &&
    typeof window.__menmenDrawio.canEdit === 'function' &&
    window.__menmenDrawio.canEdit()
  )
  if (img.classList.contains('menmen-drawio-editable') && canEditDrawio) return false
  if (img.classList.contains('chem-3d-snapshot') && img.offsetParent === null) return false
  const src = (img.getAttribute('src') || '').trim()
  if (!src) return false
  if (/^data:image\/svg/i.test(src)) return false
  const rect = img.getBoundingClientRect()
  if (rect.width > 0 && rect.width < 20 && rect.height > 0 && rect.height < 20) return false
  return true
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

export function closeMenmenImageLightbox () {
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
  if (e.key === 'Escape') closeMenmenImageLightbox()
}

function attachLightboxPanZoom (stage, panEl, overlayEl) {
  let scale = 1
  let panX = 0
  let panY = 0
  let drag = null
  let moved = false

  const applyView = () => {
    panEl.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`
  }

  const setGrabbing = (on) => {
    overlayEl.style.cursor = on ? 'grabbing' : 'grab'
    panEl.style.cursor = overlayEl.style.cursor
  }

  const zoomAt = (clientX, clientY, nextScale) => {
    nextScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale))
    if (nextScale === scale) return
    const stageRect = stage.getBoundingClientRect()
    const cx = stageRect.left + stageRect.width / 2 + panX
    const cy = stageRect.top + stageRect.height / 2 + panY
    const ratio = nextScale / scale
    panX += (clientX - cx) * (1 - ratio)
    panY += (clientY - cy) * (1 - ratio)
    scale = nextScale
    applyView()
  }

  wheelHandler = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0) {
      panX -= e.deltaX
      panY -= e.deltaY
      applyView()
      return
    }
    const step = e.deltaY > 0 ? 0.9 : 1.1
    zoomAt(e.clientX, e.clientY, scale * step)
  }
  overlayEl.addEventListener('wheel', wheelHandler, { passive: false })

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0 && !(e.touches && e.touches.length)) return
    if (e.target && e.target.closest && e.target.closest('.menmen-img-lightbox-close')) return
    e.preventDefault()
    e.stopPropagation()
    const pt = pointFromEvent(e)
    drag = { id: pt.id, x: pt.x, y: pt.y, panX, panY }
    moved = false
    if (e.pointerId != null) {
      try { stage.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
    }
    setGrabbing(true)
  }
  const onPointerMove = (e) => {
    if (!drag) return
    const pt = pointFromEvent(e)
    if (pt.id !== 'touch' && drag.id !== 'mouse' && pt.id !== drag.id) return
    e.preventDefault()
    e.stopPropagation()
    const dx = pt.x - drag.x
    const dy = pt.y - drag.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true
    panX = drag.panX + dx
    panY = drag.panY + dy
    applyView()
  }
  const endDrag = (e) => {
    if (!drag) return
    const pt = e ? pointFromEvent(e) : null
    if (pt && pt.id !== 'touch' && drag.id !== 'mouse' && pt.id !== drag.id) return
    drag = null
    setGrabbing(false)
    if (e && e.pointerId != null) {
      try { stage.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
    }
    if (moved) {
      window.setTimeout(() => { moved = false }, 0)
    }
  }

  setGrabbing(false)
  applyView()
  const opts = { capture: true, passive: false }
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
  overlayEl.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('.menmen-img-lightbox-close')) return
    if (!moved) return
    e.preventDefault()
    e.stopPropagation()
    moved = false
  }, true)
}

export function openMenmenImageLightbox (img) {
  closeMenmenImageLightbox()
  overlay = document.createElement('div')
  overlay.className = 'menmen-img-lightbox'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'menmen-img-lightbox-close'
  closeBtn.setAttribute('aria-label', '关闭')
  closeBtn.textContent = '\u00d7'

  const stage = document.createElement('div')
  stage.className = 'menmen-img-lightbox-stage'

  const panEl = document.createElement('div')
  panEl.className = 'menmen-img-lightbox-pan'

  const big = document.createElement('img')
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

  const onClose = (e) => {
    e.preventDefault()
    e.stopPropagation()
    closeMenmenImageLightbox()
  }
  closeBtn.addEventListener('pointerdown', onClose, true)
  closeBtn.addEventListener('click', onClose, true)
  stage.addEventListener('dblclick', (e) => {
    e.stopPropagation()
    closeMenmenImageLightbox()
  })
  document.addEventListener('keydown', onKeydown)
}

function onPreviewDblClick (e) {
  if (window.__menmenCustomUI === false) return
  const img = e.target.closest('img')
  if (!img || !isZoomable(img)) return
  e.preventDefault()
  e.stopPropagation()
  if (window.__menmenImageLightbox && typeof window.__menmenImageLightbox.open === 'function') {
    window.__menmenImageLightbox.open(img)
    return
  }
  openMenmenImageLightbox(img)
}

/** 在预览根节点上委托双击放大（finishView 每次更新后调用，WeakSet 保证只绑一次） */
export function bindPreviewImageLightbox (view) {
  const el = view && view.jquery ? view[0] : view
  if (!el || boundRoots.has(el)) return
  boundRoots.add(el)
  el.addEventListener('dblclick', onPreviewDblClick, true)
  if (!window.__menmenImageLightbox) {
    window.__menmenImageLightbox = {
      open: openMenmenImageLightbox,
      close: closeMenmenImageLightbox
    }
  }
}

/** 非 webpack 页面（footer 独立脚本） */
export function initMenmenImageLightboxGlobal () {
  const root = document.querySelector('.ui-view-area .markdown-body') || document.getElementById('doc')
  if (root) bindPreviewImageLightbox(root)
}
