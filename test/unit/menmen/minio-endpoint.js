'use strict'

const assert = require('assert')
const { normalizeMenmenMinioEndpoint, INTERNAL_HOST, INTERNAL_PORT } = require('../../../lib/config/menmenMinioEndpoint')

describe('normalizeMenmenMinioEndpoint', () => {
  it('rewrites gateway CMD_DOMAIN + :9000 to docker minio', () => {
    const cfg = {
      domain: '192.168.1.15',
      minio: {
        endPoint: '192.168.1.15',
        port: 9000,
        secure: false,
        accessKey: 'a',
        secretKey: 'b'
      }
    }
    normalizeMenmenMinioEndpoint(cfg)
    assert.equal(cfg.minio.endPoint, INTERNAL_HOST)
    assert.equal(cfg.minio.port, INTERNAL_PORT)
  })

  it('rewrites www.menmendoc.com:80 to docker minio', () => {
    const cfg = {
      domain: 'www.menmendoc.com',
      minio: {
        endPoint: 'www.menmendoc.com',
        port: 80,
        secure: false
      }
    }
    normalizeMenmenMinioEndpoint(cfg)
    assert.equal(cfg.minio.endPoint, INTERNAL_HOST)
    assert.equal(cfg.minio.port, INTERNAL_PORT)
  })

  it('leaves dedicated minio host unchanged', () => {
    const cfg = {
      domain: 'www.menmendoc.com',
      minio: {
        endPoint: 'minio.internal.corp',
        port: 9000,
        secure: false
      }
    }
    normalizeMenmenMinioEndpoint(cfg)
    assert.equal(cfg.minio.endPoint, 'minio.internal.corp')
    assert.equal(cfg.minio.port, 9000)
  })
})
