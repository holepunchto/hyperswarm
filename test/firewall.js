const { timeout } = require('nonsynchronous')

const Hyperswarm = require('..')
const { test, destroyAll } = require('./helpers')

const CONNECTION_TIMEOUT = 100
const BACKOFFS = [
  100,
  200,
  300
]

test('firewalled server - bad client is rejected', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    firewall: remotePublicKey => {
      return remotePublicKey.equals(swarm1.keyPair.publicKey)
    }
  })

  let serverConnections = 0
  swarm2.on('connection', () => serverConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm2.join(topic, { client: false, server: true }).flushed()

  swarm1.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)

  t.same(serverConnections, 0, 'server did not receive an incoming connection')

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('firewalled client - bad server is rejected', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    firewall: remotePublicKey => {
      return remotePublicKey.equals(swarm1.keyPair.publicKey)
    }
  })

  let clientConnections = 0
  swarm2.on('connection', () => clientConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()

  swarm2.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)

  t.same(clientConnections, 0, 'client did not receive an incoming connection')

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('firewalled server - rejection does not trigger retry cascade', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let firewallCalls = 0
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    firewall: remotePublicKey => {
      firewallCalls++
      return remotePublicKey.equals(swarm1.keyPair.publicKey)
    }
  })

  let serverConnections = 0
  swarm2.on('connection', () => serverConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm2.join(topic).flushed()

  swarm1.join(topic)

  await timeout(BACKOFFS[2] * 5) // Wait for many retries -- there should only be 3

  t.same(serverConnections, 0, 'server did not receive an incoming connection')
  t.same(firewallCalls, 1, 'client retried mulitple times but server cached it')

  await destroyAll(swarm1, swarm2)
  t.end()
})
