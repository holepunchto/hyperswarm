const Hyperswarm = require('..')
const { test, destroyAll, planPromise } = require('./helpers')

test('join peer - can establish direct connections to public keys', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const plan = planPromise(t, 4)
  const firstConnection = planPromise(t, 1)
  let s2Connected = false

  swarm2.on('connection', conn => {
    conn.on('error', noop)
    if (!s2Connected) {
      firstConnection.pass('swarm2 got its first connection')
      s2Connected = true
    }
    plan.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.on('error', noop)
    plan.pass('swarm1 got a connection')
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

  await plan

  await destroyAll(swarm1, swarm2)
})

test('join peer - attempt to connect to self is a no-op', async (bootstrap, t) => {
  const swarm = new Hyperswarm({ bootstrap })
  await swarm.listen()

  swarm.joinPeer(swarm.keyPair.publicKey)
  t.same(swarm._queue.length, 0)

  await destroyAll(swarm)
})

test('leave peer - will stop reconnecting to previously joined peers', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  await swarm2.listen() // Ensure that swarm2's public key is being announced

  const openPlan = planPromise(t, 2)
  const closePlan = planPromise(t, 2)

  swarm2.on('connection', conn => {
    conn.once('close', () => closePlan.pass('swarm2 connection closed'))
    openPlan.pass('swarm2 got a connection')
  })
  swarm1.on('connection', conn => {
    conn.once('close', conn => closePlan.pass('swarm1 connection closed'))
    openPlan.pass('swarm1 got a connection')
  })

  swarm1.joinPeer(swarm2.keyPair.publicKey)

  await openPlan

  swarm1.removeAllListeners('connection')
  swarm2.removeAllListeners('connection')

  swarm1.leavePeer(swarm2.keyPair.publicKey)
  t.same(swarm1.explicitPeers.size, 0)
  t.same(swarm1.connections.size, 1)
  t.same(swarm2.connections.size, 1)

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
  await closePlan

  t.same(swarm1.connections.size, 0)
  t.same(swarm2.connections.size, 0)

  await destroyAll(swarm1, swarm2)
})

function noop () {}
