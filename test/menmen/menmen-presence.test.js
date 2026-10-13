'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const presence = require('../../lib/menmen-presence')

describe('menmen-presence', function () {
  it('collectPresentUsers keeps idle/viewers and drops disconnected sockets', function () {
    const note = {
      users: {
        editor: { id: 'editor', name: 'A', idle: false },
        viewer: { id: 'viewer', name: 'B', idle: true },
        dead: { id: 'dead', name: 'C', idle: false }
      }
    }
    const connected = {
      editor: { connected: true },
      viewer: { connected: true }
    }
    const present = presence.collectPresentUsers(note, connected)
    assert.strictEqual(present.length, 2)
    assert.deepStrictEqual(present.map(function (u) { return u.id }), ['editor', 'viewer'])
  })

  it('menmen-online shows anyone still on the note, not only editors', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../public/js/menmen-online.js'), 'utf8')
    assert.ok(src.includes('编辑权 / 查看权'))
    assert.ok(src.includes('return !!(u && u.name)'))
    assert.ok(!src.includes('只展示正在编辑的人'))
  })

  it('findNoteIdBySocketId recovers noteId for cleaner fakes', function () {
    const notes = {
      n1: { users: { s1: { id: 's1' } } },
      n2: { users: { s2: { id: 's2' } } }
    }
    assert.strictEqual(presence.findNoteIdBySocketId(notes, 's2'), 'n2')
    assert.strictEqual(presence.findNoteIdBySocketId(notes, 'missing'), null)
  })

  it('staleSocketIds lists sockets that are no longer connected', function () {
    const stale = presence.staleSocketIds(
      { a: {}, b: {} },
      { a: { connected: true } }
    )
    assert.deepStrictEqual(stale, ['b'])
  })

  it('realtime uses presence helper and does not leak note.users on cleaner', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/realtime.js'), 'utf8')
    assert.ok(src.includes("require('./menmen-presence')"))
    assert.ok(src.includes('collectPresentUsers'))
    assert.ok(src.includes('findNoteIdBySocketId'))
    assert.ok(src.includes('pruneStalePresence'))
    assert.ok(src.includes('socket.noteId || menmenPresence.findNoteIdBySocketId'))
  })

  it('index.js filters online users list consistently', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../public/js/index.js'), 'utf8')
    assert.ok(src.includes("socket.on('online users'"))
    assert.ok(src.includes('onlineUsers = filterMenmenOnlineUsers(data.users)'))
  })

  it('embed leave stops socket reconnect loop', function () {
    const indexJs = fs.readFileSync(path.join(__dirname, '../../public/js/index.js'), 'utf8')
    const onlineJs = fs.readFileSync(path.join(__dirname, '../../public/js/menmen-online.js'), 'utf8')
    const flipJs = fs.readFileSync(path.join(__dirname, '../../public/js/menmen-reader-flip.js'), 'utf8')
    assert.ok(indexJs.includes('menmenLeaveCollaboration'))
    assert.ok(indexJs.includes('__menmenSkipSocketReconnect'))
    assert.ok(onlineJs.includes('menmenLeaveCollaboration'))
    assert.ok(flipJs.includes('menmen-host-park'))
  })

  it('socket.io heartbeat is passed to constructor not io.set', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8')
    assert.ok(src.includes('pingInterval: config.heartbeatInterval'))
    assert.ok(src.includes('pingTimeout: config.heartbeatTimeout'))
    assert.ok(!src.includes("io.set('heartbeat interval'"))
  })
})
