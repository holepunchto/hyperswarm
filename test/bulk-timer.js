'use strict'
const test = require('tape')

const BulkTimer = require('../lib/bulk-timer')

const TEST_INTERVAL = 100

test('bulk timer queue', async t => {
  t.plan(1)

  const timer = new BulkTimer(TEST_INTERVAL, batch => {
    t.same(batch, [1, 2])
  })

  timer.add(1)
  timer.add(2)

  await waitForCalls(1)
  timer.destroy()
})

test('bulk timer queue (async)', async t => {
  t.plan(1)

  const timer = new BulkTimer(TEST_INTERVAL, batch => {
    t.same(batch, [1, 2])
    timer.destroy()
  })

  timer.add(1)
  await new Promise(resolve => setImmediate(resolve))
  timer.add(2)

  await waitForCalls(1)
})

test('bulk timer queue different batch', async t => {
  t.plan(2)

  let calls = 0
  const timer = new BulkTimer(TEST_INTERVAL, batch => {
    if (calls++ === 0) {
      t.same(batch, [1])
      return
    }
    t.same(batch, [2])
    timer.destroy()
  })

  timer.add(1)
  await waitForCalls(1)

  timer.add(2)
  await waitForCalls(1)
})

test('bulk timer - nothing pending', async t => {
  let calls = 0
  const timer = new BulkTimer(TEST_INTERVAL, () => calls++)

  timer.add(1)
  await waitForCalls(1) // nothing should be pending after this
  t.same(calls, 1)

  await waitForCalls(1)
  t.same(calls, 1)

  timer.destroy()
  t.end()
})

function waitForCalls (n) {
  return new Promise(resolve => setTimeout(resolve, n * (TEST_INTERVAL * 1.5)))
}
