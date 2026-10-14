'use strict'

const fetch = require('node-fetch')
const logger = require('../logger')
const menmenPerm = require('../menmen-perm')
const notePermission = require('../note-permission')
const scopeUtil = require('./scope-util')

function sendRenderJson (res, status, body) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  })
  const payload = JSON.stringify(body == null ? {} : body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

async function proxyJson (url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let body = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch (err) {
        logger.error(`render-util: invalid JSON from ${url}: ${err.message}`)
        throw new Error('invalid_upstream')
      }
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function platformUserFromReq (req) {
  let username = null
  if (req.user && req.user.profile) {
    try {
      username = JSON.parse(req.user.profile).username
    } catch (err) {
      username = null
    }
  }
  const platformUserId =
    req.user && req.user.profileid && /^\d+$/.test(String(req.user.profileid))
      ? parseInt(String(req.user.profileid), 10)
      : null
  return { username, platformUserId }
}

async function requireNoteEdit (noteId, req) {
  if (!noteId || typeof noteId !== 'string') return false
  const { username, platformUserId } = platformUserFromReq(req)
  return menmenPerm.checkCanEdit(noteId, username, platformUserId)
}

async function resolveVisibility (noteIdOrAlias, req) {
  if (!noteIdOrAlias) return 'private'
  try {
    const menmenVis = await menmenPerm.resolveVisibilityForArticle(noteIdOrAlias)
    if (menmenVis) return menmenVis
    const note = await scopeUtil.loadNoteByAliasOrId(noteIdOrAlias)
    if (!note) return 'private'
    return notePermission.isNotePublicByPermission(note.permission) ? 'public' : 'private'
  } catch (err) {
    logger.warn('render-util: resolveVisibility failed: ' + err.message)
    return 'private'
  }
}

function mapJobUrls (keys, scope, noteId) {
  const urls = {}
  if (!keys || typeof keys !== 'object') return urls
  for (const [name, key] of Object.entries(keys)) {
    if (!key) continue
    if (String(key).startsWith('public/')) {
      urls[name] = `/oss/${key}`
    } else {
      const parts = String(key).split('/')
      const domain = parts[1]
      const file = parts.slice(3).join('/')
      urls[name] = `/api/hw/${domain}/${scope}/${file}${noteId ? `?noteId=${encodeURIComponent(noteId)}` : ''}`
    }
  }
  return urls
}

module.exports = {
  sendRenderJson,
  proxyJson,
  resolveVisibility,
  mapJobUrls,
  requireNoteEdit,
  platformUserFromReq
}
