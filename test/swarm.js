const test = require('brittle')
const { timeout } = require('nonsynchronous')
const createTestnet = require('@hyperswarm/testnet')

const Hyperswarm = require('..')

const CONNECTION_TIMEOUT = 100
const BACKOFFS = [
  100,
  200,
  300
]

test('one server, one client - first connection', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const connected = t.test('connection')
  connected.plan(1)

  swarm2.on('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
    conn.end()
  })
  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  await connected

  await swarm1.destroy()
  await swarm2.destroy()
})

test('two servers - first connection', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const connected = t.test('connection')
  connected.plan(2)

  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
    connected.pass('swarm1')
    conn.end()
  })
  swarm2.on('connection', (conn) => {
    conn.on('error', noop)
    connected.pass('swarm2')
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')

  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  await connected

  await swarm1.destroy()
  await swarm2.destroy()
})

test('one server, one client - single reconnect', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  const reconnected = t.test('reconnection')
  reconnected.plan(2)

  let clientDisconnected = false
  let serverDisconnected = false

  swarm2.on('connection', (conn) => {
    if (!clientDisconnected) {
      clientDisconnected = true
      conn.on('error', noop)
      conn.destroy()
      return
    }
    reconnected.pass('client')
    conn.end()
  })
  swarm1.on('connection', (conn) => {
    if (!serverDisconnected) {
      serverDisconnected = true
      conn.on('error', noop)
      conn.destroy()
      return
    }
    reconnected.pass('server')
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await reconnected

  await swarm1.destroy()
  await swarm2.destroy()
})

test('one server, one client - maximum reconnects', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
    info.proven = false // Simulate a failing peer
    info.attempts = connections
    conn.on('error', noop)
    conn.destroy()
  })
  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout(BACKOFFS[2] * 4)
  t.is(connections, 3, 'client saw 3 retries')

  await swarm1.destroy()
  await swarm2.destroy()
})

test('one server, one client - banned peer does not reconnect', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
    info.ban(true)
    conn.on('error', noop)
    conn.destroy()
  })
  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout(BACKOFFS[2] * 2) // Wait for 2 long backoffs
  t.is(connections, 1, 'banned peer was not retried')

  await swarm1.destroy()
  await swarm2.destroy()
})

test('two servers, two clients - simple deduplication', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let s1Connections = 0
  let s2Connections = 0

  swarm1.on('connection', (conn) => {
    s1Connections++
    conn.on('error', noop)
  })
  swarm2.on('connection', (conn) => {
    s2Connections++
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  await timeout(250) // 250 ms will be enough for all connections to trigger

  t.is(s1Connections, 1)
  t.is(s2Connections, 1)

  await swarm1.destroy()
  await swarm2.destroy()
})

test('one server, two clients - topic multiplexing', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  let peerInfo = null
  swarm2.on('connection', (conn, info) => {
    clientConnections++
    peerInfo = info
    conn.on('error', noop)
  })

  swarm1.on('connection', (conn) => conn.on('error', noop))

  const topic1 = Buffer.alloc(32).fill('hello world')
  const topic2 = Buffer.alloc(32).fill('hi world')

  await swarm1.join(topic1, { client: false, server: true }).flushed()
  await swarm1.join(topic2, { client: false, server: true }).flushed()
  swarm2.join(topic1, { client: true, server: false })
  swarm2.join(topic2, { client: true, server: false })

  await timeout(250) // 250 ms will be enough for all connections to trigger

  t.is(clientConnections, 1)
  t.is(peerInfo.topics.length, 2)

  await swarm1.destroy()
  await swarm2.destroy()
})

test('one server, two clients - first connection', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })
  const swarm3 = new Hyperswarm({ bootstrap })

  const connected = t.test('connection')
  connected.plan(3)

  swarm1.on('connection', (conn) => {
    connected.pass('swarm1')
    conn.on('error', noop)
    conn.destroy()
  })
  swarm2.on('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
    conn.destroy()
  })
  swarm3.on('connection', (conn) => {
    connected.pass('swarm3')
    conn.on('error', noop)
    conn.destroy()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
  swarm3.join(topic, { server: false, client: true })

  await swarm2.flush()
  await swarm3.flush()

  await connected

  await swarm1.destroy()
  await swarm2.destroy()
  await swarm3.destroy()
})

test('one server, two clients - if a second client joins after the server leaves, they will not connect', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm3 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let serverConnections = 0
  swarm1.on('connection', (conn) => {
    serverConnections++
    conn.on('error', noop)
  })

  swarm2.on('connection', (conn) => conn.on('error', noop))
  swarm3.on('connection', (conn) => conn.on('error', noop))

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()

  swarm2.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.is(serverConnections, 1)

  await swarm1.leave(topic)
  swarm3.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.is(serverConnections, 1)

  await swarm1.destroy()
  await swarm2.destroy()
  await swarm3.destroy()
})

