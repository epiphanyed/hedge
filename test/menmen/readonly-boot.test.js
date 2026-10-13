'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  queryRequestsMenmenReadonly,
  queryAllowsMenmenEdit,
  searchRequestsMenmenReadonly,
  appendRequestQuery
} = require('../../lib/menmen-readonly-boot')

describe('menmen-readonly-boot', function () {
  it('fail-closed: only canEdit=1 is editable; missing/0 is readonly', function () {
    assert.strictEqual(queryAllowsMenmenEdit({ canEdit: '1' }), true)
    assert.strictEqual(queryRequestsMenmenReadonly({ canEdit: '1' }), false)
    assert.strictEqual(queryRequestsMenmenReadonly({ canEdit: '0' }), true)
    assert.strictEqual(queryRequestsMenmenReadonly({ canEdit: ['0'] }), true)
    assert.strictEqual(queryRequestsMenmenReadonly({}), true)
    assert.strictEqual(queryRequestsMenmenReadonly(null), true)
  })

  it('search string fail-closed unless canEdit=1', function () {
    assert.strictEqual(searchRequestsMenmenReadonly('?canEdit=1'), false)
    assert.strictEqual(searchRequestsMenmenReadonly('?canEdit=0&mode=view'), true)
    assert.strictEqual(searchRequestsMenmenReadonly(''), true)
  })

  it('appendRequestQuery keeps canEdit across alias redirect', function () {
    const loc = 'http://hd.example/a_1'
    assert.strictEqual(
      appendRequestQuery({ originalUrl: '/n123?canEdit=0&mode=view' }, loc),
      'http://hd.example/a_1?canEdit=0&mode=view'
    )
    assert.strictEqual(appendRequestQuery({ originalUrl: '/n123' }, loc), loc)
  })

  it('showNote passes readonly/canEdit and preserves query on alias redirect', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/web/note/controller.js'), 'utf8')
    assert.ok(src.includes('queryRequestsMenmenReadonly'))
    assert.ok(src.includes('queryAllowsMenmenEdit'))
    assert.ok(src.includes('appendRequestQuery'))
    assert.ok(src.includes('menmenCanEdit: queryAllowsMenmenEdit(req.query)'))
  })

  it('hedgedoc.ejs defaults to readonly unless canEdit=1, before header paint', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../public/views/hedgedoc.ejs'), 'utf8')
    assert.ok(src.includes("menmenBodyClass.push('menmen-can-edit')"))
    assert.ok(src.includes("menmenBodyClass.push('menmen-readonly')"))
    assert.ok(src.includes("v==='1'"))
    const headerIdx = src.indexOf("include('hedgedoc/header')")
    const bootIdx = src.indexOf("v==='1'")
    assert.ok(bootIdx >= 0 && bootIdx < headerIdx)
  })

  it('head inline CSS hides mode toggles unless menmen-can-edit', function () {
    const head = fs.readFileSync(path.join(__dirname, '../../public/views/hedgedoc/head.ejs'), 'utf8')
    assert.ok(head.includes('body.menmen-custom-ui .ui-mode-group'))
    assert.ok(head.includes('menmen-can-edit'))
    const css = fs.readFileSync(path.join(__dirname, '../../public/css/menmen-custom.css'), 'utf8')
    assert.ok(css.includes('body.menmen-custom-ui .ui-mode-group'))
    assert.ok(css.includes('menmen-can-edit:not(.menmen-readonly) .ui-mode-group'))
  })

  it('index.js fail-closed boots readonly unless canEdit=1', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../public/js/index.js'), 'utf8')
    assert.ok(src.includes('function urlAllowsMenmenEdit'))
    assert.ok(src.includes('let menmenReadonly = !urlAllowsMenmenEdit()'))
    assert.ok(src.includes("applyMenmenClass('menmen-can-edit'"))
  })
})
