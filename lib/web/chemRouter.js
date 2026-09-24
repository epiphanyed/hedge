'use strict'

const Router = require('express').Router
const bodyParser = require('body-parser')
const { rateLimit } = require('express-rate-limit')

const config = require('../config')
const errors = require('../errors')
const logger = require('../logger')
const scopeUtil = require('./scope-util')
const renderUtil = require('./render-util')

const chemRouter = (module.exports = Router())

function enabled () {
  return !!(config.chem && config.chem.serviceToken)
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

chemRouter.post('/api/chem/render', bodyParser.json({ limit: '128kb' }), renderLimit, async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error', message: 'Login required' })

  const noteId = req.body && req.body.noteId
  const scope = noteId ? await scopeUtil.resolveScopeFromNoteId(noteId) : null
  if (!scope) return renderUtil.sendRenderJson(res, 404, { status: 'error', message: '无法解析 scope' })

  const visibility = await renderUtil.resolveVisibility(noteId, req)
  try {
    const upstream = await renderUtil.proxyJson(`${config.chem.serviceUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chem-Token': config.chem.serviceToken,
        'X-Menmen-Visibility': visibility
      },
      body: JSON.stringify({
        smiles: req.body.smiles,
        options: req.body.options || {},
        name: req.body.name,
        scope,
        visibility
      })
    }, 10000)
    if (upstream.status === 429) return renderUtil.sendRenderJson(res, 429, { status: 'error', retryAfter: 30 })
    const body = upstream.body || {}
    if (body.keys) {
      body.urls = renderUtil.mapJobUrls(body.keys, scope, noteId)
    }
    return renderUtil.sendRenderJson(res, upstream.status === 200 ? 202 : upstream.status, body)
  } catch (err) {
    logger.error(`chemRouter render failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})

chemRouter.get('/api/chem/jobs/:scope/:hash', async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error' })

  const { scope, hash } = req.params
  const noteId = req.query.noteId
  if (!scopeUtil.isValidScope(scope) || !scopeUtil.isValidHash(hash)) return errors.errorBadRequest(res)

  try {
    const upstream = await renderUtil.proxyJson(`${config.chem.serviceUrl}/jobs/${scope}/${hash}`, {
      method: 'GET',
      headers: { 'X-Chem-Token': config.chem.serviceToken }
    }, 5000)
    const body = upstream.body || {}
    if (body.keys) {
      body.urls = renderUtil.mapJobUrls(body.keys, scope, noteId)
      delete body.keys
    }
    if (body.chemfig && body.chemfig.svgKey) {
      body.chemfig = Object.assign({}, body.chemfig, {
        svgUrl: renderUtil.mapJobUrls({ chemfig: body.chemfig.svgKey }, scope, noteId).chemfig
      })
      delete body.chemfig.svgKey
    }
    return renderUtil.sendRenderJson(res, upstream.status, body)
  } catch (err) {
    logger.error(`chemRouter jobs failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})

chemRouter.post('/api/chem/chemfig', bodyParser.json({ limit: '128kb' }), renderLimit, async function (req, res) {
  if (!enabled()) return errors.errorNotFound(res)
  if (!isAllowed(req)) return renderUtil.sendRenderJson(res, 403, { status: 'error', message: 'Login required' })

  const noteId = req.body && req.body.noteId
  const scope = noteId ? await scopeUtil.resolveScopeFromNoteId(noteId) : null
  if (!scope) return renderUtil.sendRenderJson(res, 404, { status: 'error', message: '无法解析 scope' })

  const visibility = await renderUtil.resolveVisibility(noteId, req)
  const hash = req.body && req.body.hash
  if (!hash || !scopeUtil.isValidHash(hash)) return errors.errorBadRequest(res)

  try {
    const upstream = await renderUtil.proxyJson(`${config.chem.serviceUrl}/chemfig`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chem-Token': config.chem.serviceToken,
        'X-Menmen-Visibility': visibility
      },
      body: JSON.stringify({
        smiles: req.body.smiles,
        name: req.body.name,
        scope,
        hash,
        visibility
      })
    }, 15000)
    const body = upstream.body || {}
    if (body.chemfig && body.chemfig.svgKey) {
      body.chemfig.svgUrl = renderUtil.mapJobUrls({ chemfig: body.chemfig.svgKey }, scope, noteId).chemfig
      delete body.chemfig.svgKey
    }
    return renderUtil.sendRenderJson(res, upstream.status === 200 ? 202 : upstream.status, body)
  } catch (err) {
    logger.error(`chemRouter chemfig failed: ${err.message}`)
    return renderUtil.sendRenderJson(res, 503, { status: 'error' })
  }
})
