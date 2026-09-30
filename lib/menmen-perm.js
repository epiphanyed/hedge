'use strict'

const mysql = require('mysql2/promise')
const logger = require('./logger')

const USER_CACHE_TTL_MS = 10 * 60 * 1000
const PERM_CACHE_TTL_MS = 10 * 1000
const READ_CACHE_TTL_MS = 10 * 1000
const QUERY_TIMEOUT_MS = 2500

let pool = null
let enabled = false

/** @type {Map<string, { id: number, at: number }>} */
const userIdCache = new Map()
/** @type {Map<string, { canEdit: boolean, at: number }>} */
const permCache = new Map()
/** @type {Map<string, { canRead: boolean, at: number }>} */
const readCache = new Map()

function cleanBoundedMap (map, maxLimit = 5000) {
  if (map.size > maxLimit) {
    const it = map.keys()
    for (let i = 0; i < 500; i++) {
      const k = it.next().value
      if (k) map.delete(k)
    }
  }
}

function initFromConfig (cfg) {
  const url = cfg.menmen && cfg.menmen.mysqlUrl
  if (!url) {
    enabled = false
    pool = null
    return
  }
  try {
    pool = mysql.createPool({
      uri: url,
      connectionLimit: (cfg.menmen && cfg.menmen.mysqlConnectionLimit) || 25,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
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

async function queryOne (sql, params) {
  if (!pool) return []
  const [rows] = await pool.query({ sql, timeout: QUERY_TIMEOUT_MS }, params)
  return rows
}

function parseArticleIdFromNoteId (noteIdOrAlias) {
  if (!noteIdOrAlias) return null
  const str = String(noteIdOrAlias).trim()
  const m = /^a_(\d+)$/.exec(str)
  if (m) return parseInt(m[1], 10)
  if (/^\d+$/.test(str)) return parseInt(str, 10)
  return null
}

function permCacheKey (articleId, userId) {
  return `${articleId}:${userId}`
}

function readCacheKey (noteIdOrAlias, userId) {
  const aid = parseArticleIdFromNoteId(noteIdOrAlias)
  const keyPart = aid != null ? String(aid) : String(noteIdOrAlias)
  return `${keyPart}:${userId || 'anon'}`
}

function getUserIdFromUser (user) {
  if (!user) return null
  if (user.profileid && /^\d+$/.test(String(user.profileid))) {
    return parseInt(user.profileid, 10)
  }
  return null
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

async function resolveUserId (username) {
  if (!username) return null
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
  cleanBoundedMap(userIdCache)
  return rows[0].id
}

async function resolveArticleId (noteIdOrAlias) {
  const direct = parseArticleIdFromNoteId(noteIdOrAlias)
  if (direct) return direct
  const rows = await queryOne(
    'SELECT id FROM sys_article WHERE note_id = ? AND (is_deleted IS NULL OR is_deleted = 0) LIMIT 1',
    [noteIdOrAlias]
  )
  if (!rows || !rows.length) return null
  return rows[0].id
}

async function queryArticleAccess (articleId) {
  const modeRows = await queryOne(
    'SELECT access_mode, is_deleted FROM sys_article WHERE id = ? LIMIT 1',
    [articleId]
  )
  if (!modeRows || !modeRows.length) return null
  if (modeRows[0].is_deleted === 1) return null
  return { accessMode: modeRows[0].access_mode }
}

async function isOfficialMeshArticle (articleId) {
  const rows = await queryOne(
    "SELECT 1 FROM mmge_nodes WHERE article_id = ? AND visibility = 'OFFICIAL' LIMIT 1",
    [articleId]
  )
  return !!(rows && rows.length)
}

async function hasReadablePlacement (articleId) {
  const descRows = await queryOne(
    'SELECT 1 FROM sys_project WHERE description_article_id = ? LIMIT 1',
    [articleId]
  )
  if (descRows && descRows.length) return true
  if (await isOfficialMeshArticle(articleId)) return true
  const nodeRows = await queryOne(
    `SELECT 1 FROM sys_project_article_node pan
     INNER JOIN sys_project_node pn ON pan.fk_project_node_id = pn.id AND pn.is_deleted = 0
     WHERE pan.fk_article_id = ? LIMIT 1`,
    [articleId]
  )
  return !!(nodeRows && nodeRows.length)
}

async function isProjectPublic (articleId) {
  const rows = await queryOne(
    `SELECT EXISTS(
       SELECT 1 FROM sys_project_article_node pan
       INNER JOIN sys_project_node pn ON pan.fk_project_node_id = pn.id AND pn.is_deleted = 0
       INNER JOIN sys_project p ON pn.fk_project_id = p.id
       WHERE pan.fk_article_id = ? AND p.is_public = 1
     ) AS ok`,
    [articleId]
  )
  return !!(rows && rows[0] && (rows[0].ok === 1 || rows[0].ok === true))
}

async function isPlatformAdmin (userId) {
  const adminRows = await queryOne(
    `SELECT COUNT(1) AS cnt
     FROM sys_user_role ur
     INNER JOIN sys_role r ON ur.role_id = r.id
     WHERE ur.user_id = ? AND r.code = 'admin'`,
    [userId]
  )
  return !!(adminRows[0] && adminRows[0].cnt > 0)
}

async function isNodeOrProjectCreator (userId, articleId) {
  const rows = await queryOne(
    `SELECT EXISTS(
       SELECT 1 FROM sys_project_article_node pan
       INNER JOIN sys_project_node pn ON pan.fk_project_node_id = pn.id AND pn.is_deleted = 0
       LEFT JOIN sys_project p ON pn.fk_project_id = p.id
       WHERE pan.fk_article_id = ? AND (pn.create_by = ? OR p.create_by = ?)
     ) AS ok`,
    [articleId, userId, userId]
  )
  return !!(rows && rows[0] && (rows[0].ok === 1 || rows[0].ok === true))
}

async function isGroupMember (articleId, userId) {
  const rows = await queryOne(
    `SELECT EXISTS(
       SELECT 1 FROM sys_group_article sga
       JOIN sys_group_user sgu ON sga.fk_group_id = sgu.fk_group_id
       WHERE sga.fk_article_id = ? AND sgu.fk_user_id = ?
     ) AS ok`,
    [articleId, userId]
  )
  return !!(rows && rows[0] && (rows[0].ok === 1 || rows[0].ok === true))
}

async function hasUserArticleGrant (articleId, userId) {
  const rows = await queryOne(
    `SELECT EXISTS(
       SELECT 1 FROM sys_user_article
       WHERE fk_article_id = ? AND fk_user_id = ?
     ) AS ok`,
    [articleId, userId]
  )
  return !!(rows && rows[0] && (rows[0].ok === 1 || rows[0].ok === true))
}

async function hasGroupWritePermission (articleId, userId) {
  const rows = await queryOne(
    `SELECT EXISTS(
       SELECT 1 FROM sys_group_article sga
       JOIN sys_group_user sgu ON sga.fk_group_id = sgu.fk_group_id
       WHERE sga.fk_article_id = ? AND sgu.fk_user_id = ? AND sgu.permission >= 1
     ) AS ok`,
    [articleId, userId]
  )
  return !!(rows && rows[0] && (rows[0].ok === 1 || rows[0].ok === true))
}

async function canEditProjectDescription (userId, articleId) {
  const projRows = await queryOne(
    'SELECT id FROM sys_project WHERE description_article_id = ? LIMIT 1',
    [articleId]
  )
  if (!projRows || !projRows.length) return false
  const projectId = projRows[0].id
  const adminRows = await queryOne(
    `SELECT 1 FROM sys_group_user sgu
     INNER JOIN sys_group_project sgp ON sgu.fk_group_id = sgp.fk_group_id
     WHERE sgp.fk_project_id = ? AND sgu.fk_user_id = ? AND sgu.role IN (0, 2)
     LIMIT 1`,
    [projectId, userId]
  )
  return !!(adminRows && adminRows.length)
}

async function evaluateCanRead (articleId, userId) {
  const article = await queryArticleAccess(articleId)
  if (!article) return false
  if (!(await hasReadablePlacement(articleId))) return false
  const [isPublic, isOfficial] = await Promise.all([
    isProjectPublic(articleId),
    isOfficialMeshArticle(articleId)
  ])
  if (isPublic || isOfficial) return true
  if (userId == null) return false
  const [isAdmin, isCreator] = await Promise.all([
    isPlatformAdmin(userId),
    isNodeOrProjectCreator(userId, articleId)
  ])
  if (isAdmin || isCreator) return true
  const [isMember, hasGrant] = await Promise.all([
    isGroupMember(articleId, userId),
    hasUserArticleGrant(articleId, userId)
  ])
  return isMember || hasGrant
}

async function evaluateCanEdit (articleId, userId) {
  if (userId == null) return false
  const article = await queryArticleAccess(articleId)
  if (!article) return false
  if (!(await hasReadablePlacement(articleId))) return false
  if (await isPlatformAdmin(userId)) return true
  const mode = article.accessMode
  if (mode === 1 || mode === 2) return false

  const descRows = await queryOne(
    'SELECT id FROM sys_project WHERE description_article_id = ? LIMIT 1',
    [articleId]
  )
  if (descRows && descRows.length) {
    return canEditProjectDescription(userId, articleId)
  }

  if (await isNodeOrProjectCreator(userId, articleId)) return true
  if (await hasUserArticleGrant(articleId, userId)) return true
  return hasGroupWritePermission(articleId, userId)
}

function evictPermCache (articleId, userId) {
  if (!articleId) return
  const id = parseInt(articleId, 10)
  if (userId) {
    permCache.delete(permCacheKey(id, userId))
  } else {
    for (const key of permCache.keys()) {
      if (key.startsWith(`${id}:`)) permCache.delete(key)
    }
  }
  for (const key of readCache.keys()) {
    if (key.startsWith(`${id}:`) || key.startsWith(`a_${id}:`)) {
      readCache.delete(key)
    }
  }
}

async function checkCanRead (noteIdOrAlias, req, note) {
  if (!noteIdOrAlias) return false
  if (!isEnabled()) {
    return false
  }

  if (req && req.get) {
    const menmenCfg = require('./config').menmen || {}
    const internalToken = menmenCfg.internalEvictToken
    if (internalToken && req.get('x-menmen-internal') === internalToken) {
      return true
    }
  }

  const platformUserId = req && req.user ? getUserIdFromUser(req.user) : null

  let canRead = false
  let cacheKey = readCacheKey(noteIdOrAlias, platformUserId)
  try {
    const articleId = await resolveArticleId(noteIdOrAlias)
    if (articleId != null) {
      cacheKey = `${articleId}:${platformUserId || 'anon'}`
    }
    const cached = readCache.get(cacheKey)
    if (cached && Date.now() - cached.at <= READ_CACHE_TTL_MS) {
      return cached.canRead
    }
    if (!articleId) {
      canRead = false
    } else {
      canRead = await evaluateCanRead(articleId, platformUserId)
    }
  } catch (err) {
    logger.warn('menmen-perm: checkCanRead failed (fail-close): ' + err.message)
    canRead = false
  }

  readCache.set(cacheKey, { canRead, at: Date.now() })
  cleanBoundedMap(readCache)
  return canRead
}

function getCachedCanEdit (noteIdOrAlias, username, platformUserId) {
  if (!isEnabled()) return null
  let userId = platformUserId
  if (userId == null && username) {
    const userEntry = userIdCache.get(username)
    if (!userEntry || Date.now() - userEntry.at > USER_CACHE_TTL_MS) return null
    userId = userEntry.id
  }
  if (userId == null) return null
  const articleId = parseArticleIdFromNoteId(noteIdOrAlias)
  if (!articleId) return null
  const entry = permCache.get(permCacheKey(articleId, userId))
  if (!entry || Date.now() - entry.at > PERM_CACHE_TTL_MS) return null
  return entry.canEdit
}

function setPermCache (articleId, userId, canEdit) {
  permCache.set(permCacheKey(articleId, userId), { canEdit, at: Date.now() })
  cleanBoundedMap(permCache)
}

async function checkCanEdit (noteIdOrAlias, username, platformUserId) {
  if (!isEnabled()) return null
  try {
    const articleId = await resolveArticleId(noteIdOrAlias)
    if (!articleId) return false
    let userId = platformUserId
    if (userId == null) {
      if (!username) return false
      userId = await resolveUserId(username)
    }
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

function warmCanEdit (noteIdOrAlias, username, platformUserId) {
  return checkCanEdit(noteIdOrAlias, username, platformUserId)
}

async function resolveVisibilityForArticle (noteIdOrAlias) {
  if (!isEnabled()) return null
  const articleId = await resolveArticleId(noteIdOrAlias)
  if (!articleId) return null
  return (await isProjectPublic(articleId)) ? 'public' : 'private'
}

async function isArticlePublic (articleId) {
  return isProjectPublic(articleId)
}

function _setPoolForTests (mockPool) {
  pool = mockPool
  enabled = !!mockPool
}

function _resetCachesForTests () {
  userIdCache.clear()
  permCache.clear()
  readCache.clear()
}

module.exports = {
  initFromConfig,
  isEnabled,
  parseArticleIdFromNoteId,
  resolveArticleId,
  resolveVisibilityForArticle,
  isArticlePublic,
  getCachedCanEdit,
  checkCanRead,
  checkCanEdit,
  warmCanEdit,
  getUsernameFromUser,
  getUserIdFromUser,
  evictPermCache,
  queryOne,
  _setPoolForTests,
  _resetCachesForTests
}
