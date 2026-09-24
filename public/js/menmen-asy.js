/* global serverurl */
'use strict'

import escapeHTML from 'escape-html'
import { noteid } from './lib/config/index'

const ioSeen = new WeakSet()

function buildShell (localKey) {
  return `
<div class="menmen-card-shell asy-container" data-asy-key="${localKey}">
  <div class="menmen-card-header">
    <span class="menmen-card-title">ASY</span>
    <div class="menmen-card-tabs">
      <button type="button" class="menmen-card-tab active" data-tab="svg">SVG</button>
      <button type="button" class="menmen-card-tab" data-tab="source">Source</button>
    </div>
  </div>
  <div class="menmen-card-body">
    <div class="menmen-card-panel tab-svg active"><div class="menmen-card-loading">点击「SVG」或切换 Tab 编译</div></div>
    <div class="menmen-card-panel tab-source"><pre class="asy-source-editor"></pre></div>
  </div>
</div>`
}

function bindTabs ($c) {
  $c.find('.menmen-card-tab').off('click.asy').on('click.asy', function () {
    const tab = $(this).data('tab')
    $c.find('.menmen-card-tab').removeClass('active')
    $(this).addClass('active')
    $c.find('.menmen-card-panel').removeClass('active')
    $c.find(`.tab-${tab}`).addClass('active')
    if (tab === 'svg') compileAsy($c)
  })
}

async function pollJob (scope, hash) {
  let delay = 1000
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${serverurl}/api/geo/jobs/${scope}/${hash}?noteId=${encodeURIComponent(noteid || '')}`, { credentials: 'same-origin' })
    const body = await res.json()
    if (body.status === 'done' && body.urls) return body
    if (body.status === 'error') throw new Error(body.error || 'compile failed')
    await new Promise(r => setTimeout(r, delay))
    delay = Math.min(5000, delay * 1.3)
  }
  throw new Error('timeout')
}

async function compileAsy ($c) {
  if ($c.attr('data-asy-ready')) return
  const source = $c.find('.tab-source pre').text()
  if (!source.trim()) return
  const $panel = $c.find('.tab-svg')
  $panel.html('<div class="menmen-card-loading">编译 Asymptote…</div>')
  try {
    const res = await fetch(`${serverurl}/api/geo/compile-asy`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, noteId: noteid })
    })
    const job = await res.json()
    const result = job.status === 'done' ? job : await pollJob(job.scope, job.hash)
    const urls = result.urls || {}
    const html = Object.entries(urls).map(([k, u]) =>
      `<figure><figcaption>${escapeHTML(k)}</figcaption><img src="${escapeHTML(u)}" alt="${escapeHTML(k)}"/></figure>`
    ).join('')
    if (!html) throw new Error('无 SVG 输出（需 Asymptote 环境）')
    $panel.html(`<div class="menmen-card-views">${html}</div>`)
    $c.attr('data-asy-ready', '1')
  } catch (e) {
    $panel.html(`<div class="alert alert-warning">${escapeHTML(e.message)}</div>`)
  }
}

function observeHydrate ($shell) {
  if (ioSeen.has($shell[0])) return
  ioSeen.add($shell[0])
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !$(entry.target).attr('data-asy-ready')) {
        compileAsy($(entry.target))
        io.disconnect()
      }
    })
  }, { rootMargin: '200px' })
  io.observe($shell[0])
}

export function asyHighlightRender (code, lang) {
  if (lang !== 'asy') return null
  return `<div class="asy raw menmen-card-shell" data-lang="asy">${escapeHTML(code)}</div>`
}

export function processAsyBlocks (view) {
  view.find('div.asy.raw').removeClass('raw').each(function () {
    const $value = $(this)
    const code = $value.text()
    let hash = 5381
    for (let i = 0; i < code.length; i++) {
      hash = ((hash << 5) + hash) + code.charCodeAt(i)
      hash |= 0
    }
    const localKey = `ak_${(hash >>> 0).toString(36)}`
    const $ele = $value.parent().parent()
    $ele.replaceWith(buildShell(localKey))
    const $shell = view.find(`[data-asy-key="${localKey}"]`).last()
    $shell.find('.tab-source pre').text(code)
    bindTabs($shell)
    observeHydrate($shell)
  })
}
