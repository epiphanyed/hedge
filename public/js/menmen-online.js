/* menmen: 右上角头像组（仅当前笔记在线协作者，无 ONLINE 文案） */
(function () {
  function boot () {
    var $ = window.jQuery || window.$
    if (!$) {
      setTimeout(boot, 50)
      return
    }

    var MAX_VISIBLE = 5
    var refreshing = false
    var lastSignature = ''

    function isSocketConnected () {
      var cm = window.cmClient
      return !!(cm && cm.serverAdapter && cm.serverAdapter.socket && cm.serverAdapter.socket.connected)
    }

    function isEditorBooting () {
      return !window.loaded || !isSocketConnected()
    }

    function dedupeUsers (list) {
      if (!list || !list.length) return []
      var out = []
      var seenUser = {}
      for (var i = 0; i < list.length; i++) {
        var u = list[i]
        if (!u) continue
        var key = u.userid ? ('u:' + u.userid) : ('s:' + u.id)
        if (Object.prototype.hasOwnProperty.call(seenUser, key)) {
          var prev = out[seenUser[key]]
          if (u.photo && !prev.photo) prev.photo = u.photo
          if (!u.idle) prev.idle = false
          if (u.color) prev.color = u.color
          if (u.login) prev.login = true
          continue
        }
        seenUser[key] = out.length
        out.push(u)
      }
      return out
    }

    function shouldShowUser (u) {
      if (!u || !u.name) return false
      if (!u.idle) return true
      return !!u.login
    }

    function collectUsersFromDom () {
      var users = []
      var seen = {}
      $('#online-user-list .ui-user-item, #short-online-user-list .ui-user-item').each(function () {
        var name = $(this).find('.ui-user-name, .name').first().text().trim()
        if (!name || seen[name]) return
        seen[name] = true
        var icon = $(this).find('.ui-user-icon')
        var bg = icon.css('background-image')
        var photo = null
        if (bg && bg !== 'none') {
          var m = bg.match(/url\(["']?([^"')]+)["']?\)/)
          if (m) photo = m[1]
        }
        users.push({
          name: name,
          photo: photo,
          color: icon.css('background-color'),
          idle: false,
          login: true
        })
      })
      return users
    }

    function normalizeUsers (raw) {
      if (!raw || !raw.length) return []
      return dedupeUsers(raw).map(function (u) {
        return {
          name: u.name || '',
          photo: u.photo || null,
          color: u.color || null,
          idle: !!u.idle,
          login: !!u.login
        }
      }).filter(shouldShowUser)
    }

    function getUsers () {
      var fromSocket = normalizeUsers(window.__menmenOnlineUsers)
      if (fromSocket.length) return fromSocket
      return collectUsersFromDom()
    }

    function usersSignature (users) {
      return users.map(function (u) {
        return (u.name || '') + '|' + (u.photo || '') + '|' + (u.idle ? '1' : '0')
      }).join(';')
    }

    function appendLetterAvatar (group, u, label) {
      var letter = $('<span class="menmen-letter-avatar"></span>')
        .text((u.name || '?').charAt(0).toUpperCase())
        .attr('title', label)
      if (u.color) letter.css('background-color', u.color)
      group.append(letter)
    }

    function buildAvatarGroup (users) {
      var group = $('<span class="menmen-avatar-group"></span>')
      var visible = users.slice(0, MAX_VISIBLE)
      var extra = users.length - visible.length
      visible.forEach(function (u) {
        var label = u.name || ''
        if (u.photo) {
          var img = $('<img>').attr('src', u.photo).attr('alt', label).attr('title', label)
          img.on('error', function () {
            appendLetterAvatar(group, u, label)
            $(this).remove()
          })
          group.append(img)
        } else {
          appendLetterAvatar(group, u, label)
        }
      })
      if (extra > 0) {
        var moreHint = (window.__menmenI18n && window.__menmenI18n.moreOnline)
          ? window.__menmenI18n.moreOnline.replace('%s', String(extra))
          : (extra + ' more online')
        var more = $('<span class="menmen-avatar-more"></span>').text('+' + extra).attr('title', moreHint)
        group.append(more)
      }
      return group
    }

    function applyToStatus ($anchor, users, $container) {
      if (!$anchor.length) return
      if (!users.length) {
        if (isEditorBooting()) return
        $anchor.empty()
        if ($container && $container.length) $container.hide()
        return
      }
      if ($container && $container.length) {
        $container.show()
      }
      $('#online-user-list, #short-online-user-list').show()
      $anchor.empty().append(buildAvatarGroup(users))
    }

    function refreshAvatars () {
      if (refreshing) return
      var users = getUsers()
      var sig = usersSignature(users)
      if (sig === lastSignature && $('.menmen-avatar-group').length) return
      refreshing = true
      try {
        lastSignature = sig
        applyToStatus($('.ui-status'), users, $('#online-user-list'))
        applyToStatus($('.ui-short-status'), users, $('#short-online-user-list'))
      } finally {
        refreshing = false
      }
    }

    function attachEditorSocket () {
      var cm = window.cmClient
      if (!cm || !cm.serverAdapter || !cm.serverAdapter.socket) return false
      var s = cm.serverAdapter.socket
      if (!s || s.__menmenBound) return !!s.__menmenBound
      s.__menmenBound = true
      s.on('connect', function () {
        scheduleRefresh()
      })
      s.on('online users', function (data) {
        window.__menmenOnlineUsers = (data && data.users) ? data.users : []
        try {
          document.dispatchEvent(new CustomEvent('menmen-online-users', { detail: window.__menmenOnlineUsers }))
        } catch (e) { /* ignore */ }
        scheduleRefresh()
      })
      return true
    }

    var refreshTimer = null
    function scheduleRefresh () {
      if (refreshTimer) return
      refreshTimer = setTimeout(function () {
        refreshTimer = null
        refreshAvatars()
      }, 100)
    }

    $(function () {
      document.addEventListener('menmen-online-users', scheduleRefresh)
      scheduleRefresh()
      var tries = 0
      var bootTimer = setInterval(function () {
        attachEditorSocket()
        scheduleRefresh()
        if (++tries >= 30 || (window.loaded && attachEditorSocket())) {
          clearInterval(bootTimer)
        }
      }, 1000)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
