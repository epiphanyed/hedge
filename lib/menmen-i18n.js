'use strict'

function buildMenmenI18n (translate) {
  return {
    tableOfContents: translate('Table of Contents'),
    expandAll: translate('Expand all'),
    collapseAll: translate('Collapse all'),
    backToTop: translate('Back to top'),
    goToBottom: translate('Go to bottom'),
    expandCollapseSection: translate('Expand or collapse section'),
    collapseToc: translate('Collapse table of contents'),
    expandToc: translate('Expand table of contents'),
    moreOnline: translate('%s more online'),
    enterFullscreen: translate('Fullscreen'),
    exitFullscreen: translate('Exit fullscreen')
  }
}

module.exports = {
  buildMenmenI18n
}
