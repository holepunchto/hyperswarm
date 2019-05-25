'use strict'
const { test } = require('tap')
const { whenify, immediate, timeout } = require('./util')
const bulkTimer = require('../lib/bulk-timer')

test('bulk timer queue', async ({ is, same }) => {
  const timer = whenify(bulkTimer)
  const t = timer(100, function (batch) {
    is(batch.length, 2)
    same([ 1, 2 ], batch)
    t.destroy()
  })
  t.push(1)
  t.push(2)
  await timer.done()
})

test('bulk timer queue (async)', async ({ is, same }) => {
  const timer = whenify(bulkTimer)
  const t = timer(100, function (batch) {
    is(batch.length, 2)
    same([ 1, 2 ], batch)
    t.destroy()
  })
  t.push(1)
  await immediate
  t.push(2)
  await timer.done()
})

test('bulk timer queue different batch', async ({ is, same }) => {
  const timer = whenify(bulkTimer, { asyncOps: 2 })
  const t = timer(100, function (batch) {
    if (timer.count === 0) {
      is(batch.length, 1)
      same([ 1 ], batch)
      return
    }
    is(batch.length, 1)
    same([ 2 ], batch)
    t.destroy()
  })
  t.push(1)
  await timeout(75)
  t.push(2)
  await timer.done()
})
