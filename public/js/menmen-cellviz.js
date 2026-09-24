'use strict'

import escapeHTML from 'escape-html'

const SYMBOLS = {
  nucleus: { cx: 100, cy: 100, r: 28, fill: '#6e59a5' },
  mitochondrion: { cx: 160, cy: 130, rx: 22, ry: 12, fill: '#e5484d' },
  cell_membrane: { cx: 100, cy: 100, r: 90, fill: 'none', stroke: '#3e63dd', sw: 2 },
  vacuole: { cx: 60, cy: 140, r: 18, fill: '#12a594', opacity: 0.5 }
}

function renderComponent (comp) {
  const t = comp.type
  const sym = SYMBOLS[t]
  if (!sym) {
    return `<circle cx="${(comp.pos[0] * 200).toFixed(1)}" cy="${(comp.pos[1] * 200).toFixed(1)}" r="8" fill="#999"/>`
  }
  const x = (comp.pos && comp.pos[0] != null) ? comp.pos[0] * 200 : sym.cx
  const y = (comp.pos && comp.pos[1] != null) ? comp.pos[1] * 200 : sym.cy
  const label = escapeHTML(comp.label || t)
  if (sym.r && !sym.rx) {
    return `<circle cx="${x}" cy="${y}" r="${sym.r * (comp.size || 0.3) / 0.3}" fill="${sym.fill}" opacity="${sym.opacity || 1}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" fill="#fff">${label}</text>`
  }
  if (sym.stroke) {
    return `<circle cx="${x}" cy="${y}" r="${sym.r}" fill="${sym.fill}" stroke="${sym.stroke}" stroke-width="${sym.sw}"/>`
  }
  return `<ellipse cx="${x}" cy="${y}" rx="${sym.rx}" ry="${sym.ry}" fill="${sym.fill}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9">${label}</text>`
}

function buildShell (localKey) {
  return `
<div class="menmen-card-shell cellviz-container" data-cellviz-key="${localKey}">
  <div class="menmen-card-header"><span class="menmen-card-title">CELLVIZ</span></div>
  <div class="menmen-card-body"><svg class="cellviz-svg" viewBox="0 0 200 200" width="100%" height="280"></svg></div>
</div>`
}

function renderIr ($shell, ir) {
  const parts = (ir.components || []).map(renderComponent)
  ;(ir.arrows || []).forEach(a => {
    parts.push(`<line x1="${a.from[0] * 200}" y1="${a.from[1] * 200}" x2="${a.to[0] * 200}" y2="${a.to[1] * 200}" stroke="#333" marker-end="url(#arrow)"/>`)
  })
  $shell.find('.cellviz-svg').html(`<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#333"/></marker></defs>${parts.join('')}`)
}

export function cellvizHighlightRender (code, lang) {
  if (lang !== 'cellviz') return null
  return `<div class="cellviz raw menmen-card-shell" data-lang="cellviz">${escapeHTML(code)}</div>`
}

export function processCellvizBlocks (view) {
  view.find('div.cellviz.raw').removeClass('raw').each(function () {
    const $value = $(this)
    const code = $value.text()
    const localKey = `cv_${code.length}`
    const $ele = $value.parent().parent()
    $ele.replaceWith(buildShell(localKey))
    const $shell = view.find(`[data-cellviz-key="${localKey}"]`).last()
    try {
      const ir = JSON.parse(code.trim())
      renderIr($shell, ir)
    } catch (e) {
      $shell.find('.cellviz-svg').replaceWith(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
    }
  })
}
