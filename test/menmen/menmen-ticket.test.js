'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

describe('menmen-ticket contract', function () {
  it('anonymous downgrade uses query.articleId only (no Referer)', function () {
    const src = fs.readFileSync(
      path.join(__dirname, '../../lib/web/auth/menmen-ticket.js'),
      'utf8'
    )
    assert.ok(src.includes('host articleId without token'))
    assert.ok(src.includes('req.query.articleId'))
    assert.ok(!src.includes("req.get('Referer')"))
  })
})
