/* menmen: Menu 左侧全屏按钮 */
(function () {
  var mounted = false
  var bootTries = 0
  var MAX_BOOT_TRIES = 40

  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 50)
      return
    }
    if (!document.body.classList.contains('menmen-custom-ui')) return
    if (mounted || $('.menmen-fullscreen-item').length) return

    function t (key, fallback) {
      var i18n = window.__menmenI18n
      return (i18n && i18n[key]) || fallback
    }

    function isFullscreen () {
      return !!(document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement)
    }

    function requestFullscreen () {
      var el = document.documentElement
      var fn = el.requestFullscreen || el.webkitRequestFullscreen ||
        el.mozRequestFullScreen || el.msRequestFullscreen
      if (!fn) return Promise.reject(new Error('unsupported'))
      return Promise.resolve(fn.call(el))
    }

    function exitFullscreen () {
      var fn = document.exitFullscreen || document.webkitExitFullscreen ||
        document.mozCancelFullScreen || document.msExitFullscreen
      if (!fn) return Promise.reject(new Error('unsupported'))
      return Promise.resolve(fn.call(document))
    }

    function toggleFullscreen (e) {
      if (e) {
        e.preventDefault()
        e.stopPropagation()
      }
      var p = isFullscreen() ? exitFullscreen() : requestFullscreen()
      p.catch(function () {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'menmen-hedgedoc-fullscreen' }, '*')
        }
      })
    }

    function findMenuLi () {
      var $menu = null
      $('.navbar-collapse ul.navbar-nav.navbar-right > li').each(function () {
        var $a = $(this).children('a[data-toggle="dropdown"]').first()
        if (!$a.length) return
        if ($a.find('.fa-caret-down').length) {
          $menu = $(this)
        }
      })
      return $menu
    }

    var $menuLi = findMenuLi()
    if (!$menuLi || !$menuLi.length) {
      if (++bootTries < MAX_BOOT_TRIES) setTimeout(boot, 100)
      return
    }

    var $item = $('<li class="menmen-fullscreen-item"></li>')
    var $btn = $('<a href="#" class="menmen-fullscreen-btn"></a>')
      .append($('<i class="fa fa-expand"></i>'))
    $item.append($btn)
    $menuLi.before($item)
    mounted = true

    function updateButton () {
      var on = isFullscreen()
      $btn.find('i')
        .toggleClass('fa-expand', !on)
        .toggleClass('fa-compress', on)
      $btn.attr('title', on ? t('exitFullscreen', 'Exit fullscreen') : t('enterFullscreen', 'Fullscreen'))
      $btn.attr('aria-label', $btn.attr('title'))
    }

    updateButton()
    $btn.on('click', toggleFullscreen)
    document.addEventListener('fullscreenchange', updateButton)
    document.addEventListener('webkitfullscreenchange', updateButton)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
