/* global serverurl, MathJax */
'use strict'

import '../css/menmen-ink.css'
import { inkToolSvg } from './menmen-ink-icons'
import { noteid } from './lib/config/index'
import getUIElements from './lib/editor/ui-elements'
import { insertLatexHwBlock, mathInsertIsInline } from './menmen-math-delimiters'
import { getStroke as perfectFreehandGetStroke } from 'perfect-freehand'
import katexMod from 'katex'
import 'katex/dist/katex.min.css'

const LOGIC_W = 1200
const LOGIC_H = 800
const PRESET_COLORS = ['#111', '#555', '#E5484D', '#F76B15', '#F5D90A', '#30A46C', '#12A594', '#3E63DD', '#8E4EC6', '#E93D82', '#A18072', '#FFF']
const TOOL_DEFS = [
  { id: 'color', label: 'Color', shortcut: 'C' },
  { id: 'pencil', label: 'Pencil', shortcut: '1' },
  { id: 'ballpoint', label: 'Ballpoint', shortcut: '2' },
  { id: 'brush', label: 'Brush', shortcut: '3' },
  { id: 'fineliner', label: 'Fineliner', shortcut: '4' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' }
]

const TOOL_OPTS = {
  pencil: { size: 2, thinning: 0.5, smoothing: 0.5, streamline: 0.4, simulatePressure: true },
  ballpoint: { size: 1.5, thinning: 0.15, smoothing: 0.35, streamline: 0.3, simulatePressure: true },
  brush: { size: 10, thinning: 0.75, smoothing: 0.6, streamline: 0.5, simulatePressure: true },
  fineliner: { size: 3, thinning: 0, smoothing: 0.8, streamline: 0.6, simulatePressure: false }
}

let getStroke = null
let katex = null
let editorInstance = null
let cm = null
let overlayOpen = false
let insertBookmark = null
let activeTool = 'ballpoint'
let color = '#111111'
let alpha = 1
let eraserRadius = 14
let strokes = []
let undoStack = []
let redoStack = []
let currentStroke = null
let pointerDown = false
let rafId = null
let committedCanvas = null
let liveCanvas = null
let liveCtx = null
let committedCtx = null
let scale = 1
let dpr = 1
let vlmAvailable = null
let pollTimer = null
let pendingCommitKey = 'menmen.ink.pendingCommit'
let recognizeMode = localStorage.getItem('menmen.ink.lastMode') || 'latex'
let editTargetHash = null
let editBlockRange = null
let editConflict = null
let docChangeHandler = null

const RECOG_MODES = [
  { id: 'latex', label: '公式 LaTeX' },
  { id: 'geo3d', label: '数学立体图形' },
  { id: 'chem', label: '化学分子' },
  { id: 'cellviz', label: '细胞结构' }
]

async function getRecognizeModes () {
  const modes = RECOG_MODES.slice()
  try {
    const res = await fetch(`${serverurl}/api/vlm/readyz`, { credentials: 'same-origin' })
    if (res.ok) {
      const body = await res.json()
      if (body.autoEnabled && !modes.some(m => m.id === 'auto')) {
        modes.unshift({ id: 'auto', label: '自动识别' })
      }
    }
  } catch (e) { /* ignore */ }
  return modes
}

function loadToolPrefs () {
  try {
    const raw = localStorage.getItem('menmen.ink.tools')
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

function saveToolPref (tool, patch) {
  const all = loadToolPrefs()
  all[tool] = Object.assign({}, all[tool] || {}, patch)
  localStorage.setItem('menmen.ink.tools', JSON.stringify(all))
}

function toolColor () {
  return color
}

function svgToolIcon (tool) {
  return inkToolSvg(tool, 'var(--ink-color)', tool === 'color' ? toolColor() : undefined)
}

function ensureModules () {
  if (!getStroke) getStroke = perfectFreehandGetStroke
  return Promise.resolve()
}

function ensureKatex () {
  if (!katex) katex = katexMod.default || katexMod
  return Promise.resolve()
}

function sessionKey () {
  return `menmen.ink.session.${noteid || 'draft'}`
}

function saveSession () {
  try {
    sessionStorage.setItem(sessionKey(), JSON.stringify({ strokes, w: LOGIC_W, h: LOGIC_H, v: 1, bg: '#FFFFFF' }))
  } catch (e) { /* ignore quota */ }
}

function loadSession () {
  try {
    const raw = sessionStorage.getItem(sessionKey())
    if (!raw) return
    const data = JSON.parse(raw)
    if (Array.isArray(data.strokes)) strokes = data.strokes
  } catch (e) { /* ignore */ }
}

function logicPoint (e, canvas) {
  const rect = canvas.getBoundingClientRect()
  const x = (e.clientX - rect.left) / scale
  const y = (e.clientY - rect.top) / scale
  const pressure = (e.pressure && e.pressure !== 0) ? e.pressure : 0.5
  return [x, y, pressure, e.tiltX || 0, e.tiltY || 0, Date.now()]
}

function strokeOptions (tool, strokeColor, strokeAlpha) {
  const base = TOOL_OPTS[tool] || TOOL_OPTS.ballpoint
  return {
    size: base.size,
    thinning: base.thinning,
    smoothing: base.smoothing,
    streamline: base.streamline,
    simulatePressure: base.simulatePressure,
    easing: t => t,
    start: { taper: tool === 'ballpoint' ? 0 : 6, cap: true },
    end: { taper: tool === 'ballpoint' ? 2 : 6, cap: true },
    last: true
  }
}

function polygonFromStroke (stroke) {
  if (!getStroke || !stroke.points.length) return null
  const outline = getStroke(stroke.points, strokeOptions(stroke.tool, stroke.color, stroke.alpha))
  if (!outline.length) return null
  return outline
}

function drawStrokeOnCtx (ctx, stroke) {
  const poly = polygonFromStroke(stroke)
  if (!poly) return
  ctx.save()
  ctx.globalAlpha = stroke.alpha
  ctx.fillStyle = stroke.color
  ctx.beginPath()
  ctx.moveTo(poly[0][0] * scale, poly[0][1] * scale)
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i][0] * scale, poly[i][1] * scale)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function redrawCommitted () {
  if (!committedCtx || !committedCanvas) return
  committedCtx.clearRect(0, 0, committedCanvas.width, committedCanvas.height)
  committedCtx.save()
  committedCtx.scale(dpr, dpr)
  strokes.forEach(s => drawStrokeOnCtx(committedCtx, s))
  committedCtx.restore()
}

function redrawLive () {
  if (!liveCtx || !liveCanvas) return
  liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height)
  liveCtx.save()
  liveCtx.scale(dpr, dpr)
  if (committedCanvas) {
    liveCtx.drawImage(committedCanvas, 0, 0, liveCanvas.width / dpr, liveCanvas.height / dpr)
  }
  if (currentStroke) drawStrokeOnCtx(liveCtx, currentStroke)
  liveCtx.restore()
}

function scheduleLiveRedraw () {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    redrawLive()
  })
}

