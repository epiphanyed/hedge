'use strict'

/**
 * Markdown-it 插件：行内 #MEN-101 渲染为 issue 徽章（Menmen-Issue §8.3）
 */
module.exports = function issueBadgePlugin(md) {
  function rebuildInlineChildren(children, Token) {
    const newChildren = []
    children.forEach(function (child) {
      if (child.type !== 'text' || !child.content) {
        newChildren.push(child)
        return
      }
      const text = child.content
      let lastIndex = 0
      let match
      const regex = /#([A-Z][A-Z0-9]*-\d+)/g
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          const t = new Token('text', '', 0)
          t.content = text.slice(lastIndex, match.index)
          newChildren.push(t)
        }
        const htmlToken = new Token('html_inline', '', 0)
        htmlToken.content =
          '<span class="issue-badge" data-issue-key="' +
          match[1] +
          '" title="Menmen Issue">' +
          match[1] +
          '</span>'
        newChildren.push(htmlToken)
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < text.length) {
        const t = new Token('text', '', 0)
        t.content = text.slice(lastIndex)
        newChildren.push(t)
      }
    })
    return newChildren
  }

  function replaceBadges(state) {
    const Token = state.Token
    state.tokens.forEach(function (token) {
      if (token.type === 'inline' && token.children && token.children.length) {
        token.children = rebuildInlineChildren(token.children, Token)
      }
    })
  }

  md.core.ruler.push('issue_badge', replaceBadges)
}
