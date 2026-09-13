/* global serverurl */
'use strict'

import escapeHTML from 'escape-html'
import hljs from 'highlight.js'
import { noteid } from './lib/config/index'
import getUIElements from './lib/editor/ui-elements'

const ui = getUIElements()

const manimStateMap = new Map()
const manimDebounceTimers = new Map()
const manimPollers = new Map()
const MANIM_DEBOUNCE_MS = 1000
const MANIM_POLL_MS = 3000

function clientHash (input) {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `mk_${(hash >>> 0).toString(36)}`
}

function escapeCode (code) {
  return escapeHTML(code)
}

function highlightPython (code) {
  try {
    return hljs.highlight('python', code).value
  } catch (err) {
    console.warn('manim source highlight failed:', err)
    return escapeCode(code)
  }
}

/** 从源码猜 Scene 子类名（与 manim-service AST 回退一致：取第一个） */
function guessSceneName (code) {
  if (!code) return ''
  const re = /class\s+([A-Za-z_]\w*)\s*\([^)]*\b\w*Scene\b[^)]*\)/g
  const match = re.exec(code)
  return match ? match[1] : ''
}

function resolveDisplayScene (explicitScene, code, stateScene) {
  return (explicitScene || stateScene || guessSceneName(code) || '').trim()
}

function formatSceneFiles (sceneName) {
  const name = sceneName || ''
  if (!name) return 'script.py · output.mp4'
  return `${name}.py · ${name}.mp4`
}

function updateManimHeader ($container, sceneName) {
  $container.find('.manim-title').text('MANIM')
  $container.find('.manim-subtitle').text(formatSceneFiles(sceneName))
}

function buildManimShell (localKey, sceneName, code) {
  const name = resolveDisplayScene(sceneName, code, '')
  return `
<div class="manim-container" data-manim-key="${localKey}" data-scene-name="${escapeCode(name)}">
  <div class="manim-header">
    <div class="manim-info">
      <span class="manim-title">MANIM</span>
      <span class="manim-subtitle">${escapeCode(formatSceneFiles(name))}</span>
    </div>
    <div class="manim-tabs">
      <button type="button" class="manim-tab-btn active" data-tab="video">Video</button>
      <button type="button" class="manim-tab-btn" data-tab="source">Source</button>
    </div>
  </div>
  <div class="manim-content">
    <div class="manim-tab-panel tab-video active"></div>
    <div class="manim-tab-panel tab-source" style="display:none;">
      <pre class="manim-source-pre"><code class="hljs language-python">${highlightPython(code)}</code></pre>
    </div>
  </div>
</div>`
}

function bindManimTabs ($container) {
  $container.find('.manim-tab-btn').off('click.manim').on('click.manim', function () {
    const tab = $(this).data('tab')
    $container.find('.manim-tab-btn').removeClass('active')
    $(this).addClass('active')
    $container.find('.manim-tab-panel').hide()
    $container.find(`.tab-${tab}`).show()
  })
}

function renderManimLoadingPanel ($container, label) {
  $container.find('.tab-video').html(`
    <div class="manim-loading">
      <span class="manim-spinner"></span>
      <span>${escapeCode(label || 'Rendering...')}</span>
    </div>`)
}

function renderManimErrorPanel ($container, state, onRetry) {
  const stderr = escapeCode(state.stderr || 'Render failed')
  $container.find('.tab-video').html(`
    <div class="manim-error">
      <div class="manim-error-title">✕ Render failed</div>
      <pre class="manim-error-body">${stderr}</pre>
      <button type="button" class="manim-retry-btn">Retry</button>
    </div>`)
  $container.find('.manim-retry-btn').off('click.manim').on('click.manim', onRetry)
}

function renderManimDonePanel ($container, state) {
  const url = state.videoUrl || ''
  $container.attr('data-video-url', url)
  $container.find('.tab-video').html(`
    <div class="manim-video-wrapper">
      <video controls loop muted playsinline src="${escapeCode(url)}"></video>
    </div>
    <div class="manim-footer">Cached in MinIO · public/manim/</div>`)
}

function getPreviewRoot () {
  if (ui.area && ui.area.markdown) {
    return ui.area.markdown
  }
  return $('.markdown-body').first()
}

function applyManimResult (localKey, code, scene, state) {
  manimStateMap.set(localKey, state)
  const $targets = getPreviewRoot().find(`[data-manim-key="${localKey}"]`)
  $targets.each(function () {
    const $container = $(this)
    const displayScene = resolveDisplayScene(scene, code, state.sceneName)
    if (displayScene) {
      updateManimHeader($container, displayScene)
      $container.attr('data-scene-name', displayScene)
    }
    if (state.status === 'done') {
      renderManimDonePanel($container, state)
    } else if (state.status === 'error') {
      renderManimErrorPanel($container, state, function () {
        const next = Object.assign({}, state, { retried: 0 })
        manimStateMap.set(localKey, next)
        submitManimRender(localKey, code, scene, true)
      })
    } else {
      renderManimLoadingPanel($container)
    }
    bindManimTabs($container)
  })
}

function stopPoller (localKey) {
  const timer = manimPollers.get(localKey)
  if (timer) {
    clearInterval(timer)
    manimPollers.delete(localKey)
  }
}

