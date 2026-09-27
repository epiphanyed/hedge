'use strict'

/**
 * Shared HedgeDoc note view-permission checks.
 * Used by realtime.js and menmenPerm.checkCanRead for unlinked notes.
 * Align with lib/web/note/util.js (Passport uses isAuthenticated(), not logged_in).
 */

function isRequestAuthenticated (req) {
  if (!req || !req.user) return false
  if (req.user.logged_in) return true
  if (typeof req.isAuthenticated === 'function') return req.isAuthenticated()
  return false
}

function checkViewPermission (req, note) {
  if (!note) return false
  if (note.permission === 'private') {
    return isRequestAuthenticated(req) && req.user.id === note.ownerId
  }
  if (note.permission === 'limited' || note.permission === 'protected') {
    return isRequestAuthenticated(req)
  }
  return true
}

function isNotePublicByPermission (permission) {
  return permission === 'freely' || permission === 'editable' || permission === 'locked'
}

module.exports = {
  checkViewPermission,
  isNotePublicByPermission,
  isRequestAuthenticated
}
