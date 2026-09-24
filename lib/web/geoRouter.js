'use strict'

const Router = require('express').Router
const bodyParser = require('body-parser')
const { rateLimit } = require('express-rate-limit')

const config = require('../config')
const errors = require('../errors')
const logger = require('../logger')
const scopeUtil = require('./scope-util')
const renderUtil = require('./render-util')

const geoRouter = (module.exports = Router())

function enabled () {
  return !!(config.geo && config.geo.serviceToken)
}

function isAllowed (req) {
  return req.isAuthenticated() || config.allowAnonymous || config.allowAnonymousEdits
}

const renderLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => (req.user && req.user.id) || req.ip,
  handler: (req, res) => errors.errorTooManyRequests(res)
})

geoRouter.post('/api/geo/render', bodyParser.json({ limit: '128kb' }), renderLimit, async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error', message: 'Login required' })

  const noteId = req.body && req.body.noteId
  const scope = noteId ? await scopeUtil.resolveScopeFromNoteId(noteId) : null
  if (!scope) return renderUtil.sendRenderJson(res, 404, { status: 'error', message: '无法解析 scope' })

  const visibility = await renderUtil.resolveVisibility(noteId, req)
  try {
    const upstream = await renderUtil.proxyJson(`${config.geo.serviceUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Geo-Token': config.geo.serviceToken,
        'X-Menmen-Visibility': visibility
      },
      body: JSON.stringify({ ir: req.body.ir, scope, visibility })
    }, 10000)
    if (upstream.status === 429) return renderUtil.sendRenderJson(res, 429, { status: 'error', retryAfter: 30 })
    const body = upstream.body || {}
    if (body.keys) {
      body.urls = renderUtil.mapJobUrls(body.keys, scope, noteId)
    }
    return renderUtil.sendRenderJson(res, upstream.status === 200 ? 202 : upstream.status, body)
  } catch (err) {
    logger.error(`geoRouter render failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})

geoRouter.post('/api/geo/compile-asy', bodyParser.json({ limit: '128kb' }), renderLimit, async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error', message: 'Login required' })

  const noteId = req.body && req.body.noteId
  const scope = noteId ? await scopeUtil.resolveScopeFromNoteId(noteId) : null
  if (!scope) return renderUtil.sendRenderJson(res, 404, { status: 'error', message: '无法解析 scope' })

  const visibility = await renderUtil.resolveVisibility(noteId, req)
  try {
    const upstream = await renderUtil.proxyJson(`${config.geo.serviceUrl}/compile-asy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Geo-Token': config.geo.serviceToken,
        'X-Menmen-Visibility': visibility
      },
      body: JSON.stringify({ source: req.body.source, scope, visibility })
    }, 10000)
    if (upstream.status === 429) return renderUtil.sendRenderJson(res, 429, { status: 'error', retryAfter: 30 })
    const body = upstream.body || {}
    if (body.keys) {
      body.urls = renderUtil.mapJobUrls(body.keys, scope, noteId)
    }
    return renderUtil.sendRenderJson(res, upstream.status === 200 ? 202 : upstream.status, body)
  } catch (err) {
    logger.error(`geoRouter compile-asy failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})

geoRouter.post('/api/geo/asy-source', bodyParser.json({ limit: '128kb' }), renderLimit, async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error', message: 'Login required' })

  try {
    const upstream = await renderUtil.proxyJson(`${config.geo.serviceUrl}/asy-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Geo-Token': config.geo.serviceToken
      },
      body: JSON.stringify({ ir: req.body.ir, scope: '0', visibility: 'private' })
    }, 5000)
    return renderUtil.sendRenderJson(res, upstream.status, upstream.body || {})
  } catch (err) {
    logger.error(`geoRouter asy-source failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})

geoRouter.get('/api/geo/jobs/:scope/:hash', async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error' })

  const { scope, hash } = req.params
  const noteId = req.query.noteId
  if (!scopeUtil.isValidScope(scope) || !scopeUtil.isValidHash(hash)) return errors.errorBadRequest(res)

  try {
    const upstream = await renderUtil.proxyJson(`${config.geo.serviceUrl}/jobs/${scope}/${hash}`, {
      method: 'GET',
      headers: { 'X-Geo-Token': config.geo.serviceToken }
    }, 5000)
    const body = upstream.body || {}
    if (body.keys) {
      body.urls = renderUtil.mapJobUrls(body.keys, scope, noteId)
      delete body.keys
    }
    return renderUtil.sendRenderJson(res, upstream.status, body)
  } catch (err) {
    logger.error(`geoRouter jobs failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})
