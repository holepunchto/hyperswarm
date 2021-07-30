const { EventEmitter } = require('events')
const DHT = require('@hyperswarm/dht')
const spq = require('shuffled-priority-queue')

const PeerInfo = require('./lib/peer-info')
const RetryTimer = require('./lib/retry-timer')
const PublicKeySet = require('./lib/public-key-set')
const PeerDiscovery = require('./lib/peer-discovery')

const MAX_PEERS = 64
const MAX_CLIENT_CONNECTIONS = Infinity // TODO: Change
const MAX_SERVER_CONNECTIONS = Infinity

const MAX_PARALLEL_FAST_ATTEMPTS = 5
const MAX_PARALLEL_SLOW_ATTEMPTS = 1

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
      maxParallelFast = MAX_PARALLEL_FAST_ATTEMPTS,
      maxParallelSlow = MAX_PARALLEL_SLOW_ATTEMPTS,
      firewall = allowAll
    } = opts

    this.keyPair = keyPair

    const networkOpts = {}
    if (opts.bootstrap) networkOpts.bootstrap = opts.bootstrap
    this.dht = new DHT(networkOpts)

    this.server = this.dht.createServer({
      firewall: this._handleFirewall.bind(this),
      onholepunch: this._handleServerHolepunch.bind(this),
      onconnection: this._handleServerConnection.bind(this)
    })

    this.destroyed = false
    this.maxPeers = maxPeers
    this.maxClientConnections = maxClientConnections
    this.maxServerConnections = maxServerConnections
    this.maxParallelFast = maxParallelFast
    this.maxParallelSlow = maxParallelSlow
    this.connections = new PublicKeySet()
    this.peers = new PublicKeySet()

    this._listening = null
    this._discovery = new Map()
    this._timer = new RetryTimer(this._requeue.bind(this), {
      backoffs: opts.backoffs,
      jitter: opts.jitter
    })
    this._queue = spq()

    this._currentFast = 0
    this._currentSlow = 0
    this._waitingSlow = [] // Queued slow connections that should be attempted when capacity is available
    this._pendingConnections = []

    this._pendingFlushes = []
    this._flushTick = 0

    this._clientConnections = 0
    this._serverConnections = 0
    this._firewall = firewall
  }

  _enqueue (peerInfo, shouldAttempt = true) {
    const empty = !this._queue.head()
    peerInfo.queued = true
    peerInfo._flushTick = this._flushTick
    this._queue.add(peerInfo)
    if (empty && shouldAttempt) this._attemptClientConnections()
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
    return !this.destroyed &&
      this.connections.size < this.maxPeers &&
      this._clientConnections < this.maxClientConnections &&
      this._currentFast < this.maxParallelFast
  }

  _shouldRequeue (peerInfo) {
    for (const topic of peerInfo.topics) {
      if (this._discovery.has(topic.toString('hex')) && !this.destroyed) {
        return true
      }
    }
    return false
  }

  _connectionProcessed (conn, peerInfo) {
    if (peerInfo.fast) this._currentFast--
    else this._currentSlow--
    if (this._waitingSlow.length || this._queue.length) this._attemptClientConnections()
  }

  _registerConnectionListeners (conn, peerInfo) {
    let opened = false
    conn.on('error', noop)
    conn.on('close', () => {
      this.connections.delete(conn.remotePublicKey, conn)
      this._clientConnections--

      peerInfo._disconnected()
      if (this._shouldRequeue(peerInfo)) this._timer.add(peerInfo)
      if (!opened) this._flushMaybe(peerInfo)

      this._connectionProcessed(conn, peerInfo)
    })
    conn.on('open', () => {
      opened = true
      conn.removeListener('error', noop)

      peerInfo._connected()
      peerInfo.client = true
      this.emit('connection', conn, peerInfo)
      this._flushMaybe(peerInfo)

      this._connectionProcessed(conn, peerInfo)
    })
  }

  _updateConcurrency (peerInfo) {
    // The fast connection limit is enforced by _shouldConnect. Slow connections must be limited here.
    if (peerInfo.fast) {
      this._currentFast++
      return true
    }
    if (this._currentSlow < this.maxParallelSlow) {
      this._currentSlow++
      return true
    }
    this._waitingSlow.push(peerInfo)
    return false
  }

  // Called when the PeerQueue indicates a connection should be attempted.
  _attemptClientConnections () {
    // Requeue any slow connections that are waiting for a parallelism slot
    while (this._waitingSlow.length) {
      const peerInfo = this._waitingSlow.pop()
      peerInfo.eager = true
      if (peerInfo._updatePriority()) this._enqueue(peerInfo, false)
    }
    while (this._queue.length && this._shouldConnect()) {
      const peerInfo = this._queue.shift()
      peerInfo.queued = false

      if (!this._updateConcurrency(peerInfo)) continue

      if (peerInfo.banned || this.connections.has(peerInfo.publicKey)) {
        this._flushMaybe(peerInfo)
        continue
      }

      // TODO: Support async firewalling at some point.
      if (!this._handleFirewall(peerInfo.publicKey, null)) {
        peerInfo.ban()
        this._flushMaybe(peerInfo)
        continue
      }

      const conn = this.dht.connect(peerInfo.publicKey, {
        onholepunch: natInfo => this._handleClientHolepunch(peerInfo, conn, natInfo),
        nodes: peerInfo.nodes,
        keyPair: this.keyPair
      })

      this.connections.set(conn.remotePublicKey, conn)
      this._registerConnectionListeners(conn, peerInfo)
      this._clientConnections++
    }
  }

  _handleServerHolepunch (natInfo) {
    // TODO: Implement
    return true
  }

  _handleClientHolepunch (peerInfo, conn, natInfo) {
    // A few different scenarios:
    // 1. natInfo will differ from the static NAT info that was used in updateConcurrency
    //  - update peerInfo and concurrency to reflect this
    // 2. if the concurrency limit is reached, bail on this connection and ensure the peerInfo is requeued
    //  - updateConcurrency will do this
    if (peerInfo.fast === natInfo.fast) return true // If the dynamic NAT info matches the static, just continue
    if (natInfo.fast) {
      peerInfo.fast = true
      this._currentSlow--
    } else {
      peerInfo.fast = false
      this._currentFast--
    }
    return this._updateConcurrency(peerInfo)
  }

  _handleFirewall (remotePublicKey, payload) {
    if (remotePublicKey.equals(this.keyPair.publicKey)) return false

    const existing = this.connections.get(remotePublicKey)
    if (existing) {
      if (existing.isInitiator === true && isOpen(existing)) return false
    }

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
      if (existing.isInitiator && isOpen(existing)) {
        conn.on('error', noop)
        conn.destroy(new Error(ERR_DUPLICATE))
        return
      }
      existing.on('error', noop)
      existing.destroy(new Error(ERR_DUPLICATE))
    }

    const peerInfo = this._upsertPeer(conn.remotePublicKey, null)

    this.connections.set(conn.remotePublicKey, conn)
    this._serverConnections++

    conn.on('close', () => {
      this.connections.delete(conn.remotePublicKey, conn)
      this._serverConnections--
    })
    peerInfo.client = false
    this.emit('connection', conn, peerInfo)
  }

  _upsertPeer (publicKey, nodes) {
    if (publicKey.equals(this.keyPair.publicKey)) return null

    let peerInfo = this.peers.get(publicKey)
    if (peerInfo) {
      if (nodes) peerInfo.nodes = nodes
      return peerInfo
    }

    peerInfo = new PeerInfo({
      publicKey,
      nodes
    })

    this.peers.set(publicKey, peerInfo)
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
    if (peerInfo) peerInfo._topic(topic)
    if (!peerInfo || this.connections.has(peer.publicKey)) return
    if (!peerInfo.prioritized || peerInfo.server) peerInfo._reset()
    if (peerInfo._updatePriority()) {
      this._enqueue(peerInfo)
    }
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
    if (!topic) throw new Error(ERR_MISSING_TOPIC)
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
    if (!topic) throw new Error(ERR_MISSING_TOPIC)
    const topicString = topic.toString('hex')
    if (!this._discovery.has(topicString)) return Promise.resolve()
    const discovery = this._discovery.get(topicString)
    this._discovery.delete(topicString)
    return discovery.destroy()
  }

  // Returns a promise
  async flush () {
    const allFlushed = [...this._discovery.values()].map(v => v.flushed())
    await Promise.all(allFlushed)

    let pendingConnections = 0
    for (const conn of this.connections) {
      if (!conn.id) pendingConnections++
    }

    if (!this._queue.length && pendingConnections === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this._pendingFlushes.push({
        resolve,
        reject,
        missing: this._queue.length,
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

    await this.dht.destroy()
    await this.server.close()

    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.reject(new Error(ERR_DESTROYED))
    }

    for (const conn of this.connections) {
      conn.destroy()
    }
  }
}

function noop () { }

function allowAll () {
  return true
}

function isOpen (stream) {
  return !!stream.id
}
