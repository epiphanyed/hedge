/* menmen: 月亮左侧视图布局下拉（居中 / wide），与全屏无关 */
(function () {
  var mounted = false
  var bootTries = 0
  var MAX_BOOT_TRIES = 40
  var LAYOUT_KEY = 'menmen-preview-layout'
  var WIDE_CLASS = 'menmen-preview-wide'

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

  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 50)
      return
    }
    if (!document.body.classList.contains('menmen-custom-ui')) return
    markMobileUa()
    if (mounted || $('.menmen-view-layout-group').length) return

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

    function setLayout (layout) {
      var wide = layout === 'wide'
      try {
        sessionStorage.setItem(LAYOUT_KEY, wide ? 'wide' : 'centered')
      } catch (e) { /* ignore */ }
      document.body.classList.toggle(WIDE_CLASS, wide)
      updateUi()
    }

    var $nightGroup = $('.navbar-collapse .ui-mode-group').nextAll('.btn-group').has('.ui-night').first()
    if (!$nightGroup.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    var $group = $('<div class="btn-group menmen-view-layout-group"></div>')
    var $btn = $(
      '<button type="button" class="btn btn-default dropdown-toggle menmen-view-layout-btn" ' +
      'data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
      '<i class="fa fa-desktop"></i> <span class="caret"></span>' +
      '</button>'
    )
    var $menu = $('<ul class="dropdown-menu menmen-view-layout-menu" role="menu"></ul>')
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
    mounted = true

    function updateUi () {
      var wide = getLayout() === 'wide'
      document.body.classList.toggle(WIDE_CLASS, wide)
      $optCentered.toggleClass('menmen-layout-selected', !wide)
      $optWide.toggleClass('menmen-layout-selected', wide)
      $btn.attr('title', t('viewLayout', 'View layout'))
      $btn.attr('aria-label', $btn.attr('title'))
      $btn.toggleClass('active', wide)
    }

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

    updateUi()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
