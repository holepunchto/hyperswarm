const test = require('brittle')

const Hyperswarm = require('..')

test.solo('one server, one client - single reconnect', { timeout: 120000 }, async (t) => {
  // const { bootstrap } = await createTestnet(3, t.teardown)
  const bootstrap = undefined // ['192.168.1.193:49738']

  const seed = Buffer.alloc(32).fill('billie-fast-reconnect')
  const swarm1 = new Hyperswarm({ seed, bootstrap })
  console.log('my key:', swarm1.keyPair.publicKey.toString('hex'))

  const reconnectsTest = t.test('reconnects')

  reconnectsTest.plan(2)

  t.teardown(async () => {
    await swarm1.destroy()
  })

  swarm1.on('connection', async (conn) => {
    console.log('conn.rawStream.remoteHost', conn.rawStream.remoteHost)
    console.log('conn.publicKey', conn.publicKey.toString('hex'))
    console.log('conn.remotePublicKey', conn.remotePublicKey.toString('hex'))
    conn.on('error', console.log.bind(console))
    conn.on('close', console.log.bind(console))
    reconnectsTest.pass('agent connected')
    console.log('conn.rawStream.id', conn.rawStream.id, 'conn.rawStream.remoteId', conn.rawStream.remoteId)
  })

  const topic = Buffer.alloc(32).fill('billie-fast-reconnect')
  swarm1.listen()
  await swarm1.join(topic, { client: false, server: true }).flushed()
})
