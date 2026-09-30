/* global serverurl */
'use strict'

import '../css/menmen-cards.css'
import escapeHTML from 'escape-html'
import { noteid } from './lib/config/index'
import * as THREE from 'three'
import { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'

const SCENE_LRU_MAX = 16
const IO_RELEASE_MS = 5000

const stateMap = new Map()
const sceneCache = new Map()
const sceneLruOrder = []
const cardStates = new Map()
const ioSeen = new WeakSet()
const ioReleaseTimers = new WeakMap()

let sharedRenderer = null
const OrbitControls = OrbitControlsImpl
let activeCardKey = null
let moStarted = false
/** @type {Map<string, Promise<void>>} */
const hydrateInflight = new Map()

function clientHash (input) {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `gk_${(hash >>> 0).toString(36)}`
}

function canonicalJson (obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => {
        acc[k] = sort(v[k])
        return acc
      }, {})
    }
    return v
  }
  return JSON.stringify(sort(obj))
}

async function sha256Hex (text) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }
  return clientHash(text)
}

async function parseIr (code) {
  const ir = JSON.parse(code.trim())
  const cleaned = Object.assign({}, ir)
  delete cleaned.hw
  const hash = await sha256Hex(canonicalJson(cleaned))
  return { ir, hash, cleaned, cacheKey: canonicalJson(cleaned) }
}

function buildShell (localKey, hash) {
  return `
<div class="menmen-card-shell geo3d-container" data-geo3d-key="${localKey}" data-geo3d-hash="${escapeHTML(hash)}">
  <div class="menmen-card-header">
    <span class="menmen-card-title">GEO3D</span>
    <div class="menmen-card-tabs">
      <button type="button" class="menmen-card-tab active" data-tab="3d">3D</button>
      <button type="button" class="menmen-card-tab" data-tab="views">标准视图</button>
      <button type="button" class="menmen-card-tab" data-tab="source">IR</button>
    </div>
  </div>
  <div class="menmen-card-body">
    <div class="menmen-card-panel tab-3d active"><div class="menmen-card-loading">加载 3D…</div></div>
    <div class="menmen-card-panel tab-views"><div class="menmen-card-loading">点击「标准视图」生成</div></div>
    <div class="menmen-card-panel tab-source"><pre></pre></div>
  </div>
</div>`
}

function bindAsyExport ($c) {
  const $src = $c.find('.tab-source')
  if ($src.find('.menmen-asy-export').length) return
  const $btn = $('<button type="button" class="btn btn-xs btn-default menmen-asy-export">导出 Asymptote</button>')
  $btn.on('click', async () => {
    try {
      const code = $c.find('.tab-source pre').text()
      const ir = JSON.parse(code.trim())
      const res = await fetch(`${serverurl}/api/geo/asy-source`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ir, noteId: noteid })
      })
      const body = await res.json()
      if (!body.source) throw new Error('无 Asymptote 源')
      const blob = new Blob([body.source], { type: 'text/plain;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'geometry.asy'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      alert(e.message)
    }
  })
  $src.prepend($btn)
}

function findGeoFenceBySource (sourceSnapshot) {
  const cm = window.editor
  if (!cm || !sourceSnapshot) return null
  const doc = cm.getValue()
  const fenceRe = /```geo3d\s*\n([\s\S]*?)```/g
  let fm
  while ((fm = fenceRe.exec(doc)) !== null) {
    if (fm[2].trim() === sourceSnapshot.trim()) {
      return { from: cm.posFromIndex(fm.index), to: cm.posFromIndex(fm.index + fm[0].length) }
    }
  }
  return null
}

