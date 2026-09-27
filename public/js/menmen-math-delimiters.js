'use strict'

/** 去掉已有 $ / $$ / \\( \\) / \\[ \\] 包裹，只保留 LaTeX 核心 */
export function stripMathDelimiters (latex) {
  if (latex == null) return ''
  let s = String(latex).trim()
  if (/^\$\$[\s\S]+\$\$$/.test(s)) return s.slice(2, -2).trim()
  if (/^\$[^\n]+\$$/.test(s)) return s.slice(1, -1).trim()
  if (/^\\\([\s\S]*\\\)$/.test(s)) return s.replace(/^\\\(|\\\)$/g, '').trim()
  if (/^\\\[[\s\S]*\\\]$/.test(s)) return s.replace(/^\\\[|\\\]$/g, '').trim()
  return s
}

/** 当前行光标前后是否有非空文字 → 行内公式用 $ */
export function mathInsertIsInline (cm, cursor) {
  if (!cm || !cursor) return false
  const line = cm.getLine(cursor.line) || ''
  const before = line.slice(0, cursor.ch).trim()
  const after = line.slice(cursor.ch).trim()
  return !!(before || after)
}

/**
 * 仅公式、独占一行/块 → $$…$$（居中）；与正文同行 → $…$
 * @param {string} latex
 * @param {{ inline?: boolean }} opts — inline true 强制 $；false 强制 $$
 */
export function wrapMathLatex (latex, opts) {
  const o = opts || {}
  const core = stripMathDelimiters(latex)
  if (!core) return ''
  const inline = o.inline === true
  if (inline) return '$' + core + '$'
  if (core.indexOf('\n') >= 0) return '$$\n' + core + '\n$$'
  return '$$\n' + core + '\n$$'
}

export function insertLatexHwBlock (latex, hash, opts) {
  const wrapped = wrapMathLatex(latex, opts)
  return `<!-- hw:${hash} -->\n${wrapped}`
}
