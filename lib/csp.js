const config = require('./config')
const { v4: uuidv4 } = require('uuid')
const { buildDomainOriginWithProtocol } = require('./config/buildDomainOriginWithProtocol')

const CspStrategy = {}

function menmenConfiguredConnectOrigins () {
  const origins = []
  const httpOrigin = buildDomainOriginWithProtocol(config, 'http')
  const wsOrigin = buildDomainOriginWithProtocol(config, 'ws')
  if (httpOrigin) origins.push(httpOrigin)
  if (wsOrigin) origins.push(wsOrigin)
  if (config.serverURL) {
    try {
      origins.push(new URL(config.serverURL).origin)
    } catch (err) {
      /* ignore */
    }
  }
  const homeUrl = config.menmen && config.menmen.homeUrl
  if (homeUrl) {
    try {
      origins.push(new URL(homeUrl).origin)
    } catch (err) {
      /* ignore */
    }
  }
  return origins
}

/** 网关 Host 与 CMD_DOMAIN 不一致时，允许 fetch /me、/api/* 走当前页 origin */
function menmenRequestConnectOrigin (req, res) {
  const host = req.get && req.get('host')
  if (!host) return null
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  return `${proto}://${host}`
}

function menmenRequestWsOrigin (req, res) {
  const host = req.get && req.get('host')
  if (!host) return null
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim()
  return `${proto === 'https' ? 'wss' : 'ws'}://${host}`
}

/** script-src / style-src 须与当前页 Host 一致（CMD_DOMAIN=LAN IP 时仅靠 'self' 在部分 Firefox 场景仍报错） */
function menmenRequestScriptBuild (req, res) {
  const origin = menmenRequestConnectOrigin(req, res)
  return origin ? `${origin}/build/` : null
}
function menmenRequestScriptJs (req, res) {
  const origin = menmenRequestConnectOrigin(req, res)
  return origin ? `${origin}/js/` : null
}
function menmenRequestScriptConfig (req, res) {
  const origin = menmenRequestConnectOrigin(req, res)
  return origin ? `${origin}/config` : null
}
function menmenRequestStyleBuild (req, res) {
  const origin = menmenRequestConnectOrigin(req, res)
  return origin ? `${origin}/build/` : null
}
function menmenRequestStyleCss (req, res) {
  const origin = menmenRequestConnectOrigin(req, res)
  return origin ? `${origin}/css/` : null
}

const defaultDirectives = {
  defaultSrc: ['\'none\''],
  baseUri: ['\'self\''],
  connectSrc: [
    '\'self\'',
    ...menmenConfiguredConnectOrigins(),
    menmenRequestConnectOrigin,
    menmenRequestWsOrigin,
    'https://vimeo.com/api/v2/video/'
  ],
  fontSrc: ['\'self\'', 'data:', menmenRequestScriptBuild],
  workerSrc: ['\'self\'', 'blob:'],
  manifestSrc: ['\'self\''],
  frameSrc: ['\'self\'', 'https://player.vimeo.com', 'https://www.youtube.com', 'https://gist.github.com'],
  imgSrc: ['*', 'data:'], // we allow using arbitrary images & explicit data for mermaid
  scriptSrc: [
    '\'self\'',
    config.serverURL + '/build/',
    config.serverURL + '/js/',
    config.serverURL + '/config',
    menmenRequestScriptBuild,
    menmenRequestScriptJs,
    menmenRequestScriptConfig,
    '\'unsafe-inline\'' // this is ignored by browsers supporting nonces/hashes
  ],
  styleSrc: [
    '\'self\'',
    config.serverURL + '/build/',
    config.serverURL + '/css/',
    menmenRequestStyleBuild,
    menmenRequestStyleCss,
    '\'unsafe-inline\''
  ], // unsafe-inline is required for some libs, plus used in views
  objectSrc: ['*'], // Chrome PDF viewer treats PDFs as objects :/
  formAction: ['\'self\''],
  mediaSrc: ['*']
}

const disqusDirectives = {
  scriptSrc: ['https://disqus.com', 'https://*.disqus.com', 'https://*.disquscdn.com'],
  styleSrc: ['https://*.disquscdn.com'],
  fontSrc: ['https://*.disquscdn.com']
}

const googleAnalyticsDirectives = {
  scriptSrc: ['https://www.google-analytics.com']
}

const dropboxDirectives = {
  scriptSrc: ['https://www.dropbox.com', '\'unsafe-inline\'']
}

const disallowFramingDirectives = {
  frameAncestors: ['\'self\'']
}

const allowPDFEmbedDirectives = {
  objectSrc: ['*'], // Chrome and Firefox treat PDFs as objects
  frameSrc: ['*'] // Chrome also checks PDFs against frame-src
}

const configuredGitLabInstanceDirectives = {
  connectSrc: [config.gitlab.baseURL]
}

CspStrategy.computeDirectives = function () {
  const directives = {}
  mergeDirectives(directives, config.csp.directives)
  mergeDirectivesIf(config.csp.addDefaults, directives, defaultDirectives)
  mergeDirectivesIf(config.csp.addDisqus, directives, disqusDirectives)
  mergeDirectivesIf(config.csp.addGoogleAnalytics, directives, googleAnalyticsDirectives)
  mergeDirectivesIf(config.dropbox.appKey, directives, dropboxDirectives)
  mergeDirectivesIf(!config.csp.allowFraming, directives, disallowFramingDirectives)
  mergeDirectivesIf(config.csp.allowPDFEmbed, directives, allowPDFEmbedDirectives)
  mergeDirectivesIf(config.isGitlabSnippetsEnable, directives, configuredGitLabInstanceDirectives)
  addInlineScriptExceptions(directives)
  addUpgradeUnsafeRequestsOptionTo(directives)
  addReportURI(directives)
  return directives
}

function mergeDirectives (existingDirectives, newDirectives) {
  for (const propertyName in newDirectives) {
    const newDirective = newDirectives[propertyName]
    if (newDirective) {
      const existingDirective = existingDirectives[propertyName] || []
      existingDirectives[propertyName] = existingDirective.concat(newDirective)
    }
  }
}

function mergeDirectivesIf (condition, existingDirectives, newDirectives) {
  if (condition) {
    mergeDirectives(existingDirectives, newDirectives)
  }
}

function addInlineScriptExceptions (directives) {
  directives.scriptSrc.push(getCspNonce)
  // TODO: This is the SHA-256 hash of the inline script in build/reveal.js/plugins/notes/notes.html
  // Any more clean solution appreciated.
  directives.scriptSrc.push('\'sha256-81acLZNZISnyGYZrSuoYhpzwDTTxi7vC1YM4uNxqWaM=\'')
}

function getCspNonce (req, res) {
  return '\'nonce-' + res.locals.nonce + '\''
}

function addUpgradeUnsafeRequestsOptionTo (directives) {
  if (config.csp.upgradeInsecureRequests === 'auto' && (config.useSSL || config.protocolUseSSL)) {
    directives.upgradeInsecureRequests = []
  } else if (config.csp.upgradeInsecureRequests === true) {
    directives.upgradeInsecureRequests = []
  }
}

function addReportURI (directives) {
  if (config.csp.reportURI) {
    directives.reportUri = config.csp.reportURI
  }
}

CspStrategy.addNonceToLocals = function (req, res, next) {
  res.locals.nonce = uuidv4()
  next()
}

module.exports = CspStrategy
