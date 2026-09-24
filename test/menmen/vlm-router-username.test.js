'use strict'

const assert = require('assert')
const menmenPerm = require('../../lib/menmen-perm')

describe('vlmRouter commit username', function () {
  it('getUsernameFromUser uses profile.username (not Sequelize user.name)', function () {
    const user = {
      id: 1,
      profile: JSON.stringify({ username: 'alice' })
    }
    assert.strictEqual(menmenPerm.getUsernameFromUser(user), 'alice')
    assert.strictEqual(menmenPerm.getUsernameFromUser({ id: 1, name: 'wrong' }), null)
  })
})
