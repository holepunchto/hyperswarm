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
      firewall = allowAll
    } = opts

    this.keyPair = keyPair
    this.dht = new DHT({
      bootstrap: opts.bootstrap
    })
    this.server = this.dht.createServer({
      firewall: this._handleFirewall.bind(this),
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
    this._pendingConnections = []
    this._flushTick = 0

    this._clientConnections = 0
    this._serverConnections = 0
    this._firewall = firewall
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
      if ((peerInfo._updatePriority() === false) || this.connections.has(peerInfo.publicKey)) continue
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

      if (peerInfo.banned || this.connections.has(peerInfo.publicKey)) {
        this._flushMaybe(peerInfo)
        continue
      }

      // TODO: Support async firewalling at some point.
      if (!this._firewall(peerInfo.publicKey, null)) {
        peerInfo.ban()
        this._flushMaybe(peerInfo)
        continue
      }

      const conn = this.dht.connect(peerInfo.publicKey, {
        nodes: peerInfo.nodes,
        keyPair: this.keyPair
      })
      this.connections.add(conn)

      this._pendingConnections.push(conn)
      this._clientConnections++
      let opened = false

      conn.on('close', () => {
        this.connections.delete(conn)
        this._pendingConnections.splice(this._pendingConnections.indexOf(conn), 1)
        this._clientConnections--
        peerInfo._disconnected()
        this._timer.add(peerInfo)
        if (!opened) this._flushMaybe(peerInfo)
      })
      conn.on('error', noop)
      conn.on('open', () => {
        opened = true
        this._pendingConnections.splice(this._pendingConnections.indexOf(conn), 1)
        conn.removeListener('error', noop)
        peerInfo._connected()
        peerInfo.client = true
        this.emit('connection', conn, peerInfo)
        this._flushMaybe(peerInfo)
      })
    }
  }

  _handleFirewall (remotePublicKey, payload) {
    const existing = this.connections.get(remotePublicKey)
    if (existing && isOpen(existing)) return false
    if (remotePublicKey.equals(this.keyPair.publicKey)) return false
    const peerInfo = this.peers.get(remotePublicKey.toString('hex'))
    if (peerInfo && peerInfo.banned) return false
    return this._firewall(remotePublicKey, payload)
  }

  // Called when the DHT receives a new server connection.
  _handleServerConnection (conn) {
    if (this.destroyed) {
      // TODO: Investigate why a final server connection can be received after close
      conn.on('error', noop)
      return conn.destroy(ERR_DESTROYED)
    }

    const existing = this.connections.get(conn.remotePublicKey)
    if (existing) {
      if (isOpen(existing)) {
        conn.on('error', noop)
        conn.destroy(new Error(ERR_DUPLICATE))
        return
      }

      existing.destroy(new Error(ERR_DUPLICATE))
    }

    const peerInfo = this._upsertPeer(conn.remotePublicKey, null)

    this.connections.add(conn)
    this._serverConnections++

    conn.on('close', () => {
      this.connections.delete(conn)
      this._serverConnections--
    })
    peerInfo.client = false
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
    if (peerInfo) peerInfo.topic(topic)
    if (!peerInfo || this.connections.has(peer.publicKey)) return
    if (!peerInfo.prioritized || peerInfo.server) peerInfo._reset()
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
      onpeer: peer => this._handlePeer(peer, topic)
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
    const allRefreshedPromises = [...this._discovery.values()].map(v => v.refreshed())
    await Promise.all(allRefreshedPromises)
    if (!this._queue.length && !this._pendingConnections.length) return Promise.resolve()
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
    if (this.destroyed) return
    this.destroyed = true

    this._timer.destroy()
    this.dht.destroy()
    await this.server.close()

    for (const discovery of this._discovery.values()) {
      discovery.destroy()
    }

    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.reject(new Error(ERR_DESTROYED))
    }

    for (const conn of this.connections) {
      conn.destroy()
    }
  }
}

function noop () {}

function allowAll () {
  return true
}

function isOpen (stream) {
  return !!stream.id
}
