/* global serverurl */
'use strict'

import escapeHTML from 'escape-html'
import { noteid } from './lib/config/index'

const VIEWER_LRU_MAX = 4

const stateMap = new Map()
const viewerLru = []
const viewerMap = new Map()
const ioSeen = new WeakSet()

function clientHash (input) {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `ck_${(hash >>> 0).toString(36)}`
}

function parseChemBlock (code) {
  const lines = code.trim().split('\n').map(l => l.trim()).filter(Boolean)
  const smiles = lines[0] || ''
  const options = {}
  let name = ''
  lines.slice(1).forEach(ln => {
    const idx = ln.indexOf(':')
    if (idx < 0) return
    const k = ln.slice(0, idx).trim().toLowerCase()
    const v = ln.slice(idx + 1).trim()
    if (k === 'name') name = v
    else if (k !== 'hw') options[k] = v
  })
  return { smiles, options, name, raw: code }
}

function buildShell (localKey) {
  return `
<div class="menmen-card-shell chem-container" data-chem-key="${localKey}">
  <div class="menmen-card-header">
    <span class="menmen-card-title">CHEM</span>
    <div class="menmen-card-tabs">
      <button type="button" class="menmen-card-tab active" data-tab="2d">2D</button>
      <button type="button" class="menmen-card-tab" data-tab="3d">3D</button>
      <button type="button" class="menmen-card-tab" data-tab="tex">TeX</button>
      <button type="button" class="menmen-card-tab" data-tab="source">Source</button>
    </div>
  </div>
  <div class="menmen-card-body">
    <div class="menmen-card-panel tab-2d active"><div class="menmen-card-loading">加载…</div></div>
    <div class="menmen-card-panel tab-3d"><div class="menmen-card-loading">打开 3D Tab 加载</div></div>
    <div class="menmen-card-panel tab-tex"><div class="menmen-card-loading">打开 TeX Tab 生成 chemfig</div></div>
    <div class="menmen-card-panel tab-source"><pre></pre></div>
  </div>
</div>`
}

function touchViewerLru (key) {
  const idx = viewerLru.indexOf(key)
  if (idx >= 0) viewerLru.splice(idx, 1)
  viewerLru.push(key)
}

function evictViewers (keepKey) {
  while (viewerMap.size >= VIEWER_LRU_MAX) {
    const victim = viewerLru.find(k => k !== keepKey)
    if (!victim) break
    const ent = viewerMap.get(victim)
    if (ent && ent.viewer) {
      try { ent.viewer.clear() } catch (e) { /* ignore */ }
    }
    viewerMap.delete(victim)
    const vi = viewerLru.indexOf(victim)
    if (vi >= 0) viewerLru.splice(vi, 1)
    $(`[data-chem-key="${victim}"]`).removeAttr('data-chem-3d-ready').find('.tab-3d .chem-3d-active').removeClass('chem-3d-active')
  }
}

function bindTabs ($c, parsed) {
  $c.find('.menmen-card-tab').off('click.chem').on('click.chem', function () {
    const tab = $(this).data('tab')
    $c.find('.menmen-card-tab').removeClass('active')
    $(this).addClass('active')
    $c.find('.menmen-card-panel').removeClass('active')
    $c.find(`.tab-${tab}`).addClass('active')
    if (tab === '3d') load3dTab($c)
    if (tab === 'tex') loadTexTab($c, parsed)
    if (tab === '2d' && !$c.attr('data-chem-rendered')) submitChemRender($c, parsed)
  })
}

