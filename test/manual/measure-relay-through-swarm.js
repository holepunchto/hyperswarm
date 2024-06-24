/**
 * The goal of this test is to measure how long it takes to connect via a relay.
 *
 * It requires some extra modules to get the relays:
 * npm install --no-save hypertrace hypercore-id-encoding @holepunchto/keet-default-config
 */

function customLogger (data) {
  console.log(`   ... ${data.id} ${Object.keys(data.caller.props || []).join(',')} ${data.caller.filename}:${data.caller.line}:${data.caller.column}`)
}
require('hypertrace').setTraceFunction(customLogger)

const { DEV_BLIND_RELAY_KEYS } = require('@holepunchto/keet-default-config')
const HypercoreId = require('hypercore-id-encoding')
const DEV_RELAY_KEYS = DEV_BLIND_RELAY_KEYS.map(HypercoreId.decode)
const relayThrough = DEV_RELAY_KEYS

const Hyperswarm = require('../..')

// Silly little way to make the addresses predictable
if (process.argv.length < 3) {
  console.log('please add "client" or "server" cli arg')
  process.exit(1)
}
const arg = process.argv[2]
if (arg !== 'client' && arg !== 'server') {
  console.log('please add "client" or "server" cli arg')
  process.exit(1)
}
console.log('starting', arg)

const serverSeed = Buffer.alloc(32).fill('measure-relay-maf-billie-server')
const serverPubKey = 'c154e3cadd741a07aa91068e70d6645b2deeba6112e3233bb2161be28bf68ad6'
const clientSeed = Buffer.alloc(32).fill('measure-relay-maf-billie-client')
// const clientPubKey = '69f4a91f1cc257cecfa5b2faab2196266a04076fdd462c133b4a51f612a4c16e'

const seed = arg === 'server' ? serverSeed : clientSeed

const swarm = new Hyperswarm({ seed })
const dht = swarm.dht

const server = dht.createServer({ relayThrough }, (conn) => {
  conn.on('error', console.log.bind(console))
  conn.on('close', console.log.bind(console))
  conn.on('data', (data) => console.log(data.toString('utf8')))
  conn.on('open', () => {
    conn.setKeepAlive(5000)
    conn.write('hello')
  })
})

if (arg === 'server') {
  server.listen(server.keyPair)
}

if (arg === 'client') {
  let connected = false
  console.time('INITIAL CONNECTION TIME')

  const conn = dht.connect(serverPubKey, { relayThrough })
  conn.on('error', console.log.bind(console))
  conn.on('close', console.log.bind(console))
  conn.on('data', (data) => console.log(data.toString('utf8')))
  conn.on('open', () => {
    conn.setKeepAlive(5000)
    conn.write('hello')

    if (!connected) {
      connected = true
      console.timeEnd('INITIAL CONNECTION TIME')
      return
    }
    console.timeEnd('RECONNECTION TIME')
  })
}
