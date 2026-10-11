'use strict'

/** Docker / SDK 内网 MinIO 主机名；浏览器不可解析，须改同源 /oss/ */
const INTERNAL_MINIO_HOSTS = new Set(['minio', 'localhost', '127.0.0.1'])

function isInternalMinioHost (host) {
  if (!host) return false
  const h = String(host).toLowerCase()
  if (INTERNAL_MINIO_HOSTS.has(h)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

function ossPathFromObjectPath (pathname) {
  if (!pathname) return null
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (path.startsWith('/oss/')) return path
  if (path.startsWith('/user-avatars/') || path.startsWith('/project/')) {
    return `/oss${path}`
  }
  return null
}

/**
 * 将 DB / MinIO SDK 产生的头像或媒体 URL 改为浏览器可请求的相对 /oss/ 路径（随当前页 Host）。
 */
function menmenPublicMediaUrl (url) {
  if (!url || typeof url !== 'string') return url
  const trimmed = url.trim()
  if (!trimmed) return url

  if (trimmed.startsWith('/oss/')) return trimmed

  if (!/^https?:\/\//i.test(trimmed)) {
    const key = trimmed.replace(/^\/+/, '')
    if (key.startsWith('user-avatars/') || key.startsWith('project/')) {
      return `/oss/${key}`
    }
    return trimmed
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch (err) {
    return url
  }

  const ossFromPath = ossPathFromObjectPath(parsed.pathname)
  if (ossFromPath) {
    const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80)
    if (isInternalMinioHost(parsed.hostname) || port === 9000) {
      return ossFromPath + parsed.search
    }
  }

  return url
}

module.exports = {
  menmenPublicMediaUrl,
  isInternalMinioHost,
  ossPathFromObjectPath
}
