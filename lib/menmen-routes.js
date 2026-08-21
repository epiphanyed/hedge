'use strict'

const express = require('express')
const config = require('./config')

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

module.exports = router
