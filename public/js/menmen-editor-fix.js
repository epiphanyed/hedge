/* menmen: 行号与正文对齐；手写笔在光标下打开白色画板，并展开铅笔/圆珠笔 */
(function () {
  var TOOLS = [
    { id: 'color', label: '颜色', icon: 'color' },
    { id: 'pencil', label: '铅笔', icon: 'pencil' },
    { id: 'ballpoint', label: '圆珠笔', icon: 'ballpoint' },
    { id: 'brush', label: '毛笔', icon: 'brush' },
    { id: 'fineliner', label: '针管笔', icon: 'fineliner' },
    { id: 'eraser', label: '橡皮', icon: 'eraser' }
  ]
  var PRESET_COLORS = ['#111', '#555', '#E5484D', '#F76B15', '#F5D90A', '#30A46C', '#12A594', '#3E63DD', '#8E4EC6', '#E93D82']
  var INK_RECO_MODES = [
    { id: 'latex', label: '数学公式' },
    { id: 'chem_eq', label: '化学方程式' },
    { id: 'chem', label: '化学结构式' },
    { id: 'geo3d', label: '数学立体图形' }
  ]
  var INK_LAST_MODE_KEY = 'menmen.ink.lastMode'
  var INK_PAD_HEIGHT_KEY = 'menmen.ink.padHeight'
  var INK_PAD_MIN_H = 160
  var INK_PAD_EDGE = 6

  var refreshTimer = null
  var observing = false
  var padOpen = false
  var activeTool = 'ballpoint'
  var color = '#111111'
  var drawing = false
  var stroke = null
  var strokes = []
  var inkHistory = [[]]
  var inkHistoryIndex = 0
  var inkInsertCursor = null
  var padScrollEl = null
  var onPadScroll = null

  function editorInstance () {
    return window.editor
  }

  function editAreaEl () {
    return document.querySelector('.ui-edit-area')
  }

  function alignGutters () {
    var wrap = document.querySelector('.ui-edit-area .CodeMirror')
    if (!wrap) return
    wrap.style.direction = 'ltr'
    var gutters = wrap.querySelector('.CodeMirror-gutters')
    var sizer = wrap.querySelector('.CodeMirror-sizer')
    if (!gutters || !sizer) return
    gutters.style.left = '0'
    gutters.style.right = 'auto'
    var w = gutters.offsetWidth
    if (w < 24) {
      gutters.style.width = '36px'
      w = Math.max(gutters.offsetWidth, 36)
    }
    sizer.style.marginLeft = w + 'px'
  }

  function refreshEditor () {
    var ed = editorInstance()
    if (!ed || typeof ed.refresh !== 'function') {
      alignGutters()
      return false
    }
    try {
      ed.refresh()
    } catch (e) { /* ignore */ }
    alignGutters()
    return true
  }

  function readerFlipPaginating () {
    try {
      var flip = window.__menmenReaderFlip
      return !!(flip && typeof flip.isPaginating === 'function' && flip.isPaginating())
    } catch (e) {
      return false
    }
  }

  function scheduleRefresh () {
    if (readerFlipPaginating()) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshEditor()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(refreshEditor)
    refreshTimer = setTimeout(refreshEditor, 80)
    setTimeout(refreshEditor, 240)
    setTimeout(refreshEditor, 800)
  }

  function editAreaVisible () {
    var wrap = document.querySelector('.ui-edit-area .CodeMirror')
    return !!(wrap && wrap.offsetHeight > 0 && wrap.offsetWidth > 0)
  }

  function bindResize () {
    if (observing || typeof ResizeObserver === 'undefined') return
    var area = editAreaEl()
    if (!area) return
    observing = true
    var ro = new ResizeObserver(function () {
      if (readerFlipPaginating()) return
      if (editAreaVisible()) scheduleRefresh()
      if (padOpen) placePad()
    })
    ro.observe(area)
  }

  function waitAndRefresh (attempt) {
    attempt = attempt || 0
    if (editAreaVisible() && refreshEditor()) {
      scheduleRefresh()
      bindResize()
      return
    }
    if (attempt > 80) return
    setTimeout(function () { waitAndRefresh(attempt + 1) }, 120)
  }

  function toolSvg (id) {
    if (window.__menmenInkIcons && window.__menmenInkIcons.inkToolSvg) {
      return window.__menmenInkIcons.inkToolSvg(id, color, id === 'color' ? color : undefined)
    }
    return ''
  }

  function ensureTray () {
    var tray = document.querySelector('.menmen-ink-tray')
    if (!tray) return null
    if (tray.getAttribute('data-menmen-built') === '1' && tray.getAttribute('data-menmen-icons') === '3') return tray
    tray.innerHTML = ''
    TOOLS.forEach(function (def) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ink-tool'
      btn.dataset.tool = def.id
      btn.title = def.label
      btn.setAttribute('role', def.id === 'color' ? 'button' : 'radio')
      btn.setAttribute('aria-checked', def.id === activeTool ? 'true' : 'false')
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + toolSvg(def.id) + '</svg>'
      tray.appendChild(btn)
    })
    tray.setAttribute('data-menmen-built', '1')
    tray.setAttribute('data-menmen-icons', '3')
    tray.addEventListener('click', onTrayClick)
    return tray
  }

  function refreshTrayIcons () {
    var tray = document.querySelector('.menmen-ink-tray')
    if (!tray) return
    tray.querySelectorAll('.ink-tool').forEach(function (btn) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + toolSvg(btn.dataset.tool) + '</svg>'
      if (btn.dataset.tool !== 'color') {
        btn.setAttribute('aria-checked', btn.dataset.tool === activeTool ? 'true' : 'false')
      }
    })
  }

  function onTrayClick (e) {
    var btn = e.target.closest('.ink-tool')
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    var tool = btn.dataset.tool
    if (tool === 'color') {
      toggleColorPop(btn)
      return
    }
    activeTool = tool
    refreshTrayIcons()
  }

  function cloneStrokes (list) {
    return JSON.parse(JSON.stringify(list || []))
  }

  function resetInkHistory () {
    inkHistory = [[]]
    inkHistoryIndex = 0
    updateUndoRedoUi()
  }

  function commitInkHistory () {
    inkHistory = inkHistory.slice(0, inkHistoryIndex + 1)
    inkHistory.push(cloneStrokes(strokes))
    if (inkHistory.length > 80) {
      inkHistory.shift()
    } else {
      inkHistoryIndex += 1
    }
    updateUndoRedoUi()
  }

  function undoInk () {
    if (inkHistoryIndex <= 0) return
    inkHistoryIndex -= 1
    strokes = cloneStrokes(inkHistory[inkHistoryIndex])
    var pad = document.querySelector('.menmen-ink-pad')
    if (pad) redrawPad(pad)
    updateUndoRedoUi()
  }

  function redoInk () {
    if (inkHistoryIndex >= inkHistory.length - 1) return
    inkHistoryIndex += 1
    strokes = cloneStrokes(inkHistory[inkHistoryIndex])
    var pad = document.querySelector('.menmen-ink-pad')
    if (pad) redrawPad(pad)
    updateUndoRedoUi()
  }

  function updateUndoRedoUi () {
    var undoBtn = document.querySelector('.menmen-ink-panel .btn-undo')
    var redoBtn = document.querySelector('.menmen-ink-panel .btn-redo')
    if (undoBtn) undoBtn.disabled = inkHistoryIndex <= 0
    if (redoBtn) redoBtn.disabled = inkHistoryIndex >= inkHistory.length - 1
  }

  function toggleColorPop (anchor) {
    var group = document.querySelector('.menmen-ink-group')
    if (!group) return
    if (getComputedStyle(group).position === 'static') group.style.position = 'relative'
    var pop = group.querySelector('.menmen-ink-color-pop')
    if (!pop) {
      pop = document.createElement('div')
      pop.className = 'menmen-ink-color-pop hidden'
      pop.innerHTML =
        '<div class="swatches">' +
        PRESET_COLORS.map(function (c) {
          return '<button type="button" class="swatch" data-color="' + c + '" style="background:' + c + '"></button>'
        }).join('') +
        '</div>'
      group.appendChild(pop)
      pop.addEventListener('click', function (ev) {
        ev.stopPropagation()
        var sw = ev.target.closest('.swatch')
        if (!sw) return
        color = sw.dataset.color
        pop.classList.add('hidden')
        refreshTrayIcons()
      })
    }
    var show = pop.classList.contains('hidden')
    if (show) {
      pop.classList.remove('hidden')
      var groupRect = group.getBoundingClientRect()
      var anchorRect = anchor.getBoundingClientRect()
      pop.style.left = Math.max(0, anchorRect.left - groupRect.left) + 'px'
      pop.style.top = (anchorRect.bottom - groupRect.top + 4) + 'px'
    } else {
      pop.classList.add('hidden')
    }
  }

  function setToggleUi (open) {
    var btn = document.querySelector('.menmen-ink-toggle')
    var tray = ensureTray()
    if (btn) {
      btn.classList.toggle('active', open)
      btn.setAttribute('aria-pressed', open ? 'true' : 'false')
    }
    if (tray) {
      tray.classList.toggle('open', open)
      if (open) tray.removeAttribute('hidden')
      else tray.setAttribute('hidden', '')
    }
  }

  function cmGutterWidth (ed) {
    if (!ed || !ed.getWrapperElement) return 0
    var gutters = ed.getWrapperElement().querySelector('.CodeMirror-gutters')
    return gutters ? gutters.offsetWidth : 0
  }

  function bindPadScroll (ed) {
    /* 手写板贴底固定，不再随光标/滚动 reposition */
  }

  function unbindPadScroll () {
    padScrollEl = null
    onPadScroll = null
  }

  function inkPadMaxHeight (areaH) {
    return Math.max(INK_PAD_MIN_H, areaH - INK_PAD_EDGE)
  }

  function readInkPadHeight (areaH, pad) {
    var maxH = inkPadMaxHeight(areaH)
    if (pad && pad.dataset.userHeight) {
      var u = parseInt(pad.dataset.userHeight, 10)
      if (!isNaN(u) && u >= INK_PAD_MIN_H) return Math.min(u, maxH)
    }
    var saved = parseInt(localStorage.getItem(INK_PAD_HEIGHT_KEY), 10)
    if (!isNaN(saved) && saved >= INK_PAD_MIN_H) return Math.min(saved, maxH)
    return Math.min(300, Math.max(INK_PAD_MIN_H, Math.floor(areaH * 0.38)))
  }

  function padChromeHeight (pad) {
    var panel = pad.querySelector('.menmen-ink-panel')
    var handle = pad.querySelector('.menmen-ink-pad-resize')
    return (handle ? handle.offsetHeight : 10) + (panel ? panel.offsetHeight : 40)
  }

  function bindPadResize (pad) {
    var handle = pad.querySelector('.menmen-ink-pad-resize')
    if (!handle || handle.dataset.bound === '1') return
    handle.dataset.bound = '1'
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      var startY = e.clientY
      var startH = pad.offsetHeight
      var area = editAreaEl()
      var maxH = area ? inkPadMaxHeight(area.clientHeight) : startH

      function move (ev) {
        var dy = startY - ev.clientY
        var newH = Math.min(maxH, Math.max(INK_PAD_MIN_H, startH + dy))
        pad.style.height = newH + 'px'
        pad.dataset.userHeight = String(newH)
        localStorage.setItem(INK_PAD_HEIGHT_KEY, String(newH))
        resizePadCanvas(pad)
      }
      function up () {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    })
  }

  function ensurePadResizeHandle (pad) {
    if (!pad) return
    if (!pad.querySelector('.menmen-ink-pad-resize')) {
      var handle = document.createElement('div')
      handle.className = 'menmen-ink-pad-resize'
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', 'horizontal')
      handle.title = '拖拽调整高度'
      pad.insertBefore(handle, pad.firstChild)
    }
    bindPadResize(pad)
  }

  function placePad () {
    var pad = document.querySelector('.menmen-ink-pad')
    var area = editAreaEl()
    var ed = editorInstance()
    if (!pad || !area) return
    ensurePadResizeHandle(pad)
    var areaRect = area.getBoundingClientRect()
    var areaW = area.clientWidth || areaRect.width
    var areaH = area.clientHeight || areaRect.height
    var edge = INK_PAD_EDGE
    var left = edge
    var width = Math.max(200, areaW - edge * 2)

    if (ed && ed.getWrapperElement) {
      var cm = ed.getWrapperElement()
      var cmRect = cm.getBoundingClientRect()
      var gutterW = cmGutterWidth(ed)
      left = Math.max(edge, (cmRect.left - areaRect.left) + gutterW)
      width = Math.max(200, areaW - left - edge)
    }

    var height = readInkPadHeight(areaH, pad)
    pad.dataset.userHeight = String(height)

    pad.style.left = left + 'px'
    pad.style.right = 'auto'
    pad.style.top = 'auto'
    pad.style.bottom = edge + 'px'
    pad.style.width = width + 'px'
    pad.style.height = height + 'px'
    resizePadCanvas(pad)
  }

  function resizePadCanvas (pad) {
    var canvas = pad.querySelector('canvas')
    if (!canvas) return
    var cssW = canvas.clientWidth
    var cssH = canvas.clientHeight
    if (cssW < 1 || cssH < 1) {
      var padRect = pad.getBoundingClientRect()
      cssW = padRect.width
      cssH = Math.max(80, padRect.height - padChromeHeight(pad))
    }
    var dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(cssW * dpr))
    canvas.height = Math.max(1, Math.floor(cssH * dpr))
    canvas.style.width = cssW + 'px'
    canvas.style.height = cssH + 'px'
    redrawPad(pad)
  }

  function redrawPad (pad) {
    var canvas = pad.querySelector('canvas')
    if (!canvas) return
    var ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    strokes.forEach(function (s) {
      if (!s.points.length) return
      ctx.strokeStyle = s.erase ? '#ffffff' : s.color
      ctx.lineWidth = (s.erase ? 16 : s.width) * (window.devicePixelRatio || 1)
      ctx.beginPath()
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (var i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
      ctx.stroke()
    })
  }

  function canvasPoint (canvas, e) {
    var rect = canvas.getBoundingClientRect()
    var dpr = window.devicePixelRatio || 1
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr
    }
  }

  function toolWidth () {
    if (activeTool === 'pencil') return 2
    if (activeTool === 'brush') return 8
    if (activeTool === 'fineliner') return 3
    return 1.8
  }

  function fillInkRecognizeModeSelect (sel) {
    if (!sel) return
    var savedMode = localStorage.getItem(INK_LAST_MODE_KEY) || 'latex'
    if (!INK_RECO_MODES.some(function (m) { return m.id === savedMode })) savedMode = 'latex'
    var cur = sel.value
    sel.innerHTML = ''
    INK_RECO_MODES.forEach(function (m) {
      var opt = document.createElement('option')
      opt.value = m.id
      opt.textContent = m.label
      sel.appendChild(opt)
    })
    if (INK_RECO_MODES.some(function (m) { return m.id === cur })) sel.value = cur
    else sel.value = savedMode
  }

  function upgradeInkRecognizePanel (panel) {
    if (!panel) return
    var recognizeBtn = panel.querySelector('.btn-recognize-text')
    if (!recognizeBtn || !panel.querySelector('.btn-undo')) return
    var sel = panel.querySelector('.ink-recog-mode')
    if (sel) {
      if (sel.options.length !== INK_RECO_MODES.length) fillInkRecognizeModeSelect(sel)
      return
    }
    sel = document.createElement('select')
    sel.className = 'ink-recog-mode'
    sel.title = '识别类型'
    fillInkRecognizeModeSelect(sel)
    sel.addEventListener('change', function () {
      localStorage.setItem(INK_LAST_MODE_KEY, sel.value)
      applyInkHintForMode(panel, sel.value)
    })
    panel.insertBefore(sel, recognizeBtn)
    applyInkHintForMode(panel, sel.value)
    recognizeBtn.textContent = '识别并插入'
  }

  function ensurePad () {
    var area = editAreaEl()
    if (!area) return null
    if (window.getComputedStyle(area).position === 'static') area.style.position = 'relative'
    var overlay = area.querySelector('.menmen-ink-overlay')
    if (overlay) {
      var modeSel = overlay.querySelector('.ink-recog-mode')
      if (!overlay.querySelector('.btn-undo') || !modeSel || modeSel.options.length < INK_RECO_MODES.length) {
        overlay.remove()
      }
    }
    overlay = area.querySelector('.menmen-ink-overlay')
    if (overlay) {
      var panel = overlay.querySelector('.menmen-ink-panel')
      upgradeInkRecognizePanel(panel)
      var existingSel = panel && panel.querySelector('.ink-recog-mode')
      if (existingSel && existingSel.options.length !== INK_RECO_MODES.length) {
        fillInkRecognizeModeSelect(existingSel)
      }
      ensurePadResizeHandle(overlay.querySelector('.menmen-ink-pad'))
      return overlay
    }
    var savedMode = localStorage.getItem(INK_LAST_MODE_KEY) || 'latex'
    if (!INK_RECO_MODES.some(function (m) { return m.id === savedMode })) savedMode = 'latex'
    var modeOptions = INK_RECO_MODES.map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === savedMode ? ' selected' : '') + '>' + m.label + '</option>'
    }).join('')
    overlay = document.createElement('div')
    overlay.className = 'menmen-ink-overlay'
    overlay.innerHTML =
      '<div class="menmen-ink-pad">' +
        '<div class="menmen-ink-pad-resize" role="separator" aria-orientation="horizontal" title="拖拽调整高度"></div>' +
        '<canvas></canvas>' +
        '<div class="menmen-ink-panel">' +
          '<button type="button" class="btn-undo" title="撤销 (Ctrl+Z)">撤销</button>' +
          '<button type="button" class="btn-redo" title="重做 (Ctrl+Y)">重做</button>' +
          '<button type="button" class="btn-clear">清空</button>' +
          '<button type="button" class="btn-image">插入为图片</button>' +
          '<select class="ink-recog-mode" title="识别类型">' + modeOptions + '</select>' +
          '<input type="text" class="ink-recog-hint" maxlength="100" placeholder="补充：苯环、呋喃…" title="结构式识别时可填物质名" />' +
          '<button type="button" class="btn-recognize-text">识别并插入</button>' +
          '<button type="button" class="btn-close">关闭</button>' +
        '</div>' +
      '</div>'
    var canvas = overlay.querySelector('canvas')
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId)
      drawing = true
      stroke = {
        color: color,
        width: toolWidth(),
        erase: activeTool === 'eraser',
        points: [canvasPoint(canvas, e)]
      }
      strokes.push(stroke)
      redrawPad(overlay.querySelector('.menmen-ink-pad'))
    })
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing || !stroke) return
      stroke.points.push(canvasPoint(canvas, e))
      redrawPad(overlay.querySelector('.menmen-ink-pad'))
    })
    var endStroke = function () {
      if (drawing && stroke && stroke.points.length > 1) commitInkHistory()
      drawing = false
      stroke = null
    }
    canvas.addEventListener('pointerup', endStroke)
    canvas.addEventListener('pointercancel', endStroke)
    overlay.querySelector('.btn-undo').addEventListener('click', undoInk)
    overlay.querySelector('.btn-redo').addEventListener('click', redoInk)
    overlay.querySelector('.btn-clear').addEventListener('click', function () {
      strokes = []
      redrawPad(overlay.querySelector('.menmen-ink-pad'))
      commitInkHistory()
    })
    overlay.querySelector('.btn-image').addEventListener('click', function () {
      insertPadImage(overlay)
    })
    var modeSelect = overlay.querySelector('.ink-recog-mode')
    if (modeSelect) {
      modeSelect.addEventListener('change', function () {
        localStorage.setItem(INK_LAST_MODE_KEY, modeSelect.value)
        applyInkHintForMode(overlay.querySelector('.menmen-ink-panel'), modeSelect.value)
      })
      applyInkHintForMode(overlay.querySelector('.menmen-ink-panel'), modeSelect.value)
    }
    overlay.querySelector('.btn-recognize-text').addEventListener('click', function () {
      recognizeAsText(overlay)
    })
    overlay.querySelector('.btn-close').addEventListener('click', closePad)
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closePad()
    })
    area.appendChild(overlay)
    ensurePadResizeHandle(overlay.querySelector('.menmen-ink-pad'))
    return overlay
  }

  function noteId () {
    if (typeof window.noteid === 'string' && window.noteid) return window.noteid
    var path = (location.pathname || '').replace(/^\//, '').split('/')
    return decodeURIComponent(path[0] || '')
  }

  function serverBase () {
    return (typeof window.serverurl === 'string') ? window.serverurl : ''
  }

  function vlmUrl (path) {
    if (path.charAt(0) === '/') return path
    var base = serverBase()
    return base ? (base.replace(/\/$/, '') + '/' + path) : '/' + path
  }

  /** 插入图片走 nginx /uploadimage → blog；直连 :3000 时用 serverurl（CMD_DOMAIN）网关。 */
  function uploadImageUrl () {
    var base = serverBase()
    if (base) return base.replace(/\/$/, '') + '/uploadimage'
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      return window.location.origin + '/uploadimage'
    }
    return '/uploadimage'
  }

  function parseUploadImageResponse (res) {
    return res.text().then(function (text) {
      var data = null
      if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) {
        try {
          data = JSON.parse(text)
        } catch (e) {
          throw new Error('上传接口返回格式异常')
        }
      }
      if (res.ok && data) {
        var url = data.link || data.url || (data[0] && data[0].url)
        if (url) return url
      }
      if (res.status === 401 || res.status === 403) throw new Error('请先登录后再插入图片')
      if (res.status === 413) throw new Error('图片过大')
      throw new Error((data && (data.message || data.error)) || ('插入图片失败（HTTP ' + res.status + '）'))
    })
  }

  var VLM_IMAGE_MAX_EDGE = 320
  var VLM_RECOGNIZE_POLL_MS = 360000

  function drawScaledInk (srcCanvas, sx, sy, sw, sh, maxEdge, quality) {
    var scale = Math.min(1, maxEdge / Math.max(sw, sh))
    var w = Math.max(1, Math.round(sw * scale))
    var h = Math.max(1, Math.round(sh * scale))
    var off = document.createElement('canvas')
    off.width = w
    off.height = h
    var ctx = off.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, w, h)
    return off.toDataURL('image/jpeg', quality == null ? 0.85 : quality)
  }

  function compressInkImage (canvas) {
    var maxEdge = 896
    var srcW = canvas.width
    var srcH = canvas.height
    if (!srcW || !srcH) return canvas.toDataURL('image/jpeg', 0.88)
    return drawScaledInk(canvas, 0, 0, srcW, srcH, maxEdge, 0.88)
  }

  /** 识别用：裁掉空白，再缩小，减少 VLM 视觉 token 与推理时间 */
  function compressInkImageForVlm (canvas) {
    var srcW = canvas.width
    var srcH = canvas.height
    if (!srcW || !srcH) return canvas.toDataURL('image/jpeg', 0.85)
    var ctx = canvas.getContext('2d')
    var img = ctx.getImageData(0, 0, srcW, srcH)
    var data = img.data
    var minX = srcW
    var minY = srcH
    var maxX = 0
    var maxY = 0
    for (var y = 0; y < srcH; y++) {
      for (var x = 0; x < srcW; x++) {
        var i = (y * srcW + x) * 4
        var a = data[i + 3]
        if (a < 12) continue
        var r = data[i]
        var g = data[i + 1]
        var b = data[i + 2]
        if (r > 248 && g > 248 && b > 248) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    if (maxX <= minX || maxY <= minY) {
      return drawScaledInk(canvas, 0, 0, srcW, srcH, VLM_IMAGE_MAX_EDGE, 0.85)
    }
    var pad = Math.max(6, Math.round(Math.max(maxX - minX, maxY - minY) * 0.08))
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(srcW - 1, maxX + pad)
    maxY = Math.min(srcH - 1, maxY + pad)
    var sw = maxX - minX + 1
    var sh = maxY - minY + 1
    var aspect = sw / Math.max(1, sh)
    var maxEdge = VLM_IMAGE_MAX_EDGE
    if (aspect >= 2.2) maxEdge = 512
    else if (aspect >= 1.5) maxEdge = 448
    var padExtra = aspect >= 2 ? Math.round(sw * 0.04) : 0
    minX = Math.max(0, minX - padExtra)
    maxX = Math.min(srcW - 1, maxX + padExtra)
    sw = maxX - minX + 1
    return drawScaledInk(canvas, minX, minY, sw, sh, maxEdge, 0.88)
  }

  function parseVlmResponse (res) {
    return res.text().then(function (text) {
      var ct = (res.headers.get('content-type') || '').toLowerCase()
      var body = null
      if (text && (ct.indexOf('json') >= 0 || text.charAt(0) === '{' || text.charAt(0) === '[')) {
        try {
          body = JSON.parse(text)
        } catch (e) {
          throw new Error('识别接口返回格式异常')
        }
      } else if (res.status === 413) {
        throw new Error('手写图片过大，请清空后重试')
      } else if (res.status === 429) {
        throw new Error('识别太频繁，请稍后再试')
      } else if (res.status === 401 || res.status === 403) {
        throw new Error('请先登录 HedgeDoc 后再识别')
      } else if (res.status === 404 || res.status === 502 || res.status === 504) {
        throw new Error('识别服务不可用（HTTP ' + res.status + '）')
      } else if (text && text.indexOf('<html') >= 0) {
        throw new Error('识别接口异常，请刷新页面后重试')
      } else {
        throw new Error('识别失败（HTTP ' + res.status + '）')
      }
      return { ok: res.ok, status: res.status, body: body }
    })
  }

  function stripLatexDelimiters (latex) {
    return String(latex).trim().replace(/^\$+|\$+$/g, '')
  }

  function normalizeLatexCore (latex) {
    var s = String(latex).trim()
    if (/^\\\([\s\S]*\\\)$/.test(s)) s = s.replace(/^\\\(|\\\)$/g, '')
    if (/^\\\[[\s\S]*\\\]$/.test(s)) s = s.replace(/^\\\[|\\\]$/g, '')
    return stripLatexDelimiters(s).trim()
  }

  function stripMathDelimiters (latex) {
    if (latex == null) return ''
    var s = String(latex).trim()
    if (/^\$\$[\s\S]+\$\$$/.test(s)) return s.slice(2, -2).trim()
    if (/^\$[^\n]+\$$/.test(s)) return s.slice(1, -1).trim()
    if (/^\\\([\s\S]*\\\)$/.test(s)) return s.replace(/^\\\(|\\\)$/g, '').trim()
    if (/^\\\[[\s\S]*\\\]$/.test(s)) return s.replace(/^\\\[|\\\]$/g, '').trim()
    return s
  }

  function mathInsertIsInline (ed, cursor) {
    if (!ed || !cursor) return false
    var line = ed.getLine(cursor.line) || ''
    var before = line.slice(0, cursor.ch).trim()
    var after = line.slice(cursor.ch).trim()
    return !!(before || after)
  }

  function wrapMathLatex (latex, opts) {
    opts = opts || {}
    var core = stripMathDelimiters(latex)
    if (!core) return ''
    if (opts.inline === true) return '$' + core + '$'
    if (core.indexOf('\n') >= 0) return '$$\n' + core + '\n$$'
    return '$$\n' + core + '\n$$'
  }

  function looksLikeMath (core) {
    if (!core) return false
    if (/\\[a-zA-Z]|[\^_]/.test(core)) return true
    if (/^[A-Za-z0-9]+\s*=\s*.+/.test(core)) return true
    return false
  }

  function extractCompleteFracs (s) {
    var re = /\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
    var parts = []
    var m
    while ((m = re.exec(s)) !== null) parts.push(m[0])
    return parts
  }

  function sanitizeRecognizedLatex (latex) {
    var s = normalizeLatexCore(latex)
    s = s.replace(/\\\$/g, '').replace(/\$/g, '')
    s = s.replace(/^\\partial\.?\s*/i, '')
    s = s.replace(/(?:so\s+)?(?:the\s+)?(?:first\s+term\s+is\s+|second\s+(?:term\s+)?is\s+)/gi, '')
    s = s.replace(/,?\s*the second is\s+/gi, ' ')

    var fullPde = s.match(
      /(\\frac\{\\partial\s*[a-zA-Z]\}\{\\partial\s*[a-zA-Z]\}(?:\s*\+\s*\\frac\{\\partial\s*[a-zA-Z]\}\{\\partial\s*[a-zA-Z]\})?\s*=\s*[^\s\\,;.+]+)/
    )
    if (fullPde) return fullPde[1].trim()

    var fullEq = s.match(
      /((?:\\frac\{[^{}]*\}\{[^{}]*\}\s*)+(?:\+\s*\\frac\{[^{}]*\}\{[^{}]*\}\s*)*=\s*[^\s\\,;.+]+)/
    )
    if (fullEq) return fullEq[1].trim()

    var fracs = extractCompleteFracs(s)
    var tail = s
    var cut = s.search(/\\frac/)
    if (cut >= 0) tail = s.slice(cut)
    tail = tail.replace(/\\frac\{[^{}]*\}\{[^{}]*$/, '').replace(/\\frac\{[^{}]*$/, '')
    fracs = extractCompleteFracs(tail)
    var expr = ''
    if (fracs.length >= 2) expr = fracs.join(' + ')
    else if (fracs.length === 1) expr = fracs[0]
    else {
      cut = tail.search(/\\(?:frac|partial|sum|int|sqrt)/)
      if (cut >= 0) tail = tail.slice(cut)
      expr = tail.replace(/\s+/g, ' ').trim().replace(/^[,.;\s]+|[,.;\s]+$/g, '')
    }
    var eq = tail.match(/=\s*(\\frac\{[^{}]*\}\{[^{}]*\}|\\partial\s*[a-zA-Z]+|[0-9]+(?:\.[0-9]+)?|[a-zA-Z]\b)/)
    if (eq && expr.indexOf(' = ') < 0) expr = expr.replace(/\s+$/, '') + ' = ' + eq[1].trim()
    return expr
  }

  function insertChemBlockContent (smiles, name, hash) {
    var block = smiles
    if (name) block += '\nname: ' + name
    if (hash) block += '\nhw: ' + hash
    return '```chem\n' + block + '\n```'
  }

  function insertGeoBlockContent (ir, hash) {
    var body = Object.assign({}, ir)
    if (hash) body.hw = hash
    return '```geo3d\n' + JSON.stringify(body, null, 2) + '\n```'
  }

  function inkHintForMode (mode) {
    if (mode === 'chem') return { ph: '补充：苯环、呋喃…', title: '结构式识别时可填物质名' }
    if (mode === 'geo3d') return { ph: '补充：立方体、三棱锥…', title: '立体图形识别时可填形体名称' }
    if (mode === 'chem_eq') return { ph: '补充：反应条件…', title: '化学方程式可选补充' }
    return { ph: '补充提示（可选）', title: '识别时可填补充说明' }
  }

  function applyInkHintForMode (panel, mode) {
    if (!panel) return
    var hintEl = panel.querySelector('.ink-recog-hint')
    if (!hintEl) return
    var meta = inkHintForMode(mode)
    hintEl.placeholder = meta.ph
    hintEl.title = meta.title
  }

  function sanitizeChemEqLatex (latex) {
    var s = normalizeLatexCore(latex)
    s = s.replace(/\\\$/g, '').replace(/\$/g, '')
    s = s.replace(/\\frac\{\\partial\s*f\}\{\\partial\s*[a-zA-Z]\}[\s\S]*/i, '').trim()
    return s
  }

  function formatRecognizeInsert (result, opts) {
    opts = opts || {}
    var mode = opts.mode || (result && result.mode) || 'latex'
    if (!result) return ''
    if (typeof result === 'string') return result.trim()
    if (mode === 'chem' || result.mode === 'chem') {
      var smiles = result.smiles ? String(result.smiles).trim() : ''
      if (!smiles && result.text) smiles = String(result.text).trim()
      if (!smiles) return ''
      var chemName = result.name ? String(result.name).trim() : ''
      return insertChemBlockContent(smiles, chemName, opts.hash)
    }
    if (mode === 'geo3d' || result.mode === 'geo3d') {
      var geoIr = result.ir
      if (!geoIr || !geoIr.shape) return ''
      return insertGeoBlockContent(geoIr, opts.hash)
    }
    if (result.markdown && String(result.markdown).trim()) return String(result.markdown).trim()
    var latex = result.latex
    if (typeof latex === 'string' && latex.trim()) {
      latex = latex.trim()
      if (/^\$\$[\s\S]+\$\$$/.test(latex)) return latex
      if (/^\$[^\n]+\$$/.test(latex)) return latex
      var core = (mode === 'chem_eq' || result.mode === 'chem_eq')
        ? sanitizeChemEqLatex(latex)
        : sanitizeRecognizedLatex(latex)
      if (looksLikeMath(core)) {
        if (mode === 'chem_eq' || result.mode === 'chem_eq') return '$$\n' + core + '\n$$'
        var inline = opts.inline
        if (inline === undefined && opts.editor) {
          var cur = opts.cursor || opts.editor.getCursor()
          inline = mathInsertIsInline(opts.editor, cur)
        }
        return wrapMathLatex(core, { inline: inline === true })
      }
      return core
        .replace(/^\\text\{([\s\S]*)\}$/, '$1')
        .replace(/\\text\{([\s\S]*?)\}/g, '$1')
        .replace(/\\\\/g, '')
        .trim()
    }
    if (result.text) return String(result.text).trim()
    if (result.smiles) {
      var s = String(result.smiles).trim()
      var n = result.name ? String(result.name).trim() : ''
      if (mode === 'chem') return insertChemBlockContent(s, n, opts.hash)
      return n ? n + ' (' + s + ')' : s
    }
    if (result.name) return String(result.name).trim()
    if (result.ir && result.ir.description) return String(result.ir.description).trim()
    return ''
  }

  function requestMathJaxTypeset () {
    if (typeof window.menmenEnsureMathJax !== 'function') return
    window.menmenEnsureMathJax(function () {
      var hub = window.MathJax && window.MathJax.Hub
      if (!hub || hub.__menmenStub) return
      var root = document.querySelector('.ui-view-area .markdown-body') || document.getElementById('doc')
      if (root) hub.Queue(['Typeset', hub, root])
    })
  }

  function pollRecognizeJob (scope, hash, onProgress) {
    var start = Date.now()
    var delay = 800
    function once () {
      return fetch(vlmUrl('/api/vlm/jobs/' + encodeURIComponent(scope) + '/' + encodeURIComponent(hash)), {
        credentials: 'same-origin'
      }).then(parseVlmResponse).then(function (x) {
        var body = x.body
        if (!body) throw new Error('识别任务查询失败')
        if (body.status === 'done') return body.result
        if (body.status === 'error') {
          var errMsg = body.error || '识别错误'
          if (/timed out|timeout|ReadTimeout/i.test(errMsg)) {
            throw new Error('视觉模型响应超时，请缩小笔迹区域或稍后重试')
          }
          if (/no JSON|未返回可识别|empty chem/i.test(errMsg)) {
            throw new Error('未能识别出内容，请简化笔迹后重试')
          }
          if (/立体图形|geo3d/i.test(errMsg)) {
            throw new Error(errMsg)
          }
          throw new Error(errMsg)
        }
        if (body.status === 'lost' || body.status === 'expired') throw new Error('任务丢失，请重试')
        if (Date.now() - start > VLM_RECOGNIZE_POLL_MS) {
          throw new Error('识别超时（模型过慢，已等待 ' + Math.round(VLM_RECOGNIZE_POLL_MS / 1000) + ' 秒），请缩小笔迹或稍后重试')
        }
        if (typeof onProgress === 'function') {
          var sec = Math.round((Date.now() - start) / 1000)
          var tail = sec >= 60 ? '，复杂公式可能需要数分钟' : '（视觉模型）'
          onProgress('识别中… ' + sec + 's' + tail)
        }
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(once()) }, delay)
        }).then(function (r) {
          delay = Math.min(4000, Math.round(delay * 1.4))
          return r
        })
      })
    }
    return once()
  }

  function recognizeAsText (overlay) {
    var canvas = overlay.querySelector('canvas')
    var btn = overlay.querySelector('.btn-recognize-text')
    var modeSelect = overlay.querySelector('.ink-recog-mode')
    var mode = modeSelect ? modeSelect.value : (localStorage.getItem(INK_LAST_MODE_KEY) || 'latex')
    if (!INK_RECO_MODES.some(function (m) { return m.id === mode })) mode = 'latex'
    if (modeSelect) localStorage.setItem(INK_LAST_MODE_KEY, mode)
    var ed = editorInstance()
    if (!canvas || !ed) return
    var nid = noteId()
    if (!nid) {
      window.alert('无法识别当前笔记')
      return
    }
    if (btn) {
      btn.disabled = true
      btn.textContent = '识别中…'
    }
    var image = compressInkImageForVlm(canvas)
    var hintEl = overlay.querySelector('.ink-recog-hint')
    var hint = hintEl ? String(hintEl.value || '').trim().slice(0, 100) : ''
    fetch(vlmUrl('/api/vlm/recognize'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image,
        strokes: { v: 1, w: canvas.width, h: canvas.height, bg: '#FFFFFF', strokes: [] },
        mode: mode,
        hint: hint,
        noteId: nid
      })
    }).then(parseVlmResponse).then(function (x) {
      if (x.status === 503) throw new Error('识别服务不可用')
      if (x.status === 429) throw new Error('识别繁忙，请稍后重试')
      var jobHash = x.body && x.body.hash ? x.body.hash : null
      if (x.body && x.body.result) return { result: x.body.result, hash: jobHash }
      if (x.body && x.body.status === 'done' && x.body.result) {
        return { result: x.body.result, hash: jobHash }
      }
      if (x.body && x.body.scope && x.body.hash) {
        jobHash = x.body.hash
        return pollRecognizeJob(x.body.scope, jobHash, function (label) {
          if (btn) btn.textContent = label
        }).then(function (result) {
          return { result: result, hash: jobHash }
        })
      }
      throw new Error((x.body && (x.body.message || x.body.error)) || '识别失败')
    }).then(function (payload) {
      var result = payload.result
      var cur = inkInsertCursor || ed.getCursor()
      var text = formatRecognizeInsert(result, {
        mode: mode,
        hash: payload.hash,
        editor: ed,
        cursor: cur,
        inline: mathInsertIsInline(ed, cur)
      })
      if (!text) {
        if (mode === 'chem') throw new Error('未能识别出化学结构，请重试或改用「化学方程式」')
        if (mode === 'chem_eq') throw new Error('未能识别出化学方程式，请写清楚系数与箭头后重试')
        if (mode === 'geo3d') throw new Error('未能识别出立体图形，请画清楚棱边后重试')
        throw new Error('没有识别到内容')
      }
      var cur = inkInsertCursor || ed.getCursor()
      ed.replaceRange(text, cur, cur)
      setTimeout(requestMathJaxTypeset, 350)
      strokes = []
      closePad()
    }).catch(function (err) {
      console.error('menmen-ink recognize failed', err)
      window.alert(err.message || '识别失败')
    }).then(function () {
      if (btn) {
        btn.disabled = false
        btn.textContent = '识别并插入'
      }
    })
  }

  function insertPadImage (overlay) {
    var canvas = overlay.querySelector('canvas')
    var ed = editorInstance()
    if (!canvas || !ed) return
    canvas.toBlob(function (blob) {
      if (!blob) return
      var fd = new FormData()
      fd.append('image', blob, 'handwriting.png')
      fd.append('upload', blob, 'handwriting.png')
      fetch(uploadImageUrl(), { method: 'POST', credentials: 'same-origin', body: fd })
        .then(parseUploadImageResponse)
        .then(function (url) {
          var cur = inkInsertCursor || ed.getCursor()
          ed.replaceRange('\n![handwriting](' + url + ')\n', cur, cur)
          strokes = []
          closePad()
        })
        .catch(function (err) {
          console.error('menmen-ink upload failed', err)
          window.alert(err.message || '插入图片失败')
        })
    }, 'image/png')
  }

  function openPad () {
    ensureTray()
    var overlay = ensurePad()
    if (!overlay) return
    resetInkHistory()
    strokes = []
    redrawPad(overlay.querySelector('.menmen-ink-pad'))
    overlay.style.display = 'block'
    padOpen = true
    setToggleUi(true)
    var ed = editorInstance()
    if (ed && typeof ed.getCursor === 'function') inkInsertCursor = ed.getCursor()
    if (ed && typeof ed.setOption === 'function') ed.setOption('readOnly', 'nocursor')
    bindPadScroll(ed)
    scheduleRefresh()
    placePad()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(placePad)
    upgradeInkRecognizePanel(overlay.querySelector('.menmen-ink-panel'))
  }

  function closePad () {
    var area = editAreaEl()
    var overlay = area && area.querySelector('.menmen-ink-overlay')
    if (overlay) overlay.style.display = 'none'
    padOpen = false
    setToggleUi(false)
    unbindPadScroll()
    inkInsertCursor = null
    var pop = document.querySelector('.menmen-ink-color-pop')
    if (pop) pop.classList.add('hidden')
    var ed = editorInstance()
    if (ed && typeof ed.setOption === 'function') ed.setOption('readOnly', false)
  }

  function toggleInk (e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (padOpen) closePad()
    else openPad()
  }

  function findInkToggle (node) {
    if (!node || !node.closest) return null
    return node.closest('.menmen-ink-toggle')
  }

  /** toolbar.html 打进 index-pack 后需 rebuild；此处统一为 public/menmen-ink-toggle.png */
  function upgradeInkToolbarIcon () {
    var base = (typeof window.serverurl === 'string' && window.serverurl) ? window.serverurl.replace(/\/$/, '') : ''
    var src = base + '/menmen-ink-toggle.png?v=2'
    document.querySelectorAll('.menmen-ink-toggle').forEach(function (btn) {
      var svg = btn.querySelector('svg.menmen-ink-icon')
      if (svg) svg.remove()
      var img = btn.querySelector('img.menmen-ink-icon')
      if (!img) {
        img = document.createElement('img')
        img.className = 'menmen-ink-icon menmen-ink-icon-img'
        img.alt = ''
        img.setAttribute('aria-hidden', 'true')
        btn.insertBefore(img, btn.firstChild)
      }
      img.width = 18
      img.height = 18
      if (img.getAttribute('src') !== src) img.src = src
      btn.dataset.inkIconV2 = 'png2'
    })
  }

  function boot () {
    waitAndRefresh(0)
    ensureTray()
    upgradeInkToolbarIcon()
    if (typeof MutationObserver !== 'undefined') {
      var iconObs = new MutationObserver(function () { upgradeInkToolbarIcon() })
      iconObs.observe(document.body, { childList: true, subtree: true })
    }
    document.addEventListener('click', function (e) {
      if (!findInkToggle(e.target)) return
      toggleInk(e)
    }, true)
    window.addEventListener('resize', function () {
      if (editAreaVisible()) scheduleRefresh()
      if (padOpen) placePad()
    })
    document.addEventListener('focusin', function (e) {
      if (e.target && e.target.closest && e.target.closest('.CodeMirror')) scheduleRefresh()
    })
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.altKey && String(e.key).toLowerCase() === 'h') {
        e.preventDefault()
        toggleInk()
      }
      if (padOpen && e.key === 'Escape') closePad()
      if (padOpen && (e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'z') {
        e.preventDefault()
        undoInk()
      }
      if (padOpen && (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'y') {
        e.preventDefault()
        redoInk()
      }
    })
    document.addEventListener('click', function (e) {
      var pop = document.querySelector('.menmen-ink-color-pop')
      if (!pop || pop.classList.contains('hidden')) return
      if (e.target.closest('.menmen-ink-color-pop') || e.target.closest('.ink-tool[data-tool="color"]')) return
      pop.classList.add('hidden')
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
