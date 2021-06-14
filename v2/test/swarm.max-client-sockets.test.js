'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once, timeout } = require('nonsynchronous')
const { dhtBootstrap } = require('./util')
const hyperswarm = require('../swarm')

test('maxClientSockets defaults to Infinity', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const { maxClientSockets } = swarm
  is(maxClientSockets, Infinity)
  swarm.destroy()
})

test('maxClientSockets option controls maximum amount of client sockets', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap, maxClientSockets: 9 })
  const key = randomBytes(32)
  const swarms = []

  const { maxClientSockets } = swarm
  is(maxClientSockets, 9)
  for (var i = 0; i < maxClientSockets; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }

  swarm.join(key, {
    announce: false,
    lookup: true
  })
  is(swarm.clientSockets, 0)
  await once(swarm, 'listening')
  for (var c = 0; c < maxClientSockets; c++) {
    await once(swarm, 'connection')
  }
  is(swarm.clientSockets, maxClientSockets)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow ample time for a potential connection event
  is(swarm.clientSockets, maxClientSockets)
  swarm2.destroy()
  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(...swarms)
})

test('after maxClientSockets is exceeded, client sockets can connect to peers after client socket count is below threshhold again', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxClientSockets: 8
  })

  const key = randomBytes(32)
  const swarms = []
  const { maxClientSockets } = swarm
  is(maxClientSockets, 8)
  for (var i = 0; i < maxClientSockets + 1; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }

  swarm.join(key, {
    announce: false,
    lookup: true
  })
  is(swarm.clientSockets, 0)
  await once(swarm, 'listening')
  for (var c = 0; c < maxClientSockets; c++) {
    await once(swarm, 'connection')
  }
  is(swarm.clientSockets, maxClientSockets)
  const peer = swarms.shift()
  peer.destroy()
  await once(peer, 'close')
  await once(swarm, 'disconnection')
  is(swarm.clientSockets, maxClientSockets - 1)
  // should automatically connect to the extra announcing peer
  await once(swarm, 'connection')

  is(swarm.clientSockets, maxClientSockets)

  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(...swarms)
})
