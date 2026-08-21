'use strict'

const assert = require('assert')
const menmenPerm = require('../../lib/menmen-perm')

function createMockPool (handlers) {
  let queryCount = 0
  return {
    getConnection: async function () {
      return {
        query: async function (opts, params) {
          queryCount++
          const sql = typeof opts === 'string' ? opts : opts.sql
          const rows = handlers(sql, params, queryCount)
          return [rows]
        },
        release: function () {}
      }
    },
    getQueryCount: function () {
      return queryCount
    }
  }
}

describe('menmen-perm', function () {
  beforeEach(function () {
    menmenPerm._resetCachesForTests()
    menmenPerm._setPoolForTests(null)
    delete process.env.CMD_MENMEN_MYSQL_URL
  })

  it('TC-P1-U01 parseArticleIdFromNoteId a_42', function () {
    assert.strictEqual(menmenPerm.parseArticleIdFromNoteId('a_42'), 42)
  })

  it('TC-P1-U02 parseArticleIdFromNoteId non a_ prefix', function () {
    assert.strictEqual(menmenPerm.parseArticleIdFromNoteId('xyz'), null)
  })

  it('TC-P1-U03 admin short-circuit', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 1 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 1 }]
      throw new Error('should not reach frozen/grant: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    const ok = await menmenPerm.checkCanEdit('a_1', 'admin')
    assert.strictEqual(ok, true)
  })

  it('TC-P1-U04 frozen LOCKED', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 2 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U05 frozen ARCHIVE', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 2 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 2 }]
      throw new Error('unexpected')
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U06 node creator', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 3 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'creator'), true)
  })

  it('TC-P1-U07 project creator', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 5 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'projectowner'), true)
  })

  it('TC-P1-U08 user direct grant', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 6 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'direct'), true)
  })

  it('TC-P1-U09 group read-only permission=0', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 8 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('sys_group_article')) return [{ ok: 0 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'groupreader'), false)
  })

  it('TC-P1-U10 group write permission>=1', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 4 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('sys_group_article')) return [{ ok: 1 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'groupwriter'), true)
  })

  it('TC-P1-U11 unrelated user denied', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 99 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('sys_group_article')) return [{ ok: 0 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'stranger'), false)
  })

  it('TC-P1-U12 cache TTL avoids duplicate full evaluation', async function () {
    let evalCalls = 0
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 7 }]
      if (sql.includes('COUNT(1)')) {
        evalCalls++
        return [{ cnt: 0 }]
      }
      if (sql.includes('access_mode')) return [{ access_mode: 0 }]
      if (sql.includes('sys_project_node')) return [{ ok: 1 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    await menmenPerm.checkCanEdit('a_1', 'writer')
    await menmenPerm.checkCanEdit('a_1', 'writer')
    assert.strictEqual(evalCalls, 1)
  })

  it('TC-P1-U13 fail-close on mysql error', async function () {
    menmenPerm._setPoolForTests({
      getConnection: async function () {
        throw new Error('connection refused')
      }
    })
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U14 unconfigured returns null from checkCanEdit', async function () {
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), null)
    assert.strictEqual(menmenPerm.isEnabled(), false)
  })
})