function bindIrEdit ($c) {
  const $src = $c.find('.tab-source')
  if ($src.find('.menmen-geo-apply-ir').length) return
  $c.find('.tab-source pre').attr('contenteditable', 'true').addClass('geo3d-ir-editor')
  const $btn = $('<button type="button" class="btn btn-xs btn-primary menmen-geo-apply-ir">Apply IR</button>')
  $btn.on('click', () => {
    const cm = window.editor
    if (!cm) {
      alert('编辑器不可用')
      return
    }
    const code = $c.find('.tab-source pre').text()
    try {
      JSON.parse(code)
    } catch (e) {
      alert('JSON 无效')
      return
    }
    const snap = $c.attr('data-geo3d-source') || ''
    const target = findGeoFenceBySource(snap)
    if (!target) {
      alert('找不到对应 geo3d 块')
      return
    }
    cm.replaceRange('```geo3d\n' + code.trim() + '\n```', target.from, target.to)
    $c.attr('data-geo3d-source', code.trim())
    $c.removeAttr('data-geo3d-ready')
    $c.find('.tab-views').html('<div class="menmen-card-loading">IR 已变更，点击「标准视图」重新生成</div>')
  })
  $src.prepend($btn)
}

function bindTabs ($c) {
  bindAsyExport($c)
  bindIrEdit($c)
  $c.find('.menmen-card-tab').off('click.geo').on('click.geo', function () {
    const tab = $(this).data('tab')
    $c.find('.menmen-card-tab').removeClass('active')
    $(this).addClass('active')
    $c.find('.menmen-card-panel').removeClass('active')
    $c.find(`.tab-${tab}`).addClass('active')
    if (tab === 'views') triggerGeoRender($c)
    if (tab === '3d') activateCard($c.attr('data-geo3d-key'))
  })
}

function ensureThree () {
  return Promise.resolve()
}

function ensureSharedRenderer () {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false })
  }
  return sharedRenderer
}

function disposeObject3D (obj) {
  if (!obj) return
  obj.traverse((node) => {
    if (node.geometry) node.geometry.dispose()
    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach(m => m.dispose())
      else node.material.dispose()
    }
  })
}

function disposeSceneEntry (entry) {
  if (!entry || !entry.scene) return
  disposeObject3D(entry.scene)
}

function touchSceneCache (key, entry) {
  const idx = sceneLruOrder.indexOf(key)
  if (idx >= 0) sceneLruOrder.splice(idx, 1)
  sceneLruOrder.push(key)
  sceneCache.set(key, entry)
  while (sceneLruOrder.length > SCENE_LRU_MAX) {
    const evict = sceneLruOrder.shift()
    if (evict === key) continue
    disposeSceneEntry(sceneCache.get(evict))
    sceneCache.delete(evict)
  }
}

function cubeVertices (half) {
  const h = half
  return {
    A: new THREE.Vector3(-h, -h, -h),
    B: new THREE.Vector3(h, -h, -h),
    C: new THREE.Vector3(h, h, -h),
    D: new THREE.Vector3(-h, h, -h),
    E: new THREE.Vector3(-h, -h, h),
    F: new THREE.Vector3(h, -h, h),
    G: new THREE.Vector3(h, h, h),
    H: new THREE.Vector3(-h, h, h)
  }
}

function resolveLabelPoint (labels, labelMap, key) {
  const ref = labels && labels[key]
  if (!ref) return null
  if (labelMap[ref]) return labelMap[ref].clone()
  return null
}

function buildCustomPolyhedron (ir, faceAlpha) {
  const verts = (ir.vertices || []).map(v => new THREE.Vector3(v[0], v[1], v[2]))
  const geom = new THREE.BufferGeometry()
  const positions = []
  ;(ir.faces || []).forEach(face => {
    if (face.length < 3) return
    for (let i = 1; i < face.length - 1; i++) {
      const a = verts[face[0]]
      const b = verts[face[i]]
      const c = verts[face[i + 1]]
      if (!a || !b || !c) continue
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    }
  })
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({
    color: 0x3e63dd, transparent: true, opacity: faceAlpha, side: THREE.DoubleSide
  }))
  const labelMap = {}
  verts.forEach((v, i) => { labelMap[`v${i}`] = v })
  return { mesh, labelMap, edges: [] }
}