function resizeCanvases (container) {
  const pad = container.classList.contains('menmen-ink-pad') ? container : container.closest('.menmen-ink-pad')
  const rect = pad ? pad.getBoundingClientRect() : container.getBoundingClientRect()
  const chrome = pad ? inkPadChromeHeight(pad) : 0
  const drawH = Math.max(1, rect.height - chrome)
  scale = Math.min(rect.width / LOGIC_W, drawH / LOGIC_H)
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.max(1, Math.floor(rect.width * dpr))
  const h = Math.max(1, Math.floor(drawH * dpr))
  ;[committedCanvas, liveCanvas].forEach(c => {
    c.width = w
    c.height = h
    c.style.width = `${rect.width}px`
    c.style.height = `${rect.height}px`
  })
  committedCtx = committedCanvas.getContext('2d')
  liveCtx = liveCanvas.getContext('2d')
  redrawCommitted()
  redrawLive()
}

function newStrokeId () {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function hitStroke (x, y) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]
    for (const p of s.points) {
      const dx = p[0] - x
      const dy = p[1] - y
      if (Math.hypot(dx, dy) < eraserRadius + (s.width || 2)) return i
    }
  }
  return -1
}

function onPointerDown (e) {
  if (!overlayOpen) return
  e.preventDefault()
  liveCanvas.setPointerCapture(e.pointerId)
  pointerDown = true
  const pt = logicPoint(e, liveCanvas)
  if (activeTool === 'eraser') {
    const idx = hitStroke(pt[0], pt[1])
    if (idx >= 0) {
      const removed = strokes.splice(idx, 1)
      undoStack.push({ type: 'erase', removed, added: [] })
      redoStack = []
      redrawCommitted()
      redrawLive()
      saveSession()
    }
    return
  }
  currentStroke = {
    id: newStrokeId(),
    tool: activeTool,
    color,
    alpha,
    width: (TOOL_OPTS[activeTool] || TOOL_OPTS.ballpoint).size,
    points: [pt]
  }
}

function onPointerMove (e) {
  if (!pointerDown || !currentStroke) return
  e.preventDefault()
  currentStroke.points.push(logicPoint(e, liveCanvas))
  scheduleLiveRedraw()
}

function onPointerUp (e) {
  if (!pointerDown) return
  pointerDown = false
  if (currentStroke && currentStroke.points.length > 1) {
    strokes.push(currentStroke)
    undoStack.push({ type: 'draw', stroke: currentStroke })
    redoStack = []
    saveSession()
    redrawCommitted()
  }
  currentStroke = null
  redrawLive()
}

