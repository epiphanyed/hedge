'use strict'

const mysql = require('mysql2/promise')
const logger = require('./logger')

const USER_CACHE_TTL_MS = 10 * 60 * 1000
const PERM_CACHE_TTL_MS = 10 * 1000
const QUERY_TIMEOUT_MS = 2000

let pool = null
let enabled = false

/** @type {Map<string, { id: number, at: number }>} */
const userIdCache = new Map()
/** @type {Map<string, { canEdit: boolean, at: number }>} */
const permCache = new Map()

function initFromConfig (config) {
  const url = config.menmen && config.menmen.mysqlUrl
  if (!url) {
    enabled = false
    pool = null
    return
  }
  try {
    pool = mysql.createPool({
      uri: url,
      connectionLimit: 5,
      waitForConnections: true
    })
    enabled = true
    logger.info('menmen-perm: MySQL read-only pool enabled')
  } catch (err) {
    logger.error('menmen-perm: pool init failed: ' + err.message)
    enabled = false
    pool = null
  }
}

function isEnabled () {
  return enabled && pool !== null
}

function parseArticleIdFromNoteId (noteIdOrAlias) {
  if (!noteIdOrAlias) return null
  const m = /^a_(\d+)$/.exec(String(noteIdOrAlias).trim())
  return m ? parseInt(m[1], 10) : null
}

function permCacheKey (articleId, userId) {
  return `${articleId}:${userId}`
}

function getCachedCanEdit (noteIdOrAlias, username) {
  if (!isEnabled() || !username) return null
  const articleId = parseArticleIdFromNoteId(noteIdOrAlias)
  if (!articleId) return null
  const userEntry = userIdCache.get(username)
  if (!userEntry || Date.now() - userEntry.at > USER_CACHE_TTL_MS) return null
  const entry = permCache.get(permCacheKey(articleId, userEntry.id))
  if (!entry || Date.now() - entry.at > PERM_CACHE_TTL_MS) return null
  return entry.canEdit
}

function setPermCache (articleId, userId, canEdit) {
  permCache.set(permCacheKey(articleId, userId), { canEdit, at: Date.now() })
}

async function queryOne (sql, params) {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query({ sql, timeout: QUERY_TIMEOUT_MS }, params)
    return rows
  } finally {
    conn.release()
  }
}

async function resolveArticleId (noteIdOrAlias) {
  let articleId = parseArticleIdFromNoteId(noteIdOrAlias)
  if (articleId) return articleId
  const rows = await queryOne(
    'SELECT id FROM sys_article WHERE note_id = ? LIMIT 1',
    [noteIdOrAlias]
  )
  if (!rows || !rows.length) return null
  return rows[0].id
}

async function resolveUserId (username) {
  const cached = userIdCache.get(username)
  if (cached && Date.now() - cached.at <= USER_CACHE_TTL_MS) {
    return cached.id
  }
  const rows = await queryOne(
    'SELECT id FROM sys_user WHERE username = ? LIMIT 1',
    [username]
  )
  if (!rows || !rows.length) return null
  userIdCache.set(username, { id: rows[0].id, at: Date.now() })
  return rows[0].id
}

async function evaluateCanEdit (articleId, userId) {
  const adminRows = await queryOne(
    `SELECT COUNT(1) AS cnt
     FROM sys_user_role ur
     INNER JOIN sys_role r ON ur.role_id = r.id
     WHERE ur.user_id = ? AND r.code = 'admin'`,
    [userId]
  )
  if (adminRows[0] && adminRows[0].cnt > 0) {
    return true
  }

  const modeRows = await queryOne(
    'SELECT access_mode FROM sys_article WHERE id = ? LIMIT 1',
    [articleId]
  )
  if (!modeRows || !modeRows.length) return false
  const mode = modeRows[0].access_mode
  if (mode === 1 || mode === 2) return false

  const descRows = await queryOne(
    `SELECT p.id AS projectId
     FROM sys_project p
     WHERE p.description_article_id = ?
     LIMIT 1`,
    [articleId]
  )
  if (descRows && descRows.length) {
    const projectId = descRows[0].projectId
    const adminRows = await queryOne(
      `SELECT EXISTS(
        SELECT 1 FROM sys_group_user sgu
        INNER JOIN sys_group_project sgp ON sgu.fk_group_id = sgp.fk_group_id
        WHERE sgp.fk_project_id = ? AND sgu.fk_user_id = ? AND sgu.role IN (0, 2)
      ) AS ok`,
      [projectId, userId]
    )
    return !!(adminRows[0] && (adminRows[0].ok === 1 || adminRows[0].ok === true))
  }

  const creatorRows = await queryOne(
    `SELECT EXISTS(
      SELECT 1 FROM sys_project_node pn
      LEFT JOIN sys_project p ON p.id = pn.fk_project_id
      WHERE pn.fk_article_id = ? AND (pn.create_by = ? OR p.create_by = ?)
    ) AS ok`,
    [articleId, userId, userId]
  )
  if (creatorRows[0] && (creatorRows[0].ok === 1 || creatorRows[0].ok === true)) {
    return true
  }

  const directRows = await queryOne(
    `SELECT EXISTS(
      SELECT 1 FROM sys_user_article
      WHERE fk_article_id = ? AND fk_user_id = ?
    ) AS ok`,
    [articleId, userId]
  )
  if (directRows[0] && (directRows[0].ok === 1 || directRows[0].ok === true)) {
    return true
  }

  const groupRows = await queryOne(
    `SELECT EXISTS(
      SELECT 1 FROM sys_group_article sga
      JOIN sys_group_user sgu ON sga.fk_group_id = sgu.fk_group_id
      WHERE sga.fk_article_id = ? AND sgu.fk_user_id = ? AND sgu.permission >= 1
    ) AS ok`,
    [articleId, userId]
  )
  return !!(groupRows[0] && (groupRows[0].ok === 1 || groupRows[0].ok === true))
}

async function checkCanEdit (noteIdOrAlias, username) {
  if (!isEnabled()) return null
  if (!username) return false
  try {
    const articleId = await resolveArticleId(noteIdOrAlias)
    if (!articleId) return false
    const userId = await resolveUserId(username)
    if (!userId) return false
    const cached = permCache.get(permCacheKey(articleId, userId))
    if (cached && Date.now() - cached.at <= PERM_CACHE_TTL_MS) {
      return cached.canEdit
    }
    const canEdit = await evaluateCanEdit(articleId, userId)
    setPermCache(articleId, userId, canEdit)
    return canEdit
  } catch (err) {
    logger.warn('menmen-perm: checkCanEdit failed (fail-close): ' + err.message)
    return false
  }
}

function warmCanEdit (noteIdOrAlias, username) {
  return checkCanEdit(noteIdOrAlias, username)
}

function getUsernameFromUser (user) {
  if (!user || !user.profile) return null
  try {
    const profile = JSON.parse(user.profile)
    return profile.username || null
  } catch (e) {
    return null
  }
}

/** 供测试注入 mock pool */
function _setPoolForTests (mockPool) {
  pool = mockPool
  enabled = !!mockPool
}

function _resetCachesForTests () {
  userIdCache.clear()
  permCache.clear()
}

module.exports = {
  initFromConfig,
  isEnabled,
  parseArticleIdFromNoteId,
  getCachedCanEdit,
  checkCanEdit,
  warmCanEdit,
  getUsernameFromUser,
  _setPoolForTests,
  _resetCachesForTests
}
