/* menmen: 月亮左侧视图布局下拉（居中 / wide / paged），与全屏无关 */
(function () {
  var mounted = false
  var bootTries = 0
  var pagedEngineTries = 0
  var layoutDockJqTries = 0
  var MAX_BOOT_TRIES = 40
  var LAYOUT_KEY = 'menmen-preview-layout'
  var LAYOUT_BEFORE_PAGED_KEY = 'menmen-preview-layout-before-paged'
  var WIDE_CLASS = 'menmen-preview-wide'
  var instances = []

  function isMobileUa () {
    try {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
        navigator.userAgent || ''
      )
    } catch (e) {
      return false
    }
  }

  function markMobileUa () {
    if (typeof document === 'undefined' || !document.body) return
    if (!document.body.classList.contains('menmen-custom-ui')) return
    if (isMobileUa()) document.body.classList.add('menmen-mobile-ua')
  }

  function t (key, fallback) {
    var i18n = window.__menmenI18n
    return (i18n && i18n[key]) || fallback
  }

  function normalizeLayout (raw) {
    if (raw === 'wide' || raw === 'paged' || raw === 'centered') return raw
    return 'centered'
  }

  function getLayout () {
    try {
      var stored = sessionStorage.getItem(LAYOUT_KEY)
      if (stored === 'wide' || stored === 'paged' || stored === 'centered') return stored
    } catch (e) { /* ignore */ }
    return isMobileUa() ? 'wide' : 'centered'
  }

  function applyPagedEngine (layout) {
    var flip = window.__menmenReaderFlip
    if (!flip || typeof flip.toggle !== 'function') {
      if (layout === 'paged') {
        pagedEngineTries += 1
        if (pagedEngineTries < MAX_BOOT_TRIES) {
          setTimeout(function () { applyPagedEngine(layout) }, 120)
        }
      }
      return
    }
    pagedEngineTries = 0
    if (layout === 'paged') flip.toggle(true)
    else flip.toggle(false)
  }

  function exitPagedMode () {
    var restore = isMobileUa() ? 'wide' : 'centered'
    try {
      var before = sessionStorage.getItem(LAYOUT_BEFORE_PAGED_KEY)
      if (before === 'wide' || before === 'centered') restore = before
    } catch (e) { /* ignore */ }
    setLayout(restore)
  }

  function syncPagedLayoutDock (isPaged) {
    if (!document.body) return
    var $ = window.jQuery || window.$
    if (isPaged === undefined) {
      isPaged = document.body.classList.contains('menmen-reader-paged')
    }
    var $dock = $ ? $('#menmen-paged-layout-dock') : null
    if (!isPaged) {
      if ($ && instances.length) {
        for (var j = 0; j < instances.length; j++) {
          var instOff = instances[j]
          if (instOff._pagedRestoreParent && instOff.$group.parent().is('#menmen-paged-layout-dock')) {
            instOff.$group.detach().appendTo(instOff._pagedRestoreParent)
          }
        }
      }
      var offDock = document.getElementById('menmen-paged-layout-dock')
      if (offDock) offDock.remove()
      layoutDockJqTries = 0
      return
    }
    if (!$) {
      if (window.__menmenReaderFlip && typeof window.__menmenReaderFlip.ensurePagedControlBar === 'function') {
        window.__menmenReaderFlip.ensurePagedControlBar()
      }
      if (++layoutDockJqTries < MAX_BOOT_TRIES) {
        setTimeout(function () { syncPagedLayoutDock(true) }, 50)
      }
      return
    }
    layoutDockJqTries = 0
    if (!$dock.length) {
      $dock = $('<div id="menmen-paged-layout-dock" class="menmen-paged-layout-dock" aria-label="View layout"></div>')
      $('body').append($dock)
    }
    dedupeLayoutInstances()
    var primary = primaryLayoutInstance()
    if (!primary) return
    if (!primary._pagedRestoreParent || !primary._pagedRestoreParent.length) {
      primary._pagedRestoreParent = primary.$group.parent()
    }
    if (!primary.$group.parent().is($dock)) {
      primary.$group.detach().appendTo($dock)
    }
  }

  function applyLayoutClasses (layout) {
    if (!document.body) return
    var wide = layout === 'wide'
    document.body.classList.toggle(WIDE_CLASS, wide)
    applyPagedEngine(layout)
    syncPagedLayoutDock(layout === 'paged')
  }

  function updateAllUi () {
    var layout = getLayout()
    applyLayoutClasses(layout)
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i]
      inst.$optCentered.toggleClass('menmen-layout-selected', layout === 'centered')
      inst.$optWide.toggleClass('menmen-layout-selected', layout === 'wide')
      inst.$optPaged.toggleClass('menmen-layout-selected', layout === 'paged')
      inst.$btn.attr('title', t('viewLayout', 'View layout'))
      inst.$btn.attr('aria-label', inst.$btn.attr('title'))
      inst.$btn.toggleClass('active', layout !== 'centered')
    }
  }

  function setLayout (layout) {
    layout = normalizeLayout(layout)
    var prev = getLayout()
    if (layout === 'paged' && prev !== 'paged') {
      try {
        sessionStorage.setItem(LAYOUT_BEFORE_PAGED_KEY, prev)
      } catch (e) { /* ignore */ }
    }
    try {
      sessionStorage.setItem(LAYOUT_KEY, layout)
    } catch (e) { /* ignore */ }
    applyLayoutClasses(layout)
    updateAllUi()
    syncMobilePagedEntry()
  }

  function findNightGroups ($) {
    return $('.btn-group').has('> .ui-night, > label.ui-night').filter(function () {
      var $g = $(this)
      return $g.closest('.navbar-collapse, .nav-mobile').length > 0
    })
  }

  /** 桌面顶栏与 nav-mobile 各有一处夜间模式，布局控件只挂一份，避免分页浮层出现两个下拉 */
  function pickPrimaryNightGroup ($) {
    var $groups = findNightGroups($)
    if (!$groups.length) return null
    if (isMobileUa()) {
      var $mobile = $groups.filter(function () {
        return $(this).closest('.nav-mobile, .visible-xs').length > 0
      }).first()
      if ($mobile.length) return $mobile
    }
    var $desktop = $groups.filter(function () {
      return $(this).closest('.nav-mobile, .visible-xs').length === 0
    }).first()
    if ($desktop.length) return $desktop
    return $groups.first()
  }

  function dedupeLayoutInstances () {
    if (instances.length <= 1) return
    for (var i = instances.length - 1; i >= 1; i--) {
      instances[i].$group.remove()
      instances.splice(i, 1)
    }
  }

  function primaryLayoutInstance () {
    return instances.length ? instances[0] : null
  }

  function syncMobilePagedEntry () {
    if (!isMobileUa() || !document.body) return
    var id = 'menmen-mobile-paged-entry'
    var existing = document.getElementById(id)
    var inPaged = document.body.classList.contains('menmen-reader-paged') || getLayout() === 'paged'
    if (inPaged) {
      if (existing) existing.remove()
      return
    }
    if (existing) return
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.id = id
    btn.className = 'menmen-mobile-paged-entry'
    var label = t('layoutPagedShort', t('layoutPaged', 'Paged'))
    btn.setAttribute('aria-label', label)
    btn.textContent = label
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      setLayout('paged')
    })
    document.body.appendChild(btn)
  }

  function mountBeside ($, $nightGroup) {
    if (instances.length > 0) return
    if ($nightGroup.prev('.menmen-view-layout-group').length) return

    var $group = $('<div class="btn-group menmen-view-layout-group"></div>')
    var layoutIcon = isMobileUa() ? 'fa-book' : 'fa-desktop'
    var $btn = $(
      '<button type="button" class="btn btn-default dropdown-toggle menmen-view-layout-btn" ' +
      'data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
      '<i class="fa ' + layoutIcon + '"></i> <span class="caret"></span>' +
      '</button>'
    )
    var $menu = $('<ul class="dropdown-menu menmen-view-layout-menu" role="menu"></ul>')
    if ($nightGroup.closest('.nav-mobile, .visible-xs').length) {
      $menu.addClass('dropdown-menu-right')
    }
    var $optCentered = $('<li role="presentation"></li>').append(
      $('<a href="#" role="menuitem" class="menmen-layout-centered"></a>')
        .text(t('layoutCentered', 'Centered'))
    )
    var $optWide = $('<li role="presentation"></li>').append(
      $('<a href="#" role="menuitem" class="menmen-layout-wide"></a>')
        .text(t('layoutWide', 'Wide'))
    )
    var $optPaged = $('<li role="presentation"></li>').append(
      $('<a href="#" role="menuitem" class="menmen-layout-paged"></a>')
        .text(t('layoutPaged', 'Paged'))
    )
    $menu.append($optCentered, $optWide, $optPaged)
    $group.append($btn, $menu)
    $nightGroup.before($group)

    $optCentered.on('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      setLayout('centered')
      $group.removeClass('open')
    })
    $optWide.on('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      setLayout('wide')
      $group.removeClass('open')
    })
    $optPaged.on('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      setLayout('paged')
      $group.removeClass('open')
    })

    instances.push({
      $group: $group,
      $btn: $btn,
      $optCentered: $optCentered,
      $optWide: $optWide,
      $optPaged: $optPaged
    })
  }

  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 50)
      return
    }
    if (!document.body) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 50)
      return
    }
    if (!document.body.classList.contains('menmen-custom-ui')) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }
    markMobileUa()
    syncMobilePagedEntry()

    var storedLayout = getLayout()
    if (storedLayout === 'paged') {
      applyLayoutClasses('paged')
    }

    var $nightGroup = pickPrimaryNightGroup($)
    if (!$nightGroup || !$nightGroup.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    mountBeside($, $nightGroup)
    dedupeLayoutInstances()

    if (!instances.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    mounted = true
    updateAllUi()
    syncMobilePagedEntry()
    if (getLayout() === 'paged' || document.body.classList.contains('menmen-reader-paged')) {
      syncPagedLayoutDock(true)
    }
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var mo = new MutationObserver(function () { syncMobilePagedEntry() })
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    }
  }

  window.__menmenViewLayout = {
    setLayout: setLayout,
    getLayout: getLayout,
    exitPagedMode: exitPagedMode,
    syncPagedLayoutDock: syncPagedLayoutDock
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