function buildScene (ir) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf8f9fa)
  const shape = ir.shape || 'cube'
  const p = ir.params || {}
  const edge = p.edge || 2
  const height = p.height || edge
  const radius = p.radius || 1
  const faceAlpha = (ir.style && ir.style.face_alpha != null) ? ir.style.face_alpha : 0.75

  let mesh
  let labelMap = {}
  let edgePairs = []

  if (shape === 'custom_polyhedron') {
    const built = buildCustomPolyhedron(ir, faceAlpha)
    mesh = built.mesh
    labelMap = built.labelMap
    edgePairs = built.edges
    scene.add(mesh)
  } else {
    let geom
    if (shape === 'sphere') geom = new THREE.SphereGeometry(radius, 32, 24)
    else if (shape === 'cylinder') geom = new THREE.CylinderGeometry(radius, radius, height, 32)
    else if (shape === 'cone' || shape === 'frustum') {
      const topR = shape === 'frustum' ? (p.top_radius || radius * 0.5) : 0
      geom = new THREE.CylinderGeometry(topR, radius, height, 32)
    } else if (shape === 'tetrahedron' || shape === 'regular_tetrahedron') geom = new THREE.TetrahedronGeometry(edge * 0.9)
    else if (shape === 'octahedron') geom = new THREE.OctahedronGeometry(edge * 0.9)
    else if (shape === 'pyramid') geom = new THREE.ConeGeometry(edge, height, p.base_sides || 4)
    else if (shape === 'prism') geom = new THREE.CylinderGeometry(edge, edge, height, p.base_sides || 6)
    else if (shape === 'cuboid') geom = new THREE.BoxGeometry(p.width || edge, height, p.depth || edge)
    else geom = new THREE.BoxGeometry(edge * 0.8, edge * 0.8, edge * 0.8)

    mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({
      color: 0x3e63dd, transparent: true, opacity: faceAlpha
    }))
    scene.add(mesh)

    if (shape === 'cube' || shape === 'cuboid' || !shape) {
      const half = (shape === 'cuboid' ? Math.max(p.width || edge, p.depth || edge, height) : edge) * 0.4
      labelMap = cubeVertices(half)
      edgePairs = [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A'], ['E', 'F'], ['F', 'G'], ['G', 'H'], ['H', 'E'], ['A', 'E'], ['B', 'F'], ['C', 'G'], ['D', 'H']]
    } else {
      const edges = new THREE.EdgesGeometry(geom)
      mesh.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x111111 })))
    }
  }

  if (ir.labels) {
    Object.keys(ir.labels).forEach(k => {
      const pt = resolveLabelPoint(ir.labels, labelMap, k)
      if (pt) labelMap[k] = pt
    })
  }

  if (ir.section && ir.section.through && ir.section.through.length >= 3 && edgePairs.length) {
    const pts = ir.section.through.slice(0, 3).map(l => labelMap[l]).filter(Boolean)
    if (pts.length === 3) {
      const sectionData = computeSectionPolygon(pts, edgePairs.map(([a, b]) => [labelMap[a], labelMap[b]]).filter(e => e[0] && e[1]))
      if (sectionData && sectionData.length >= 3) {
        const secGeom = new THREE.BufferGeometry()
        const flat = []
        for (let i = 1; i < sectionData.length - 1; i++) {
          flat.push(sectionData[0].x, sectionData[0].y, sectionData[0].z)
          flat.push(sectionData[i].x, sectionData[i].y, sectionData[i].z)
          flat.push(sectionData[i + 1].x, sectionData[i + 1].y, sectionData[i + 1].z)
        }
        secGeom.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3))
        const secMesh = new THREE.Mesh(secGeom, new THREE.MeshBasicMaterial({
          color: 0xffaa00, transparent: true, opacity: 0.45, side: THREE.DoubleSide
        }))
        scene.add(secMesh)
        const outline = new THREE.BufferGeometry().setFromPoints([...sectionData, sectionData[0]])
        scene.add(new THREE.LineLoop(outline, new THREE.LineBasicMaterial({ color: 0xcc6600, linewidth: 2 })))
        ir._sectionVertexCount = sectionData.length
      }
    }
  }

  const hiddenDashed = !(ir.style && ir.style.hidden_dashed === false)
  const edgeGroup = edgePairs.length ? createConvexEdgeGroup(scene, edgePairs, labelMap, hiddenDashed) : null

  const light = new THREE.DirectionalLight(0xffffff, 0.9)
  light.position.set(2, 3, 4)
  scene.add(light)
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))
  return { scene, mesh, labelMap, edgeGroup, hiddenDashed }
}

