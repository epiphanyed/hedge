/* global serverurl */
'use strict'

import { noteid } from './lib/config/index'

const HW_COMMENT_RE = /^hw:([a-f0-9]{64})$/

function walkComments (root, cb) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null)
  let node = walker.nextNode()
  while (node) {
    cb(node)
    node = walker.nextNode()
  }
}

function findNextMathBlock (commentNode) {
  let el = commentNode.nextSibling
  while (el) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      if (el.classList && (el.classList.contains('MathJax') || el.classList.contains('katex-display') || el.tagName === 'MJX-CONTAINER')) {
        return el
      }
      if (el.querySelector && el.querySelector('.MathJax, .katex-display, mjx-container')) {
        return el
      }
    }
    if (el.nodeType === Node.COMMENT_NODE) break
    el = el.nextSibling
  }
  return null
}

function addEditButton (anchor, hash) {
  if (!anchor || anchor.querySelector('.menmen-hw-edit-btn')) return
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'menmen-hw-edit-btn btn btn-xs btn-default'
  btn.textContent = '编辑笔迹'
  btn.title = `hw:${hash}`
  btn.addEventListener('click', () => {
    require.ensure([], (req) => {
      req('./menmen-handwriting').loadHandwritingForEdit(hash).catch(err => {
        console.warn('loadHandwritingForEdit failed', err)
        alert('无法加载笔迹，请确认已登录且有读权限')
      })
    }, 'menmen-ink')
  })
  const wrap = document.createElement('span')
  wrap.className = 'menmen-hw-edit-wrap'
  wrap.appendChild(btn)
  if (anchor.parentNode) {
    anchor.parentNode.insertBefore(wrap, anchor.nextSibling)
  }
}

function scanGeoChemCellviz ($view) {
  $view.find('.geo3d-container[data-geo3d-hash], .chem-container, .cellviz-container').each(function () {
    const $c = $(this)
    let hash = $c.attr('data-geo3d-hash') || ''
    if (!hash) {
      const src = $c.find('.tab-source pre').text() || ''
      try {
        if ($c.hasClass('chem-container')) {
          const m = src.match(/^hw:\s*([a-f0-9]{64})/m)
          hash = m ? m[1] : ''
        } else {
          const ir = JSON.parse(src.trim())
          hash = ir.hw || ''
        }
      } catch (e) { /* ignore */ }
    }
    if (hash) addEditButton(this, hash)
  })
}

export function processHwReferences (view) {
  // 预览区不展示「编辑笔迹」；并清掉 partialUpdate 留下的旧按钮节点
  if (view && view.find) {
    view.find('.menmen-hw-edit-wrap').remove()
  }
}
