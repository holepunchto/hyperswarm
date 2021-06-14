'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once } = require('nonsynchronous')
const { dhtBootstrap } = require('./util')
const hyperswarm = require('../')

test('validatePeer default', async () => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  await once(swarm2, 'peer')
  swarm1.leave(key)
  swarm2.leave(key)
  swarm1.destroy()
  swarm2.destroy()
  closeDht()
})

test('validatePeer host + peer-rejected event', async () => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap, validatePeer: (peer) => peer.host === '0.0.0.256' })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  await once(swarm2, 'peer-rejected')
  swarm1.leave(key)
  swarm2.leave(key)
  swarm1.destroy()
  swarm2.destroy()
  closeDht()
})

test('validatePeer disallow remote', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap, validatePeer: (peer) => peer.local })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ peer ] = await once(swarm2, 'peer')
  is(peer.local, true)
  swarm1.leave(key)
  swarm2.leave(key)
  swarm1.destroy()
  swarm2.destroy()
  closeDht()
})
