const test = require('brittle')
const DHT = require('hyperdht')
const createTestnet = require('hyperdht/testnet')
const b4a = require('b4a')

const Hyperswarm = require('..')

test('suspend + resume', async (t) => {
  t.plan(4)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  const topic = Buffer.alloc(32).fill('hello world')

  swarm1.on('connection', function (socket) {
    t.pass('swarm1 received connection')
    socket.on('error', () => {})
  })

  swarm2.on('connection', function (socket) {
    t.pass('swarm2 received connection')
    socket.on('error', () => {})
  })

  const discovery = swarm1.join(topic, { server: true, client: false })
  await discovery.flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  t.comment('suspended swarm2')
  swarm2.suspend()

  setTimeout(() => {
    t.comment('resumed swarm2')
    swarm2.resume()
  }, 2000)
})

test('suspend + resume - a server re-announces on resume', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const server = new Hyperswarm({ bootstrap })
  t.teardown(() => server.destroy())

  const probe = new DHT({ bootstrap })
  t.teardown(() => probe.destroy())

  const topic = Buffer.alloc(32).fill('re-announce')

  await server.join(topic, { server: true, client: false }).flushed()
  t.ok((await announced(topic)) > 0, 'announced')

  await server.suspend()
  t.is(await announced(topic), 0, 'unannounced on suspend()')

  await server.resume()
  await server.flush()
  t.ok((await announced(topic)) > 0, 'reannounced on resume()')

  async function announced(topic) {
    let peers = 0
    for await (const result of probe.lookup(topic)) peers += result.peers.length
    return peers
  }
})

test('suspend + resume - 2 peers both server and client', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const a = new Hyperswarm({ bootstrap })
  const b = new Hyperswarm({ bootstrap })

  t.teardown(async () => {
    await a.destroy()
    await b.destroy()
  })

  const topic = Buffer.alloc(32).fill('symmetric roles')

  const connected = Promise.all([nextConnection(a), nextConnection(b)])

  await a.join(topic, { server: true, client: true }).flushed()
  await b.join(topic, { server: true, client: true }).flushed()

  t.comment('flushed')

  await t.execution(connected, 'connected')
  t.is(a.connections.size, 1, 'A connection')
  t.is(b.connections.size, 1, 'B connection')

  await Promise.all([a.suspend(), b.suspend()])
  t.comment('suspended')

  t.is(a.connections.size, 0, 'A no connection')
  t.is(b.connections.size, 0, 'B no connection')

  const reconnected = Promise.all([nextConnection(a), nextConnection(b)])

  await a.resume()

  // discovery.refresh() is not awaitable by resume()
  await new Promise((resolve) => setTimeout(resolve, 100))
  await b.resume()

  t.comment('resumed')

  await reconnected
  t.comment('reconnected after resume')

  t.is(a.connections.size, 1, 'A connection')
  t.is(b.connections.size, 1, 'B connection')

  function nextConnection(swarm) {
    return new Promise((resolve) => {
      swarm.once('connection', (connection) => {
        connection.once('error', (err) => {
          if (err.code !== 'ECONNRESET') throw err
        })

        resolve()
      })
    })
  }
})

test('suspend + resume - queued peers can still connect after resume', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const topic = Buffer.alloc(32).fill('hello world')
  const servers = []

  for (let i = 0; i < 3; i++) {
    const server = new Hyperswarm({ bootstrap })
    server.on('connection', (conn) => conn.on('error', noop))
    await server.join(topic, { server: true, client: false }).flushed()
    servers.push(server)
  }

  // maxPeers 1 keeps all but one discovered peer in the queue
  const client = new Hyperswarm({ bootstrap, maxPeers: 1 })
  client.on('connection', (conn) => conn.on('error', noop))

  t.teardown(async () => {
    for (const server of servers) await server.destroy()
    await client.destroy()
  })

  const discovery = client.join(topic, { client: true, server: false })
  await client.flush()
  t.is(client.connections.size, 1)

  await client.suspend()
  t.is(client.peers.size, 0, 'queued peers are released')

  await client.resume()
  await discovery.flushed()
  await client.flush()

  // the connected server goes away, the client should move on to a queued one
  const [conn] = client.connections
  const connected = servers.find((s) => b4a.equals(s.keyPair.publicKey, conn.remotePublicKey))
  await connected.destroy()

  await discovery.refresh()
  await client.flush()
  t.is(client.connections.size, 1, 'connected to another server')
})

function noop() {}
