'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { timeout } = require('nonsynchronous')
const hyperswarm = require('../')

test('whitelist default', async ({ is, fail }) => {
  const key = randomBytes(32)
  const swarmA = hyperswarm()
  const swarmB = hyperswarm()
  let emitted = false

  swarmA.once('peer', (peer, details) => {
    emitted = true
  })

  swarmA.on('peer-rejected', (peer, details) => {
    if (details.reason === 'whitelist') {
      fail('peer-rejected event should not be emitted with default whitelist')
    }
  })

  swarmA.join(key, { lookup: true, announce: false })
  swarmB.join(key, { lookup: false, announce: true })

  await timeout(250)
  is(emitted, true)

  swarmA.destroy()
  swarmB.destroy()
})

test('whitelist hosts + peer-rejected', async ({ is, fail }) => {
  const key = randomBytes(32)
  const swarmA = hyperswarm({ whitelist: (peer) => peer.host === '0.0.0.256' })
  const swarmB = hyperswarm()
  let rejected = false

  swarmA.on('peer', (peer, details) => {
    fail('peer event should not be emitted when host is not allowed')
  })

  swarmA.on('peer-rejected', (peer, details) => {
    // basic confirmation
    if (details.reason === 'whitelist') {
      rejected = true
    }
  })

  swarmA.join(key, { lookup: true, announce: false })
  swarmB.join(key, { lookup: false, announce: true })

  await timeout(250)
  is(rejected, true)

  swarmA.destroy()
  swarmB.destroy()
})

test('whitelist disallow remote', async ({ fail }) => {
  const key = randomBytes(32)
  const swarmA = hyperswarm({ whitelist: (peer) => peer.local })
  const swarmB = hyperswarm()

  swarmA.on('peer', (peer) => {
    if (!peer.local) {
      fail('connected peer should be local')
    }
  })

  swarmA.join(key, { lookup: true, announce: false })
  swarmB.join(key, { lookup: false, announce: true })

  await timeout(1000)

  swarmA.destroy()
  swarmB.destroy()
})
