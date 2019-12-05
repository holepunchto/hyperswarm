'use strict'
const { randomBytes } = require('crypto')
const { test } = require('tap')
const { once, timeout } = require('nonsynchronous')
const { dhtBootstrap } = require('./util')
const hyperswarm = require('../swarm')
const net = require('net')

test('maxServerSockets defaults to Infinity', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const { maxServerSockets } = swarm
  is(maxServerSockets, Infinity)
  swarm.destroy()
})

test('maxServerSockets option controls maximum incoming sockets', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap, maxServerSockets: 9 })
  const key = randomBytes(32)
  swarm.join(key, {
    announce: true,
    lookup: false
  })
  const swarms = []
  await once(swarm, 'listening')
  const { maxServerSockets } = swarm
  is(maxServerSockets, 9)
  for (var i = 0; i < maxServerSockets; i++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await once(s, 'listening')
    await once(swarm, 'connection')
  }

  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  swarm.once('connection', () => fail('connection should not be emitted after max peers is reached'))
  await timeout(150) // allow time for a potential connection event
  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})

test('after maxServerSockets is exceeded, new incoming sockets are refused until server socket count is below threshhold again', async ({ is, fail }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxServerSockets: 8
  })

  const key = randomBytes(32)
  const swarms = []
  const { maxServerSockets } = swarm
  is(maxServerSockets, 8)
  swarm.join(key, {
    announce: true,
    lookup: false
  })
  is(swarm.serverSockets, 0)
  await once(swarm, 'listening')
  for (var n = 0; n < maxServerSockets; n++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await once(s, 'listening')
    await once(swarm, 'connection')
  }
  is(swarm.serverSockets, maxServerSockets)
  swarms[0].destroy()
  await once(swarms[0], 'close')
  await once(swarm, 'disconnection')
  is(swarm.peers, maxServerSockets - 1)
  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  await once(swarm, 'connection')

  is(swarm.serverSockets, maxServerSockets)

  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }
  closeDht(swarm, swarm2, ...swarms)
})

test('maxServerSockets is actually a soft limit, the absolute hard limit is double maxServerSockets', async ({ is, fail }) => {
  delete require.cache[require.resolve('../lib/queue')]
  delete require.cache[require.resolve('..')]
  const { PeerQueue } = require('../lib/queue')
  const { add } = PeerQueue.prototype
  PeerQueue.prototype.add = function (peer) {
    // insert fake referrer to trigger udp connections
    peer.referrer = {}
    return add.call(this, peer)
  }
  delete require.cache[require.resolve('@hyperswarm/network')]
  const { connect } = net
  net.connect = () => {
    // zombie client socket so that utp always wins
    return net.Socket()
  }

  var hyperswarm = require('../swarm')
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm = hyperswarm({
    bootstrap,
    maxServerSockets: 4
  })

  const key = randomBytes(32)
  const swarms = []
  const { maxServerSockets } = swarm
  is(maxServerSockets, 4)
  swarm.on('connection', c => c.write('hi'))
  swarm.join(key, {
    announce: true,
    lookup: false
  })
  is(swarm.serverSockets, 0)
  await once(swarm, 'listening')
  for (var n = 0; n < maxServerSockets; n++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await once(s, 'listening')
    // fake holepunch ability
    s.network.discovery.holepunch = (peer, cb) => setImmediate(cb)
    // fake utp connection
    await once(swarm, 'connection')
  }

  is(swarm.serverSockets, maxServerSockets)

  delete require.cache[require.resolve('../lib/queue')]
  delete require.cache[require.resolve('..')]
  delete require.cache[require.resolve('@hyperswarm/network')]
  net.connect = connect
  hyperswarm = require('../swarm')
  for (var c = 0; c < maxServerSockets; c++) {
    const s = hyperswarm({ bootstrap })
    swarms.push(s)
    s.join(key, {
      announce: false,
      lookup: true
    })
    await once(s, 'listening')
    await once(swarm, 'connection')
  }

  // maxServerSockers have been exceeded by double
  // because now both utp and tcp have reached max connections
  is(swarm.serverSockets, maxServerSockets * 2)
  const swarm2 = hyperswarm({ bootstrap })
  swarm2.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm2, 'listening')

  swarm.once('connection', (_, info) => {
    fail('connection should not be emitted after double max server connections is reached')
  })
  await timeout(200)
  is(swarm.serverSockets, maxServerSockets * 2) // hard server conn limit
  swarm2.leave(key)
  swarm.leave(key)
  for (const s of swarms) {
    s.leave(key)
  }

  closeDht(swarm, swarm2, ...swarms)
  setImmediate(() => process.exit(0)) // haxx exit the process so we don't have to wait for utp timeouts ... maybe something we can improve in utp?
})
