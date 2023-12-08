const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const { timeout, flushConnections } = require('./helpers')

const Hyperswarm = require('..')

const BACKOFFS = [
  100,
  200,
  300,
  400
]

test('firewalled server - bad client is rejected', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

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
  await flushConnections(swarm1)

  t.alike(serverConnections, 0, 'server did not receive an incoming connection')

  await swarm1.destroy()
  await swarm2.destroy()
})

test('firewalled client - bad server is rejected', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)
  t.plan(2)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    firewall: remotePublicKey => {
      const firewalled = remotePublicKey.equals(swarm1.keyPair.publicKey)
      t.ok(firewalled, 'The peer got firewalled')
      return firewalled
    }
  })

  let clientConnections = 0
  swarm2.on('connection', () => clientConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await flushConnections(swarm2)

  t.alike(clientConnections, 0, 'client did not receive an incoming connection')

  await swarm1.destroy()
  await swarm2.destroy()
})

test('firewalled server - rejection does not trigger retry cascade', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

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

  t.alike(serverConnections, 0, 'server did not receive an incoming connection')
  t.alike(firewallCalls, 1, 'client retried mulitple times but server cached it')

  await swarm1.destroy()
  await swarm2.destroy()
})