function normalizeImage () {
  const off = document.createElement('canvas')
  const short = Math.min(LOGIC_W, LOGIC_H)
  const lineW = short / 200
  off.width = LOGIC_W
  off.height = LOGIC_H
  const ctx = off.getContext('2d')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, LOGIC_W, LOGIC_H)

  const filtered = strokes.filter(s => s.alpha > 0.5 && !(s.tool === 'brush' && s.width >= 16))
  filtered.forEach(s => {
    const fake = Object.assign({}, s, {
      tool: 'ballpoint',
      color: '#111111',
      alpha: 1,
      points: s.points
    })
    const poly = polygonFromStroke(fake)
    if (!poly || !poly.length) return
    ctx.fillStyle = '#111'
    ctx.beginPath()
    ctx.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
    ctx.closePath()
    ctx.fill()
  })

  let minX = LOGIC_W; let minY = LOGIC_H; let maxX = 0; let maxY = 0
  const img = ctx.getImageData(0, 0, LOGIC_W, LOGIC_H)
  for (let y = 0; y < LOGIC_H; y++) {
    for (let x = 0; x < LOGIC_W; x++) {
      if (img.data[(y * LOGIC_W + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
    }
  }
  if (maxX <= minX) {
    return off.toDataURL('image/png')
  }
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05)
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(LOGIC_W - 1, maxX + pad); maxY = Math.min(LOGIC_H - 1, maxY + pad)
  const cw = maxX - minX + 1
  const ch = maxY - minY + 1
  const crop = document.createElement('canvas')
  const edge = Math.min(896, Math.max(cw, ch))
  crop.width = edge
  crop.height = edge
  const cctx = crop.getContext('2d')
  cctx.fillStyle = '#FFFFFF'
  cctx.fillRect(0, 0, edge, edge)
  const scaleFit = edge / Math.max(cw, ch)
  cctx.drawImage(off, minX, minY, cw, ch, (edge - cw * scaleFit) / 2, (edge - ch * scaleFit) / 2, cw * scaleFit, ch * scaleFit)
  return crop.toDataURL('image/png')
}

async function checkVlmAvailable () {
  if (vlmAvailable !== null) return vlmAvailable
  try {
    const res = await fetch(`${serverurl}/api/vlm/readyz`, { credentials: 'same-origin' })
    vlmAvailable = res.ok
  } catch (e) {
    vlmAvailable = false
  }
  return vlmAvailable
}

async function recognize (mode, hint) {
  await ensureModules()
  const image = normalizeImage()
  const payload = {
    image,
    strokes: { v: 1, w: LOGIC_W, h: LOGIC_H, bg: '#FFFFFF', strokes },
    mode: mode || 'latex',
    hint: hint || undefined,
    noteId: noteid
  }
  const res = await fetch(`${serverurl}/api/vlm/recognize`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const body = await res.json()
  if (res.status === 503) throw new Error('识别服务不可用')
  if (res.status === 429) throw new Error('队列已满，请稍后重试')
  if (!res.ok && res.status !== 202) throw new Error(body.message || '识别失败')
  return body
}

async function pollJob (scope, hash) {
  const start = Date.now()
  let delay = 1000
  while (Date.now() - start < 360000) {
    const res = await fetch(`${serverurl}/api/vlm/jobs/${scope}/${hash}`, { credentials: 'same-origin' })
    const body = await res.json()
    if (body.status === 'done') return body.result
    if (body.status === 'error') throw new Error(body.error || '识别错误')
    if (body.status === 'lost' || body.status === 'expired') throw new Error('任务丢失，请重试')
    await new Promise(r => { pollTimer = setTimeout(r, delay) })
    delay = Math.min(5000, Math.round(delay * 1.4))
  }
  throw new Error('识别超时')
}

async function mathjaxReady () {
  if (typeof MathJax === 'undefined' || !MathJax.startup) {
    await new Promise(r => setTimeout(r, 300))
  }
  if (MathJax.startup && MathJax.startup.promise) {
    await MathJax.startup.promise
  }
}

async function verifyMathPreview (latex) {
  await ensureKatex()
  try {
    katex.renderToString(latex, { throwOnError: true })
  } catch (e) {
    return { ok: false, error: e.message }
  }
  await mathjaxReady()
  const el = document.createElement('div')
  el.textContent = `$$${latex}$$`
  try {
    if (MathJax.typesetPromise) {
      await MathJax.typesetPromise([el])
    }
    return { ok: true, html: el.innerHTML }
  } catch (e) {
    return { ok: false, error: 'MathJax 预览失败' }
  }
}

function queuePendingCommit (item) {
  let list = []
  try { list = JSON.parse(localStorage.getItem(pendingCommitKey) || '[]') } catch (e) { list = [] }
  list.push(item)
  localStorage.setItem(pendingCommitKey, JSON.stringify(list))
}

async function commitHandwriting (scope, hash) {
  const res = await fetch(`${serverurl}/api/vlm/commit`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, hash, noteId: noteid })
  })
  if (!res.ok) throw new Error('commit failed')
  return res.json()
}

async function retryPendingCommits () {
  let list = []
  try { list = JSON.parse(localStorage.getItem(pendingCommitKey) || '[]') } catch (e) { return }
  const remain = []
  for (const item of list) {
    if (item.noteId !== noteid) { remain.push(item); continue }
    try {
      await commitHandwriting(item.scope, item.hash)
    } catch (e) {
      remain.push(item)
    }
  }
  localStorage.setItem(pendingCommitKey, JSON.stringify(remain))
  updatePendingCommitBanner(remain.filter(i => i.noteId === noteid).length)
}

function updatePendingCommitBanner (count) {
  const ui = getUIElements()
  const editArea = ui.area && ui.area.edit && ui.area.edit[0]
  if (!editArea) return
  let banner = editArea.querySelector('.menmen-ink-pending-banner')
  if (!count) {
    if (banner) banner.remove()
    return
  }
  if (!banner) {
    banner = document.createElement('div')
    banner.className = 'menmen-ink-pending-banner alert alert-warning'
    banner.setAttribute('role', 'status')
    editArea.insertBefore(banner, editArea.firstChild)
  }
  banner.textContent = `有 ${count} 条笔迹尚未持久化，打开笔记时将自动重试 commit`
}

