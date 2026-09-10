/* menmen: 目录悬浮窗（可拖动）+ 层级折叠
 * 独立挂到 body，拦截 HedgeDoc 对 left/top/width 的改写。
 */
(function () {
  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      setTimeout(boot, 50)
      return
    }
    if (!document.body || !document.body.classList.contains('menmen-custom-ui')) {
      setTimeout(boot, 50)
      return
    }

    var BRANCH = 'menmen-toc-branch'
    var OPEN = 'menmen-toc-open'
    var PANEL_COLLAPSED = 'menmen-toc-panel-collapsed'
    var FLOAT_CLASS = 'menmen-toc-float'
    /** v2：按 right 锚定；丢弃旧 left 坐标，避免展开后右侧裁切 */
    var POS_KEY = 'menmen-toc-pos-v2'
    var EDGE = 8
    var DRAG_THRESHOLD = 4
    var enhancing = false
    var dragging = false
    var listenersBound = false
    var headTouchBound = false
    var cssGuardInstalled = false
    var startX = 0
    var startY = 0
    var startLeft = 0
    var startTop = 0
    var pending = false

    function t (key, fallback) {
      var i18n = window.__menmenI18n
      return (i18n && i18n[key]) || fallback
    }

    function panelEl () {
      return document.getElementById('ui-toc-affix')
    }

    function installCssGuard () {
      if (cssGuardInstalled || !$.fn || !$.fn.css) return
      cssGuardInstalled = true
      var orig = $.fn.css
      $.fn.css = function (name, value) {
        var el = this.length === 1 ? this[0] : null
        var guard = el && el.id === 'ui-toc-affix' && el.classList.contains(FLOAT_CLASS)
        if (guard) {
          if (typeof name === 'string' && arguments.length >= 2 && /^(left|top|right|width|margin|marginLeft|margin-left)$/.test(name)) {
            return this
          }
          if (name && typeof name === 'object' && typeof name !== 'function' && !Array.isArray(name)) {
            var next = {}
            var blocked = false
            for (var k in name) {
              if (!Object.prototype.hasOwnProperty.call(name, k)) continue
              if (/^(left|top|right|width|margin|marginLeft|margin-left|marginTop|margin-top)$/.test(k)) {
                blocked = true
                continue
              }
              next[k] = name[k]
            }
            if (blocked) {
              if (Object.keys(next).length) return orig.call(this, next)
              return this
            }
          }
        }
        return orig.apply(this, arguments)
      }
    }

    function viewportWidth () {
      return Math.max(
        document.documentElement ? document.documentElement.clientWidth : 0,
        window.innerWidth || 0
      )
    }

    function viewportHeight () {
      return Math.max(
        document.documentElement ? document.documentElement.clientHeight : 0,
        window.innerHeight || 0
      )
    }

    function getDragBounds (el) {
      var panelW = Math.max((el && el.offsetWidth) || 220, 36)
      var panelH = Math.max((el && el.offsetHeight) || 48, 36)
      var nav = document.querySelector('.navbar-fixed-top')
      var minTop = nav ? Math.round(nav.getBoundingClientRect().bottom) + EDGE : EDGE
      var vw = viewportWidth()
      var vh = viewportHeight()
      return {
        minLeft: EDGE,
        maxLeft: Math.max(EDGE, vw - panelW - EDGE),
        minTop: minTop,
        maxTop: Math.max(minTop, vh - panelH - EDGE),
        edge: EDGE,
        vw: vw,
        vh: vh
      }
    }

    function clamp (val, min, max) {
      return Math.min(Math.max(val, min), max)
    }

    /**
     * 休息态：用 right + top 锚定。
     * 宽度变化时右边缘不动，展开向左变宽，不会超出屏幕右侧。
     */
    function pinPanelRight (el, right, top) {
      if (!el) return
      var bounds = getDragBounds(el)
      var safeRight = clamp(
        typeof right === 'number' ? right : EDGE,
        EDGE,
        Math.max(EDGE, bounds.vw - EDGE - 36)
      )
      var safeTop = clamp(
        typeof top === 'number' ? top : bounds.minTop,
        bounds.minTop,
        bounds.maxTop
      )
      el.style.setProperty('position', 'fixed', 'important')
      el.style.setProperty('left', 'auto', 'important')
      el.style.setProperty('right', Math.round(safeRight) + 'px', 'important')
      el.style.setProperty('top', Math.round(safeTop) + 'px', 'important')
      el.style.setProperty('margin', '0', 'important')
      el.style.setProperty('bottom', 'auto', 'important')
    }

    /** 拖拽过程：临时 left + top，便于跟手 */
    function setPanelBoxLeft (el, left, top) {
      if (!el) return
      var bounds = getDragBounds(el)
      el.style.setProperty('position', 'fixed', 'important')
      el.style.setProperty('left', Math.round(clamp(left, bounds.minLeft, bounds.maxLeft)) + 'px', 'important')
      el.style.setProperty('top', Math.round(clamp(top, bounds.minTop, bounds.maxTop)) + 'px', 'important')
      el.style.setProperty('right', 'auto', 'important')
      el.style.setProperty('margin', '0', 'important')
    }

    function loadPosition () {
      try {
        var raw = sessionStorage.getItem(POS_KEY)
        if (!raw) return null
        var pos = JSON.parse(raw)
        if (typeof pos.right !== 'number' || typeof pos.top !== 'number') return null
        return pos
      } catch (err) {
        return null
      }
    }

    function savePosition (el) {
      if (!el) return
      var rect = el.getBoundingClientRect()
      var vw = viewportWidth()
      try {
        sessionStorage.setItem(POS_KEY, JSON.stringify({
          right: Math.round(clamp(vw - rect.right, EDGE, vw - EDGE - 36)),
          top: Math.round(rect.top)
        }))
      } catch (err) { /* ignore */ }
    }

    function applySavedPosition (el) {
      if (!el || dragging) return
      var bounds = getDragBounds(el)
      var pos = loadPosition()
      // 刷新后默认贴最右侧；仅保留用户拖过的 top
      var top = pos && typeof pos.top === 'number' ? pos.top : Math.max(bounds.minTop, 60)
      pinPanelRight(el, EDGE, top)
    }

    /** 展开/折叠后：右缘贴齐 EDGE，保证完整可见 */
    function ensureFullyVisible (el) {
      if (!el || dragging) return
      var rect = el.getBoundingClientRect()
      var bounds = getDragBounds(el)
      var right = clamp(bounds.vw - rect.right, EDGE, bounds.vw - EDGE - 36)
      // 只要右侧溢出或左侧溢出，都改回贴右
      if (rect.right > bounds.vw - EDGE + 0.5 || rect.left < EDGE - 0.5) {
        right = EDGE
      }
      pinPanelRight(el, right, rect.top)
    }

    function eventPoint (e) {
      if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY }
      if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
      return { x: e.clientX, y: e.clientY }
    }

    function isOnHead (node) {
      return !!(node && node.closest && node.closest('#ui-toc-affix .menmen-toc-panel-head'))
    }

    function onPointerDown (e) {
      if (e.type === 'mousedown' && e.button !== 0) return
      if (!isOnHead(e.target)) return
      if (e.target.closest('a')) return
      if (e.target.closest('.menmen-toc-panel-collapse')) return
      var el = panelEl()
      if (!el || !el.classList.contains(FLOAT_CLASS)) return
      var pt = eventPoint(e)
      var rect = el.getBoundingClientRect()
      pending = true
      dragging = false
      startX = pt.x
      startY = pt.y
      startLeft = rect.left
      startTop = rect.top
    }

    function onPointerMove (e) {
      if (!pending && !dragging) return
      var el = panelEl()
      if (!el) return
      var pt = eventPoint(e)
      if (!dragging) {
        var dx = pt.x - startX
        var dy = pt.y - startY
        if ((dx * dx + dy * dy) < DRAG_THRESHOLD * DRAG_THRESHOLD) return
        dragging = true
        el.classList.add('menmen-toc-dragging')
      }
      setPanelBoxLeft(el, startLeft + (pt.x - startX), startTop + (pt.y - startY))
      e.preventDefault()
    }

    function onPointerUp () {
      var el = panelEl()
      if (dragging && el) {
        el.classList.remove('menmen-toc-dragging')
        // 拖拽结束改回 right 锚定，后续展开不会裁切
        ensureFullyVisible(el)
        savePosition(el)
      }
      dragging = false
      pending = false
    }

    function bindDragListeners () {
      if (listenersBound) return
      listenersBound = true
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('mousedown', onPointerDown, true)
      window.addEventListener('pointermove', onPointerMove, true)
      window.addEventListener('mousemove', onPointerMove, true)
      window.addEventListener('pointerup', onPointerUp, true)
      window.addEventListener('mouseup', onPointerUp, true)
      window.addEventListener('touchend', onPointerUp, true)
      window.addEventListener('blur', onPointerUp)
      window.addEventListener('resize', function () {
        var el = panelEl()
        if (!el || !el.classList.contains(FLOAT_CLASS) || dragging) return
        ensureFullyVisible(el)
      })
    }

    /** 仅在 TOC 标题栏绑定 touch 监听，避免 document 级 non-passive 触发 Chrome Violation */
    function bindHeadTouchListeners (el) {
      if (headTouchBound || !el) return
      var head = el.querySelector('.menmen-toc-panel-head')
      if (!head) return
      headTouchBound = true
      var touchOpts = { passive: false }
      head.addEventListener('touchstart', onPointerDown, touchOpts)
      head.addEventListener('touchmove', onPointerMove, touchOpts)
    }

    function disableBootstrapAffix (el) {
      if (!el) return
      var $el = $(el)
      el.removeAttribute('data-spy')
      $el.removeClass('affix affix-top affix-bottom')
      var inst = $el.data('bs.affix')
      if (inst && inst.$target) {
        try { inst.$target.off('.bs.affix') } catch (err) { /* ignore */ }
      }
      $el.removeData('bs.affix')
    }

    function reparentToBody (el) {
      if (!el || el.parentElement === document.body) return
      document.body.appendChild(el)
    }

    function enableFloatPanel (el) {
      if (!el || !el.querySelector('.toc')) return
      installCssGuard()
      reparentToBody(el)
      el.classList.add(FLOAT_CLASS)
      disableBootstrapAffix(el)
      var $hide = $('.ui-view-area > .ui-toc, .menmen-custom-ui > .ui-content .ui-toc')
      $hide.hide()
      if (!dragging) applySavedPosition(el)
      el.style.setProperty('display', 'block', 'important')
      bindDragListeners()
      bindHeadTouchListeners(el)
    }

    function applyTocMenuI18n ($root) {
      $root = $root || $(document)
      $root.find('.expand-toggle').each(function () {
        var $el = $(this)
        var txt = $el.text().trim()
        if (txt === 'Expand all' || txt === t('expandAll', 'Expand all')) {
          $el.text(t('expandAll', 'Expand all'))
        } else if (txt === 'Collapse all' || txt === t('collapseAll', 'Collapse all')) {
          $el.text(t('collapseAll', 'Collapse all'))
        }
      })
      $root.find('.back-to-top').text(t('backToTop', 'Back to top'))
      $root.find('.go-to-bottom').text(t('goToBottom', 'Go to bottom'))
    }

    function enhanceBranches ($root) {
      $root.find('.toc .nav > li').each(function () {
        var $li = $(this)
        var $sub = $li.children('ul.nav')
        if (!$sub.length) return
        if (!$li.hasClass(BRANCH)) {
          $li.addClass(BRANCH)
          if ($li.hasClass('active') || $li.find('.active').length) {
            $li.addClass(OPEN)
          }
        }
        if ($li.children('.menmen-toc-branch-toggle').length) return
        var sectionTitle = t('expandCollapseSection', 'Expand or collapse section')
        var $toggle = $('<span class="menmen-toc-branch-toggle" role="button" tabindex="0"><i class="fa fa-chevron-right"></i></span>')
        $toggle.attr('title', sectionTitle).attr('aria-label', sectionTitle)
        $li.prepend($toggle)
        $toggle.on('click keydown', function (e) {
          if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          e.stopPropagation()
          $li.toggleClass(OPEN)
        })
      })
    }

    function syncCollapseButton ($collapseBtn, collapsed) {
      var $icon = $collapseBtn.find('i')
      if (collapsed) {
        $icon.removeClass('fa-angle-double-right').addClass('fa-list')
      } else {
        $icon.removeClass('fa-list').addClass('fa-angle-double-right')
      }
      var label = collapsed ? t('expandToc', 'Expand table of contents') : t('collapseToc', 'Collapse table of contents')
      $collapseBtn.attr('title', label).attr('aria-label', label)
    }

    function enhancePanel ($panel) {
      if (!$panel.length) return
      if (!$panel.find('> .menmen-toc-panel-head').length) {
        var dragHint = t('dragToc', 'Drag to move')
        var $head = $(
          '<div class="menmen-toc-panel-head menmen-toc-drag-handle" draggable="false">' +
            '<span class="menmen-toc-panel-grip" title="' + dragHint + '"><i class="fa fa-arrows"></i></span>' +
            '<span class="menmen-toc-panel-title"></span>' +
            '<button type="button" class="menmen-toc-panel-collapse">' +
              '<i class="fa fa-angle-double-right"></i>' +
            '</button>' +
          '</div>'
        )
        $head.find('.menmen-toc-panel-title').text(t('tableOfContents', 'Table of Contents'))
        $head.find('.menmen-toc-panel-title').attr('title', dragHint)
        var $collapseBtn = $head.find('.menmen-toc-panel-collapse')
        $collapseBtn.attr('title', t('collapseToc', 'Collapse table of contents'))
        $collapseBtn.attr('aria-label', t('collapseToc', 'Collapse table of contents'))
        $panel.prepend($head)
        $collapseBtn.on('click', function (e) {
          if (dragging) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          e.preventDefault()
          e.stopPropagation()
          $panel.toggleClass(PANEL_COLLAPSED)
          var collapsed = $panel.hasClass(PANEL_COLLAPSED)
          syncCollapseButton($collapseBtn, collapsed)
          try {
            sessionStorage.setItem('menmen-toc-collapsed', collapsed ? '1' : '0')
          } catch (err) { /* ignore */ }
          // 用 right 锚定：展开向左变宽，右缘始终不超出屏幕
          requestAnimationFrame(function () {
            var node = panelEl()
            if (!node) return
            var top = node.getBoundingClientRect().top
            pinPanelRight(node, EDGE, top)
            savePosition(node)
          })
        })
        try {
          if (sessionStorage.getItem('menmen-toc-collapsed') === '1') {
            $panel.addClass(PANEL_COLLAPSED)
            syncCollapseButton($collapseBtn, true)
          }
        } catch (err) { /* ignore */ }
      }
    }

    function enhanceAll () {
      if (enhancing || dragging) return
      var el = panelEl()
      if (!el || !el.querySelector('.toc')) return
      enhancing = true
      try {
        enhancePanel($(el))
        enhanceBranches($(el))
        enhanceBranches($('#ui-toc'))
        applyTocMenuI18n($('#ui-toc-affix, #ui-toc, .ui-toc-dropdown'))
        enableFloatPanel(el)
      } finally {
        enhancing = false
      }
    }

    var enhanceTimer = null
    function scheduleEnhance () {
      if (dragging || enhanceTimer) return
      enhanceTimer = setTimeout(function () {
        enhanceTimer = null
        if (!dragging) enhanceAll()
      }, 50)
    }

    function watchAffix () {
      var affix = panelEl()
      if (!affix) return
      new MutationObserver(function () {
        if (enhancing || dragging) return
        if (affix.querySelector('.toc')) scheduleEnhance()
      }).observe(affix, { childList: true, subtree: true })
    }

    enhanceAll()
    watchAffix()
    $(document).on('click', '.expand-toggle', function () {
      setTimeout(function () {
        applyTocMenuI18n($('#ui-toc-affix, #ui-toc, .ui-toc-dropdown'))
      }, 0)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
