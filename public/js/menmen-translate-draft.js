'use strict'

(function () {
  function readQuery () {
    var params = new URLSearchParams(window.location.search)
    return {
      translateDraft: params.get('translateDraft') === '1',
      sourceLang: params.get('sourceLang') || '',
      targetLang: params.get('lang') || ''
    }
  }

  function langLabel (code) {
    if (!code) return ''
    var map = { 'zh-cn': '简体中文', en: 'English' }
    return map[code] || code
  }

  function ensureBanner (cfg) {
    if (!cfg.translateDraft || !cfg.sourceLang) return
    if (document.getElementById('menmen-translate-draft-banner')) return
    var i18n = window.__menmenI18n || {}
    var template = i18n.translateFromDraft || 'Translating draft from {sourceLang}'
    var text = template.replace('{sourceLang}', langLabel(cfg.sourceLang))
    if (cfg.targetLang) {
      text += ' → ' + langLabel(cfg.targetLang)
    }
    var bar = document.createElement('div')
    bar.id = 'menmen-translate-draft-banner'
    bar.className = 'menmen-translate-draft-banner'
    bar.setAttribute('role', 'status')
    bar.textContent = text
    document.body.insertBefore(bar, document.body.firstChild)
    document.body.classList.add('menmen-has-translate-draft-banner')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { ensureBanner(readQuery()) })
  } else {
    ensureBanner(readQuery())
  }
})()