function replaceAtBookmark (block) {
  if (insertBookmark) {
    insertBookmark.replace(block)
    insertBookmark.clear()
    insertBookmark = null
  } else {
    cm.replaceRange(block, cm.getCursor())
  }
}

function rangesIntersect (fromA, toA, fromB, toB) {
  if (cm.comparePos(toA, fromB) <= 0) return false
  if (cm.comparePos(toB, fromA) <= 0) return false
  return true
}

function findHwBlockTarget (hash) {
  const doc = cm.getValue()
  const latexRe = new RegExp(`<!--\\s*hw:${hash}\\s*-->\\s*\\n(?:\\$\\$[\\s\\S]*?\\$\\$|\\$[^\\n$]+\\$)`, 'm')
  let m = latexRe.exec(doc)
  if (m) {
    return { from: cm.posFromIndex(m.index), to: cm.posFromIndex(m.index + m[0].length), kind: 'latex', hash }
  }
  const fenceRe = /```(geo3d|cellviz)\s*\n([\s\S]*?)```/g
  let fm
  while ((fm = fenceRe.exec(doc)) !== null) {
    try {
      const ir = JSON.parse(fm[2].trim())
      if (ir.hw === hash) {
        return { from: cm.posFromIndex(fm.index), to: cm.posFromIndex(fm.index + fm[0].length), kind: fm[1], hash }
      }
    } catch (e) { /* ignore */ }
  }
  const chemRe = /```chem\s*\n([\s\S]*?)```/g
  while ((fm = chemRe.exec(doc)) !== null) {
    if (new RegExp(`^hw:\\s*${hash}\\s*$`, 'm').test(fm[1])) {
      return { from: cm.posFromIndex(fm.index), to: cm.posFromIndex(fm.index + fm[0].length), kind: 'chem', hash }
    }
  }
  return null
}

function parseHwFromTarget (target) {
  if (!target) return null
  const block = cm.getRange(target.from, target.to)
  const hm = block.match(/hw:([a-f0-9]{64})/) || block.match(/"hw"\s*:\s*"([a-f0-9]{64})"/)
  return hm ? hm[1] : target.hash
}

function stopEditWatch () {
  editTargetHash = null
  editBlockRange = null
  editConflict = null
  if (docChangeHandler && cm) {
    cm.off('change', docChangeHandler)
    docChangeHandler = null
  }
}

function updateConflictUi (panel) {
  if (!panel) return
  const banner = panel.querySelector('.menmen-ink-conflict')
  const btnInsert = panel.querySelector('.btn-insert')
  const btnOverwrite = panel.querySelector('.btn-overwrite')
  const btnAppend = panel.querySelector('.btn-append')
  if (editConflict) {
    if (banner) {
      banner.classList.remove('hidden')
      const nh = editConflict.newHash
      banner.textContent = nh && nh !== editTargetHash
        ? `该笔迹已被协同者修改（hw:${nh.slice(0, 8)}…），请选择插入方式`
        : '该笔迹块已被协同者修改，请选择插入方式'
    }
    if (btnInsert) btnInsert.classList.add('hidden')
    if (btnOverwrite) btnOverwrite.classList.remove('hidden')
    if (btnAppend) btnAppend.classList.remove('hidden')
  } else {
    if (banner) banner.classList.add('hidden')
    if (btnInsert) btnInsert.classList.remove('hidden')
    if (btnOverwrite) btnOverwrite.classList.add('hidden')
    if (btnAppend) btnAppend.classList.add('hidden')
  }
}

function startEditWatch (hash, panel) {
  stopEditWatch()
  editTargetHash = hash
  const target = findHwBlockTarget(hash)
  editBlockRange = target ? { from: target.from, to: target.to } : null
  docChangeHandler = (instance, changeObj) => {
    if (!editTargetHash || !editBlockRange) return
    if (!rangesIntersect(editBlockRange.from, editBlockRange.to, changeObj.from, changeObj.to)) return
    let current = findHwBlockTarget(editTargetHash)
    if (!current) {
      const fromIdx = cm.indexFromPos(editBlockRange.from)
      const snippet = cm.getValue().slice(Math.max(0, fromIdx - 200), fromIdx + 800)
      const hm = snippet.match(/hw:([a-f0-9]{64})/) || snippet.match(/"hw"\s*:\s*"([a-f0-9]{64})"/)
      if (hm) current = findHwBlockTarget(hm[1])
    }
    if (!current) {
      editBlockRange = null
      return
    }
    editConflict = { newHash: parseHwFromTarget(current), target: current }
    editBlockRange = { from: current.from, to: current.to }
    updateConflictUi(panel || document.querySelector('.menmen-ink-preview'))
  }
  cm.on('change', docChangeHandler)
}

function replaceHwBlock (target, content) {
  cm.replaceRange(content, target.from, target.to)
}

function insertAfterHwBlock (target, content) {
  cm.replaceRange('\n' + content, target.to, target.to)
}

function insertLatexBlockContent (latex, hash) {
  const inline = mathInsertIsInline(cm, cm.getCursor())
  return insertLatexHwBlock(latex, hash, { inline })
}

function insertGeoBlockContent (ir, hash) {
  const body = Object.assign({}, ir, { hw: hash })
  return '```geo3d\n' + JSON.stringify(body, null, 2) + '\n```'
}

