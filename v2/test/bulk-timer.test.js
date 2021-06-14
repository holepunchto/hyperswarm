'use strict'
const { test } = require('tap')
const { whenify, immediate, timeout, done, count } = require('nonsynchronous')
const bulkTimer = require('../lib/bulk-timer')

test('bulk timer queue', async ({ is, same }) => {
  const timer = whenify(bulkTimer)
  const t = timer(100, (batch) => {
    is(batch.length, 2)
    same([ 1, 2 ], batch)
    t.destroy()
  })
  t.push(1)
  t.push(2)
  await timer[done]
})

test('bulk timer queue (async)', async ({ is, same }) => {
  const timer = whenify(bulkTimer)
  const t = timer(100, (batch) => {
    is(batch.length, 2)
    same([ 1, 2 ], batch)
    t.destroy()
  })
  t.push(1)
  await immediate()
  t.push(2)
  await timer[done]
})

test('bulk timer queue different batch', async ({ is, same }) => {
  const timer = whenify(bulkTimer, { asyncOps: 2 })
  const t = timer(100, (batch) => {
    if (timer[count] === 0) {
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
  await timer[done]
})

test('bulk timer – nothing pending', async ({ is }) => {
  var called = false
  var runs = 0
  const t = bulkTimer(100, function () {
    called = !!runs++
  })
  t.push(1) // this triggers the interval
  is(runs, 0)
  await timeout(200) // wait for pending to clear
  is(runs, 1)
  await timeout(200)
  is(called, false)
  t.destroy()
})
