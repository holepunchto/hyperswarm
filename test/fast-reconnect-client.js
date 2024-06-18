const test = require('brittle')

const Hyperswarm = require('..')
const HyperDHT = require('hyperdht')

test.solo('one server, one client - single reconnect', async (t) => {
  // const { bootstrap } = await createTestnet(3, t.teardown)
  const bootstrap = undefined // ['192.168.1.193:49738']
  const swarm1 = new Hyperswarm({ bootstrap })
  console.log('my key:', swarm1.keyPair.publicKey.toString('hex'))

  const seed = Buffer.alloc(32).fill('billie-fast-reconnect')
  const serverKey = HyperDHT.keyPair(seed)
  console.log('server key:', serverKey.publicKey)

  const reconnectsTest = t.test('reconnects')

  reconnectsTest.plan(2)

  t.teardown(async () => {
    await swarm1.destroy()
  })

  let disconnected = false

  swarm1.on('connection', async (conn) => {
    console.log('conn.publicKey', conn.publicKey.toString('hex'))
    console.log('conn.remotePublicKey', conn.remotePublicKey.toString('hex'))
    conn.on('error', noop)
    console.log('conn.rawStream.id', conn.rawStream.id, 'conn.rawStream.remoteId', conn.rawStream.remoteId)
    if (!disconnected) {
      disconnected = true

      reconnectsTest.pass('client terminates initial connection')
      conn.destroy(new Error('whoops'))
      return
    }
    reconnectsTest.pass('agent reconnected')
  })

  const topic = Buffer.alloc(32).fill('billie-fast-reconnect')
  await swarm1.join(topic, { client: true, server: false }).flushed()
//   swarm1.joinPeer(serverKey.publicKey)
})

function noop () {}
