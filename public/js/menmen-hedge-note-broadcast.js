'use strict'

/**
 * HedgeDoc 保存后通过 BroadcastChannel 通知 Issue 页刷新微卡片（§8.4.4.1）。
 */
;(function menmenHedgeNoteBroadcast() {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel('menmen-hedge-note')
  let last = window.lastchangetime
  setInterval(function tick() {
    if (!window.lastchangetime || window.lastchangetime === last) return
    last = window.lastchangetime
    var noteId = (window.note && window.note.id) || null
    bc.postMessage({
      type: 'NOTE_UPDATED',
      noteId: noteId,
      updatedAt: last,
    })
  }, 2000)
})()
