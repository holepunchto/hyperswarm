const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const { flushConnections } = require('./helpers')

const Hyperswarm = require('..')

test.solo('one server, one client - single reconnect', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

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
    console.log(conn.rawStream.id, conn.rawStream.remoteId)
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

function noop () {}
