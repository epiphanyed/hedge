/* menmen: 月亮左侧视图布局下拉（居中 / wide），与全屏无关 */
(function () {
  var mounted = false
  var bootTries = 0
  var MAX_BOOT_TRIES = 40
  var LAYOUT_KEY = 'menmen-preview-layout'
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

  function getLayout () {
    // 仅手机 UA 强制宽屏；桌面即使 iframe 变窄也尊重用户选择
    if (isMobileUa()) return 'wide'
    try {
      return sessionStorage.getItem(LAYOUT_KEY) === 'wide' ? 'wide' : 'centered'
    } catch (e) {
      return 'centered'
    }
  }

  function updateAllUi () {
    var wide = getLayout() === 'wide'
    if (document.body) document.body.classList.toggle(WIDE_CLASS, wide)
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i]
      inst.$optCentered.toggleClass('menmen-layout-selected', !wide)
      inst.$optWide.toggleClass('menmen-layout-selected', wide)
      inst.$btn.attr('title', t('viewLayout', 'View layout'))
      inst.$btn.attr('aria-label', inst.$btn.attr('title'))
      inst.$btn.toggleClass('active', wide)
    }
  }

  function setLayout (layout) {
    var wide = layout === 'wide'
    try {
      sessionStorage.setItem(LAYOUT_KEY, wide ? 'wide' : 'centered')
    } catch (e) { /* ignore */ }
    if (document.body) document.body.classList.toggle(WIDE_CLASS, wide)
    updateAllUi()
  }

  function findNightGroups ($) {
    // 桌面：.navbar-collapse 内月亮；窄屏/iframe：.nav-mobile 内月亮
    // 不依赖 ui-mode-group 兄弟关系（只读时该组可能被隐藏/结构调整）
    return $('.btn-group').has('> .ui-night, > label.ui-night').filter(function () {
      var $g = $(this)
      return $g.closest('.navbar-collapse, .nav-mobile').length > 0
    })
  }

  function mountBeside ($, $nightGroup) {
    if ($nightGroup.prev('.menmen-view-layout-group').length) return

    var $group = $('<div class="btn-group menmen-view-layout-group"></div>')
    var $btn = $(
      '<button type="button" class="btn btn-default dropdown-toggle menmen-view-layout-btn" ' +
      'data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
      '<i class="fa fa-desktop"></i> <span class="caret"></span>' +
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
    $menu.append($optCentered, $optWide)
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

    instances.push({
      $group: $group,
      $btn: $btn,
      $optCentered: $optCentered,
      $optWide: $optWide
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
    // index.js 也可能晚一点才补上 class，这里重试而不是直接放弃
    if (!document.body.classList.contains('menmen-custom-ui')) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }
    markMobileUa()

    // 手机端：默认 wide，不挂布局按钮；电脑端才展示按钮与下拉
    if (isMobileUa()) {
      if (document.body) document.body.classList.add(WIDE_CLASS)
      mounted = true
      return
    }

    var $nightGroups = findNightGroups($)
    if (!$nightGroups.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    $nightGroups.each(function () {
      mountBeside($, $(this))
    })

    if (!instances.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    mounted = true
    updateAllUi()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
