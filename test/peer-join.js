const test = require('brittle')
const createTestnet = require('@hyperswarm/testnet')

const Hyperswarm = require('..')

test('join peer - can establish direct connections to public keys', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const firstConnection = t.test('first connection')
  firstConnection.plan(2)

  const connections = t.test('connections')
  connections.plan(4)

  let s2Connected = false
  let s1Connected = false

  swarm2.on('connection', conn => {
    conn.on('error', noop)
    if (!s2Connected) {
      firstConnection.pass('swarm2 got its first connection')
      s2Connected = true
    }
    connections.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.on('error', noop)
    if (!s1Connected) {
      firstConnection.pass('swarm1 got its first connection')
      s1Connected = true
    }
    connections.pass('swarm1 got a connection')
  })

  swarm1.joinPeer(swarm2.keyPair.publicKey)
  await firstConnection

  for (const conn of swarm1.connections) {
    conn.end()
  }
  for (const conn of swarm2.connections) {
    conn.end()
  }
  await swarm1.flush() // Should reconnect

  await connections

  await swarm1.destroy()
  await swarm2.destroy()
})

test('join peer - attempt to connect to self is a no-op', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm = new Hyperswarm({ bootstrap })
  await swarm.listen()

  swarm.joinPeer(swarm.keyPair.publicKey)
  t.alike(swarm._queue.length, 0)

  await swarm.destroy()
})

test('leave peer - will stop reconnecting to previously joined peers', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const open = t.test('open')
  open.plan(2)

  const close = t.test('close')
  close.plan(2)

  swarm2.on('connection', conn => {
    conn.once('close', () => close.pass('swarm2 connection closed'))
    open.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.once('close', conn => close.pass('swarm1 connection closed'))
    open.pass('swarm1 got a connection')
  })

  swarm1.joinPeer(swarm2.keyPair.publicKey)

  await open

  swarm1.removeAllListeners('connection')
  swarm2.removeAllListeners('connection')

  swarm1.leavePeer(swarm2.keyPair.publicKey)
  t.alike(swarm1.explicitPeers.size, 0)
  t.alike(swarm1.connections.size, 1)
  t.alike(swarm2.connections.size, 1)

  swarm2.on('connection', conn => {
    t.fail('swarm2 got a connection after leave')
  })
  swarm1.on('connection', conn => {
    t.fail('swarm1 got a connection after leave')
  })

  for (const conn of swarm1.connections) {
    conn.end()
  }
  for (const conn of swarm2.connections) {
    conn.end()
  }
  await close

  t.alike(swarm1.connections.size, 0)
  t.alike(swarm2.connections.size, 0)

  await swarm1.destroy()
  await swarm2.destroy()
})

function noop () {}
