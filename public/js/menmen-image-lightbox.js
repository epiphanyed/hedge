'use strict'

let overlay = null
let wheelHandler = null
const boundRoots = new WeakSet()
const ZOOM_MIN = 0.25
const ZOOM_MAX = 8

function isZoomable (img) {
  if (!img || img.tagName !== 'IMG') return false
  if (img.closest('.menmen-ink-pad, .menmen-ink-overlay, .menmen-img-lightbox')) return false
  if (img.classList.contains('emoji')) return false
  if (img.classList.contains('chem-3d-snapshot') && img.offsetParent === null) return false
  const src = (img.getAttribute('src') || '').trim()
  if (!src) return false
  if (/^data:image\/svg/i.test(src)) return false
  const rect = img.getBoundingClientRect()
  if (rect.width > 0 && rect.width < 20 && rect.height > 0 && rect.height < 20) return false
  return true
}

export function closeMenmenImageLightbox () {
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
  if (e.key === 'Escape') closeMenmenImageLightbox()
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

  const big = document.createElement('img')
  big.src = img.currentSrc || img.src
  big.alt = img.alt || ''

  overlay.appendChild(closeBtn)
  stage.appendChild(big)
  overlay.appendChild(stage)
  document.body.appendChild(overlay)
  document.body.classList.add('menmen-img-lightbox-open')

  let scale = 1
  const applyScale = () => {
    big.style.transform = scale === 1 ? '' : `scale(${scale})`
  }
  wheelHandler = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const step = e.deltaY > 0 ? 0.9 : 1.1
    scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * step))
    applyScale()
  }
  overlay.addEventListener('wheel', wheelHandler, { passive: false })

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === closeBtn) closeMenmenImageLightbox()
  })
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    closeMenmenImageLightbox()
  })
  big.addEventListener('dblclick', (e) => {
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
  openMenmenImageLightbox(img)
}

/** 在预览根节点上委托双击放大（finishView 每次更新后调用，WeakSet 保证只绑一次） */
export function bindPreviewImageLightbox (view) {
  const el = view && view.jquery ? view[0] : view
  if (!el || boundRoots.has(el)) return
  boundRoots.add(el)
  el.addEventListener('dblclick', onPreviewDblClick, true)
}

/** 非 webpack 页面（footer 独立脚本） */
export function initMenmenImageLightboxGlobal () {
  const root = document.querySelector('.ui-view-area .markdown-body') || document.getElementById('doc')
  if (root) bindPreviewImageLightbox(root)
}