async function pollChemJob (scope, hash) {
  let delay = 1000
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${serverurl}/api/chem/jobs/${scope}/${hash}?noteId=${encodeURIComponent(noteid || '')}`, { credentials: 'same-origin' })
    const body = await res.json()
    if (body.status === 'done') return body
    if (body.status === 'error') throw new Error(body.error || 'render failed')
    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(5000, delay * 1.3)
  }
  throw new Error('timeout')
}

async function submitChemRender ($c, parsed) {
  $c.find('.tab-2d').html('<div class="menmen-card-loading">渲染中…</div>')
  try {
    const res = await fetch(`${serverurl}/api/chem/render`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smiles: parsed.smiles,
        options: parsed.options,
        name: parsed.name,
        noteId: noteid
      })
    })
    const job = await res.json()
    const result = job.status === 'done' ? job : await pollChemJob(job.scope, job.hash)
    const urls = result.urls || {}
    if (urls.svg) {
      $c.find('.tab-2d').html(`<img src="${escapeHTML(urls.svg)}" alt="2D structure"/>`)
      $c.attr('data-chem-rendered', '1')
      stateMap.set($c.attr('data-chem-key'), Object.assign({}, result, { scope: job.scope, hash: job.hash }))
    } else {
      throw new Error('no svg url')
    }
  } catch (e) {
    $c.find('.tab-2d').html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
  }
}

async function loadTexTab ($c, parsed) {
  const key = $c.attr('data-chem-key')
  const state = stateMap.get(key)
  const $panel = $c.find('.tab-tex')
  if ($c.attr('data-chem-tex-ready')) return
  if (!state || !state.scope || !state.hash) {
    $panel.html('<div class="menmen-card-loading">请先加载 2D 渲染</div>')
    return
  }
  const chemfig = state.chemfig || {}
  if (chemfig.status === 'done' && (chemfig.svgUrl || chemfig.tex)) {
    renderChemfigPanel($panel, chemfig)
    $c.attr('data-chem-tex-ready', '1')
    return
  }
  if (chemfig.status === 'failed') {
    $panel.html(`<div class="alert alert-warning">${escapeHTML(chemfig.error || 'chemfig 失败')}</div>`)
    return
  }
  $panel.html('<div class="menmen-card-loading">生成 chemfig…</div>')
  try {
    const res = await fetch(`${serverurl}/api/chem/chemfig`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smiles: parsed.smiles,
        name: parsed.name,
        hash: state.hash,
        noteId: noteid
      })
    })
    const body = await res.json()
    let cf = body.chemfig || {}
    for (let i = 0; i < 30 && cf.status === 'running'; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const st = await fetch(`${serverurl}/api/chem/jobs/${state.scope}/${state.hash}?noteId=${encodeURIComponent(noteid || '')}`, { credentials: 'same-origin' })
      const job = await st.json()
      cf = job.chemfig || cf
    }
    state.chemfig = cf
    stateMap.set(key, state)
    if (cf.status === 'done') {
      renderChemfigPanel($panel, cf)
      $c.attr('data-chem-tex-ready', '1')
    } else {
      throw new Error(cf.error || 'chemfig timeout')
    }
  } catch (e) {
    $panel.html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
  }
}

function renderChemfigPanel ($panel, chemfig) {
  let html = ''
  if (chemfig.svgUrl) {
    html += `<img src="${escapeHTML(chemfig.svgUrl)}" alt="chemfig"/>`
  }
  if (chemfig.tex) {
    html += `<pre class="chemfig-tex">${escapeHTML(chemfig.tex)}</pre>`
  }
  $panel.html(html || '<div class="menmen-card-loading">无 chemfig 输出</div>')
}

function save3dSnapshot ($c, viewerEl) {
  try {
    const canvas = viewerEl.querySelector('canvas')
    if (!canvas) return
    const snap = canvas.toDataURL('image/png')
    let $img = $c.find('img.chem-3d-snapshot')
    if (!$img.length) {
      $img = $('<img class="chem-3d-snapshot" alt="3D snapshot" style="display:none;max-width:100%"/>')
      $c.find('.menmen-card-body').append($img)
    }
    $img.attr('src', snap)
  } catch (e) { /* ignore */ }
}

function show3dPlaceholder ($panel, $c, onActivate) {
  const $snap = $c.find('img.chem-3d-snapshot')
  const snapSrc = $snap.attr('src')
  let html = '<div class="chem-3d-placeholder">'
  if (snapSrc) {
    html += `<img src="${escapeHTML(snapSrc)}" alt="3D preview" style="max-width:100%;opacity:0.85"/>`
  }
  html += '<p class="text-muted small">点击激活 3D 交互</p>'
  html += '<button type="button" class="btn btn-xs btn-primary chem-3d-activate">激活 3D</button></div>'
  $panel.html(html)
  $panel.find('.chem-3d-activate').on('click', onActivate)
}

function mount3dViewer ($c, sdfUrl) {
  const key = $c.attr('data-chem-key')
  const $panel = $c.find('.tab-3d')

  if (viewerMap.has(key) && $c.attr('data-chem-3d-ready')) {
    touchViewerLru(key)
    return
  }

  evictViewers(key)
  $panel.html('<div class="menmen-card-loading">加载 3D…</div>')

  require.ensure([], (req) => {
    $panel.html('<div class="chem-3d-viewer chem-3d-active" style="height:280px;position:relative;"></div>')
    const el = $panel.find('.chem-3d-viewer')[0]
    const $3Dmol = req('3dmol')
    const viewer = $3Dmol.createViewer(el, { backgroundColor: 'white' })
    fetch(sdfUrl, { credentials: 'same-origin' })
      .then(r => {
        if (!r.ok) throw new Error('SDF fetch failed')
        return r.text()
      })
      .then(sdf => {
        viewer.addModel(sdf, 'sdf')
        viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.25 } })
        viewer.zoomTo()
        viewer.render()
        viewerMap.set(key, { viewer, el })
        touchViewerLru(key)
        $c.attr('data-chem-3d-ready', '1')
        save3dSnapshot($c, el)
      })
      .catch(e => {
        $panel.html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
      })
  }, 'vendor-chem')
}

function load3dTab ($c) {
  const key = $c.attr('data-chem-key')
  const state = stateMap.get(key)
  const sdfUrl = state && state.urls && state.urls.sdf
  const $panel = $c.find('.tab-3d')
  if (!sdfUrl) {
    $panel.html('<div class="menmen-card-loading">无 3D 构象（分子过大或未生成）</div>')
    return
  }

  if (viewerMap.has(key) && $c.attr('data-chem-3d-ready')) {
    touchViewerLru(key)
    return
  }

  if (viewerMap.size >= VIEWER_LRU_MAX && !viewerMap.has(key)) {
    show3dPlaceholder($panel, $c, () => mount3dViewer($c, sdfUrl))
    return
  }

  mount3dViewer($c, sdfUrl)
}

function observeHydrate ($shell, parsed) {
  if (ioSeen.has($shell[0])) return
  ioSeen.add($shell[0])
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !$shell.attr('data-chem-rendered')) {
        submitChemRender($shell, parsed)
        io.disconnect()
      }
    })
  }, { rootMargin: '200px' })
  io.observe($shell[0])
}

export function chemHighlightRender (code, lang) {
  if (lang !== 'chem') return null
  return `<div class="chem raw menmen-card-shell" data-lang="chem">${escapeHTML(code)}</div>`
}

export function processChemBlocks (view) {
  view.find('div.chem.raw').removeClass('raw').each(function () {
    const $value = $(this)
    const code = $value.text()
    const parsed = parseChemBlock(code)
    const localKey = clientHash(code)
    const $ele = $value.parent().parent()
    $ele.replaceWith(buildShell(localKey))
    const $shell = view.find(`[data-chem-key="${localKey}"]`).last()
    $shell.find('.tab-source pre').text(code)
    bindTabs($shell, parsed)
    observeHydrate($shell, parsed)
  })
}
