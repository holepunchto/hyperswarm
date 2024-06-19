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
const HyperDHT = require('hyperdht')

test.solo('one server, one client - single reconnect', { timeout: 120000 }, async (t) => {
  // const { bootstrap } = await createTestnet(3, t.teardown)
  const bootstrap = undefined // ['192.168.1.193:49738']
  const swarm1 = new Hyperswarm({ bootstrap, relayThrough })
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
    console.log('conn.rawStream.remoteHost', conn.rawStream.remoteHost)
    // console.log('conn.publicKey', conn.publicKey.toString('hex'))
    // console.log('conn.remotePublicKey', conn.remotePublicKey.toString('hex'))
    conn.on('error', noop)
    // console.log('conn.rawStream.id', conn.rawStream.id, 'conn.rawStream.remoteId', conn.rawStream.remoteId)
    console.log('conn.streamId', conn.streamId)
    if (!disconnected) {
      disconnected = true

      reconnectsTest.pass('client terminates initial connection')
      console.log('turn off wifi now')
      waitAndDestroy(conn, 8000)
      return
    }
    reconnectsTest.pass('agent reconnected')
    swarm1.leavePeer(serverKey.publicKey)
  })

  async function waitAndDestroy (conn, timeout) {
    await new Promise(r => setTimeout(() => r(), timeout))
    conn.rawStream.destroy()
    console.log('aaaaaand turn wifi back on now')
  }

  swarm1.joinPeer(serverKey.publicKey)
  await reconnectsTest
})

function noop () {}
