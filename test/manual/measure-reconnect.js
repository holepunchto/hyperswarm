/**
 * The goal of this test is to measure how quickly a client reconnects
 * after manually switching networks / e.g. from wifi to mobile data.
 *
 * It requires some extra packages that are private to Holepunch to get the relay keys,
 * which is why these aren't devDependencies.
 */

// Automatically install required packages.
try {
  require.resolve('hypertrace')
  require.resolve('hypercore-id-encoding')
  require.resolve('@holepunchto/keet-default-config')
  require.resolve('picocolors')
} catch {
  const { execSync } = require('child_process')
  execSync('npm install --no-save hypertrace hypercore-id-encoding @holepunchto/keet-default-config picocolors')
}

const pc = require('picocolors')
function customLogger (data) {
  const className = pc.gray(`[${data.object.className}]`)
  const event = pc.blue(data.id)
  const filename = pc.gray(`${data.caller.filename.replace(process.cwd(), '.')}:${data.caller.line}:${data.caller.column}`)
  const props = `{ ${Object.keys(data.caller.props || []).join(',')} }`
  console.log(`${className} ${event} ${props} ${filename}`)
}

require('hypertrace').setTraceFunction(customLogger)
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
