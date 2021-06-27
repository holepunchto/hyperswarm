'use strict'
const test = require('tape')
const crypto = require('hypercore-crypto')

const PeerQueue = require('../lib/queue')
const PeerInfo = require('../lib/peer-info')

const BACKOFFS = [
  100,
  300,
  500
]

test('peer queue - add / shift', t => {
  const q = new PeerQueue()
  const peerInfo = randomPeerInfo()
  q.queue(peerInfo)

  t.same(q.shift(), peerInfo)
  t.same(q.shift(), null)

  q.destroy()
  t.end()
})

test('peer queue - queue calls onreadable after add', async t => {
  t.plan(1)

  const q = new PeerQueue({
    onreadable: () => {
      t.ok('onreadable was called')
    }
  })

  q.queue(randomPeerInfo())
  await waitForBackoff(BACKOFFS[0])
})

test('peer queue - queue calls onreadable after a reinsertion', async t => {
  let calls = 0
  const q = new PeerQueue({
    backoffs: BACKOFFS,
    onreadable: () => calls++
  })

  q.queue(randomPeerInfo()) // will trigger first onreadable

  const peerInfo = q.shift()
  quickRetry(peerInfo)
  q.queueLater(peerInfo) // will trigger second after small backoff

  await waitForBackoff(BACKOFFS[0])
  t.same(calls, 2)

  q.destroy()
  t.end()
})

test('peer queue - requeue, quick retry', async t => {
  t.plan(1)

  let peerInfo = null
  const q = new PeerQueue({
    backoffs: BACKOFFS,
    onreadable: () => {
      if (!peerInfo) {
        peerInfo = q.shift()
        quickRetry(peerInfo)
        q.queueLater(peerInfo)
      } else {
        const p = q.shift()
        t.same(p, peerInfo)
      }
    }
  })

  q.queue(randomPeerInfo())
  await waitForBackoff(BACKOFFS[0])

  q.destroy()
})

test('peer queue - requeue, forget unresponsive', async t => {
  t.plan(2)

  let peerInfo = null
  const q = new PeerQueue({
    backoffs: BACKOFFS,
    onreadable: () => {
      if (!peerInfo) {
        peerInfo = q.shift()
        peerInfo.attempts = 5 // With 5 attempts, the peer should not be requeued
        q.queueLater(peerInfo)
      } else {
        t.fail('queue should not be readable again')
      }
    }
  })

  q.queue(randomPeerInfo())
  await waitForBackoff(BACKOFFS[2]) // Wait for a large backoff to elapse

  t.same(q._queue.length, 0)
  t.true(peerInfo)

  q.destroy()
})

test('peer queue - does not requeue banned peers', async t => {
  t.plan(2)

  let peerInfo = null
  const q = new PeerQueue({
    backoffs: BACKOFFS,
    onreadable: () => {
      if (!peerInfo) {
        peerInfo = q.shift()
        peerInfo.ban()
        q.queueLater(peerInfo)
      } else {
        t.fail('queue should not be readable again')
      }
    }
  })

  q.queue(randomPeerInfo())
  await waitForBackoff(BACKOFFS[2]) // Wait for a large backoff to elapse

  t.same(q._queue.length, 0)
  t.true(peerInfo)

  q.destroy()
})

test('peer queue - correct backoff timing, unproven peer', async t => {
  const q = new PeerQueue({
    backoffs: BACKOFFS
  })

  let peerInfo = randomPeerInfo()
  peerInfo.attempts = 1 // In practice, queueLater should be called after an initial queue

  q.queueLater(peerInfo)
  t.same(q._mTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[1])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._lTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[2])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._lTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[2])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._sTimer._pending.length, 0)
  t.same(q._mTimer._pending.length, 0)
  t.same(q._lTimer._pending.length, 0)

  q.destroy()
  t.end()
})

test('peer queue - correct backoff timing, proven peer', async t => {
  const q = new PeerQueue({
    backoffs: BACKOFFS
  })

  let peerInfo = randomPeerInfo()
  peerInfo.attempts = 1 // In practice, queueLater should be called after an initial queue
  peerInfo.proven = true

  q.queueLater(peerInfo)
  t.same(q._sTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[0])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._mTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[1])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._lTimer._pending.length, 1)

  await waitForBackoff(BACKOFFS[2])

  peerInfo = q.shift()
  peerInfo.attempts++

  q.queueLater(peerInfo)
  t.same(q._sTimer._pending.length, 0)
  t.same(q._mTimer._pending.length, 0)
  t.same(q._lTimer._pending.length, 0)

  q.destroy()
  t.end()
})

function waitForBackoff (ms) {
  return new Promise(resolve => setTimeout(resolve, ms * 1.5))
}

function randomPeerInfo () {
  return new PeerInfo({
    publicKey: crypto.randomBytes(32)
  })
}

function quickRetry (peerInfo) {
  peerInfo.proven = true
  peerInfo.reconnect(true)
  peerInfo.attempts = 1
}
