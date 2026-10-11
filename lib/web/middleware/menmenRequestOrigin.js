'use strict'

const config = require('../../config')

/** Nginx 网关 Host（与 default.conf server_name 内网段一致） */
function isMenmenGatewayHostname (host) {
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (host === 'menmendoc.com' || host === 'www.menmendoc.com') return true
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true
  // 阿里云公网 IP / 其它数字 IP 隧道入口（与 nginx server_name 一致）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true
  if (host === 'dev.menmendoc.test' || host.endsWith('.menmendoc.test')) return true
  return false
}

function parseGatewayHostname (rawHost) {
  if (!rawHost) return null
  const hostHeader = String(rawHost).split(',')[0].trim()
  if (!hostHeader) return null

  let hostname = hostHeader
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']')
    if (end > 0) hostname = hostHeader.slice(1, end)
  } else {
    const colon = hostHeader.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(hostHeader.slice(colon + 1))) {
      hostname = hostHeader.slice(0, colon)
    }
  }
  return isMenmenGatewayHostname(hostname) ? hostname : null
}

/** /config 与前端 serverurl：与当前页 Host 一致，避免 CMD_DOMAIN=LAN IP 时跨源 fetch。 */
function menmenClientDomainFromRequest (req) {
  const hostname =
    parseGatewayHostname(req.headers['x-forwarded-host']) ||
    parseGatewayHostname(req.headers.host)
  return hostname || config.domain
}

function parseHostParts (rawHost) {
  if (!rawHost) return null
  const header = String(rawHost).split(',')[0].trim()
  if (!header) return null

  let hostname = header
  let portSuffix = ''
  if (header.startsWith('[')) {
    const end = header.indexOf(']')
    if (end > 0) {
      hostname = header.slice(1, end)
      portSuffix = header.slice(end + 1)
    }
  } else {
    const colon = header.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(header.slice(colon + 1))) {
      hostname = header.slice(0, colon)
      portSuffix = header.slice(colon)
    }
  }
  return { hostname, portSuffix }
}

function buildOriginFromParts (req, hostname, portSuffix) {
  const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  const useSsl = protoHeader === 'https' || config.protocolUseSSL
  const protocol = (useSsl ? 'https' : 'http') + '://'
  let origin = protocol + hostname

  const isStandardPort =
    (useSsl && (portSuffix === '' || portSuffix === ':443')) ||
    (!useSsl && (portSuffix === '' || portSuffix === ':80'))

  if (config.urlAddPort && portSuffix && !isStandardPort) {
    origin += portSuffix
  }

  if (config.urlPath) {
    origin += '/' + config.urlPath
  }

  return origin
}

function buildMenmenRequestOrigin (req) {
  const parts = parseHostParts(req.headers['x-forwarded-host'] || req.headers.host)
  if (!parts) return null
  const { hostname, portSuffix } = parts
  if (!isMenmenGatewayHostname(hostname)) return null
  return buildOriginFromParts(req, hostname, portSuffix)
}

/** 隧道 / 局域网 IP 等与 CMD_DOMAIN 不一致时，仍用当前页 Host 作 serverURL */
function buildMenmenRequestOriginFallback (req) {
  const parts = parseHostParts(req.headers['x-forwarded-host'] || req.headers.host)
  if (!parts) return null
  const { hostname, portSuffix } = parts
  if (!hostname || hostname === config.domain) return null
  return buildOriginFromParts(req, hostname, portSuffix)
}

/**
 * 按实际请求 Host 重写 serverURL（模板 base href / 静态资源前缀）。
 * 手机 WebView 常走 LAN IP，而 CMD_DOMAIN 固定 www.menmendoc.com 会导致 CSS/JS 拉取失败、界面「乱码」。
 */
function menmenRequestOrigin (req, res, next) {
  const origin = buildMenmenRequestOrigin(req) || buildMenmenRequestOriginFallback(req)
  if (origin) res.locals.serverURL = origin
  next()
}

menmenRequestOrigin.isMenmenGatewayHostname = isMenmenGatewayHostname
menmenRequestOrigin.menmenClientDomainFromRequest = menmenClientDomainFromRequest
menmenRequestOrigin.buildMenmenRequestOrigin = buildMenmenRequestOrigin

module.exports = menmenRequestOrigin