test('two servers, one client - refreshing a peer discovery instance discovers new server', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm3 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  swarm3.on('connection', (conn) => {
    clientConnections++
    conn.on('error', noop)
  })

  swarm1.on('connection', (conn) => conn.on('error', noop))
  swarm2.on('connection', (conn) => conn.on('error', noop))

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  const discovery = swarm3.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.is(clientConnections, 1)

  await swarm2.join(topic).flushed()
  await timeout(CONNECTION_TIMEOUT)
  t.is(clientConnections, 1)

  await discovery.refresh()
  await swarm3.flush()
  t.is(clientConnections, 2)

  await swarm1.destroy()
  await swarm2.destroy()
  await swarm3.destroy()
})

test('one server, one client - correct deduplication when a client connection is destroyed', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  let serverConnections = 0
  let clientData = 0
  let serverData = 0

  const RECONNECT_TIMEOUT = CONNECTION_TIMEOUT * 4

  swarm1.on('connection', (conn) => {
    serverConnections++
    conn.on('error', noop)
    conn.on('data', () => serverData++)
    conn.write('hello world')
  })
  swarm2.on('connection', (conn) => {
    clientConnections++
    conn.on('error', noop)
    conn.on('data', () => clientData++)
    conn.write('hello world')
    if (clientConnections === 1) setTimeout(() => conn.destroy(), 100) // Destroy the first client connection
  })

  const topic = Buffer.alloc(32).fill('hello world')

  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
  await swarm2.flush()

  await timeout(RECONNECT_TIMEOUT) // Wait for the first connection to be destroyed/reestablished.

  t.is(clientConnections, 2)
  t.is(serverConnections, 2)
  t.is(clientData, 2)
  t.is(serverData, 2)

  await swarm1.destroy()
  await swarm2.destroy()
})

test('constructor options - debug options forwarded to DHT constructor', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    debug: {
      handshake: {
        latency: [500, 500]
      }
    }
  })
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    debug: {
      handshake: {
        latency: [500, 500]
      }
    }
  })

  const connected = t.test('connection')
  connected.plan(2)

  swarm1.once('connection', (conn) => {
    connected.pass('swarm1')
    conn.on('error', noop)
  })
  swarm2.once('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true }).flushed()

  const start = Date.now()
  swarm2.join(topic, { client: true })

  await connected

  const duration = Date.now() - start
  t.ok(duration > 500)

  await swarm1.destroy()
  await swarm2.destroy()
})

test('flush when max connections reached', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap, maxPeers: 1 })
  const swarm3 = new Hyperswarm({ bootstrap, maxPeers: 1 })

  const topic = Buffer.alloc(32).fill('hello world')

  await swarm1.join(topic, { server: true }).flushed()

  await swarm2
    .on('connection', (conn) => conn.on('error', noop))
    .join(topic, { client: true })
    .flushed()

  await swarm3
    .on('connection', (conn) => conn.on('error', noop))
    .join(topic, { client: true })
    .flushed()

  await swarm2.flush()
  await swarm3.flush()

  t.pass('flush resolved')

  await swarm1.destroy()
  await swarm2.destroy()
  await swarm3.destroy()
})

test('rejoining with different client/server opts refreshes', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const topic = Buffer.alloc(32).fill('hello world')

  swarm1.join(topic, { client: true, server: false })
  await swarm1.join(topic, { client: true, server: true }).flushed()

  await swarm2
    .on('connection', (conn) => conn.on('error', noop))
    .join(topic, { client: true })
    .flushed()

  await swarm2.flush()

  t.is(swarm2.connections.size, 1)

  await swarm1.destroy()
  await swarm2.destroy()
})

test('topics returns peer-discovery objects', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm = new Hyperswarm({ bootstrap })
  const topic1 = Buffer.alloc(32).fill('topic 1')
  const topic2 = Buffer.alloc(32).fill('topic 2')

  swarm.join(topic1)
  swarm.join(topic2)

  const peerDiscoveries = swarm.topics()

  t.alike(peerDiscoveries.next().value.topic, topic1)
  t.alike(peerDiscoveries.next().value.topic, topic2)

  await swarm.destroy()
})

test('multiple discovery sessions with different opts', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const topic = Buffer.alloc(32).fill('hello world')

  const connected = t.test('connection')
  connected.plan(2)

  swarm1.on('connection', (conn) => {
    connected.pass('swarm1')
    conn.on('error', noop)
  })

  swarm2.on('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
  })

  await swarm1.join(topic).flushed()
  await swarm1.flush()

  const discovery1 = swarm2.join(topic, { client: true, server: false })
  const discovery2 = swarm2.join(topic, { client: false, server: true })

  await discovery1.destroy() // should not prevent server connections
  await discovery2.flushed()

  await connected

  await swarm1.destroy()
  await swarm2.destroy()
})

test('closing all discovery sessions clears all peer-discovery objects', async t => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm = new Hyperswarm({ bootstrap })

  const topic1 = Buffer.alloc(32).fill('hello')
  const topic2 = Buffer.alloc(32).fill('world')

  const discovery1 = swarm.join(topic1, { client: true, server: false })
  const discovery2 = swarm.join(topic2, { client: false, server: true })

  t.is(swarm._discovery.size, 2)

  await Promise.all([discovery1.destroy(), discovery2.destroy()])

  t.is(swarm._discovery.size, 0)

  await swarm.destroy()
})

function noop () {}
