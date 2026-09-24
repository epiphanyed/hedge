'use strict'

const Router = require('express').Router
const Minio = require('minio')

const config = require('../config')
const errors = require('../errors')
const logger = require('../logger')
const menmenPerm = require('../menmen-perm')
const scopeUtil = require('./scope-util')

const hwRouter = (module.exports = Router())

const ALLOWED_DOMAINS = new Set(['handwriting', 'geo', 'chem', 'manim'])
const FILE_RE = /^[a-f0-9]{64}(_[a-z0-9-]+)?\.(png|json|svg|sdf|mp4)$/

let minioClient = null

function getMinioClient () {
  if (minioClient) return minioClient
  if (!config.minio || !config.minio.endPoint) return null
  minioClient = new Minio.Client({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    useSSL: config.minio.secure,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey
  })
  return minioClient
}

function contentTypeForFile (file) {
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.json')) return 'application/json'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  if (file.endsWith('.sdf')) return 'chemical/x-mdl-sdfile'
  if (file.endsWith('.mp4')) return 'video/mp4'
  return 'application/octet-stream'
}

async function tryGetObject (client, key) {
  try {
    const stream = await client.getObject(config.s3bucket, key)
    const stat = await client.statObject(config.s3bucket, key)
    return { stream, stat }
  } catch (err) {
    return null
  }
}

function ownerMatches (stat, req) {
  const meta = stat.metaData || {}
  const owner = meta['x-amz-meta-owner'] || meta.owner
  if (!owner) return true
  if (!req.user || !req.user.id) return false
  return String(owner) === String(req.user.id)
}

async function serveHwObject (req, res, domain, scope, file) {
  const client = getMinioClient()
  if (!client || !config.s3bucket) {
    return errors.errorNotFound(res)
  }

  let noteId = req.query.noteId
  let note = null
  if (noteId) {
    try {
      note = await scopeUtil.loadNoteByAliasOrId(noteId)
    } catch (err) {
      logger.debug(`hwRouter: note lookup failed: ${err.message}`)
    }
  } else if (typeof scope === 'string' && scope.startsWith('n_')) {
    const aliasOrId = scope.slice(2)
    try {
      note = await scopeUtil.loadNoteByAliasOrId(aliasOrId)
      if (note && !noteId) {
        noteId = note.alias || note.shortid || aliasOrId
      }
    } catch (err) {
      logger.debug(`hwRouter: standalone note lookup failed: ${err.message}`)
    }
  }

  const canRead = await menmenPerm.checkCanRead(noteId || scope, req, note)
  if (!canRead) {
    return errors.errorNotFound(res)
  }

  const privateKey = `private/${domain}/${scope}/${file}`
  const tmpKey = `tmp/${domain}/${scope}/${file}`

  let result = await tryGetObject(client, privateKey)
  if (!result) {
    result = await tryGetObject(client, tmpKey)
    if (result && !ownerMatches(result.stat, req)) {
      result.stream.destroy()
      return errors.errorNotFound(res)
    }
  }

  if (!result) {
    return errors.errorNotFound(res)
  }

  res.set({
    'Content-Type': contentTypeForFile(file),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${file}"`,
    'Cache-Control': 'private, max-age=300'
  })
  result.stream.pipe(res)
}

/** Resolve scope from noteId — for clients that only know noteId + hash */
hwRouter.get('/api/hw/note/:domain/:file', async function (req, res) {
  const { domain, file } = req.params
  if (!ALLOWED_DOMAINS.has(domain) || !FILE_RE.test(file)) {
    return errors.errorBadRequest(res)
  }
  const noteId = req.query.noteId
  if (!noteId) return errors.errorBadRequest(res)
  let scope
  try {
    scope = await scopeUtil.resolveScopeFromNoteId(noteId)
  } catch (err) {
    return errors.errorNotFound(res)
  }
  if (!scope) return errors.errorNotFound(res)
  return serveHwObject(req, res, domain, scope, file)
})

hwRouter.get('/api/hw/:domain/:scope/:file', async function (req, res) {
  const { domain, scope, file } = req.params
  if (!ALLOWED_DOMAINS.has(domain) || !scopeUtil.isValidScope(scope) || !FILE_RE.test(file)) {
    return errors.errorBadRequest(res)
  }
  return serveHwObject(req, res, domain, scope, file)
})
