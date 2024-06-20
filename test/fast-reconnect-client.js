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

const swarm1 = new Hyperswarm({ relayThrough })

swarm1.dht.on('network-change', () => console.time('RECONNECTION TIME'))

const seed = Buffer.alloc(32).fill('billie-fast-reconnect')
const serverKey = HyperDHT.keyPair(seed)

let connected = false

swarm1.on('connection', async (conn) => {
  console.log('conn.rawStream.remoteHost', conn.rawStream.remoteHost)
  conn.on('error', console.log.bind(console))
  conn.on('close', console.log.bind(console))
  if (!connected) {
    connected = true
    console.timeEnd('INITIAL CONNECTION TIME')
    return
  }
  console.timeEnd('RECONNECTION TIME')
})

console.time('INITIAL CONNECTION TIME')
swarm1.joinPeer(serverKey.publicKey)
