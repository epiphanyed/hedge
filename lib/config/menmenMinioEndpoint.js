'use strict'

const logger = require('../logger')

const INTERNAL_HOST = process.env.CMD_MENMEN_MINIO_INTERNAL_HOST || 'minio'
const INTERNAL_PORT = toIntegerConfig(process.env.CMD_MENMEN_MINIO_INTERNAL_PORT) || 9000

/** 与 menmenRequestOrigin 一致；勿 require 该模块（会循环依赖 config）。 */
function isMenmenGatewayHostname (host) {
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (host === 'menmendoc.com' || host === 'www.menmendoc.com') return true
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true
  return false
}

function toIntegerConfig (value) {
  if (value === undefined || value === null || value === '') return undefined
  const n = parseInt(String(value), 10)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Hedge 容器内 MinIO SDK 必须走 Docker 网内 S3（minio:9000）。
 * 误把 CMD_DOMAIN / 网关 Host（nginx :80）当作 CMD_MINIO_ENDPOINT 会导致读写失败。
 */
function normalizeMenmenMinioEndpoint (config) {
  if (!config || !config.minio || !config.minio.endPoint) return

  const minio = config.minio
  const endPoint = String(minio.endPoint).trim()
  const port = minio.port || 9000
  const domain = config.domain ? String(config.domain).trim() : ''

  const isGatewayHost =
    isMenmenGatewayHostname(endPoint) ||
    (domain && endPoint === domain)
  const isWebPort = port === 80 || port === 443

  if (!isGatewayHost && !isWebPort) return
  if (endPoint === INTERNAL_HOST && port === INTERNAL_PORT && !minio.secure) return

  logger.warn(
    'menmen: MinIO SDK must not use gateway :80/:443 or CMD_DOMAIN (%s:%s); using %s:%s on docker network',
    endPoint,
    port,
    INTERNAL_HOST,
    INTERNAL_PORT
  )

  minio.endPoint = INTERNAL_HOST
  minio.port = INTERNAL_PORT
  minio.secure = false
}

module.exports = {
  normalizeMenmenMinioEndpoint,
  INTERNAL_HOST,
  INTERNAL_PORT
}
