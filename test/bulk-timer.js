const tape = require('tape')
const timer = require('../lib/bulk-timer')

tape('bulk timer queue', function (assert) {
  const t = timer(100, function (batch) {
    assert.same(batch.length, 2)
    assert.same([ 1, 2 ], batch)
    assert.end()
    t.destroy()
  })

  t.push(1)
  t.push(2)
})

tape('bulk timer queue (async)', function (assert) {
  const t = timer(100, function (batch) {
    assert.same(batch.length, 2)
    assert.same([ 1, 2 ], batch)
    assert.end()
    t.destroy()
  })

  t.push(1)
  setImmediate(() => t.push(2))
})

tape('bulk timer queue different batch', function (assert) {
  let runs = 0
  const t = timer(100, function (batch) {
    if (runs++ === 0) {
      assert.same(batch.length, 1)
      assert.same([ 1 ], batch)
    } else {
      assert.same(batch.length, 1)
      assert.same([ 2 ], batch)
      t.destroy()
      assert.end()
    }
  })

  t.push(1)
  setTimeout(() => t.push(2), 75)
})
