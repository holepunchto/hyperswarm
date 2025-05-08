const { EventEmitter } = require('events')
const DHT = require('hyperdht')
const spq = require('shuffled-priority-queue')
const b4a = require('b4a')
const unslab = require('unslab')

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
      relayThrough,
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
      nodes: opts.nodes,
      port: opts.port
    })
    this.server = this.dht.createServer({
      firewall: this._handleFirewall.bind(this),
      relayThrough: this._maybeRelayConnection.bind(this)
    }, this._handleServerConnection.bind(this))

    this.destroyed = false
    this.suspended = false
    this.maxPeers = maxPeers
    this.maxClientConnections = maxClientConnections
    this.maxServerConnections = maxServerConnections
    this.maxParallel = maxParallel
    this.relayThrough = relayThrough || null

    this.connecting = 0
    this.connections = new Set()
    this.peers = new Map()
    this.explicitPeers = new Set()
    this.listening = null
    this.stats = {
      updates: 0,
      connects: {
        client: {
          opened: 0,
          closed: 0,
          attempted: 0
        },
        server: {
          // Note: there is no notion of 'attempts' for server connections
          opened: 0,
          closed: 0
        }
      }
    }

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
    this.on('update', this._handleUpdate)
  }

  _maybeRelayConnection (force) {
    if (!this.relayThrough) return null
    return this.relayThrough(force)
  }

  _enqueue (peerInfo) {
    if (peerInfo.queued) return
    peerInfo.queued = true
    peerInfo._flushTick = this._flushTick
    this._queue.add(peerInfo)

    this._attemptClientConnections()
  }

  _requeue (batch) {
    if (this.suspended) return
    for (const peerInfo of batch) {
      peerInfo.waiting = false

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

  _shouldConnectExplicit () {
    return !this.destroyed &&
      !this.suspended &&
      this.connecting < this.maxParallel
  }

  _shouldConnect () {
    return !this.destroyed &&
      !this.suspended &&
      this.connecting < this.maxParallel &&
      this._allConnections.size < this.maxPeers &&
      this._clientConnections < this.maxClientConnections
  }

  _shouldRequeue (peerInfo) {
    if (this.suspended) return false
    if (peerInfo.explicit) return true
    for (const topic of peerInfo.topics) {
      if (this._discovery.has(b4a.toString(topic, 'hex')) && !this.destroyed) {
        return true
      }
    }
    return false
  }

  _connect (peerInfo, queued) {
    if (peerInfo.banned || this._allConnections.has(peerInfo.publicKey)) {
      if (queued) this._flushMaybe(peerInfo)
      return
    }

    // TODO: Support async firewalling at some point.
    if (this._handleFirewall(peerInfo.publicKey, null)) {
      peerInfo.ban(true)
      if (queued) this._flushMaybe(peerInfo)
      return
    }

    const relayThrough = this._maybeRelayConnection(peerInfo.forceRelaying)
    const conn = this.dht.connect(peerInfo.publicKey, {
      relayAddresses: peerInfo.relayAddresses,
      keyPair: this.keyPair,
      relayThrough
    })
    this._allConnections.add(conn)

    this.stats.connects.client.attempted++

    this.connecting++
    this._clientConnections++
    let opened = false

    const onerror = (err) => {
      if (this.relayThrough && shouldForceRelaying(err.code)) {
        peerInfo.forceRelaying = true
        // Reset the attempts in order to fast connect to relay
        peerInfo.attempts = 0
      }
    }

    // Removed once a connection is opened
    conn.on('error', onerror)

    conn.on('open', () => {
      opened = true
      this.stats.connects.client.opened++

      this._connectDone()
      this.connections.add(conn)
      conn.removeListener('error', onerror)
      peerInfo._connected()
      peerInfo.client = true
      this.emit('connection', conn, peerInfo)
      if (queued) this._flushMaybe(peerInfo)

      this.emit('update')
    })
    conn.on('close', () => {
      if (!opened) this._connectDone()
      this.stats.connects.client.closed++

      this.connections.delete(conn)
      this._allConnections.delete(conn)
      this._clientConnections--
      peerInfo._disconnected()

      peerInfo.waiting = this._shouldRequeue(peerInfo) && this._timer.add(peerInfo)
      this._maybeDeletePeer(peerInfo)

      if (!opened && queued) this._flushMaybe(peerInfo)

      this._attemptClientConnections()

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

    for (const peerInfo of this.explicitPeers) {
      if (!this._shouldConnectExplicit()) break
      if (peerInfo.attempts >= 5 || (Date.now() - peerInfo.disconnectedTime) < peerInfo.attempts * 1000) continue
      this._connect(peerInfo, false)
    }

    while (this._queue.length && this._shouldConnect()) {
      const peerInfo = this._queue.shift()
      peerInfo.queued = false
      this._connect(peerInfo, true)
    }
    this._drainingQueue = false
    if (this.connecting === 0) this._flushAllMaybe()
  }

  _handleFirewall (remotePublicKey, payload) {
    if (this.suspended) return true
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
    if (this.destroyed || this.suspended) {
      // TODO: Investigate why a final server connection can be received after close
      conn.on('error', noop)
      return conn.destroy(ERR_DESTROYED)
    }

    const existing = this._allConnections.get(conn.remotePublicKey)

    if (existing) {
      // If both connections are from the same peer,
      // - pick the new one if the existing stream is already established (has sent and received bytes),
      //   because the other client must have lost that connection and be reconnecting
      // - otherwise, pick the one thats expected to initiate in a tie break
      const existingIsOutdated = existing.rawBytesRead > 0 && existing.rawBytesWritten > 0
      const expectedInitiator = b4a.compare(conn.publicKey, conn.remotePublicKey) > 0
      const keepNew = existingIsOutdated || (expectedInitiator === conn.isInitiator)

      if (keepNew === false) {
        existing.sendKeepAlive()
        conn.on('error', noop)
        conn.destroy(new Error(ERR_DUPLICATE))
        return
      }

      existing.on('error', noop)
      existing.destroy(new Error(ERR_DUPLICATE))
      this._handleServerConnectionSwap(existing, conn)
      return
    }

    // When reaching here, the connection will always be 'opened' next tick
    this.stats.connects.server.opened++

    const peerInfo = this._upsertPeer(conn.remotePublicKey, null)

    this.connections.add(conn)
    this._allConnections.add(conn)
    this._serverConnections++

    conn.on('close', () => {
      this.connections.delete(conn)
      this._allConnections.delete(conn)
      this._serverConnections--
      this.stats.connects.server.closed++

      this._maybeDeletePeer(peerInfo)

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

    if (peerInfo) {
      peerInfo.relayAddresses = relayAddresses // new is always better
      return peerInfo
    }

    peerInfo = new PeerInfo({
      publicKey,
      relayAddresses
    })

    this.peers.set(keyString, peerInfo)
    return peerInfo
  }

  _handleUpdate () {
    this.stats.updates++
  }

  _maybeDeletePeer (peerInfo) {
    if (!peerInfo.shouldGC()) return

    const hasActiveConn = this._allConnections.has(peerInfo.publicKey)
    if (hasActiveConn) return

    const keyString = b4a.toString(peerInfo.publicKey, 'hex')
    this.peers.delete(keyString)
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
    // prioritize figuring out if existing connections are dead
    for (const conn of this._allConnections) {
      conn.sendKeepAlive()
    }

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
    topic = unslab(topic)

    const topicString = b4a.toString(topic, 'hex')

    let discovery = this._discovery.get(topicString)

    if (discovery && !discovery.destroyed) {
      return discovery.session(opts)
    }

    discovery = new PeerDiscovery(this, topic, {
      limit: opts.limit,
      wait: discovery ? discovery.destroy() : null,
      suspended: this.suspended,
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

    try {
      await discovery.destroy()
    } catch {
      // ignore, prop network
    }

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
    this._maybeDeletePeer(peerInfo)
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

  async destroy ({ force } = {}) {
    if (this.destroyed && !force) return
    this.destroyed = true

    this._timer.destroy()

    if (!force) await this.clear()

    await this.server.close()

    while (this._pendingFlushes.length) {
      const flush = this._pendingFlushes.pop()
      flush.onflush(false)
    }

    await this.dht.destroy({ force })
  }

  async suspend ({ log = noop } = {}) {
    if (this.suspended) return

    const promises = []

    promises.push(this.server.suspend({ log }))

    for (const discovery of this._discovery.values()) {
      promises.push(discovery.suspend({ log }))
    }

    for (const connection of this._allConnections) {
      connection.destroy()
    }

    this.suspended = true

    log('Suspending server and discovery... (' + promises.length + ')')
    await Promise.allSettled(promises)
    log('Done, suspending the dht...')
    await this.dht.suspend({ log })
    log('Done, swarm fully suspended')
  }

  async resume ({ log = noop } = {}) {
    if (!this.suspended) return

    log('Resuming the dht')
    await this.dht.resume()
    log('Done, resuming the server')
    await this.server.resume()
    log('Done, all discovery')

    for (const discovery of this._discovery.values()) {
      discovery.resume()
    }

    this._attemptClientConnections()
    this.suspended = false
  }

  topics () {
    return this._discovery.values()
  }
}

function noop () { }

function allowAll () {
  return false
}

function shouldForceRelaying (code) {
  return (code === 'HOLEPUNCH_ABORTED') ||
    (code === 'HOLEPUNCH_DOUBLE_RANDOMIZED_NATS') ||
    (code === 'REMOTE_NOT_HOLEPUNCHABLE')
}