function createConvexEdgeGroup (scene, edgePairs, labelMap, hiddenDashed) {
  const visMat = new THREE.LineBasicMaterial({ color: 0x111111 })
  const hidMat = new THREE.LineDashedMaterial({ color: 0x888888, dashSize: 0.1, gapSize: 0.06 })
  const visibleLine = new THREE.LineSegments(new THREE.BufferGeometry(), visMat)
  const hiddenLine = new THREE.LineSegments(new THREE.BufferGeometry(), hidMat)
  scene.add(visibleLine)
  scene.add(hiddenLine)
  return { edgePairs, labelMap, hiddenDashed, visibleLine, hiddenLine }
}

function updateConvexEdges (edgeGroup, camera) {
  if (!edgeGroup) return
  const visPos = []
  const hidPos = []
  const mid = new THREE.Vector3()
  const viewDir = new THREE.Vector3()
  camera.getWorldDirection(viewDir).negate()
  edgeGroup.edgePairs.forEach(([a, b]) => {
    const p0 = edgeGroup.labelMap[a]
    const p1 = edgeGroup.labelMap[b]
    if (!p0 || !p1) return
    mid.copy(p0).add(p1).multiplyScalar(0.5)
    const visible = !edgeGroup.hiddenDashed || mid.dot(viewDir) > 0
    if (visible) visPos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
    else hidPos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
  })
  edgeGroup.visibleLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(visPos, 3))
  edgeGroup.hiddenLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(hidPos, 3))
  if (edgeGroup.hiddenLine.computeLineDistances) edgeGroup.hiddenLine.computeLineDistances()
}

function projectToScreen (point, camera, w, h) {
  const v = point.clone().project(camera)
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 }
}

function updateHtmlLabels (state) {
  if (!state.$labelLayer) return
  const w = state.width
  const h = state.height
  state.$labelLayer.empty()
  if (!state.labelMap) return
  const keysToShow = state.irLabels
    ? Object.keys(state.irLabels)
    : Object.keys(state.labelMap).filter(k => /^[A-H]$/.test(k))
  keysToShow.forEach(key => {
    const pt = state.labelMap[key]
    if (!pt || !pt.isVector3) return
    const scr = projectToScreen(pt, state.camera, w, h)
    if (!scr.visible) return
    const $tag = $(`<span class="geo3d-label">${escapeHTML(key)}</span>`)
    $tag.css({ left: `${scr.x}px`, top: `${scr.y}px` })
    state.$labelLayer.append($tag)
  })
}

function computeSectionPolygon (planePts, edges) {
  const a = planePts[0]
  const b = planePts[1]
  const c = planePts[2]
  const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
  if (normal.lengthSq() < 1e-12) return null
  const hits = []
  const tol = 1e-6
  const eq = (p) => normal.dot(p) - normal.dot(a)

  edges.forEach(([p0, p1]) => {
    const d0 = eq(p0)
    const d1 = eq(p1)
    if (Math.abs(d0) < tol) hits.push(p0.clone())
    if (Math.abs(d1) < tol) hits.push(p1.clone())
    if (d0 * d1 < -tol * tol) {
      const t = d0 / (d0 - d1)
      hits.push(p0.clone().lerp(p1, t))
    }
  })

  const uniq = []
  hits.forEach(h => {
    if (!uniq.some(u => u.distanceTo(h) < tol)) uniq.push(h)
  })
  if (uniq.length < 3) return null

  const cx = uniq.reduce((s, p) => s + p.x, 0) / uniq.length
  const cy = uniq.reduce((s, p) => s + p.y, 0) / uniq.length
  const cz = uniq.reduce((s, p) => s + p.z, 0) / uniq.length
  const center = new THREE.Vector3(cx, cy, cz)
  const ux = b.clone().sub(a).normalize()
  const uy = new THREE.Vector3().crossVectors(normal, ux).normalize()
  uniq.sort((p, q) => {
    const ap = Math.atan2(p.clone().sub(center).dot(uy), p.clone().sub(center).dot(ux))
    const aq = Math.atan2(q.clone().sub(center).dot(uy), q.clone().sub(center).dot(ux))
    return ap - aq
  })
  return uniq
}

