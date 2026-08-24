'use strict'

const assert = require('assert')
const express = require('express')
const http = require('http')
const mock = require('mock-require')

function requestJson (app, method, path, body, headers) {
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, function () {
      const port = server.address().port
      const payload = body ? JSON.stringify(body) : null
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Content-Length': payload ? Buffer.byteLength(payload) : 0
        }, headers || {})
      }, function (res) {
        let data = ''
        res.on('data', function (chunk) { data += chunk })
        res.on('end', function () {
          server.close(function () {
            let parsed = {}
            if (data) {
              try {
                parsed = JSON.parse(data)
              } catch (err) {
                parsed = { _raw: data }
              }
            }
            resolve({
              status: res.statusCode,
              body: parsed,
              location: res.headers.location
            })
          })
        })
      })
      req.on('error', function (err) {
        server.close(function () { reject(err) })
      })
      if (payload) req.write(payload)
      req.end()
    })
  })
}

function buildApp (options) {
  mock('../../lib/config', options.config)
  mock('../../lib/menmen-perm', options.menmenPerm)
  mock('node-fetch', options.fetch)
  mock('../../lib/errors', {
    errorForbidden: function (res) { res.status(403).json({ error: 'forbidden' }) },
    errorNotFound: function (res) { res.status(404).send('not found') },
    errorBadRequest: function (res) { res.status(400).send('bad request') },
    errorTooManyRequests: function (res) { res.status(429).send('too many requests') }
  })
  mock.stop('../../lib/web/manimRouter')
  const router = mock.reRequire('../../lib/web/manimRouter')
  const app = express()
  app.use(function (req, res, next) {
    req.isAuthenticated = function () { return !!options.authenticated }
    next()
  })
  app.use(router)
  return app
}

describe('manimRouter', function () {
  const enabledConfig = {
    allowAnonymous: false,
    allowAnonymousEdits: false,
    manim: {
      serviceUrl: 'http://manim-service:8000',
      serviceToken: 'secret-token'
    }
  }

  afterEach(function () {
    mock.stop('../../lib/config')
    mock.stop('../../lib/menmen-perm')
    mock.stop('node-fetch')
    mock.stop('../../lib/errors')
    mock.stop('../../lib/web/manimRouter')
  })

  it('returns 404 when feature disabled', async function () {
    const app = buildApp({
      config: { manim: { serviceToken: undefined }, allowAnonymous: false, allowAnonymousEdits: false },
      menmenPerm: { resolveArticleId: async () => 42 },
      fetch: async () => ({ status: 200, text: async () => '{}' }),
      authenticated: true
    })
    const res = await requestJson(app, 'POST', '/api/manim/render', { code: 'x', noteId: 'a_42' })
    assert.strictEqual(res.status, 404)
  })

  it('returns 403 when anonymous', async function () {
    const app = buildApp({
      config: enabledConfig,
      menmenPerm: { resolveArticleId: async () => 42 },
      fetch: async () => ({ status: 200, text: async () => '{}' }),
      authenticated: false
    })
    const res = await requestJson(app, 'POST', '/api/manim/render', { code: 'x', noteId: 'a_42' })
    assert.strictEqual(res.status, 403)
  })

  it('returns 404 when noteId cannot resolve article', async function () {
    const app = buildApp({
      config: enabledConfig,
      menmenPerm: { resolveArticleId: async () => null },
      fetch: async () => ({ status: 200, text: async () => '{}' }),
      authenticated: true
    })
    const res = await requestJson(app, 'POST', '/api/manim/render', { code: 'x', noteId: 'missing' })
    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.body.status, 'error')
  })

  it('proxies render with resolved articleId', async function () {
    let captured = null
    const app = buildApp({
      config: enabledConfig,
      menmenPerm: { resolveArticleId: async () => 42 },
      fetch: async (url, opts) => {
        captured = { url, opts }
        return {
          status: 200,
          text: async () => JSON.stringify({ status: 'queued', hash: 'abc', articleId: 42 })
        }
      },
      authenticated: true
    })
    const res = await requestJson(app, 'POST', '/api/manim/render', {
      code: 'from manim import *',
      noteId: 'ode-stiffness-demo',
      scene: 'Demo'
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.status, 'queued')
    assert.strictEqual(captured.url, 'http://manim-service:8000/render')
    assert.strictEqual(captured.opts.headers['X-Manim-Token'], 'secret-token')
    const payload = JSON.parse(captured.opts.body)
    assert.strictEqual(payload.articleId, 42)
    assert.strictEqual(payload.scene, 'Demo')
    assert.strictEqual(payload.noteId, undefined)
  })

  it('proxies status by articleId and hash', async function () {
    let url = ''
    const app = buildApp({
      config: enabledConfig,
      menmenPerm: { resolveArticleId: async () => 42 },
      fetch: async (target) => {
        url = target
        return {
          status: 200,
          text: async () => JSON.stringify({ status: 'done', videoUrl: '/oss/public/manim/42/abc.mp4' })
        }
      },
      authenticated: true
    })
    const hash = 'a'.repeat(64)
    const res = await requestJson(app, 'GET', `/api/manim/status/42/${hash}`)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(url, `http://manim-service:8000/jobs/42/${hash}`)
  })
})
