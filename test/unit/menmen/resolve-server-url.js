'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.join(__dirname, '../../../public/js/lib/config/resolveServerUrl.js'),
  'utf8'
).replace(/export function/, 'function')
const resolveServerUrl = new Function(`${src}\nreturn resolveServerUrl;`)()

describe('resolveServerUrl', () => {
  it('domain 与当前页一致时保留 configured serverurl', () => {
    const url = resolveServerUrl({
      protocol: 'http:',
      hostname: 'www.menmendoc.com',
      port: '',
      origin: 'http://www.menmendoc.com',
      domain: 'www.menmendoc.com',
      urlpath: ''
    })
    assert.equal(url, 'http://www.menmendoc.com')
  })

  it('LAN 打开时 API 基址回落到当前页 origin', () => {
    const url = resolveServerUrl({
      protocol: 'http:',
      hostname: '192.168.1.15',
      port: '',
      origin: 'http://192.168.1.15',
      domain: 'www.menmendoc.com',
      urlpath: ''
    })
    assert.equal(url, 'http://192.168.1.15')
  })
})
