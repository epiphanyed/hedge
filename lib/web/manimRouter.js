'use strict'

const Router = require('express').Router
const bodyParser = require('body-parser')
const fetch = require('node-fetch')
const { rateLimit } = require('express-rate-limit')

const config = require('../config')
const errors = require('../errors')
const logger = require('../logger')
const menmenPerm = require('../menmen-perm')

const manimRouter = (module.exports = Router())

function isFeatureEnabled () {
  return !!(config.manim && config.manim.serviceToken)
}

function featureDisabled (res) {
  return errors.errorNotFound(res)
}

function isRenderAllowed (req) {
  return req.isAuthenticated() || config.allowAnonymous || config.allowAnonymousEdits
}

async function resolveArticleIdFromRequest (req) {
  const noteId = (req.body && req.body.noteId) || req.query.noteId
  if (!noteId || typeof noteId !== 'string') return null
  return menmenPerm.resolveArticleId(noteId)
}

const renderRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => {
    if (req.user && req.user.id) return `manim:${req.user.id}`
    return `manim:${req.header('cf-connecting-ip') || req.ip}`
  },
  handler: (req, res) => errors.errorTooManyRequests(res)
})

async function proxyJson (url, options) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch (err) {
      logger.error(`manimRouter: invalid JSON from ${url}: ${err.message}`)
      throw new Error('invalid_upstream')
    }
  }
  return { status: response.status, body }
}

manimRouter.post('/api/manim/render', bodyParser.json({ limit: '128kb' }), renderRateLimit, async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  if (!isRenderAllowed(req)) return errors.errorForbidden(res)

  const articleId = await resolveArticleIdFromRequest(req)
  if (!articleId) {
    return res.status(404).json({
      status: 'error',
      stderr: '无法关联到文章，请确认当前页面属于 menmen 文档'
    })
  }

  const payload = {
    code: req.body.code,
    articleId,
    scene: req.body.scene || undefined
  }

  try {
    const upstream = await proxyJson(`${config.manim.serviceUrl}/render`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Manim-Token': config.manim.serviceToken
      },
      body: JSON.stringify(payload)
    })
    return res.status(upstream.status).json(upstream.body)
  } catch (err) {
    logger.error(`manimRouter render proxy failed: ${err.message}`)
    return res.status(503).json({
      status: 'error',
      stderr: 'Render service unavailable'
    })
  }
})

manimRouter.get('/api/manim/status/:articleId/:hash', async function (req, res) {
  if (!isFeatureEnabled()) return featureDisabled(res)
  if (!isRenderAllowed(req)) return errors.errorForbidden(res)

  const articleId = req.params.articleId
  const hash = req.params.hash
  if (!/^[1-9]\d{0,18}$/.test(articleId) || !/^[a-f0-9]{64}$/.test(hash)) {
    return errors.errorBadRequest(res)
  }

  try {
    const upstream = await proxyJson(`${config.manim.serviceUrl}/jobs/${articleId}/${hash}`, {
      method: 'GET',
      headers: {
        'X-Manim-Token': config.manim.serviceToken
      }
    })
    return res.status(upstream.status).json(upstream.body)
  } catch (err) {
    logger.error(`manimRouter status proxy failed: ${err.message}`)
    return res.status(503).json({
      status: 'error',
      stderr: 'Render service unavailable'
    })
  }
})
