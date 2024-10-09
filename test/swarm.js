const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const { timeout, flushConnections } = require('./helpers')
const b4a = require('b4a')

const Hyperswarm = require('..')

const BACKOFFS = [
  100,
  200,
  300,
  400
]

test('one server, one client - first connection', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  t.plan(1)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm2.on('connection', (conn) => {
    t.pass('swarm2')
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
})

test('two servers - first connection', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const connection1Test = t.test('connection1')
  const connection2Test = t.test('connection2')

  connection1Test.plan(1)
  connection2Test.plan(1)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
    connection1Test.pass('swarm1')
    conn.end()
  })
  swarm2.on('connection', (conn) => {
    conn.on('error', noop)
    connection2Test.pass('swarm2')
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')

  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()
})

test('one server, one client - single reconnect', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  const serverReconnectsTest = t.test('server reconnects')
  const clientReconnectsTest = t.test('client reconnects')

  serverReconnectsTest.plan(1)
  clientReconnectsTest.plan(1)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  let hasClientConnected = false
  let serverDisconnected = false

  swarm2.on('connection', (conn) => {
    conn.on('error', noop)

    if (!hasClientConnected) {
      hasClientConnected = true
      return
    }

    clientReconnectsTest.pass('client reconnected')
  })

  swarm1.on('connection', async (conn) => {
    conn.on('error', noop)

    if (!serverDisconnected) {
      serverDisconnected = true

      // Ensure connection is setup for client too
      // before we destroy it
      await flushConnections(swarm2)
      if (!hasClientConnected) t.fail('Logical error in the test: the client should be connected by now')

      conn.destroy()
      return
    }
    serverReconnectsTest.pass('Server reconnected')
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })
})

test('one server, one client - maximum reconnects', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
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
  t.ok(connections > 1, 'client saw more than one retry (' + connections + ')')
  t.ok(connections < 5, 'client saw less than five attempts')

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
  const connection1Test = t.test('connection1')
  const connection2Test = t.test('connection2')

  connection1Test.plan(1)
  connection2Test.plan(1)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm1.on('connection', (conn) => {
    connection1Test.pass('Swarm 1 connection')
    conn.on('error', noop)
  })
  swarm2.on('connection', (conn) => {
    connection2Test.pass('Swarm 2 connection')
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()
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

  await swarm2.flush()
  await swarm1.flush()

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

  const connection1To2Test = t.test('connection 1 to 2')
  const connection1To3Test = t.test('connection 1 to 3')

  const connection2Test = t.test('connection2')
  const connection3Test = t.test('connection3')

  connection1To2Test.plan(1)
  connection1To3Test.plan(1)
  connection2Test.plan(1)
  connection3Test.plan(1)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
    await swarm3.destroy()
  })

  swarm1.on('connection', (conn, info) => {
    if (b4a.equals(info.publicKey, swarm2.keyPair.publicKey)) {
      connection1To2Test.pass('Swarm1 connected with swarm2')
    } else if (b4a.equals(info.publicKey, swarm3.keyPair.publicKey)) {
      connection1To3Test.pass('Swarm1 connected with swarm3')
    } else {
      t.fail('Unexpected connection')
    }
    conn.on('error', noop)
  })
  swarm2.on('connection', (conn, info) => {
    connection2Test.ok(b4a.equals(info.publicKey, swarm1.keyPair.publicKey), 'swarm2 connected with swarm1')
    conn.on('error', noop)
  })
  swarm3.on('connection', (conn, info) => {
    connection3Test.ok(b4a.equals(info.publicKey, swarm1.keyPair.publicKey), 'swarm3 connected with swarm1')
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
  swarm3.join(topic, { server: false, client: true })
})

test('one server, two clients - if a second client joins after the server leaves, they will not connect', async (t) => {
  t.plan(2)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm3 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
  })

  swarm2.on('connection', (conn) => conn.on('error', noop))
  swarm3.on('connection', (conn) => conn.on('error', noop))

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()

  swarm2.join(topic, { client: true, server: false })

  await flushConnections(swarm2)

  await swarm1.leave(topic)
  await flushConnections(swarm1)

  swarm3.join(topic, { client: true, server: false })
  await flushConnections(swarm3)

  t.is(swarm2.connections.size, 1)
  t.is(swarm3.connections.size, 0)

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

  await flushConnections(swarm3)
  t.is(clientConnections, 1)

  await swarm2.join(topic).flushed()
  await flushConnections(swarm2)
  t.is(clientConnections, 1)

  await discovery.refresh()
  await flushConnections(swarm3)
  t.is(clientConnections, 2)

  await swarm1.destroy()
  await swarm2.destroy()
  await swarm3.destroy()
})

