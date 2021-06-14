const { EventEmitter } = require('events')
const DHT = require('@hyperswarm/dht')

const PeerInfo = require('./lib/peer-info')
const PeerQueue = require('./lib/queue')
const ConnectionSet = require('./lib/connection-set')
const PeerDiscovery = require('./lib/peer-discovery')

const MAX_PEERS = 24

const ERR_DESTROYED = 'Swarm has been destroyed'
const ERR_MISSING_KEY = 'Key is required and must be a 32-byte buffer'
const ERR_JOIN_OPTS = 'Join options must enable lookup, announce or both, but not neither'

module.exports = class Hyperswarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      seed,
      keyPair = DHT.keyPair(seed),
      maxPeers = MAX_PEERS,
      onauthenticate,
      queue = {}
    } = opts

    this.keyPair = keyPair
    this.dht = new DHT()
    this.server = this.dht.createServer({
      onauthenticate,
      onconnection: this._onserverconnect.bind(this)
    })

    this.destroyed = false
    this.peers = 0
    this.maxPeers = maxPeers
    this.connections = new ConnectionSet()

    this._listening = null
    this._discovery = new Map()
    this._queue = new PeerQueue(queue, {
      onreadable: this._clientConnect.bind(this)
    })
  }

  _handleConnection (conn) {

  }

  // Server-side connections
  _onserverconnect (conn) {

  }

  // Client-side connections
  _clientConnect () {

  }

  status (key) {
    return this._discovery.get(key.toString('hex')) || null
  }

  listen () {
    if (!this._listening) this._listening = this.server.listen(this.keyPair)
    return this._listening
  }

  // Object that exposes a cancellation method (destroy)
  // TODO: Handle joining with different announce/lookup combos.
  // TODO: When you rejoin, it should reannounce + bump lookup priority
  join (topic, opts = {}) {
    const topicString = topic.toString('hex')
    if (this._discovery.has(topicString)) return this._discovery.get(topicString)
    const discovery = new PeerDiscovery(this, topic, {
      onerror: err => console.log('ERR:', err),
      onpeer: peer => console.log('PEER:', peer)
    })
    this._discovery.set(topicString, discovery)
    return discovery
  }

  // Returns a promise
  leave (topic) {
    const topicString = topic.toString('hex')
    if (!this._discovery.has(topicString)) return Promise.resolve()
    const discovery = this._discovery.get(topicString)
    this._discovery.delete(topicString)
    return discovery.destroy()
  }

  // Returns a promise
  flush () {

  }
}
