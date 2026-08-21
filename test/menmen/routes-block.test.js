'use strict'

const assert = require('assert')
const express = require('express')
const http = require('http')
const mock = require('mock-require')

function requestApp (app, method, path) {
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, function () {
      const port = server.address().port
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method
      }, function (res) {
        let body = ''
        res.on('data', function (chunk) { body += chunk })
        res.on('end', function () {
          server.close(function () {
            resolve({
              status: res.statusCode,
              location: res.headers.location,
              body
            })
          })
        })
      })
      req.on('error', function (err) {
        server.close(function () { reject(err) })
      })
      req.end()
    })
  })
}

function buildApp (config) {
  mock('../../lib/config', config)
  mock.stop('../../lib/menmen-routes')
  const router = mock.reRequire('../../lib/menmen-routes')
  const app = express()
  app.use(router)
  app.get('/ok', function (req, res) {
    res.status(200).send('ok')
  })
  return app
}

describe('menmen-routes block', function () {
  const baseConfig = {
    menmen: {
      blockRoutes: true,
      homeUrl: 'http://menmen.test/'
    },
    domain: 'menmen.test',
    protocolUseSSL: false,
    serverURL: 'http://menmen.test'
  }

  afterEach(function () {
    mock.stop('../../lib/config')
    mock.stop('../../lib/menmen-routes')
  })

  it('TC-P3-R01 GET /new redirects to home', async function () {
    const res = await requestApp(buildApp(baseConfig), 'GET', '/new')
    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.location, 'http://menmen.test/')
  })

  it('TC-P3-R02 POST /new/foo redirects to home', async function () {
    const res = await requestApp(buildApp(baseConfig), 'POST', '/new/foo')
    assert.strictEqual(res.status, 302)
    assert.strictEqual(res.location, 'http://menmen.test/')
  })

  it('TC-P3-R03 GET /p/note returns 403', async function () {
    const res = await requestApp(buildApp(baseConfig), 'GET', '/p/abc123')
    assert.strictEqual(res.status, 403)
  })

  it('TC-P3-R04 GET /s/shortid returns 403', async function () {
    const res = await requestApp(buildApp(baseConfig), 'GET', '/s/shortid')
    assert.strictEqual(res.status, 403)
  })

  it('TC-P3-R05 allowed routes pass through when block enabled', async function () {
    const res = await requestApp(buildApp(baseConfig), 'GET', '/ok')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body, 'ok')
  })

  it('blockRoutes=false skips redirects', async function () {
    const config = Object.assign({}, baseConfig, {
      menmen: { blockRoutes: false, homeUrl: 'http://menmen.test/' }
    })
    const res = await requestApp(buildApp(config), 'GET', '/ok')
    assert.strictEqual(res.status, 200)
  })
})
