import { resolveServerUrl } from './resolveServerUrl'

export const DROPBOX_APP_KEY = window.DROPBOX_APP_KEY || ''

export const domain = window.domain || '' // domain name
export const urlpath = window.urlpath || '' // sub url path, like: www.example.com/<urlpath>
export const debug = window.debug || false

export const port = window.location.port
export const serverurl = resolveServerUrl({
  protocol: window.location.protocol,
  hostname: window.location.hostname,
  port: window.location.port,
  origin: window.location.origin,
  domain,
  urlpath
})
window.serverurl = serverurl

/** 与当前页同源的 API 路径（化学/几何等 fetch，避免 CMD_DOMAIN 跨源） */
export function sameOriginApi (path) {
  const p = path.startsWith('/') ? path : `/${path}`
  if (!urlpath) return p
  const prefix = `/${String(urlpath).replace(/^\/|\/$/g, '')}`
  return `${prefix}${p}`
}
export const noteid = decodeURIComponent(urlpath ? window.location.pathname.slice(urlpath.length + 1, window.location.pathname.length).split('/')[1] : window.location.pathname.split('/')[1])
export const noteurl = `${serverurl}/${noteid}`

export const version = window.version