function insertChemBlockContent (smiles, name, hash) {
  let block = smiles
  if (name) block += `\nname: ${name}`
  block += `\nhw: ${hash}`
  return '```chem\n' + block + '\n```'
}

function insertCellvizBlockContent (ir, hash) {
  const body = Object.assign({}, ir, { hw: hash })
  return '```cellviz\n' + JSON.stringify(body, null, 2) + '\n```'
}

function applyInsertBlock (content, insertMode) {
  if (editTargetHash) {
    const target = (editConflict && editConflict.target) || findHwBlockTarget(editTargetHash)
    if (target && insertMode === 'append') {
      insertAfterHwBlock(target, content)
    } else if (target && (insertMode === 'overwrite' || !editConflict)) {
      replaceHwBlock(target, content)
    } else {
      replaceAtBookmark(content)
    }
    stopEditWatch()
  } else {
    replaceAtBookmark(content)
  }
}

function insertLatexBlock (latex, hash) {
  applyInsertBlock(insertLatexBlockContent(latex, hash), 'overwrite')
}

function insertGeoBlock (ir, hash) {
  applyInsertBlock(insertGeoBlockContent(ir, hash), 'overwrite')
}

function insertChemBlock (smiles, name, hash) {
  applyInsertBlock(insertChemBlockContent(smiles, name, hash), 'overwrite')
}

function insertCellvizBlock (ir, hash) {
  applyInsertBlock(insertCellvizBlockContent(ir, hash), 'overwrite')
}

