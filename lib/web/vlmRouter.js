'use strict'

const Router = require('express').Router
const bodyParser = require('body-parser')
const fetch = require('node-fetch')
const { rateLimit } = require('express-rate-limit')

const config = require('../config')
const errors = require('../errors')
const logger = require('../logger')
const menmenPerm = require('../menmen-perm')
const scopeUtil = require('./scope-util')

const vlmRouter = (module.exports = Router())

const dailyQuota = new Map()

function isFeatureEnabled () {
  return !!(config.vlm && config.vlm.serviceToken)
}

function featureDisabled (res) {
  return errors.errorNotFound(res)
}

function isRenderAllowed (req) {
  return req.isAuthenticated() || config.allowAnonymous || config.allowAnonymousEdits
}

function denyRender (res) {
  return sendVlmJson(res, 403, {
    status: 'error',
    code: 'forbidden',
    message: 'Login required'
  })
}

function sendVlmJson (res, status, body) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  })
  const payload = JSON.stringify(body == null ? {} : body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

function getDailyQuotaKey (req) {
  if (req.user && req.user.id) return `u:${req.user.id}`
  return `ip:${req.header('cf-connecting-ip') || req.ip}`
}

function pruneStaleDailyQuota (today) {
  for (const [k, v] of dailyQuota.entries()) {
    if (!v || v.day !== today) {
      dailyQuota.delete(k)
    }
  }
}

function checkDailyQuota (req) {
  const limit = (config.vlm && config.vlm.dailyQuota) || 200
  const key = getDailyQuotaKey(req)
  const today = new Date().toISOString().slice(0, 10)
  pruneStaleDailyQuota(today)
  const entry = dailyQuota.get(key)
  if (!entry || entry.day !== today) {
    dailyQuota.set(key, { day: today, count: 1 })
    return true
  }
  if (entry.count >= limit) return false
  entry.count += 1
  return true
}

const recognizeRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    if (req.user && req.user.id) return `vlm:${req.user.id}`
    return `vlm:${req.header('cf-connecting-ip') || req.ip}`
  },
  handler: (req, res) => errors.errorTooManyRequests(res)
})

async function proxyJson (url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let body = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch (err) {
        logger.error(`vlmRouter: invalid JSON from ${url}: ${err.message}`)
        throw new Error('invalid_upstream')
      }
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

async function ensureScopeFromBody (req) {
  const noteId = req.body && req.body.noteId
  if (!noteId) return null
  return scopeUtil.resolveScopeFromNoteId(noteId)
}

vlmRouter.post('/api/vlm/recognize', bodyParser.json({ limit: '8mb' }), recognizeRateLimit, async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  if (!isRenderAllowed(req)) return denyRender(res)
  if (!checkDailyQuota(req)) {
    return sendVlmJson(res, 429, { status: 'error', code: 'daily_quota', retryAfter: 86400 })
  }

  const scope = await ensureScopeFromBody(req)
  if (!scope) {
    return sendVlmJson(res, 404, {
      status: 'error',
      message: '无法解析笔记 scope'
    })
  }

  const owner = req.user && req.user.id ? String(req.user.id) : 'anonymous'
  const payload = {
    image: req.body.image,
    strokes: req.body.strokes || {},
    mode: req.body.mode || 'latex',
    hint: req.body.hint || undefined,
    scope,
    owner
  }

  try {
    const upstream = await proxyJson(`${config.vlm.serviceUrl}/recognize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vlm-Token': config.vlm.serviceToken
      },
      body: JSON.stringify(payload)
    }, 10000)

    if (upstream.status === 429) {
      return sendVlmJson(res, 429, {
        status: 'error',
        code: 'queue_full',
        retryAfter: upstream.body.retryAfter || 30
      })
    }
    if (upstream.status >= 500) {
      return sendVlmJson(res, 503, { status: 'error', code: 'vlm_unavailable' })
    }
    return sendVlmJson(res, upstream.status === 200 ? 202 : upstream.status, upstream.body)
  } catch (err) {
    logger.error(`vlmRouter recognize proxy failed: ${err.message}`)
    return sendVlmJson(res, 503, { status: 'error', code: 'vlm_unavailable' })
  }
})

vlmRouter.get('/api/vlm/jobs/:scope/:hash', async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  if (!isRenderAllowed(req)) return denyRender(res)

  const { scope, hash } = req.params
  if (!scopeUtil.isValidScope(scope) || !scopeUtil.isValidHash(hash)) {
    return errors.errorBadRequest(res)
  }

  try {
    const upstream = await proxyJson(`${config.vlm.serviceUrl}/jobs/${scope}/${hash}`, {
      method: 'GET',
      headers: { 'X-Vlm-Token': config.vlm.serviceToken }
    }, 5000)
    return sendVlmJson(res, upstream.status, upstream.body)
  } catch (err) {
    logger.error(`vlmRouter jobs proxy failed: ${err.message}`)
    return sendVlmJson(res, 503, { status: 'error', code: 'vlm_unavailable' })
  }
})

vlmRouter.post('/api/vlm/commit', bodyParser.json({ limit: '16kb' }), async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  if (!isRenderAllowed(req)) return denyRender(res)

  const noteId = req.body && req.body.noteId
  const scope = (req.body && req.body.scope) || (noteId ? await scopeUtil.resolveScopeFromNoteId(noteId) : null)
  const hash = req.body && req.body.hash

  if (!scope || !scopeUtil.isValidScope(scope) || !hash || !scopeUtil.isValidHash(hash)) {
    return errors.errorBadRequest(res)
  }

  if (!noteId) {
    return errors.errorBadRequest(res)
  }
  const username = menmenPerm.getUsernameFromUser(req && req.user)
  const canEdit = await menmenPerm.checkCanEdit(noteId, username)
  if (!canEdit) {
    return errors.errorForbidden(res)
  }

  const owner = req.user && req.user.id ? String(req.user.id) : 'anonymous'
  try {
    const upstream = await proxyJson(`${config.vlm.serviceUrl}/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vlm-Token': config.vlm.serviceToken
      },
      body: JSON.stringify({ scope, hash, owner })
    }, 10000)

    if (upstream.status >= 400) {
      return sendVlmJson(res, upstream.status, upstream.body)
    }

    return sendVlmJson(res, 200, {
      status: 'ok',
      strokesUrl: `/api/hw/handwriting/${scope}/${hash}.json`,
      imageUrl: `/api/hw/handwriting/${scope}/${hash}.png`
    })
  } catch (err) {
    logger.error(`vlmRouter commit proxy failed: ${err.message}`)
    return sendVlmJson(res, 503, { status: 'error', code: 'vlm_unavailable' })
  }
})

vlmRouter.get('/api/vlm/readyz', async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  try {
    const upstream = await proxyJson(`${config.vlm.serviceUrl}/readyz`, {
      method: 'GET',
      headers: { 'X-Vlm-Token': config.vlm.serviceToken }
    }, 3000)
    return sendVlmJson(res, upstream.status, upstream.body)
  } catch (err) {
    return sendVlmJson(res, 503, { status: 'error', code: 'vlm_unavailable' })
  }
})
