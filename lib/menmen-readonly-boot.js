'use strict'

/**
 * 首屏编辑切换默认隐藏：只有显式 canEdit=1 才露出铅笔/分栏。
 * 缺参、canEdit=0、别名跳转丢 query 都按只读，避免无编辑权用户刷新闪图标。
 */
function rawCanEdit (query) {
  if (!query) return ''
  const raw = Array.isArray(query.canEdit) ? query.canEdit[0] : query.canEdit
  return raw == null ? '' : String(raw)
}

function queryAllowsMenmenEdit (query) {
  return rawCanEdit(query) === '1'
}

function queryRequestsMenmenReadonly (query) {
  return !queryAllowsMenmenEdit(query)
}

function searchRequestsMenmenReadonly (search) {
  if (search == null) return true
  try {
    const q = String(search)
    const trimmed = q.charAt(0) === '?' ? q.slice(1) : q
    return new URLSearchParams(trimmed).get('canEdit') !== '1'
  } catch (e) {
    return true
  }
}

function appendRequestQuery (req, location) {
  const from = (req && (req.originalUrl || req.url)) || ''
  const q = from.indexOf('?') >= 0 ? from.slice(from.indexOf('?')) : ''
  if (!q) return location
  if (String(location).indexOf('?') >= 0) return location
  return location + q
}

module.exports = {
  queryAllowsMenmenEdit,
  queryRequestsMenmenReadonly,
  searchRequestsMenmenReadonly,
  appendRequestQuery
}
