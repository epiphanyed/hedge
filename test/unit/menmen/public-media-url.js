'use strict'

const { test } = require('node:test')
const assert = require('assert')
const { menmenPublicMediaUrl } = require('../../../lib/menmenPublicMediaUrl')

test('rewrites minio:9000 user-avatars to /oss/', () => {
  const u = 'http://minio:9000/user-avatars/u_100/x.jpg'
  assert.equal(menmenPublicMediaUrl(u), '/oss/user-avatars/u_100/x.jpg')
})

test('keeps external https URLs', () => {
  const u = 'https://cdn.example.com/a.png'
  assert.equal(menmenPublicMediaUrl(u), u)
})

test('rewrites bare object key', () => {
  assert.equal(menmenPublicMediaUrl('user-avatars/u_1/a.png'), '/oss/user-avatars/u_1/a.png')
})
