const crypto = require('hypercore-crypto')
const random = require('math-random-seed')
const { timeout } = require('nonsynchronous')

const Hyperswarm = require('..')
const { test } = require('./helpers')

const CONNECTION_TIMEOUT = 100
const BACKOFFS = [
  100,
  200,
  300
]

test('one server, one client - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  swarm2.on('connection', conn => {
    t.pass('swarm2 got a client connection')
    conn.destroy()
  })
  swarm1.on('connection', conn => {
    conn.destroy()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  await destroyAll(swarm1, swarm2)
})

test('two servers - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const s1Connected = timeoutPromise()
  const s2Connected = timeoutPromise()

  swarm1.on('connection', () => s1Connected.resolve())
  swarm2.on('connection', () => s2Connected.resolve())

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  try {
    await Promise.all([s1Connected, s2Connected])
    t.pass('connection events fired successfully')
  } catch (_) {
    t.fail('connection events did not fire')
  }

  await destroyAll(swarm1, swarm2)
})

test('one server, one client - single reconnect', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  const clientReconnected = timeoutPromise(BACKOFFS[2])
  const serverReconnected = timeoutPromise(BACKOFFS[2])
  let clientDisconnected = false
  let serverDisconnected = false

  swarm2.on('connection', conn => {
    if (!clientDisconnected) {
      clientDisconnected = true
      clientReconnected.reset()
      conn.destroy()
      return
    }
    clientReconnected.resolve()
    conn.end()
  })
  swarm1.on('connection', conn => {
    if (!serverDisconnected) {
      serverDisconnected = true
      serverReconnected.reset()
      conn.destroy()
      return
    }
    serverReconnected.resolve()
    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  try {
    await Promise.all([clientReconnected, serverReconnected])
    t.pass('client got a second connection')
  } catch (_) {
    t.fail('client did not get a second connection')
  }

  await destroyAll(swarm2, swarm1)
  t.end()
})

test('one server, one client - maximum reconnects', async (bootstrap, t) => {
  t.plan(1)

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

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout(BACKOFFS[2] * 4)
  t.same(connections, 3, 'client saw 3 retries')

  await destroyAll(swarm2, swarm1)
  t.end()
})

test('one server, one client - banned peer does not reconnect', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let connections = 0
  swarm2.on('connection', (conn, info) => {
    connections++
    info.ban(true)
    conn.destroy()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { client: false, server: true }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await timeout(BACKOFFS[2] * 2) // Wait for 2 long backoffs
  t.same(connections, 1, 'banned peer was not retried')

  await destroyAll(swarm2, swarm1)
  t.end()
})

test('two servers, two clients - simple deduplication', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let s1Connections = 0
  let s2Connections = 0

  swarm1.on('connection', () => s1Connections++)
  swarm2.on('connection', () => s2Connections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  await swarm2.join(topic).flushed()

  await timeout(250) // 250 ms will be enough for all connections to trigger

  t.same(s1Connections, 1)
  t.same(s2Connections, 1)

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('one server, two clients - topic multiplexing', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  let peerInfo = null
  swarm2.on('connection', (_, info) => {
    clientConnections++
    peerInfo = info
  })

  const topic1 = Buffer.alloc(32).fill('hello world')
  const topic2 = Buffer.alloc(32).fill('hi world')

  await swarm1.join(topic1, { client: false, server: true }).flushed()
  await swarm1.join(topic2, { client: false, server: true }).flushed()
  swarm2.join(topic1, { client: true, server: false })
  swarm2.join(topic2, { client: true, server: false })

  await timeout(250) // 250 ms will be enough for all connections to trigger

  t.same(clientConnections, 1)
  t.same(peerInfo.topics.length, 2)

  await destroyAll(swarm2, swarm1)
  t.end()
})

test('one server, two clients - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })
  const swarm3 = new Hyperswarm({ bootstrap })

  const s1Connected = timeoutPromise()
  const s2Connected = timeoutPromise()
  const s3Connected = timeoutPromise()

  swarm1.on('connection', () => s1Connected.resolve())
  swarm2.on('connection', () => s2Connected.resolve())
  swarm3.on('connection', () => s3Connected.resolve())

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { server: false, client: true })
  swarm3.join(topic, { server: false, client: true })

  await swarm2.flush()
  await swarm3.flush()

  try {
    await Promise.all([s1Connected, s2Connected, s3Connected])
    t.pass('connection events fired successfully')
  } catch (_) {
    t.fail('connection events did not fire')
  }

  await destroyAll(swarm2, swarm3, swarm1)
})

test('one server, two clients - if a second client joins after the server leaves, they will not connect', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm3 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let serverConnections = 0
  swarm1.on('connection', () => serverConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()

  swarm2.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.same(serverConnections, 1)

  await swarm1.leave(topic)
  swarm3.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.same(serverConnections, 1)

  await destroyAll(swarm2, swarm3, swarm1)

  t.end()
})

test('two servers, one client - refreshing a peer discovery instance discovers new server', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm3 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  swarm3.on('connection', () => clientConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic).flushed()
  const discovery = swarm3.join(topic, { client: true, server: false })

  await timeout(CONNECTION_TIMEOUT)
  t.same(clientConnections, 1)

  await swarm2.join(topic).flushed()
  await timeout(CONNECTION_TIMEOUT)
  t.same(clientConnections, 1)

  await discovery.refresh()
  await swarm3.flush()
  t.same(clientConnections, 2)

  await destroyAll(swarm1, swarm2, swarm3)
  t.end()
})