function syncCanvasDimensions (state) {
  if (!state || !state.canvas2d || !state.canvas2d.isConnected || !state.$container) return
  const $viewport = state.$container.find('.menmen-geo3d-viewport')
  const $wrap = $viewport.length ? $viewport : state.$container.find('.menmen-card-canvas-wrap')
  if (!$wrap.length) return
  const nw = $wrap.width() || state.width || 400
  const nh = Math.max(160, $wrap.height() || state.height || 280)
  if (nw !== state.width || nh !== state.height || state.canvas2d.width <= 1) {
    state.width = nw
    state.height = nh
    state.canvas2d.width = nw
    state.canvas2d.height = nh
  }
}

function syncOrbitFromCamera (state) {
  const { controls, camera } = state
  if (!controls || !camera || controls.enabled === false) return
  controls.object = camera
  controls.target.set(0, 0, 0)
  if (controls.saveState) controls.saveState()
}

function blockWheelBubble (el) {
  if (!el || el.__menmenGeo3dWheelBlock) return
  el.__menmenGeo3dWheelBlock = true
  el.addEventListener('wheel', (e) => {
    e.stopPropagation()
  }, { passive: false, capture: true })
}

function configureGeo3dControls (controls) {
  controls.target.set(0, 0, 0)
  controls.enableDamping = false
  controls.enableRotate = true
  controls.enableZoom = true
  controls.enablePan = true
  controls.zoomSpeed = 1.1
  controls.rotateSpeed = 1.0
  controls.panSpeed = 0.9
  controls.screenSpacePanning = false
  controls.minDistance = 0.8
  controls.maxDistance = 40
  if (controls.saveState) controls.saveState()
}

function wireGeo3dControls (state) {
  const { camera, canvas2d } = state
  if (!canvas2d) return null
  blockWheelBubble(canvas2d)
  const viewport = canvas2d.closest('.menmen-geo3d-viewport')
  if (viewport) blockWheelBubble(viewport)

  if (!OrbitControls) {
    bindManualControls(canvas2d, camera, () => paintCard(state))
    return null
  }

  const controls = new OrbitControls(camera, canvas2d)
  configureGeo3dControls(controls)
  controls.addEventListener('change', () => paintCard(state))
  return controls
}

function paintCard (state, opts = {}) {
  if (!state || !state.canvas2d || !state.canvas2d.isConnected) return
  syncCanvasDimensions(state)
  const w = state.width || 400
  const h = state.height || 280
  const renderer = ensureSharedRenderer()
  renderer.setSize(w, h, false)
  if (state.camera.isPerspectiveCamera) {
    state.camera.aspect = w / h
    state.camera.updateProjectionMatrix()
  }
  if (state.edgeGroup) updateConvexEdges(state.edgeGroup, state.camera)
  if (opts.syncControls && state.controls && state.controls.update) state.controls.update()
  renderer.render(state.scene, state.camera)
  const ctx = state.canvas2d.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(renderer.domElement, 0, 0)
  updateHtmlLabels(state)
  saveSnapshot(state.$container, state.canvas2d)
}

function saveSnapshot ($container, canvas2d) {
  if (!$container || !canvas2d) return
  try {
    const snap = canvas2d.toDataURL('image/png')
    let $img = $container.find('img.geo3d-snapshot')
    if (!$img.length) {
      $img = $('<img class="geo3d-snapshot" alt="3D snapshot" style="display:none;max-width:100%"/>')
      $container.find('.menmen-card-body').append($img)
    }
    $img.attr('src', snap)
  } catch (e) { /* tainted */ }
}

function deactivateCard (cardKey) {
  const st = cardStates.get(cardKey)
  if (!st) return
  if (st.controls && st.controls.dispose) st.controls.dispose()
  if (st.ro) st.ro.disconnect()
  st.controls = null
  cardStates.delete(cardKey)
  if (activeCardKey === cardKey) activeCardKey = null
}

