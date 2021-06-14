'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once } = require('nonsynchronous')
const { dhtBootstrap } = require('./util')
const hyperswarm = require('../swarm')

// this test is in its own file to avoid issues with process resources
// being consumed by prior tests, leading to sometimes odd behaviour in node

test('after maxPeers is exceeded, new peers can connect once existing peers have disconnected and peer count is below threshhold again', async ({ is }) => {
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

  swarms[0].destroy()
  await Promise.all([
    once(swarms[0], 'close'),
    once(swarm, 'disconnection')
  ])

  is(swarm.peers, maxPeers - 1)
  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await Promise.all([
    once(swarm2, 'listening'),
    once(swarm, 'connection')
  ])

  is(swarm.peers, maxPeers)
  is(swarm.open, false)

  swarm2.destroy()
  swarm.leave(key)
  swarm.destroy()
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(...swarms)
})