async function showPreviewPanel (container, scope, hash, result, mode) {
  let panel = container.querySelector('.menmen-ink-preview')
  if (!panel) {
    panel = document.createElement('div')
    panel.className = 'menmen-ink-preview'
    container.appendChild(panel)
  }
  panel.classList.remove('hidden')
  const modeId = result.mode || mode || 'latex'
  const previewText = modeId === 'latex'
    ? (result.latex || '')
    : modeId === 'chem'
      ? (result.smiles || '') + (result.name ? `\nname: ${result.name}` : '')
      : JSON.stringify(result.ir || {}, null, 2)
  panel.innerHTML = `
    <div class="menmen-ink-conflict hidden"></div>
    <textarea class="result-input">${previewText}</textarea>
    <div class="preview-math"></div>
    <div class="preview-actions">
      <button type="button" class="btn-insert">插入</button>
      <button type="button" class="btn-overwrite hidden">覆盖对方版本</button>
      <button type="button" class="btn-append hidden">插入为新块</button>
      <button type="button" class="btn-retry">重新识别</button>
      <button type="button" class="btn-image">插入为图片</button>
      <button type="button" class="btn-close">关闭</button>
    </div>
    <div class="preview-status"></div>
  `
  updateConflictUi(panel)
  const resultInput = panel.querySelector('.result-input')
  const previewMath = panel.querySelector('.preview-math')
  const statusEl = panel.querySelector('.preview-status')
  const btnInsert = panel.querySelector('.btn-insert')

  async function refreshPreview () {
    if (modeId !== 'latex') {
      previewMath.textContent = '非 LaTeX 模式：确认 JSON/SMILES 后插入'
      statusEl.textContent = '可编辑后插入'
      btnInsert.disabled = false
      return
    }
    const v = await verifyMathPreview(resultInput.value.trim())
    if (v.ok) {
      previewMath.innerHTML = v.html
      statusEl.textContent = '预览通过'
      btnInsert.disabled = false
    } else {
      previewMath.textContent = v.error
      statusEl.textContent = v.error
      btnInsert.disabled = true
    }
  }

  resultInput.addEventListener('input', () => { refreshPreview() })
  await refreshPreview()

  panel.querySelector('.btn-close').addEventListener('click', () => panel.classList.add('hidden'))
  panel.querySelector('.btn-retry').addEventListener('click', async () => {
    try {
      statusEl.textContent = '识别中…'
      const overlay = container.closest('.menmen-ink-overlay')
      const hintEl = overlay && overlay.querySelector('.menmen-ink-hint-input')
      const hint = hintEl ? hintEl.value.trim().slice(0, 100) : ''
      const job = await recognize(mode || modeId, hint)
      const finalResult = job.result || await pollJob(job.scope, job.hash)
      await showPreviewPanel(container, job.scope, job.hash, finalResult, mode || modeId)
    } catch (e) {
      statusEl.textContent = e.message
    }
  })

  async function performInsert (insertMode) {
    let content
    if (modeId === 'latex') {
      const latex = resultInput.value.trim()
      const v = await verifyMathPreview(latex)
      if (!v.ok) return
      content = insertLatexBlockContent(latex, hash)
    } else if (modeId === 'geo3d') {
      content = insertGeoBlockContent(JSON.parse(resultInput.value), hash)
    } else if (modeId === 'chem') {
      const lines = resultInput.value.trim().split('\n').filter(Boolean)
      let name = result.name
      lines.slice(1).forEach(ln => {
        if (ln.toLowerCase().startsWith('name:')) name = ln.slice(5).trim()
      })
      content = insertChemBlockContent(lines[0], name, hash)
    } else if (modeId === 'cellviz') {
      content = insertCellvizBlockContent(JSON.parse(resultInput.value), hash)
    } else {
      return
    }
    applyInsertBlock(content, insertMode)
    panel.classList.add('hidden')
    closeOverlay()
    let committed = false
    for (let i = 0; i < 3; i++) {
      try {
        await commitHandwriting(scope, hash)
        committed = true
        break
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
    if (!committed) {
      queuePendingCommit({ scope, hash, noteId: noteid, at: Date.now() })
      statusEl.textContent = '已插入，笔迹尚未持久化（将自动重试）'
      try {
        const list = JSON.parse(localStorage.getItem(pendingCommitKey) || '[]')
        updatePendingCommitBanner(list.filter(i => i.noteId === noteid).length)
      } catch (e) { /* ignore */ }
    }
  }

  panel.querySelector('.btn-insert').addEventListener('click', () => performInsert('overwrite'))
  panel.querySelector('.btn-overwrite').addEventListener('click', () => performInsert('overwrite'))
  panel.querySelector('.btn-append').addEventListener('click', () => performInsert('append'))

  panel.querySelector('.btn-image').addEventListener('click', async () => {
    const blob = await (await fetch(normalizeImage())).blob()
    const fd = new FormData()
    fd.append('upload', blob, 'handwriting.png')
    const res = await fetch(`${serverurl}/uploadimage`, { method: 'POST', credentials: 'same-origin', body: fd })
    const data = await res.json()
    if (data && data[0] && data[0].url) {
      const md = `![handwriting](${data[0].url})`
      if (insertBookmark) {
        insertBookmark.replace(md)
        insertBookmark.clear()
      } else {
        cm.replaceRange(md, cm.getCursor())
      }
      panel.classList.add('hidden')
      closeOverlay()
    }
  })
}

function buildTray (tray) {
  tray.innerHTML = ''
  TOOL_DEFS.forEach(def => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ink-tool'
    btn.dataset.tool = def.id
    btn.title = `${def.label} (${def.shortcut})`
    btn.setAttribute('role', def.id === 'color' ? 'button' : 'radio')
    btn.setAttribute('aria-checked', def.id === activeTool ? 'true' : 'false')
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svgToolIcon(def.id)}</svg>`
    btn.style.setProperty('--ink-color', color)
    tray.appendChild(btn)
  })
}

function setActiveTool (tool, tray) {
  if (tool === 'color') return
  activeTool = tool
  tray.querySelectorAll('.ink-tool[role="radio"]').forEach(el => {
    el.setAttribute('aria-checked', el.dataset.tool === tool ? 'true' : 'false')
  })
  saveToolPref(tool, { lastUsed: Date.now() })
}

const INK_PAD_HEIGHT_KEY = 'menmen.ink.padHeight'
const INK_PAD_MIN_H = 160
const INK_PAD_EDGE = 6

function inkPadMaxHeight (areaH) {
  return Math.max(INK_PAD_MIN_H, areaH - INK_PAD_EDGE)
}

function readInkPadHeight (areaH, pad) {
  const maxH = inkPadMaxHeight(areaH)
  if (pad && pad.dataset.userHeight) {
    const u = parseInt(pad.dataset.userHeight, 10)
    if (!isNaN(u) && u >= INK_PAD_MIN_H) return Math.min(u, maxH)
  }
  const saved = parseInt(localStorage.getItem(INK_PAD_HEIGHT_KEY), 10)
  if (!isNaN(saved) && saved >= INK_PAD_MIN_H) return Math.min(saved, maxH)
  return Math.min(300, Math.max(INK_PAD_MIN_H, Math.floor(areaH * 0.38)))
}

function inkPadChromeHeight (pad) {
  const panel = pad.querySelector('.menmen-ink-panel')
  const handle = pad.querySelector('.menmen-ink-pad-resize')
  return (handle ? handle.offsetHeight : 10) + (panel ? panel.offsetHeight : 0)
}

function bindInkPadResize (pad, editArea) {
  const handle = pad.querySelector('.menmen-ink-pad-resize')
  if (!handle || handle.dataset.bound === '1') return
  handle.dataset.bound = '1'
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    handle.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = pad.offsetHeight
    const maxH = editArea ? inkPadMaxHeight(editArea.clientHeight) : startH
    const move = (ev) => {
      const dy = startY - ev.clientY
      const newH = Math.min(maxH, Math.max(INK_PAD_MIN_H, startH + dy))
      pad.style.height = `${newH}px`
      pad.dataset.userHeight = String(newH)
      localStorage.setItem(INK_PAD_HEIGHT_KEY, String(newH))
      resizeCanvases(pad)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  })
}

function ensureInkPadResizeHandle (pad, editArea) {
  if (!pad) return
  if (!pad.querySelector('.menmen-ink-pad-resize')) {
    const handle = document.createElement('div')
    handle.className = 'menmen-ink-pad-resize'
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', 'horizontal')
    handle.title = '拖拽调整高度'
    pad.insertBefore(handle, pad.firstChild)
  }
  bindInkPadResize(pad, editArea)
}

function positionInkPad (pad, editArea) {
  if (!pad || !editArea) return
  ensureInkPadResizeHandle(pad, editArea)
  const areaRect = editArea.getBoundingClientRect()
  const areaW = editArea.clientWidth || areaRect.width
  const areaH = editArea.clientHeight || areaRect.height
  const edge = INK_PAD_EDGE
  let left = edge
  let width = Math.max(200, areaW - edge * 2)
  const ed = typeof cm !== 'undefined' ? cm : (typeof window !== 'undefined' ? window.editor : null)
  if (ed && typeof ed.getWrapperElement === 'function') {
    const cmEl = ed.getWrapperElement()
    const cmRect = cmEl.getBoundingClientRect()
    const gutters = cmEl.querySelector('.CodeMirror-gutters')
    const gutterW = gutters ? gutters.offsetWidth : 0
    left = Math.max(edge, (cmRect.left - areaRect.left) + gutterW)
    width = Math.max(200, areaW - left - edge)
  }
  const height = readInkPadHeight(areaH, pad)
  pad.dataset.userHeight = String(height)
  pad.style.left = `${left}px`
  pad.style.right = 'auto'
  pad.style.top = 'auto'
  pad.style.bottom = `${edge}px`
  pad.style.width = `${width}px`
  pad.style.height = `${height}px`
}

function openOverlay (editArea, opts) {
  opts = opts || {}
  overlayOpen = true
  if (!opts.preserveEditWatch) stopEditWatch()
  insertBookmark = cm.setBookmark(cm.getCursor())
  let overlay = editArea.querySelector('.menmen-ink-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'menmen-ink-overlay'
    const pad = document.createElement('div')
    pad.className = 'menmen-ink-pad'
    committedCanvas = document.createElement('canvas')
    liveCanvas = document.createElement('canvas')
    committedCanvas.style.visibility = 'hidden'
    pad.appendChild(committedCanvas)
    pad.appendChild(liveCanvas)
    overlay.appendChild(pad)

    const panel = document.createElement('div')
    panel.className = 'menmen-ink-panel'
    getRecognizeModes().then(modes => {
      const modeOptions = modes.map(m => `<option value="${m.id}" ${m.id === recognizeMode ? 'selected' : ''}>${m.label}</option>`).join('')
      panel.querySelector('.btn-mode-select').innerHTML = modeOptions
    })
    const modeOptions = RECOG_MODES.map(m => `<option value="${m.id}" ${m.id === recognizeMode ? 'selected' : ''}>${m.label}</option>`).join('')
    panel.innerHTML = `
      <select class="btn-mode-select" title="识别模式">${modeOptions}</select>
      <button type="button" class="btn-recognize">识别</button>
      <button type="button" class="btn-recognize-text">识别为文字</button>
      <button type="button" class="btn-clear">清空</button>
      <details class="menmen-ink-hint">
        <summary>补充提示</summary>
        <input type="text" class="menmen-ink-hint-input" maxlength="100" placeholder="如：这是正八面体"/>
      </details>
    `
    panel.querySelector('.btn-mode-select').addEventListener('change', (e) => {
      recognizeMode = e.target.value
      localStorage.setItem('menmen.ink.lastMode', recognizeMode)
    })
    const padEl = overlay.querySelector('.menmen-ink-pad') || overlay
    padEl.appendChild(panel)

    liveCanvas.addEventListener('pointerdown', onPointerDown)
    liveCanvas.addEventListener('pointermove', onPointerMove)
    liveCanvas.addEventListener('pointerup', onPointerUp)
    liveCanvas.addEventListener('pointercancel', onPointerUp)

    panel.querySelector('.btn-clear').addEventListener('click', () => {
      strokes = []
      undoStack = []
      redoStack = []
      saveSession()
      redrawCommitted()
      redrawLive()
    })

    panel.querySelector('.btn-recognize').addEventListener('click', async () => {
      const btn = panel.querySelector('.btn-recognize')
      btn.disabled = true
      btn.textContent = '识别中…'
      try {
        await ensureModules()
        const available = await checkVlmAvailable()
        if (!available) throw new Error('识别服务不可用，可使用「插入为图片」')
        const mode = recognizeMode
        const hintEl = panel.querySelector('.menmen-ink-hint-input')
        const hint = hintEl ? hintEl.value.trim().slice(0, 100) : ''
        const job = await recognize(mode, hint)
        const result = job.result || await pollJob(job.scope, job.hash)
        await showPreviewPanel(overlay, job.scope, job.hash, result, mode)
      } catch (e) {
        alert(e.message)
      } finally {
        btn.disabled = false
        btn.textContent = '识别'
      }
    })

    editArea.style.position = editArea.style.position || 'relative'
    editArea.appendChild(overlay)

    const ro = new ResizeObserver(() => {
      const nextPad = overlay.querySelector('.menmen-ink-pad') || overlay
      positionInkPad(nextPad, editArea)
      resizeCanvases(nextPad)
    })
    ro.observe(editArea)
    overlay._ro = ro
  }
  overlay.style.display = 'block'
  cm.setOption('readOnly', 'nocursor')
  const pad = overlay.querySelector('.menmen-ink-pad') || overlay
  positionInkPad(pad, editArea)
  resizeCanvases(pad)
  loadSession()
  redrawCommitted()
  redrawLive()
}

function closeOverlay () {
  overlayOpen = false
  stopEditWatch()
  const ui = getUIElements()
  const editArea = ui.area.edit[0]
  const overlay = editArea && editArea.querySelector('.menmen-ink-overlay')
  if (overlay) overlay.style.display = 'none'
  cm.setOption('readOnly', false)
  saveSession()
}

function setTrayOpen (tray, open) {
  if (!tray) return
  tray.classList.toggle('open', !!open)
  if (open) tray.removeAttribute('hidden')
  else tray.setAttribute('hidden', '')
}

function toggleOverlay (editArea, toggleBtn, tray) {
  if (!editArea) {
    console.error('menmen-ink: edit area missing')
    return
  }
  if (overlayOpen) {
    closeOverlay()
    if (toggleBtn) {
      toggleBtn.classList.remove('active')
      toggleBtn.setAttribute('aria-pressed', 'false')
    }
    setTrayOpen(tray, false)
  } else {
    setTrayOpen(tray, true)
    if (toggleBtn) {
      toggleBtn.classList.add('active')
      toggleBtn.setAttribute('aria-pressed', 'true')
    }
    openOverlay(editArea)
  }
}

function exposeInkGlobal () {
  window.__menmenInk = {
    toggle: toggleMenmenInk,
    isOpen: function () { return overlayOpen }
  }
}

export function toggleMenmenInk () {
  const ui = getUIElements()
  const editArea = ui.area && ui.area.edit && ui.area.edit[0]
  const toolbar = editorInstance && editorInstance.toolBar
  const toggleBtn = toolbar && toolbar.find('.menmen-ink-toggle')[0]
  const tray = toolbar && toolbar.find('.menmen-ink-tray')[0]
  toggleOverlay(editArea, toggleBtn, tray)
}

let inkInited = false

export function initMenmenHandwriting (instance) {
  editorInstance = instance
  cm = instance.editor
  exposeInkGlobal()
  if (inkInited) return
  const toolbar = instance.toolBar
  if (!toolbar || !toolbar.length) return

  const group = toolbar.find('.menmen-ink-group')
  const toggleBtn = group.find('.menmen-ink-toggle')
  const tray = group.find('.menmen-ink-tray')[0]
  if (!toggleBtn.length || !tray) return

  buildTray(tray)
  loadSession()
  retryPendingCommits()

  const ui = getUIElements()
  const editArea = ui.area.edit[0]

  toggleBtn.on('click', function (e) {
    e.preventDefault()
    e.stopPropagation()
    toggleOverlay(editArea, toggleBtn[0], tray)
  })

  tray.addEventListener('click', e => {
    const btn = e.target.closest('.ink-tool')
    if (!btn) return
    const tool = btn.dataset.tool
    if (tool === 'color') {
      let pop = group.find('.menmen-ink-color-pop')[0]
      if (!pop) {
        pop = document.createElement('div')
        pop.className = 'menmen-ink-color-pop hidden'
        pop.innerHTML = `<div class="swatches">${PRESET_COLORS.map(c => `<button type="button" class="swatch" data-color="${c}" style="background:${c}"></button>`).join('')}</div>`
        group[0].appendChild(pop)
        pop.addEventListener('click', ev => {
          const sw = ev.target.closest('.swatch')
          if (!sw) return
          color = sw.dataset.color
          tray.querySelectorAll('.ink-tool').forEach(el => el.style.setProperty('--ink-color', color))
          pop.classList.add('hidden')
        })
      }
      pop.classList.toggle('hidden')
      return
    }
    setActiveTool(tool, tray)
  })

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'h') {
      e.preventDefault()
      toggleOverlay(editArea, toggleBtn[0], tray)
    }
    if (!overlayOpen) return
    if (e.key === 'Escape') {
      closeOverlay()
      toggleBtn.removeClass('active')
      setTrayOpen(tray, false)
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      const item = undoStack.pop()
      if (!item) return
      if (item.type === 'draw') strokes = strokes.filter(s => s.id !== item.stroke.id)
      if (item.type === 'erase') strokes.push.apply(strokes, item.removed)
      redoStack.push(item)
      saveSession()
      redrawCommitted()
      redrawLive()
    }
  })

  ensureModules().catch(err => console.warn('menmen-handwriting: perfect-freehand load failed', err))
  inkInited = true
  exposeInkGlobal()
}

export async function loadHandwritingForEdit (hash) {
  if (!cm || !editorInstance) {
    throw new Error('编辑器未就绪')
  }
  const res = await fetch(`${serverurl}/api/hw/note/handwriting/${hash}.json?noteId=${encodeURIComponent(noteid || '')}`, {
    credentials: 'same-origin'
  })
  if (!res.ok) throw new Error('无法加载笔迹')
  const data = await res.json()
  if (data && Array.isArray(data.strokes)) {
    strokes = data.strokes
  } else if (data && data.strokes && Array.isArray(data.strokes.strokes)) {
    strokes = data.strokes.strokes
  } else {
    throw new Error('笔迹格式无效')
  }
  undoStack = []
  redoStack = []
  saveSession()

  const ui = getUIElements()
  const editArea = ui.area.edit[0]
  const toolbar = editorInstance.toolBar
  const toggleBtn = toolbar && toolbar.find('.menmen-ink-toggle')[0]
  const tray = toolbar && toolbar.find('.menmen-ink-tray')[0]
  if (toggleBtn && tray && !overlayOpen) {
    openOverlay(editArea, { preserveEditWatch: true })
    toggleBtn.classList.add('active')
    toggleBtn.setAttribute('aria-pressed', 'true')
    tray.classList.add('open')
  } else if (overlayOpen) {
    redrawCommitted()
    redrawLive()
  }
  startEditWatch(hash)
}