function ensureCardControls (st) {
  if (!st || !st.canvas2d || !st.canvas2d.isConnected || st.controls) return
  st.controls = wireGeo3dControls(st)
}

function activateCard (cardKey) {
  if (activeCardKey && activeCardKey !== cardKey) deactivateCard(activeCardKey)
  activeCardKey = cardKey
  const st = cardStates.get(cardKey)
  if (st) {
    ensureCardControls(st)
    syncCanvasDimensions(st)
    paintCard(st)
  }
}

function buildToolbar ($wrap, state) {
  const $bar = $('<div class="menmen-geo3d-toolbar"></div>')
  const mk = (label, fn) => {
    const $b = $(`<button type="button" class="btn btn-xs btn-default">${label}</button>`)
    $b.on('click', fn)
    return $b
  }
  const applyView = (fn) => {
    fn()
    syncOrbitFromCamera(state)
    paintCard(state, { syncControls: true })
  }
  $bar.append(mk('复位', () => {
    applyView(() => {
      state.camera.position.set(2.5, 2, 3.5)
      state.camera.lookAt(0, 0, 0)
      if (state.controls && state.controls.reset) state.controls.reset()
    })
  }))
  $bar.append(mk('主视', () => { applyView(() => { state.camera.position.set(0, 0, 5); state.camera.lookAt(0, 0, 0) }) }))
  $bar.append(mk('俯视', () => { applyView(() => { state.camera.position.set(0, 5, 0.001); state.camera.lookAt(0, 0, 0) }) }))
  $bar.append(mk('左视', () => { applyView(() => { state.camera.position.set(-5, 0, 0); state.camera.lookAt(0, 0, 0) }) }))
  $bar.append('<span class="menmen-geo3d-hint text-muted">拖拽旋转 · 滚轮缩放 · 右键平移</span>')
  $bar.append(mk('正交', () => {
    state.ortho = !state.ortho
    const w = state.width
    const h = state.height
    if (state.ortho) {
      const fr = Math.max(w, h) * 0.004
      state.camera = new THREE.OrthographicCamera(-fr * w / h, fr * w / h, fr, -fr, 0.1, 100)
      state.camera.position.copy(state.cameraPrevPos || new THREE.Vector3(2.5, 2, 3.5))
    } else {
      state.cameraPrevPos = state.camera.position.clone()
      state.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
      state.camera.position.copy(state.cameraPrevPos || new THREE.Vector3(2.5, 2, 3.5))
    }
    state.camera.lookAt(0, 0, 0)
    if (state.controls) {
      state.controls.object = state.camera
      syncOrbitFromCamera(state)
    }
    paintCard(state, { syncControls: true })
  }))
  $wrap.prepend($bar)
}

function setupInteractiveCard ($panel, ir, cacheKey, $container) {
  const cardKey = $container.attr('data-geo3d-key')
  const prev = cardStates.get(cardKey)
  if (prev) {
    if (prev.controls && prev.controls.dispose) prev.controls.dispose()
    if (prev.ro) prev.ro.disconnect()
    cardStates.delete(cardKey)
  }

  const wrap = $('<div class="menmen-card-canvas-wrap"></div>')
  const $viewport = $('<div class="menmen-geo3d-viewport"></div>')
  const canvas2d = document.createElement('canvas')
  canvas2d.className = 'menmen-geo3d-canvas'
  const $labelLayer = $('<div class="geo3d-label-layer"></div>')
  $viewport.append(canvas2d).append($labelLayer)
  wrap.append($viewport)
  $panel.empty().append(wrap)

  const w = wrap.width() || 400
  const h = Math.max(160, (wrap.height() || 280))
  canvas2d.width = w
  canvas2d.height = h

  let entry = sceneCache.get(cacheKey)
  if (!entry) {
    entry = buildScene(ir)
    touchSceneCache(cacheKey, entry)
  } else {
    touchSceneCache(cacheKey, entry)
  }

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
  camera.position.set(2.5, 2, 3.5)
  camera.lookAt(0, 0, 0)

  const state = {
    scene: entry.scene,
    mesh: entry.mesh,
    labelMap: entry.labelMap,
    edgeGroup: entry.edgeGroup,
    irLabels: ir.labels || null,
    camera,
    canvas2d,
    width: w,
    height: h,
    $container,
    $labelLayer,
    ortho: false,
    controls: null
  }

  state.controls = wireGeo3dControls(state)

  buildToolbar(wrap, state)
  syncCanvasDimensions(state)
  cardStates.set(cardKey, state)
  activeCardKey = cardKey

  if (typeof ResizeObserver !== 'undefined') {
    const $viewport = wrap.find('.menmen-geo3d-viewport')
    const sizeEl = ($viewport.length ? $viewport : wrap)[0]
    state.ro = new ResizeObserver(() => {
      const pw = state.width
      const ph = state.height
      syncCanvasDimensions(state)
      if (state.width !== pw || state.height !== ph) paintCard(state)
    })
    state.ro.observe(sizeEl)
  }

  if (ir._sectionVertexCount != null) {
    const $note = $container.find('.tab-source .geo-section-note')
    if (!$note.length) {
      $container.find('.tab-source').append(`<div class="geo-section-note text-muted small">截面多边形顶点数：${ir._sectionVertexCount}</div>`)
    } else {
      $note.text(`截面多边形顶点数：${ir._sectionVertexCount}`)
    }
  }

  paintCard(state)
}

