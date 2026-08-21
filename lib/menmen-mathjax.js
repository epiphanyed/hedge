'use strict'

function noteNeedsMathJax (content) {
  if (!content || typeof content !== 'string') return false
  if (/\$\$[\s\S]+?\$\$/.test(content)) return true
  if (/(^|[^\\])\$(?!\$)[^\$\n]+?\$/.test(content)) return true
  if (/\\[\(\[]/.test(content)) return true
  return false
}

module.exports = {
  noteNeedsMathJax
}