function pollManimStatus (localKey, code, scene, articleId, hash) {
  stopPoller(localKey)

  const tick = function () {
    fetch(`${serverurl}/api/manim/status/${articleId}/${hash}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    }).then(function (response) {
      // 304：旧 ETag 缓存，忽略并继续轮询
      if (response.status === 304) return null
      if (response.status === 404) {
        stopPoller(localKey)
        const state = manimStateMap.get(localKey) || {}
        if (!state.retried) {
          state.retried = 1
          manimStateMap.set(localKey, state)
          submitManimRender(localKey, code, scene, true)
        } else {
          applyManimResult(localKey, code, scene, {
            status: 'error',
            stderr: 'Render job not found',
            retried: state.retried
          })
        }
        return null
      }
      // 503 等瞬时错误：保持 loading，继续轮询
      if (response.status === 503) return null
      if (response.status >= 400) {
        return response.json().then(function (body) {
          stopPoller(localKey)
          applyManimResult(localKey, code, scene, {
            status: 'error',
            stderr: (body && (body.stderr || body.message)) || `Status failed (${response.status})`,
            hash,
            articleId
          })
          return null
        })
      }
      return response.json()
    }).then(function (body) {
      if (!body) return
      const state = Object.assign({}, body, { hash, articleId })
      applyManimResult(localKey, code, scene, state)
      if (body.status === 'done' || body.status === 'error') {
        stopPoller(localKey)
      }
    }).catch(function (err) {
      console.error(err)
      // 解析失败不立刻停（可能是空 304），留给下次 tick
    })
  }

  tick()
  const timer = setInterval(tick, MANIM_POLL_MS)
  manimPollers.set(localKey, timer)
}

function submitManimRender (localKey, code, scene, immediate) {
  const run = function () {
    fetch(`${serverurl}/api/manim/render`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify({
        code,
        scene: scene || undefined,
        noteId: noteid
      })
    }).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, body }
      })
    }).then(function ({ status, body }) {
      if (status === 404 && body.status === 'error') {
        applyManimResult(localKey, code, scene, body)
        return
      }
      if (status >= 400) {
        applyManimResult(localKey, code, scene, {
          status: 'error',
          stderr: body.stderr || body.message || `Request failed (${status})`
        })
        return
      }
      if (!body || !body.status) {
        applyManimResult(localKey, code, scene, {
          status: 'error',
          stderr: 'Invalid render response (check /api/manim/ nginx route)'
        })
        return
      }
      applyManimResult(localKey, code, scene, body)
      if (body.status === 'queued' || body.status === 'rendering') {
        if (!body.articleId || !body.hash) {
          applyManimResult(localKey, code, scene, {
            status: 'error',
            stderr: 'Render response missing articleId/hash'
          })
          return
        }
        pollManimStatus(localKey, code, scene, body.articleId, body.hash)
      }
    }).catch(function (err) {
      console.error(err)
      applyManimResult(localKey, code, scene, {
        status: 'error',
        stderr: 'Render service unavailable'
      })
    })
  }

  if (immediate) {
    run()
    return
  }
  const existing = manimDebounceTimers.get(localKey)
  if (existing) clearTimeout(existing)
  manimDebounceTimers.set(localKey, setTimeout(function () {
    manimDebounceTimers.delete(localKey)
    run()
  }, MANIM_DEBOUNCE_MS))
}

export function manimHighlightRender (code, lang) {
  const manimMatch = lang.match(/^manim(?::([A-Za-z_]\w*))?$/)
  if (!manimMatch) return null
  const scene = manimMatch[1] || ''
  return `<div class="manim raw" data-scene="${escapeCode(scene)}">${code}</div>`
}

export function processManimBlocks (view) {
  const manims = view.find('div.manim.raw').removeClass('raw')
  manims.each(function (key, value) {
    const $value = $(value)
    const $ele = $value.parent().parent()
    const code = $value.text()
    const scene = $value.attr('data-scene') || ''
    const displayScene = resolveDisplayScene(scene, code, '')
    const localKey = clientHash(`${scene}\n${code}`)
    const state = manimStateMap.get(localKey)

    $ele.replaceWith(buildManimShell(localKey, displayScene, code))
    const $container = getPreviewRoot().find(`[data-manim-key="${localKey}"]`).last()
    bindManimTabs($container)

    if (state && state.status === 'done') {
      updateManimHeader($container, resolveDisplayScene(scene, code, state.sceneName))
      renderManimDonePanel($container, state)
      return
    }
    if (state && state.status === 'error') {
      updateManimHeader($container, resolveDisplayScene(scene, code, state.sceneName))
      renderManimErrorPanel($container, state, function () {
        const next = Object.assign({}, state, { retried: 0 })
        manimStateMap.set(localKey, next)
        submitManimRender(localKey, code, scene, true)
      })
      return
    }
    if (state && (state.status === 'queued' || state.status === 'rendering')) {
      renderManimLoadingPanel($container)
      if (state.articleId && state.hash && !manimPollers.has(localKey)) {
        pollManimStatus(localKey, code, scene, state.articleId, state.hash)
      }
      return
    }

    renderManimLoadingPanel($container)
    submitManimRender(localKey, code, scene, false)
  })
}

export function exportManimBlocks (src) {
  src.find('.manim-container').each(function (key, value) {
    const $container = $(value)
    const videoUrl = $container.attr('data-video-url')
    const sourceHtml = $container.find('.tab-source').html() || ''
    if (videoUrl) {
      const absolute = `${window.location.origin}${videoUrl}`
      $container.replaceWith(`
        <div class="manim-export">
          <video controls src="${escapeCode(absolute)}"></video>
          <details><summary>Source</summary>${sourceHtml}</details>
        </div>`)
      return
    }
    if ($container.find('.manim-error').length) {
      const err = $container.find('.manim-error-body').text()
      $container.replaceWith(`<pre class="manim-export-error">${escapeCode(err)}</pre>`)
      return
    }
    $container.replaceWith(`<pre class="manim-export-pending">${escapeCode('Manim render pending')}</pre>`)
  })
}
