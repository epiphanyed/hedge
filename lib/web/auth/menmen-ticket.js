'use strict'

const axios = require('axios')
const logger = require('../../logger')
const models = require('../../models')
const config = require('../../config')
const menmenPerm = require('../../menmen-perm')

const tokenCache = new Map()
const TOKEN_CACHE_TTL = 60 * 1000

function getCachedUserId (token) {
  const item = tokenCache.get(token)
  if (item && Date.now() - item.time < TOKEN_CACHE_TTL) {
    return item.userId
  }
  return null
}

function setCachedUserId (token, userId) {
  tokenCache.set(token, { userId, time: Date.now() })
  if (tokenCache.size > 2000) {
    const now = Date.now()
    for (const [k, v] of tokenCache.entries()) {
      if (now - v.time > TOKEN_CACHE_TTL) tokenCache.delete(k)
    }
  }
}

function logoutAndNext (req, res, next) {
  if (typeof req.logout === 'function') {
    req.logout(function () {
      next()
    })
  } else {
    next()
  }
}

async function bindPlatformUserSession (req, res, userId) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const currentProfileId = req.user.profileid ? String(req.user.profileid) : null
    if (currentProfileId === String(userId)) {
      return
    }
    logger.info('[menmen-ticket] account switch ' + currentProfileId + ' -> ' + userId)
    await new Promise((resolve) => logoutAndNext(req, res, resolve))
  }

  const userRows = await menmenPerm.queryOne(
    'SELECT id, username, nickname, email, avatar FROM sys_user WHERE id = ? AND (is_deleted IS NULL OR is_deleted = 0) LIMIT 1',
    [userId]
  )
  if (!userRows || !userRows.length) {
    return
  }
  const sysUser = userRows[0]

  const profileObj = {
    provider: 'oauth2',
    id: String(userId),
    displayName: sysUser.nickname || sysUser.username,
    username: sysUser.username,
    avatarUrl: sysUser.avatar,
    photos: sysUser.avatar ? [{ value: sysUser.avatar }] : [],
    emails: [{ value: sysUser.email || `${sysUser.username}@menmen.internal` }]
  }
  const profileJson = JSON.stringify(profileObj)

  let localUser = await models.User.findOne({
    where: { profileid: String(userId) }
  })

  if (!localUser) {
    localUser = await models.User.create({
      profileid: String(userId),
      profile: profileJson
    })
  } else if (localUser.profile !== profileJson) {
    await localUser.update({ profile: profileJson })
  }

  await new Promise((resolve, reject) => {
    req.login(localUser, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function readGatewayUserId (req) {
  const menmen = config.menmen || {}
  const expectedTrust = menmen.gatewayTrust
  if (!expectedTrust) return null
  const trustHdr = req.get && req.get('X-Menmen-Gateway-Trust')
  if (trustHdr !== expectedTrust) return null
  const raw = req.get && req.get('X-Menmen-User-Id')
  if (!raw) return null
  const userId = parseInt(String(raw), 10)
  return Number.isFinite(userId) ? userId : null
}

function readRequestToken (req) {
  if (req.query && (req.query.token || req.query.ticket)) {
    return req.query.token || req.query.ticket
  }
  if (req.headers && req.headers.authorization) {
    const authHeader = String(req.headers.authorization).trim()
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim()
    }
    if (authHeader) return authHeader
  }
  if (req.cookies && req.cookies.Authorization) {
    return req.cookies.Authorization
  }
  if (req.cookies && (req.cookies.satoken || req.cookies['satoken'])) {
    return req.cookies.satoken || req.cookies['satoken']
  }
  return null
}

module.exports = async function menmenTicketAuth (req, res, next) {
  if (!menmenPerm.isEnabled()) {
    return next()
  }

  try {
    const gatewayUserId = readGatewayUserId(req)
    if (gatewayUserId != null) {
      await bindPlatformUserSession(req, res, gatewayUserId)
      return next()
    }

    const menmen = config.menmen || {}
    if (menmen.gatewayTrust) {
      // 生产走 Nginx 注入身份；直连 hedge 容器时不伪造网关头
      return next()
    }

    const token = readRequestToken(req)
    if (!token) {
      return next()
    }

    let userId = getCachedUserId(token)
    if (!userId) {
      const authBase = menmen.authServiceUrl || 'http://auth:9002'
      const resp = await axios.get(`${authBase}/api/auth/validate`, {
        headers: {
          Cookie: `Authorization=${encodeURIComponent(token)}`,
          Authorization: token
        },
        timeout: 2500,
        validateStatus: () => true
      })
      if (resp.status === 200) {
        const raw = resp.headers['x-user-id']
        userId = raw ? parseInt(String(raw), 10) : NaN
        if (!Number.isFinite(userId)) userId = null
        else setCachedUserId(token, userId)
      }
    }

    if (!userId) {
      return next()
    }

    await bindPlatformUserSession(req, res, userId)
    return next()
  } catch (err) {
    logger.warn('[menmen-ticket] silent auth failed: ' + err.message)
    return next()
  }
}
