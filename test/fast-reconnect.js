const test = require('brittle')

function customLogger (data) {
  console.log(`TRACE ${data.id} ${Object.keys(data.caller.props || []).join(',')} ${data.caller.filename}:${data.caller.line}:${data.caller.column}`)
}
require('hypertrace').setTraceFunction(customLogger)

const { DEV_BLIND_RELAY_KEYS } = require('@holepunchto/keet-default-config')
const HypercoreId = require('hypercore-id-encoding')
const DEV_RELAY_KEYS = DEV_BLIND_RELAY_KEYS.map(HypercoreId.decode)
const relayThrough = (force) => force ? DEV_RELAY_KEYS : null

const Hyperswarm = require('..')

test.solo('one server, one client - single reconnect', { timeout: 120000 }, async (t) => {
  // const { bootstrap } = await createTestnet(3, t.teardown)
  const bootstrap = undefined // ['192.168.1.193:49738']

  const seed = Buffer.alloc(32).fill('billie-fast-reconnect')
  const swarm1 = new Hyperswarm({ seed, bootstrap, relayThrough })
  console.log('my key:', swarm1.keyPair.publicKey.toString('hex'))

  const reconnectsTest = t.test('reconnects')

  reconnectsTest.plan(2)

  t.teardown(async () => {
    await swarm1.destroy()
  })

  swarm1.on('connection', async (conn) => {
    console.log('conn.rawStream.remoteHost', conn.rawStream.remoteHost)
    // console.log('conn.publicKey', conn.publicKey.toString('hex'))
    // console.log('conn.remotePublicKey', conn.remotePublicKey.toString('hex'))
    conn.on('error', console.log.bind(console))
    conn.on('close', console.log.bind(console))
    reconnectsTest.pass('agent connected')
    // console.log('conn.rawStream.id', conn.rawStream.id, 'conn.rawStream.remoteId', conn.rawStream.remoteId)
    console.log('conn.streamId', conn.streamId)
    conn.on('data', (data) => {
      console.log(data.toString('utf8'))
    })
  })

  // const topic = Buffer.alloc(32).fill('billie-fast-reconnect')
  swarm1.listen()
  // await swarm1.join(topic, { client: false, server: true }).flushed()

  await reconnectsTest
})
