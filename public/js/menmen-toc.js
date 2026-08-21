/* menmen: 右侧目录面板折叠 + 层级导航折叠（i18n via window.__menmenI18n） */
(function () {
  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      setTimeout(boot, 50)
      return
    }
    if (!document.body.classList.contains('menmen-custom-ui')) return

    var BRANCH = 'menmen-toc-branch'
    var OPEN = 'menmen-toc-open'
    var PANEL_COLLAPSED = 'menmen-toc-panel-collapsed'
    var enhancing = false

    function t (key, fallback) {
      var i18n = window.__menmenI18n
      return (i18n && i18n[key]) || fallback
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
        var $head = $(
          '<div class="menmen-toc-panel-head">' +
            '<span class="menmen-toc-panel-title"></span>' +
            '<button type="button" class="menmen-toc-panel-collapse">' +
              '<i class="fa fa-angle-double-right"></i>' +
            '</button>' +
          '</div>'
        )
        $head.find('.menmen-toc-panel-title').text(t('tableOfContents', 'Table of Contents'))
        var $collapseBtn = $head.find('.menmen-toc-panel-collapse')
        $collapseBtn.attr('title', t('collapseToc', 'Collapse table of contents'))
        $collapseBtn.attr('aria-label', t('collapseToc', 'Collapse table of contents'))
        $panel.prepend($head)
        $collapseBtn.on('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          $panel.toggleClass(PANEL_COLLAPSED)
          var collapsed = $panel.hasClass(PANEL_COLLAPSED)
          syncCollapseButton($collapseBtn, collapsed)
          try {
            sessionStorage.setItem('menmen-toc-collapsed', collapsed ? '1' : '0')
          } catch (err) { /* ignore */ }
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
      if (enhancing) return
      if (!$('#ui-toc-affix .toc').length && !$('#ui-toc .toc').length) return
      enhancing = true
      try {
        enhancePanel($('#ui-toc-affix'))
        enhanceBranches($('#ui-toc-affix'))
        enhanceBranches($('#ui-toc'))
        applyTocMenuI18n($('#ui-toc-affix, #ui-toc, .ui-toc-dropdown'))
      } finally {
        enhancing = false
      }
    }

    var enhanceTimer = null
    function scheduleEnhance () {
      if (enhanceTimer) return
      enhanceTimer = setTimeout(function () {
        enhanceTimer = null
        enhanceAll()
      }, 200)
    }

    $(function () {
      enhanceAll()
      $(document).on('click', '.expand-toggle', function () {
        setTimeout(function () {
          applyTocMenuI18n($('#ui-toc-affix, #ui-toc, .ui-toc-dropdown'))
        }, 0)
      })
      var affix = document.querySelector('#ui-toc-affix')
      if (affix) {
        new MutationObserver(function () {
          if (enhancing) return
          scheduleEnhance()
        }).observe(affix, { childList: true, subtree: false })
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