function bindManualControls (canvas, camera, onChange) {
  let down = false
  let btn = 0
  let lx = 0
  let ly = 0
  const target = new THREE.Vector3(0, 0, 0)
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
    down = true
    btn = e.button
    lx = e.clientX
    ly = e.clientY
    try { canvas.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
    e.preventDefault()
  }
  const onPointerUp = (e) => {
    down = false
    try { canvas.releasePointerCapture(e.pointerId) } catch (err) { /* ignore */ }
  }
  const onPointerMove = (e) => {
    if (!down) return
    const dx = e.clientX - lx
    const dy = e.clientY - ly
    lx = e.clientX
    ly = e.clientY
    if (btn === 0) {
      const offset = camera.position.clone().sub(target)
      const spherical = new THREE.Spherical().setFromVector3(offset)
      spherical.theta -= dx * 0.01
      spherical.phi -= dy * 0.01
      spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi))
      camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical))
      camera.lookAt(target)
    } else if (btn === 2) {
      const right = new THREE.Vector3().crossVectors(camera.up, camera.getWorldDirection(new THREE.Vector3())).normalize()
      const up = camera.up.clone()
      camera.position.add(right.multiplyScalar(-dx * 0.01)).add(up.multiplyScalar(dy * 0.01))
    }
    e.preventDefault()
    onChange()
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const offset = camera.position.clone().sub(target)
    const spherical = new THREE.Spherical().setFromVector3(offset)
    const factor = Math.pow(0.995, e.deltaY)
    spherical.radius = Math.max(0.8, Math.min(40, spherical.radius / factor))
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical))
    camera.lookAt(target)
    onChange()
  }, { passive: false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
}

function ensureMutationObserver () {
  if (moStarted) return
  moStarted = true
  const root = document.querySelector('.markdown-body') || document.body
  const mo = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.removedNodes.forEach(node => {
        if (!node.querySelectorAll) return
        node.querySelectorAll('.geo3d-container').forEach(el => {
          const key = el.getAttribute('data-geo3d-key')
          if (key) deactivateCard(key)
        })
      })
    })
  })
  mo.observe(root, { childList: true, subtree: true })
  window.addEventListener('beforeunload', () => {
    if (sharedRenderer) {
      sharedRenderer.dispose()
      if (sharedRenderer.forceContextLoss) sharedRenderer.forceContextLoss()
    }
  })
}

