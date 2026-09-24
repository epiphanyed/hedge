'use strict'

const { promisify } = require('util')

const models = require('../models')
const menmenPerm = require('../menmen-perm')

const parseNoteIdAsync = promisify(models.Note.parseNoteId)

const SCOPE_RE = /^(\d+|n_[0-9a-f-]{36})$/
const HASH_RE = /^[a-f0-9]{64}$/

async function resolveScopeFromNoteId (noteIdOrAlias) {
  if (!noteIdOrAlias || typeof noteIdOrAlias !== 'string') return null
  const noteUuid = await parseNoteIdAsync(noteIdOrAlias)
  const articleId = await menmenPerm.resolveArticleId(noteIdOrAlias)
  if (articleId) return String(articleId)
  return `n_${noteUuid}`
}

async function loadNoteByAliasOrId (noteIdOrAlias) {
  const noteUuid = await parseNoteIdAsync(noteIdOrAlias)
  return models.Note.findByPk(noteUuid)
}

function isValidScope (scope) {
  return SCOPE_RE.test(String(scope))
}

function isValidHash (hash) {
  return HASH_RE.test(String(hash))
}

module.exports = {
  resolveScopeFromNoteId,
  loadNoteByAliasOrId,
  isValidScope,
  isValidHash,
  SCOPE_RE,
  HASH_RE
}
