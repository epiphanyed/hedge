'use strict'

const assert = require('assert')
const { formatSceneFiles, guessSceneName, resolveDisplayScene } = require('../../lib/manimSceneGuess')

describe('manimSceneGuess', function () {
  it('guessSceneName finds first Scene subclass', function () {
    const code = `
from manim import *
class Demo(Scene):
    pass
class Other(ThreeDScene):
    pass
`
    assert.strictEqual(guessSceneName(code), 'Demo')
  })

  it('resolveDisplayScene prefers explicit scene', function () {
    const code = 'class Demo(Scene): pass'
    assert.strictEqual(resolveDisplayScene('Explicit', code, 'State'), 'Explicit')
    assert.strictEqual(resolveDisplayScene('', code, ''), 'Demo')
  })

  it('formatSceneFiles builds subtitle label', function () {
    assert.strictEqual(formatSceneFiles('Demo'), 'Demo.py · Demo.mp4')
    assert.strictEqual(formatSceneFiles(''), 'script.py · output.mp4')
  })
})
