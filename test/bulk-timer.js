const test = require('brittle')

const BulkTimer = require('../lib/bulk-timer')

const TEST_INTERVAL = 500
const TEST_TIMEOUT = TEST_INTERVAL * 5

test('bulk timer queue', { timeout: TEST_TIMEOUT }, async (t) => {
  const queued = nextBatch()
  const timer = new BulkTimer(TEST_INTERVAL, (batch) => {
    queued.resolve(batch)
  })

  t.teardown(() => timer.destroy())

  timer.add(1)
  timer.add(2)

  t.alike(await queued.promise, [1, 2])
})

test('bulk timer queue (async)', { timeout: TEST_TIMEOUT }, async (t) => {
  const queued = nextBatch()
  const timer = new BulkTimer(TEST_INTERVAL, (batch) => {
    queued.resolve(batch)
  })

  t.teardown(() => timer.destroy())

  timer.add(1)
  await new Promise((resolve) => setImmediate(resolve))
  timer.add(2)

  t.alike(await queued.promise, [1, 2])
})

test('bulk timer queue different batch', { timeout: TEST_TIMEOUT }, async (t) => {
  let calls = 0
  const first = nextBatch()
  const second = nextBatch()
  const timer = new BulkTimer(TEST_INTERVAL, (batch) => {
    if (calls++ === 0) {
      first.resolve(batch)
      return
    }
    second.resolve(batch)
  })

  t.teardown(() => timer.destroy())

  timer.add(1)
  t.alike(await first.promise, [1])

  timer.add(2)
  t.alike(await second.promise, [2])
})

test('bulk timer - nothing pending', { timeout: TEST_TIMEOUT }, async (t) => {
  const first = nextBatch()
  let calls = 0
  const timer = new BulkTimer(TEST_INTERVAL, () => {
    if (++calls === 1) first.resolve()
  })

  t.teardown(() => timer.destroy())

  timer.add(1)
  await first.promise
  t.is(calls, 1)

  await timeout(TEST_INTERVAL * 2)
  t.is(calls, 1)
})

function nextBatch() {
  let resolve = null
  const promise = new Promise((res) => {
    resolve = res
  })

  return { promise, resolve }
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
