'use strict'

const assert = require('assert')
const menmenPerm = require('../../lib/menmen-perm')

function placementOk (sql) {
  if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
  if (sql.includes('mmge_node')) return []
  if (sql.includes('sys_project_article_node') && sql.includes('LIMIT 1')) return [{ ok: 1 }]
  return null
}

function createMockPool (handlers) {
  let queryCount = 0
  return {
    query: async function (opts, params) {
      queryCount++
      const sql = typeof opts === 'string' ? opts : opts.sql
      const rows = handlers(sql, params, queryCount)
      return [rows]
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
      if (sql.includes('sys_article') && sql.includes('access_mode')) {
        return [{ access_mode: 0, is_deleted: 0 }]
      }
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('COUNT(1)')) return [{ cnt: 1 }]
      return []
    })
    menmenPerm._setPoolForTests(pool)
    const ok = await menmenPerm.checkCanEdit('a_1', 'admin')
    assert.strictEqual(ok, true)
  })

  it('TC-P1-U04 frozen LOCKED', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 2 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 1, is_deleted: 0 }]
      const p = placementOk(sql)
      if (p !== null) return p
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U05 frozen ARCHIVE', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 2 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 2, is_deleted: 0 }]
      const p = placementOk(sql)
      if (p !== null) return p
      throw new Error('unexpected')
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U06 node creator', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 3 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('sys_project_article_node') && sql.includes('create_by')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'creator'), true)
  })

  it('TC-P1-U07 project creator', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 5 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'projectowner'), true)
  })

  it('TC-P1-U08 user direct grant', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 6 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 0 }]
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
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('permission >= 1')) return [{ ok: 0 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'groupreader'), false)
  })

  it('TC-P1-U10 group write permission>=1', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 4 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('permission >= 1')) return [{ ok: 1 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'groupwriter'), true)
  })

  it('TC-P1-U11 unrelated user denied', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 99 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 0 }]
      if (sql.includes('sys_user_article')) return [{ ok: 0 }]
      if (sql.includes('permission >= 1')) return [{ ok: 0 }]
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
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return []
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('create_by')) return [{ ok: 1 }]
      return [{ ok: 0 }]
    })
    menmenPerm._setPoolForTests(pool)
    await menmenPerm.checkCanEdit('a_1', 'writer')
    await menmenPerm.checkCanEdit('a_1', 'writer')
    assert.strictEqual(evalCalls, 1)
  })

  it('TC-P1-U13 fail-close on mysql error', async function () {
    menmenPerm._setPoolForTests({
      query: async function () {
        throw new Error('connection refused')
      }
    })
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), false)
  })

  it('TC-P1-U14 unconfigured returns null from checkCanEdit', async function () {
    assert.strictEqual(await menmenPerm.checkCanEdit('a_1', 'user1'), null)
    assert.strictEqual(menmenPerm.isEnabled(), false)
  })

  it('TC-P1-U15 project description: admin only', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 10 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return [{ id: 5 }]
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('sgu.role IN (0, 2)')) return [{ ok: 1 }]
      throw new Error('unexpected: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_99', 'projadmin'), true)
  })

  it('TC-P1-U16 project description: member with write denied', async function () {
    const pool = createMockPool(function (sql) {
      if (sql.includes('FROM sys_user WHERE')) return [{ id: 11 }]
      if (sql.includes('COUNT(1)')) return [{ cnt: 0 }]
      if (sql.includes('access_mode')) return [{ access_mode: 0, is_deleted: 0 }]
      if (sql.includes('description_article_id') && sql.includes('sys_project WHERE')) return [{ id: 5 }]
      const p = placementOk(sql)
      if (p !== null) return p
      if (sql.includes('sgu.role IN (0, 2)')) return []
      throw new Error('should not reach group write: ' + sql)
    })
    menmenPerm._setPoolForTests(pool)
    assert.strictEqual(await menmenPerm.checkCanEdit('a_99', 'member'), false)
  })
})
