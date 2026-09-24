'use strict'

const express = require('express')
const config = require('./config')
const realtime = require('./realtime')

const router = express.Router()

function homeRedirectUrl () {
  if (config.menmen && config.menmen.homeUrl) {
    return config.menmen.homeUrl
  }
  if (config.domain) {
    const proto = config.protocolUseSSL ? 'https' : 'http'
    return `${proto}://${config.domain}/`
  }
  return config.serverURL + '/'
}

function blockWithRedirect (req, res) {
  return res.redirect(302, homeRedirectUrl())
}

function blockRoutes (req, res, next) {
  if (!config.menmen || !config.menmen.blockRoutes) return next()

  const p = req.path
  if (p === '/new' || p.startsWith('/new/')) {
    return blockWithRedirect(req, res)
  }
  if (/^\/p\//.test(p) || /^\/s\//.test(p)) {
    return res.status(403).send('Forbidden')
  }
  return next()
}

router.use(blockRoutes)

/** blog 语言切换：丢弃内存 OT，避免 reloadFromMinio 后被旧草稿覆盖 */
router.post('/_menmen/evict-note', express.json(), function (req, res) {
  const menmen = config.menmen || {}
  const token = menmen.internalEvictToken
  if (!token) {
    return res.status(404).json({ ok: false, error: 'disabled' })
  }
  if (req.get('x-menmen-internal') !== token) {
    return res.status(403).json({ ok: false, error: 'forbidden' })
  }
  const noteId = req.body && req.body.noteId
  if (!noteId || typeof noteId !== 'string') {
    return res.status(400).json({ ok: false, error: 'noteId required' })
  }
  const evicted = realtime.evictNoteSession(noteId, { skipSave: true })
  return res.json({ ok: true, evicted })
})

module.exports = router
