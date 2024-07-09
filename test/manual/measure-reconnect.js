/**
 * The goal of this test is to measure how quickly a client reconnects
 * after manually switching networks / e.g. from wifi to mobile data.
 *
 * It requires some extra modules to get the relays:
 * npm install --no-save hypertrace hypercore-id-encoding @holepunchto/keet-default-config
 */

function customLogger (data) {
  console.log(`   ... ${data.object.className}.${data.id} ${Object.keys(data.caller.props || []).join(',')} ${data.caller.filename}:${data.caller.line}:${data.caller.column}`)
}
try {
  require('hypertrace').setTraceFunction(customLogger)
} catch {
  console.log('Please run:')
  console.log('npm install --no-save hypertrace hypercore-id-encoding @holepunchto/keet-default-config')
  process.exit(1)
}

const { DEV_BLIND_RELAY_KEYS } = require('@holepunchto/keet-default-config')
const HypercoreId = require('hypercore-id-encoding')
const DEV_RELAY_KEYS = DEV_BLIND_RELAY_KEYS.map(HypercoreId.decode)
console.log('DEV_RELAY_KEYS', DEV_RELAY_KEYS.map(b => b.toString('hex').slice(0, 8) + '...'))
const relayThrough = (force) => force ? DEV_RELAY_KEYS : null

const Hyperswarm = require('../..')

const topic = Buffer.alloc(32).fill('measure-reconnect')
const seed = Buffer.alloc(32).fill('measure-reconnect' + require('os').hostname())

const swarm = new Hyperswarm({ seed, relayThrough })
console.log(`PUBLIC_KEY ${swarm.keyPair.publicKey.toString('hex').slice(0, 8)}...`)

swarm.dht.on('network-change', () => {
  console.log('NETWORK CHANGE')
  console.time('RECONNECTION TIME')
})

let connected = false

swarm.on('connection', async (conn) => {
  console.log(conn.rawStream.remoteHost + ':' + conn.rawStream.remotePort)

  conn.relay.on('relay', () => console.log('RELAY: RELAY'))
  conn.relay.on('unrelay', () => console.log('RELAY: UNRELAY'))
  conn.relay.on('abort', () => console.log('RELAY: ABORTED'))

  conn.on('error', (...args) => console.log('error:', ...args))
  conn.on('close', (...args) => console.log('close:', ...args))
  conn.on('data', (data) => console.log(data.toString('utf8')))
  conn.setKeepAlive(5000)
  conn.write('hello')
  if (!connected) {
    connected = true
    console.timeEnd('INITIAL CONNECTION TIME')
    return
  }
  console.timeEnd('RECONNECTION TIME')
})

console.time('INITIAL CONNECTION TIME')
swarm.join(topic)

process.on('SIGINT', () => {
  swarm.leave(topic).then(() => process.exit())
})
