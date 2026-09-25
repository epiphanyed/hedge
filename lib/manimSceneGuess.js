'use strict'

function guessSceneName (code) {
  if (!code) return ''
  const re = /class\s+([A-Za-z_]\w*)\s*\([^)]*\b\w*Scene\b[^)]*\)/g
  const match = re.exec(code)
  return match ? match[1] : ''
}

function resolveDisplayScene (explicitScene, code, stateScene) {
  return (explicitScene || stateScene || guessSceneName(code) || '').trim()
}

function formatSceneFiles (sceneName) {
  const name = sceneName || ''
  if (!name) return 'script.py · output.mp4'
  return `${name}.py · ${name}.mp4`
}

module.exports = {
  guessSceneName,
  resolveDisplayScene,
  formatSceneFiles
}
