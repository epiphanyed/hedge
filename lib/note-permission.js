'use strict'

/**
 * Shared HedgeDoc note view-permission checks.
 * Used by realtime.js and menmenPerm.checkCanRead for unlinked notes.
 */

function checkViewPermission (req, note) {
  if (!note) return false
  if (note.permission === 'private') {
    return !!(req.user && req.user.logged_in && req.user.id === note.owner)
  }
  if (note.permission === 'limited' || note.permission === 'protected') {
    return !!(req.user && req.user.logged_in)
  }
  return true
}

function isNotePublicByPermission (permission) {
  return permission === 'freely' || permission === 'editable' || permission === 'locked'
}

module.exports = {
  checkViewPermission,
  isNotePublicByPermission
}