test('one server, one client - correct deduplication when a client connection is destroyed', async (t) => {
  t.plan(4)
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  let clientConnections = 0
  let serverConnections = 0
  let clientData = 0
  let serverData = 0

  swarm1.on('connection', (conn) => {
    serverConnections++
    conn.on('error', noop)
    conn.on('data', () => {
      if (++serverData >= 2) {
        t.is(serverConnections, 2, 'Server opened second connection')
        t.pass(serverData, 2, 'Received data from second connection')
      }
    })
    conn.write('hello world')
  })
  swarm2.on('connection', (conn) => {
    clientConnections++
    conn.on('error', noop)
    conn.on('data', () => {
      if (++clientData >= 2) {
        t.is(clientConnections, 2, 'Client opened second connection')
        t.is(clientData, 2, 'Received data from second connection')
      }
    })
    conn.write('hello world')

    if (clientConnections === 1) setTimeout(() => conn.destroy(), 50) // Destroy the first client connection
  })

  const topic = Buffer.alloc(32).fill('hello world')

  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
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

  const connection1Test = t.test('connection1')
  const connection2Test = t.test('connection2')

  connection1Test.plan(1)
  connection2Test.plan(1)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm1.on('connection', (conn) => {
    connection1Test.pass('swarm1')
    conn.on('error', noop)
  })

  swarm2.on('connection', (conn) => {
    connection2Test.pass('swarm2')
    conn.on('error', noop)
  })

  await swarm1.join(topic).flushed()
  await swarm1.flush()

  const discovery1 = swarm2.join(topic, { client: true, server: false })
  swarm2.join(topic, { client: false, server: true })

  await discovery1.destroy() // should not prevent server connections
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

test('peer-discovery object deleted when corresponding connection closes (server)', async t => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const connected = t.test('connection')
  connected.plan(1)

  const otherConnected = t.test('connection')
  otherConnected.plan(1)

  swarm2.on('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
  })

  let resolveConnClosed = null
  const connClosed = new Promise(resolve => {
    resolveConnClosed = resolve
  })
  swarm1.on('connection', (conn) => {
    otherConnected.pass('swarm1')
    conn.on('error', noop)
    conn.on('close', resolveConnClosed)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  await connected
  await otherConnected

  t.is(swarm1.peers.size, 1)
  await swarm2.destroy()

  // Ensure other side detects closed connection
  await connClosed

  t.is(swarm1.peers.size, 0, 'No peerInfo memory leak')

  await swarm1.destroy()
})

test('peer-discovery object deleted when corresponding connection closes (client)', async t => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  t.plan(3)
  // We want to test it eventually gets gc'd after all the retries
  // so we don't care about waiting between retries
  const instaBackoffs = [0, 0, 0, 0]
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: instaBackoffs, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: instaBackoffs, jitter: 0 })

  let hasBeen1 = false
  swarm2.on('update', async () => {
    if (swarm2.peers.size > 0) hasBeen1 = true
    if (hasBeen1 && swarm2.peers.size === 0) {
      t.pass('No peerInfo memory leak')
      swarm2.destroy()
    }
  })

  const connected = t.test('connection')
  connected.plan(1)

  swarm2.on('connection', (conn) => {
    connected.pass('swarm2')
    conn.on('error', noop)
  })
  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  t.is(swarm2.peers.size, 1)
  await swarm1.destroy()
})

test('no default error handler set when connection event is emitted', async (t) => {
  t.plan(2)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm2.on('connection', (conn) => {
    t.is(conn.listeners('error').length, 0, 'no error listeners')
    conn.on('error', noop)
    conn.end()
  })
  swarm1.on('connection', (conn) => {
    t.is(conn.listeners('error').length, 0, 'no error listeners')
    conn.on('error', noop)
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { client: true, server: false })
})

test('peerDiscovery has unslabbed closestNodes', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const tConnect = t.test('connected')
  tConnect.plan(2)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm2.on('connection', (conn) => {
    conn.on('error', noop)
    tConnect.pass('swarm2 connected')
  })
  swarm1.on('connection', (conn) => {
    conn.on('error', noop)
    tConnect.pass('swarm1 connected')
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await tConnect

  const closestNodes = [...swarm1._discovery.values()][0]._closestNodes
  const bufferSizes = closestNodes.map(n => n.id.buffer.byteLength)
  t.is(bufferSizes[0], 32, 'unslabbed clostestNodes entry')

  const hasUnslabbeds = bufferSizes.filter(s => s !== 32).length !== 0
  t.is(hasUnslabbeds, false, 'sanity check: all are unslabbed')
})

test('topic and peer get unslabbed in PeerInfo', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  t.plan(3)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm2.on('connection', (conn) => {
    t.is(
      [...swarm2.peers.values()][0].publicKey.buffer.byteLength,
      32,
      'unslabbed publicKey in peerInfo'
    )
    t.is([...swarm2.peers.values()][0].topics[0].buffer.byteLength,
      32,
      'unslabbed topic in peerInfo'
    )

    conn.on('error', noop)
    conn.end()
  })
  swarm1.on('connection', (conn) => {
    t.is(
      [...swarm1.peers.values()][0].publicKey.buffer.byteLength,
      32,
      'unslabbed publicKey in peerInfo'
    )

    conn.on('error', noop)
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { client: true, server: false })
})

function noop () {}
