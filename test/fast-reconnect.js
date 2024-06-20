function customLogger (data) {
  console.log(`TRACE ${data.id} ${Object.keys(data.caller.props || []).join(',')} ${data.caller.filename}:${data.caller.line}:${data.caller.column}`)
}
require('hypertrace').setTraceFunction(customLogger)

const { DEV_BLIND_RELAY_KEYS } = require('@holepunchto/keet-default-config')
const HypercoreId = require('hypercore-id-encoding')
const DEV_RELAY_KEYS = DEV_BLIND_RELAY_KEYS.map(HypercoreId.decode)
const relayThrough = (force) => force ? DEV_RELAY_KEYS : null

const Hyperswarm = require('..')

// const { bootstrap } = await createTestnet(3, t.teardown)
const bootstrap = undefined // ['192.168.1.193:49738']

const seed = Buffer.alloc(32).fill('billie-fast-reconnect')
const swarm1 = new Hyperswarm({ seed, bootstrap, relayThrough })
console.log('my key:', swarm1.keyPair.publicKey.toString('hex'))

swarm1.on('connection', async (conn) => {
  console.log('conn.rawStream.remoteHost', conn.rawStream.remoteHost)
  conn.on('error', console.log.bind(console))
  conn.on('close', console.log.bind(console))
  console.log('conn.streamId', conn.streamId)
  conn.on('data', (data) => {
    console.log(data.toString('utf8'))
  })
})

swarm1.listen()
