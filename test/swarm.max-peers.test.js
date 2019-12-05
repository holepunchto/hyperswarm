'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once, timeout } = require('nonsynchronous')
const { dhtBootstrap } = require('./util')
const hyperswarm = require('../swarm')

test('maxPeers defaults to 24', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const { maxPeers } = swarm
  is(maxPeers, 24)
  swarm.destroy()
})

test('allows a maximum amount of peers (maxPeers option - client sockets)', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxClientSockets: 32 // increase client socket beyond max peers count
  })
  const key = randomBytes(32)
  const swarms = []
  const { maxPeers } = swarm // default amount of maxPeers is 24
  for (var i = 0; i < maxPeers; i++) {
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
  is(swarm.peers, 0)
  is(swarm.open, true)
  await once(swarm, 'listening')
  for (var c = 0; c < maxPeers; c++) {
    await once(swarm, 'connection')
  }
  is(swarm.peers, maxPeers)
  is(swarm.open, false)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow time for a potential connection event
  is(swarm.peers, maxPeers)
  is(swarm.open, false)
  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})

test('allows a maximum amount of peers (maxPeers option - server sockets)', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxPeers: 8
  })
  const key = randomBytes(32)
  swarm.join(key, {
    announce: true,
    lookup: false
  })
  const swarms = []
  await once(swarm, 'listening')
  const { maxPeers } = swarm
  is(maxPeers, 8)
  is(swarm.peers, 0)
  is(swarm.open, true)
  for (var i = 0; i < maxPeers; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await Promise.all([
      once(s, 'listening'),
      once(swarm, 'connection')
    ])
  }
  is(swarm.peers, maxPeers)
  is(swarm.open, false)
  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => fail('connection should not be emitted after max peers is reached'))
  await timeout(150) // allow time for a potential connection event
  is(swarm.peers, maxPeers)
  is(swarm.open, false)
  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})

test('allows a maximum amount of peers (maxPeers option - client sockets and server sockets)', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap
  })
  const key = randomBytes(32)
  const swarms = []
  const { maxPeers } = swarm // default amount of maxPeers is 24
  const clientPeers = maxPeers / 2
  const lookupPeers = maxPeers / 2
  is(swarm.peers, 0)
  is(swarm.open, true)
  for (var i = 0; i < clientPeers; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }
  swarm.join(key, {
    announce: true,
    lookup: true
  })
  is(swarm.peers, 0)
  is(swarm.open, true)
  await once(swarm, 'listening')
  for (var c = 0; c < clientPeers; c++) {
    await once(swarm, 'connection')
  }

  is(swarm.peers, clientPeers)
  is(swarm.open, true)

  for (var n = 0; n < lookupPeers; n++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await Promise.all([
      await once(s, 'listening'),
      await once(swarm, 'connection')
    ])
  }

  is(swarm.peers, maxPeers)
  is(swarm.open, false)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow time for a potential connection event
  is(swarm.peers, maxPeers)
  is(swarm.open, false)
  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})

test('maxPeers option sets the maximum amount of peers that a swarm can connect to be or be connected to', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxPeers: 8
  })
  const key = randomBytes(32)
  const swarms = []
  const { maxPeers } = swarm
  is(maxPeers, 8)
  is(swarm.peers, 0)
  is(swarm.open, true)
  const announcingPeers = maxPeers / 2
  const lookupPeers = maxPeers / 2
  for (var i = 0; i < announcingPeers; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: true,
      lookup: false
    })
    await once(s, 'listening')
  }

  swarm.join(key, {
    announce: true,
    lookup: true
  })
  is(swarm.peers, 0)
  is(swarm.open, true)
  await once(swarm, 'listening')
  for (var c = 0; c < announcingPeers; c++) {
    await once(swarm, 'connection')
  }

  is(swarm.peers, announcingPeers)
  is(swarm.open, true)

  for (var n = 0; n < lookupPeers; n++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await Promise.all([
      once(s, 'listening'),
      once(swarm, 'connection')
    ])
  }
  is(swarm.peers, maxPeers)
  is(swarm.open, false)

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => {
    fail('connection should not be emitted after max peers is reached')
  })
  await timeout(200) // allow time for a potential connection event
  is(swarm.peers, maxPeers)
  is(swarm.open, false)

  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})