async function hydrateGeo ($c, code) {
  const cardKey = $c.attr('data-geo3d-key')
  if ($c.attr('data-geo3d-ready') === '1') return
  if (cardKey && hydrateInflight.has(cardKey)) return hydrateInflight.get(cardKey)

  const run = (async () => {
    try {
      $c.attr('data-geo3d-hydrating', '1')
      const { ir, hash, cacheKey } = await parseIr(code)
      $c.attr('data-geo3d-hash', hash)
      $c.find('.tab-source pre').text(code)
      await ensureThree()
      ensureMutationObserver()
      setupInteractiveCard($c.find('.tab-3d'), ir, cacheKey, $c)
      bindTabs($c)
      $c.attr('data-geo3d-ready', '1')
    } catch (e) {
      $c.removeAttr('data-geo3d-ready')
      $c.find('.tab-3d').html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
    } finally {
      $c.removeAttr('data-geo3d-hydrating')
      if (cardKey) hydrateInflight.delete(cardKey)
    }
  })()

  if (cardKey) hydrateInflight.set(cardKey, run)
  return run
}

async function triggerGeoRender ($c) {
  const code = $c.find('.tab-source pre').text()
  if (!code) return
  const { ir, hash } = await parseIr(code)
  const $views = $c.find('.tab-views')
  $views.html('<div class="menmen-card-loading">渲染中…</div>')
  try {
    const res = await fetch(`${serverurl}/api/geo/render`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ir, noteId: noteid })
    })
    const job = await res.json()
    const finalHash = job.hash || hash
    const scope = job.scope
    if (!scope) throw new Error('missing scope')
    let delay = 1000
    for (let i = 0; i < 60; i++) {
      const st = await fetch(`${serverurl}/api/geo/jobs/${scope}/${finalHash}?noteId=${encodeURIComponent(noteid || '')}`, { credentials: 'same-origin' })
      const body = await st.json()
      if (body.status === 'done' && body.urls) {
        const html = Object.entries(body.urls).map(([k, u]) => `<figure><figcaption>${escapeHTML(k)}</figcaption><img src="${escapeHTML(u)}" alt="${escapeHTML(k)}"/></figure>`).join('')
        $views.html(`<div class="menmen-card-views">${html}</div>`)
        return
      }
      if (body.status === 'error') throw new Error(body.error || 'render error')
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(5000, delay * 1.3)
    }
    throw new Error('timeout')
  } catch (e) {
    $views.html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
  }
}

function releaseCanvasBuffer ($shell) {
  if ($shell.attr('data-geo3d-key') === activeCardKey) return
  const key = $shell.attr('data-geo3d-key')
  const st = cardStates.get(key)
  if (st && st.canvas2d) {
    st.canvas2d.width = 1
    st.canvas2d.height = 1
  }
}

function observeHydrate ($shell, code) {
  if (ioSeen.has($shell[0])) return
  ioSeen.add($shell[0])
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target
      if (entry.isIntersecting) {
        clearTimeout(ioReleaseTimers.get(el))
        if (!$(el).attr('data-geo3d-ready') && !$(el).attr('data-geo3d-hydrating')) hydrateGeo($(el), code)
        else {
          const key = $(el).attr('data-geo3d-key')
          const st = cardStates.get(key)
          if (st && st.canvas2d && st.canvas2d.width <= 1) paintCard(st)
        }
      } else {
        ioReleaseTimers.set(el, setTimeout(() => releaseCanvasBuffer($(el)), IO_RELEASE_MS))
      }
    })
  }, { rootMargin: '200px' })
  io.observe($shell[0])
}

export function geo3dHighlightRender (code, lang) {
  if (lang !== 'geo3d') return null
  return `<div class="geo3d raw menmen-card-shell" data-lang="geo3d">${escapeHTML(code)}</div>`
}

export function processGeo3dBlocks (view) {
  view.find('div.geo3d.raw').removeClass('raw').each(function () {
    const $value = $(this)
    const code = $value.text()
    const localKey = clientHash(code)
    const $ele = $value.parent().parent()
    $ele.replaceWith(buildShell(localKey, ''))
    const $shell = view.find(`[data-geo3d-key="${localKey}"]`).last()
    $shell.attr('data-geo3d-source', code.trim())
    $shell.find('.tab-source pre').text(code)
    bindTabs($shell)
    parseIr(code).then(({ hash }) => { $shell.attr('data-geo3d-hash', hash) }).catch(() => {})
    observeHydrate($shell, code)
  })
}
