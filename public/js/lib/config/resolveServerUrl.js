'use strict'

/**
 * HedgeDoc 的 CMD_DOMAIN 常与当前页 hostname 不一致（LAN IP 访问、网关反代）。
 * 此时仍用 domain 拼 serverurl 会导致 /api/chem 等 fetch 跨源 → NetworkError。
 */
export function resolveServerUrl (ctx) {
  const protocol = ctx.protocol || 'http:'
  const hostname = ctx.hostname || 'localhost'
  const port = ctx.port || ''
  const origin = ctx.origin || `${protocol}//${hostname}${port ? ':' + port : ''}`
  const domain = ctx.domain || ''
  const urlpath = ctx.urlpath || ''
  const portPart = port ? ':' + port : ''
  const pathPart = urlpath
    ? '/' + String(urlpath).replace(/^\/|\/$/g, '')
    : ''
  const configuredHost = domain || hostname
  const configured = `${protocol}//${configuredHost}${portPart}${pathPart}`.replace(/\/$/, '')

  try {
    if (new URL(configured).origin === origin) return configured
  } catch (e) {
    /* use page origin */
  }
  return (origin + pathPart).replace(/\/$/, '') || origin
}