test('firewalled server - bad client is rejected', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({
    bootstrap,
    backoffs: BACKOFFS,
    jitter: 0,
    firewall: remotePublicKey => {
      return !remotePublicKey.equals(swarm1.keyPair.publicKey)
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
      return !remotePublicKey.equals(swarm1.keyPair.publicKey)
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
      return !remotePublicKey.equals(swarm1.keyPair.publicKey)
    }
  })

  let serverConnections = 0
  swarm2.on('connection', () => serverConnections++)

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm2.join(topic).flushed()

  swarm1.join(topic)

  await timeout(BACKOFFS[2] * 5) // Wait for many retries -- there should only be 3

  t.same(serverConnections, 0, 'server did not receive an incoming connection')
  t.same(firewallCalls, 3, 'client retried 3 times')

  await destroyAll(swarm1, swarm2)
  t.end()
})

test('one server, one client - correct deduplication when a client connection is destroyed', async (bootstrap, t) => {
  const swarm1 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
  const swarm2 = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })

  let clientConnections = 0
  let serverConnections = 0
  let clientData = 0
  let serverData = 0

  const RECONNECT_TIMEOUT = CONNECTION_TIMEOUT * 4

  swarm1.on('connection', conn => {
    serverConnections++
    conn.on('error', noop)
    conn.on('data', () => serverData++)
    conn.write('hello world')
  })
  swarm2.on('connection', conn => {
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

  t.same(clientConnections, 2)
  t.same(serverConnections, 2)
  t.same(clientData, 2)
  t.same(serverData, 2)

  await destroyAll(swarm2, swarm1)
  t.end()
})

test('chaos - recovers after random disconnections (takes ~60s)', async (bootstrap, t) => {
  const SEED = 'hyperswarm v3'
  const NUM_SWARMS = 10
  const NUM_TOPICS = 15
  const NUM_FORCE_DISCONNECTS = 30

  const STARTUP_DURATION = 1000 * 5
  const TEST_DURATION = 1000 * 45
  const CHAOS_DURATION = 1000 * 10

  const swarms = []
  const topics = []
  const connections = []
  const peersBySwarm = new Map()
  const rand = random(SEED)

  for (let i = 0; i < NUM_SWARMS; i++) {
    const swarm = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
    swarms.push(swarm)
    peersBySwarm.set(swarm, new Set())
    swarm.on('connection', conn => {
      connections.push(conn)

      conn.on('error', noop)
      conn.on('close', () => {
        clearInterval(timer)
        const idx = connections.indexOf(conn)
        if (idx === -1) return
        connections.splice(idx, 1)
      })

      const timer = setInterval(() => {
        conn.write(Buffer.alloc(10))
      }, 100)
      conn.write(Buffer.alloc(10))
    })
  }
  for (let i = 0; i < NUM_TOPICS; i++) {
    const topic = crypto.randomBytes(32)
    topics.push(topic)
  }

  for (const topic of topics) {
    const numSwarms = Math.round(rand() * NUM_SWARMS)
    const topicSwarms = []
    for (let i = 0; i < numSwarms; i++) {
      topicSwarms.push(swarms[Math.floor(rand() * NUM_SWARMS)])
    }
    for (const swarm of topicSwarms) {
      const peers = peersBySwarm.get(swarm)
      for (const s of topicSwarms) {
        if (swarm === s) continue
        peers.add(s.keyPair.publicKey.toString('hex'))
      }
      await swarm.join(topic).flushed()
    }
  }

  await Promise.all(swarms.map(s => s.flush()))
  await timeout(STARTUP_DURATION)

  // Randomly destroy connections during the chaos period.
  for (let i = 0; i < NUM_FORCE_DISCONNECTS; i++) {
    const timeout = Math.floor(rand() * CHAOS_DURATION) // Leave a lot of room at the end for reestablishing connections (timeouts)
    setTimeout(() => {
      if (!connections.length) return
      const idx = Math.floor(rand() * connections.length)
      const conn = connections[idx]
      conn.destroy()
    }, timeout)
  }

  await timeout(TEST_DURATION) // Wait for the chaos to resolve

  for (const [swarm, expectedPeers] of peersBySwarm) {
    t.same(swarm.connections.size, expectedPeers.size, 'swarm has the correct number of connections')
    const missingKeys = []
    for (const conn of swarm.connections) {
      const key = conn.remotePublicKey.toString('hex')
      if (!expectedPeers.has(key)) missingKeys.push(key)
    }
    t.same(missingKeys.length, 0, 'swarm is not missing any expected peers')
  }

  await destroyAll(...swarms)
  t.end()
})

async function destroyAll (...swarms) {
  for (const swarm of swarms) {
    await swarm.clear()
  }
  for (const swarm of swarms) {
    await swarm.destroy()
  }
}

function timeoutPromise (ms = CONNECTION_TIMEOUT) {
  let res = null
  let rej = null
  let timer = null

  const p = new Promise((resolve, reject) => {
    res = resolve
    rej = reject
  })
  p.resolve = res
  p.reject = rej
  p.reset = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => p.reject(new Error('Timed out')), ms)
  }

  p.reset()
  return p
}

function noop () {}
