const { EventEmitter } = require('events')
const DHT = require('hyperdht')
const spq = require('shuffled-priority-queue')
const b4a = require('b4a')

const PeerInfo = require('./lib/peer-info')
const RetryTimer = require('./lib/retry-timer')
const ConnectionSet = require('./lib/connection-set')
const PeerDiscovery = require('./lib/peer-discovery')

const MAX_PEERS = 64
const MAX_PARALLEL = 3
const MAX_CLIENT_CONNECTIONS = Infinity // TODO: Change
const MAX_SERVER_CONNECTIONS = Infinity

const ERR_MISSING_TOPIC = 'Topic is required and must be a 32-byte buffer'
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
      maxParallel = MAX_PARALLEL,
      firewall = allowAll
    } = opts
    this.keyPair = keyPair

    this.dht = opts.dht || new DHT({
      bootstrap: opts.bootstrap,
      debug: opts.debug
    })
    this.server = this.dht.createServer({
      firewall: this._handleFirewall.bind(this)
    }, this._handleServerConnection.bind(this))

    this.destroyed = false
    this.maxPeers = maxPeers
    this.maxClientConnections = maxClientConnections
    this.maxServerConnections = maxServerConnections
    this.maxParallel = maxParallel
    this.connecting = 0
    this.connections = new Set()
    this.peers = new Map()
    this.explicitPeers = new Set()
    this.listening = null

    this._discovery = new Map()
    this._timer = new RetryTimer(this._requeue.bind(this), {
      backoffs: opts.backoffs,
      jitter: opts.jitter
    })
    this._queue = spq()

    this._allConnections = new ConnectionSet()
    this._pendingFlushes = []
    this._flushTick = 0

    this._drainingQueue = false
    this._clientConnections = 0
    this._serverConnections = 0
    this._firewall = firewall

    this.dht.on('network-change', this._handleNetworkChange.bind(this))
  }

  _enqueue (peerInfo) {
    if (peerInfo.queued) return
    peerInfo.queued = true
    peerInfo._flushTick = this._flushTick
    this._queue.add(peerInfo)

    this._attemptClientConnections()
  }

  _requeue (batch) {
    for (const peerInfo of batch) {
      if ((peerInfo._updatePriority() === false) || this._allConnections.has(peerInfo.publicKey) || peerInfo.queued) continue
      peerInfo.queued = true
      peerInfo._flushTick = this._flushTick
      this._queue.add(peerInfo)
    }

    this._attemptClientConnections()
  }

  _flushMaybe (peerInfo) {
    for (let i = 0; i < this._pendingFlushes.length; i++) {
      const flush = this._pendingFlushes[i]
      if (peerInfo._flushTick > flush.tick) continue
      if (--flush.missing > 0) continue
      flush.onflush(true)
      this._pendingFlushes.splice(i--, 1)
    }
  }

  _flushAllMaybe () {
    if (this.connecting > 0 || (this._allConnections.size < this.maxPeers && this._clientConnections < this.maxClientConnections)) {
      return false
    }

    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.onflush(true)
    }

    return true
  }

  _shouldConnect () {
    return !this.destroyed &&
      this.connecting < this.maxParallel &&
      this._allConnections.size < this.maxPeers &&
      this._clientConnections < this.maxClientConnections
  }

  _shouldRequeue (peerInfo) {
    if (peerInfo.explicit) return true
    for (const topic of peerInfo.topics) {
      if (this._discovery.has(b4a.toString(topic, 'hex')) && !this.destroyed) {
        return true
      }
    }
    return false
  }

  _connect (peerInfo) {
    if (peerInfo.banned || this._allConnections.has(peerInfo.publicKey)) {
      this._flushMaybe(peerInfo)
      return
    }

    // TODO: Support async firewalling at some point.
    if (this._handleFirewall(peerInfo.publicKey, null)) {
      peerInfo.ban()
      this._flushMaybe(peerInfo)
      return
    }

    const conn = this.dht.connect(peerInfo.publicKey, {
      relayAddresses: peerInfo.relayAddresses,
      keyPair: this.keyPair
    })
    this._allConnections.add(conn)
    this.connecting++
    this._clientConnections++
    let opened = false

    conn.on('close', () => {
      if (!opened) this._connectDone()
      this.connections.delete(conn)
      this._allConnections.delete(conn)
      this._clientConnections--
      peerInfo._disconnected()
      if (this._shouldRequeue(peerInfo)) this._timer.add(peerInfo)
      if (!opened) this._flushMaybe(peerInfo)

      this._attemptClientConnections()

      this.emit('update')
    })
    conn.on('error', noop)
    conn.on('open', () => {
      opened = true
      this._connectDone()
      this.connections.add(conn)
      conn.removeListener('error', noop)
      peerInfo._connected()
      peerInfo.client = true
      this.emit('connection', conn, peerInfo)
      this._flushMaybe(peerInfo)

      this.emit('update')
    })

    this.emit('update')
  }

  _connectDone () {
    this.connecting--

    if (this.connecting < this.maxParallel) this._attemptClientConnections()
    if (this.connecting === 0) this._flushAllMaybe()
  }

  // Called when the PeerQueue indicates a connection should be attempted.
  _attemptClientConnections () {
    // Guard against re-entries - unsure if it still needed but doesn't hurt
    if (this._drainingQueue) return
    this._drainingQueue = true
    while (this._queue.length && this._shouldConnect()) {
      const peerInfo = this._queue.shift()
      peerInfo.queued = false
      this._connect(peerInfo)
    }
    this._drainingQueue = false
    if (this.connecting === 0) this._flushAllMaybe()
  }

  _handleFirewall (remotePublicKey, payload) {
    if (b4a.equals(remotePublicKey, this.keyPair.publicKey)) return true

    const peerInfo = this.peers.get(b4a.toString(remotePublicKey, 'hex'))
    if (peerInfo && peerInfo.banned) return true

    return this._firewall(remotePublicKey, payload)
  }

  _handleServerConnectionSwap (existing, conn) {
    let closed = false

    existing.on('close', () => {
      if (closed) return

      conn.removeListener('error', noop)
      conn.removeListener('close', onclose)

      this._handleServerConnection(conn)
    })

    conn.on('error', noop)
    conn.on('close', onclose)

    function onclose () {
      closed = true
    }
  }

  // Called when the DHT receives a new server connection.
  _handleServerConnection (conn) {
    if (this.destroyed) {
      // TODO: Investigate why a final server connection can be received after close
      conn.on('error', noop)
      return conn.destroy(ERR_DESTROYED)
    }

    const existing = this._allConnections.get(conn.remotePublicKey)

    if (existing) {
      // if both connections are from the same peer, pick newest. otherwise tie break based on pub keys
      const keepNew = conn.isInitiator === existing.isInitiator || b4a.compare(conn.publicKey, conn.remotePublicKey) > 0

      if (keepNew === false) {
        conn.on('error', noop)
        conn.destroy(new Error(ERR_DUPLICATE))
        return
      }

      existing.on('error', noop)
      existing.destroy(new Error(ERR_DUPLICATE))
      this._handleServerConnectionSwap(existing, conn)
      return
    }

    const peerInfo = this._upsertPeer(conn.remotePublicKey, null)

    this.connections.add(conn)
    this._allConnections.add(conn)
    this._serverConnections++

    conn.on('close', () => {
      this.connections.delete(conn)
      this._allConnections.delete(conn)
      this._serverConnections--

      this._attemptClientConnections()

      this.emit('update')
    })
    peerInfo.client = false
    this.emit('connection', conn, peerInfo)

    this.emit('update')
  }

  _upsertPeer (publicKey, relayAddresses) {
    if (b4a.equals(publicKey, this.keyPair.publicKey)) return null
    const keyString = b4a.toString(publicKey, 'hex')
    let peerInfo = this.peers.get(keyString)
    if (peerInfo) return peerInfo

    peerInfo = new PeerInfo({
      publicKey,
      relayAddresses
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
    const peerInfo = this._upsertPeer(peer.publicKey, peer.relayAddresses)
    if (peerInfo) peerInfo._topic(topic)
    if (!peerInfo || this._allConnections.has(peer.publicKey)) return
    if (!peerInfo.prioritized || peerInfo.server) peerInfo._reset()
    if (peerInfo._updatePriority()) {
      this._enqueue(peerInfo)
    }
  }

  async _handleNetworkChange () {
    const refreshes = []

    for (const discovery of this._discovery.values()) {
      refreshes.push(discovery.refresh())
    }

    await Promise.allSettled(refreshes)
  }

  status (key) {
    return this._discovery.get(b4a.toString(key, 'hex')) || null
  }

  listen () {
    if (!this.listening) this.listening = this.server.listen(this.keyPair)
    return this.listening
  }

  // Object that exposes a cancellation method (destroy)
  // TODO: When you rejoin, it should reannounce + bump lookup priority
  join (topic, opts = {}) {
    if (!topic) throw new Error(ERR_MISSING_TOPIC)
    const topicString = b4a.toString(topic, 'hex')

    let discovery = this._discovery.get(topicString)

    if (discovery && !discovery.destroyed) {
      return discovery.session(opts)
    }

    discovery = new PeerDiscovery(this, topic, {
      wait: discovery ? discovery.destroy() : null,
      onpeer: peer => this._handlePeer(peer, topic)
    })
    this._discovery.set(topicString, discovery)
    return discovery.session(opts)
  }

  // Returns a promise
  async leave (topic) {
    if (!topic) throw new Error(ERR_MISSING_TOPIC)
    const topicString = b4a.toString(topic, 'hex')
    if (!this._discovery.has(topicString)) return Promise.resolve()

    const discovery = this._discovery.get(topicString)
    await discovery.destroy()

    if (this._discovery.get(topicString) === discovery) {
      this._discovery.delete(topicString)
    }
  }

  joinPeer (publicKey) {
    const peerInfo = this._upsertPeer(publicKey, null)
    if (!peerInfo) return
    if (!this.explicitPeers.has(peerInfo)) {
      peerInfo.explicit = true
      this.explicitPeers.add(peerInfo)
    }
    if (this._allConnections.has(publicKey)) return
    if (peerInfo._updatePriority()) {
      this._enqueue(peerInfo)
    }
  }

  leavePeer (publicKey) {
    const keyString = b4a.toString(publicKey, 'hex')
    if (!this.peers.has(keyString)) return
    const peerInfo = this.peers.get(keyString)
    peerInfo.explicit = false
    this.explicitPeers.delete(peerInfo)
  }

  // Returns a promise
  async flush () {
    const allFlushed = [...this._discovery.values()].map(v => v.flushed())
    await Promise.all(allFlushed)
    if (this._flushAllMaybe()) return true
    const pendingSize = this._allConnections.size - this.connections.size
    if (!this._queue.length && !pendingSize) return true
    return new Promise((resolve) => {
      this._pendingFlushes.push({
        onflush: resolve,
        missing: this._queue.length + pendingSize,
        tick: this._flushTick++
      })
    })
  }

  async clear () {
    const cleared = Promise.allSettled([...this._discovery.values()].map(d => d.destroy()))
    this._discovery.clear()
    return cleared
  }

  async destroy () {
    if (this.destroyed) return
    this.destroyed = true

    this._timer.destroy()

    await this.clear()

    await this.server.close()

    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.onflush(false)
    }

    for (const conn of this._allConnections) {
      conn.destroy()
    }

    await this.dht.destroy()
  }

  topics () {
    return this._discovery.values()
  }
}

function noop () { }

function allowAll () {
  return false
}
