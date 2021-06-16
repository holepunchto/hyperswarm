const { EventEmitter } = require('events')
const DHT = require('@hyperswarm/dht')
const spq = require('shuffled-priority-queue')

const PeerInfo = require('./lib/peer-info')
const RetryTimer = require('./lib/retry-timer')
const ConnectionSet = require('./lib/connection-set')
const PeerDiscovery = require('./lib/peer-discovery')

const MAX_PEERS = 64
const MAX_CLIENT_CONNECTIONS = Infinity // TODO: Change
const MAX_SERVER_CONNECTIONS = Infinity

const ERR_DESTROYED = 'Swarm has been destroyed'
const ERR_MISSING_KEY = 'Key is required and must be a 32-byte buffer'
const ERR_JOIN_OPTS = 'Join options must enable lookup, announce or both, but not neither'
const ERR_DUPLICATE = 'Duplicate connection'

module.exports = class Hyperswarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      seed,
      keyPair = DHT.keyPair(seed),
      maxPeers = MAX_PEERS,
      maxClientConnections = MAX_CLIENT_CONNECTIONS,
      maxServerConnections = MAX_SERVER_CONNECTIONS,
      onauthenticate = noop,
      queue = {}
    } = opts

    this.keyPair = keyPair
    this.dht = new DHT()
    this.server = this.dht.createServer({
      onauthenticate: this._handleAuthenticate.bind(this),
      onconnection: this._handleServerConnection.bind(this)
    })

    this.destroyed = false
    this.maxPeers = maxPeers
    this.maxClientConnections = maxClientConnections
    this.maxServerConnections = maxServerConnections
    this.connections = new ConnectionSet()
    this.peers = new Map()

    this._listening = null
    this._discovery = new Map()
    this._timer = new RetryTimer(this._requeue.bind(this))
    this._queue = spq()

    this._pendingFlushes = []
    this._flushTick = 0

    this._clientConnections = 0
    this._serverConnections = 0
    this._onauthenticate = onauthenticate
  }

  _enqueue (peerInfo) {
    const empty = !this._queue.head()
    peerInfo.queued = true
    peerInfo._flushTick = this._flushTick
    this._queue.add(peerInfo)
    if (empty) this._attemptClientConnections()
  }

  _requeue (batch) {
    const empty = !this._queue.head()
    let readable = false

    for (const peerInfo of batch) {
      if ((peerInfo._updatePriority() === false) || this._connection.has(peerInfo.remotePublicKey)) continue
      peerInfo.queued = true
      peerInfo._flushTick = this._flushTick
      this._queue.add(peerInfo)
      readable = true
    }

    if (empty && readable) this._attemptClientConnections()
  }

  _flushMaybe (peerInfo) {
    for (let i = 0; i < this._pendingFlushes.length; i++) {
      const flush = this._pendingFlushes[i]
      if (peerInfo._flushTick > flush.tick) continue
      if (--flush.missing > 0) continue
      flush.resolve()
      this._pendingFlushes.splice(i--, 1)
    }
  }

  _shouldConnect () {
    return this.connections.size < this.maxPeers &&
      this._clientConnections < this.maxClientConnections
  }

  // Called when the PeerQueue indicates a connection should be attempted.
  _attemptClientConnections () {
    // TODO: Add max parallelism
    while (this._queue.length && this._shouldConnect()) {
      const peerInfo = this._queue.shift()
      peerInfo.queued = false

      if (this.connections.has(peerInfo.publicKey)) {
        this._flushMaybe(peerInfo)
        continue
      }

      const conn = this.dht.connect(peerInfo.publicKey, {
        nodes: peerInfo.nodes,
        keyPair: this.keyPair
      })
      this.connections.add(conn)
      this._clientConnections++
      let opened = false

      conn.on('close', () => {
        this.connections.delete(conn)
        this._clientConnections--
        peerInfo._disconnected()
        this._timer.add(peerInfo)
        if (!opened) this._flushMaybe(peerInfo)
      })
      conn.on('error', noop)
      conn.on('open', () => {
        opened = true
        conn.removeListener('error', noop)
        peerInfo._connected()
        peerInfo.isClient = true
        this._flushMaybe(peerInfo)
        this.emit('connection', conn, peerInfo)
      })
    }
  }

  _handleAuthenticate (remotePublicKey) {
    if (this.connections.has(remotePublicKey)) return false
    if (remotePublicKey.equals(this.keyPair.publicKey)) return false
    const peerInfo = this.peers.get(remotePublicKey.toString('hex'))
    if (peerInfo && peerInfo.banned) return false
    return this._onauthenticate(remotePublicKey)
  }

  // Called when the DHT receives a new server connection.
  _handleServerConnection (conn) {
    const existing = this.connections.get(conn.remotePublicKey)
    if (existing) {
      conn.destroy(new Error(ERR_DUPLICATE))
      return
    }
    const peerInfo = this._upsertPeer(conn.remotePublicKey, null)

    this.connections.add(conn)
    this._serverConnections++

    conn.on('close', () => {
      this.connections.delete(conn)
      this._serverConnections--
    })
    peerInfo.isClient = false
    this.emit('connection', conn, peerInfo)
  }

  _upsertPeer (publicKey, nodes) {
    if (publicKey.equals(this.keyPair.publicKey)) return null
    const keyString = publicKey.toString('hex')

    let peerInfo = this.peers.get(keyString)
    if (peerInfo) return peerInfo

    peerInfo = new PeerInfo({
      publicKey,
      nodes
    })

    this.peers.set(keyString, peerInfo)
    return peerInfo
  }

  /*
   * Called when a peer is actively discovered during a lookup.
   *
   * Three conditions:
   *  1. Not a known peer -- insert into queue
   *  2. A known peer with normal priority -- do nothing
   *  3. A known peer with low priority -- bump priority, because it's been rediscovered
   */
  _handlePeer (peer, topic) {
    const peerInfo = this._upsertPeer(peer.publicKey, peer.nodes)
    if (!peerInfo || this.connections.has(peer.publicKey)) return
    if (!peerInfo.prioritized || peerInfo.isServer) peerInfo._reset()
    if (peerInfo._updatePriority()) this._enqueue(peerInfo)
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
      ...opts,
      onpeer: peer => this._handlePeer(peer, topic),
      onerror: err => console.log('ERR:', err)
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
  async flush () {
    const allFlushedPromises = [...this._discovery.values()].map(v => v.flushed())
    await Promise.all(allFlushedPromises)
    return new Promise((resolve, reject) => {
      this._pendingFlushes.push({
        resolve,
        reject,
        missing: this._queue.length,
        tick: this._flushTick++
      })
    })
  }

  async destroy () {
    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.reject(new Error(ERR_DESTROYED))
    }
    // TODO: Other destroy stuff
  }
}

function noop () {}
