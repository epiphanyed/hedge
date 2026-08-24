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
    dragToc: translate('Drag to move'),
    moreOnline: translate('%s more online'),
    enterFullscreen: translate('Fullscreen'),
    exitFullscreen: translate('Exit fullscreen'),
    viewLayout: translate('View layout'),
    layoutCentered: translate('Centered'),
    layoutWide: translate('Wide')
  }
}

module.exports = {
  buildMenmenI18n
}
