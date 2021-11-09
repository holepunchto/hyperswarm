const test = require('brittle')

const Hyperswarm = require('..')
const { createTestDHT, destroy } = require('./helpers')

test.solo('join peer - can establish direct connections to public keys', async t => {
  const bootstrap = await createTestDHT(t)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const allConnections = t.test('all connections established')
  const firstConnection = t.test('first connection established')
  allConnections.plan(4)
  firstConnection.plan(1)

  let s2Connected = false
  swarm2.on('connection', conn => {
    conn.on('error', noop)
    if (!s2Connected) {
      console.log(1)
      firstConnection.pass('swarm2 got its first connection')
      console.log(2)
      s2Connected = true
    }
    allConnections.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.on('error', noop)
    allConnections.pass('swarm1 got a connection')
  })

  swarm1.joinPeer(swarm2.keyPair.publicKey)

  try {
    console.log('before first connection resolved')
    await firstConnection
    console.log('after first connection resolved')
  } catch (err) {
    console.log("ERR", err)
  }

  for (const conn of swarm1.connections) {
    conn.end()
  }
  for (const conn of swarm2.connections) {
    conn.end()
  }
  await swarm1.flush() // Should reconnect

  await allConnections

  console.log('after all connections')

  await destroy(swarm1, swarm2)
})

test('join peer - attempt to connect to self is a no-op', async t => {
  const bootstrap = await createTestDHT(t)

  const swarm = new Hyperswarm({ bootstrap })
  await swarm.listen()

  swarm.joinPeer(swarm.keyPair.publicKey)
  t.is(swarm._queue.length, 0)

  await destroy(swarm)
})

test('leave peer - will stop reconnecting to previously joined peers', async t => {
  const bootstrap = await createTestDHT(t)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const connectionsOpened = test('all swarm connections were opened')
  const connectionsClosed = test('all swarm connections were closed')
  connectionsOpened.plan(2)
  connectionsClosed.plan(2)

  swarm2.on('connection', conn => {
    conn.once('close', () => connectionsClosed.pass('swarm2 connection closed'))
    connectionsOpened.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.once('close', conn => connectionsClosed.pass('swarm1 connection closed'))
    connectionsOpened.pass('swarm1 got a connection')
  })

  swarm1.joinPeer(swarm2.keyPair.publicKey)

  await connectionsOpened

  swarm1.removeAllListeners('connection')
  swarm2.removeAllListeners('connection')

  swarm1.leavePeer(swarm2.keyPair.publicKey)
  t.is(swarm1.explicitPeers.size, 0)
  t.is(swarm1.connections.size, 1)
  t.is(swarm2.connections.size, 1)

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

  await connectionsClosed

  t.is(swarm1.connections.size, 0)
  t.is(swarm2.connections.size, 0)

  await destroy(swarm1, swarm2)
})

function noop () {}
