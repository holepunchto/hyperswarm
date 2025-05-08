const safetyCatch = require('safety-catch')
const b4a = require('b4a')

const REFRESH_INTERVAL = 1000 * 60 * 10 // 10 min
const RANDOM_JITTER = 1000 * 60 * 2 // 2 min
const DELAY_GRACE_PERIOD = 1000 * 30 // 30s

module.exports = class PeerDiscovery {
  constructor (swarm, topic, { limit = Infinity, wait = null, suspended = false, onpeer = noop, onerror = safetyCatch }) {
    this.limit = limit
    this.swarm = swarm
    this.topic = topic
    this.isClient = false
    this.isServer = false
    this.destroyed = false
    this.destroying = null
    this.suspended = suspended

    this._sessions = []
    this._clientSessions = 0
    this._serverSessions = 0

    this._onpeer = onpeer
    this._onerror = onerror

    this._activeQuery = null
    this._timer = null
    this._currentRefresh = null
    this._closestNodes = null
    this._firstAnnounce = true
    this._needsUnannounce = false
    this._refreshes = 0
    this._wait = wait
  }

  session ({ server = true, client = true, limit = Infinity, onerror = safetyCatch }) {
    if (this.destroyed) throw new Error('PeerDiscovery is destroyed')
    const session = new PeerDiscoverySession(this)
    session.refresh({ server, client, limit }).catch(onerror)
    this._sessions.push(session)
    return session
  }

  _refreshLater (eager) {
    const jitter = Math.round(Math.random() * RANDOM_JITTER)
    const delay = !eager
      ? REFRESH_INTERVAL + jitter
      : jitter

    if (this._timer) clearTimeout(this._timer)

    const startTime = Date.now()
    this._timer = setTimeout(() => {
      // If your laptop went to sleep, and is coming back online...
      const overdue = Date.now() - startTime > delay + DELAY_GRACE_PERIOD
      if (overdue) this._refreshLater(true)
      else this.refresh().catch(this._onerror)
    }, delay)
  }

  _isActive () {
    return !this.destroyed && !this.suspended
  }

  // TODO: Allow announce to be an argument to this
  // TODO: Maybe announce should be a setter?
  async _refresh () {
    if (this.suspended) return
    const clock = ++this._refreshes

    if (this._wait) {
      await this._wait
      this._wait = null
      if (clock !== this._refreshes || !this._isActive()) return
    }

    const clear = this.isServer && this._firstAnnounce
    if (clear) this._firstAnnounce = false

    const opts = {
      clear,
      closestNodes: this._closestNodes
    }

    if (this.isServer) {
      await this.swarm.listen()
      // if a parallel refresh is happening, yield to the new one
      if (clock !== this._refreshes || !this._isActive()) return
      this._needsUnannounce = true
    }

    const announcing = this.isServer
    const query = this._activeQuery = announcing
      ? this.swarm.dht.announce(this.topic, this.swarm.keyPair, this.swarm.server.relayAddresses, opts)
      : this._needsUnannounce
        ? this.swarm.dht.lookupAndUnannounce(this.topic, this.swarm.keyPair, opts)
        : this.swarm.dht.lookup(this.topic, opts)

    try {
      for await (const data of this._activeQuery) {
        if (!this.isClient || !this._isActive()) continue
        for (const peer of data.peers) {
          if (this.limit === 0) return
          this.limit--
          this._onpeer(peer, data)
        }
      }
    } catch (err) {
      if (this._isActive()) throw err
    } finally {
      if (this._activeQuery === query) {
        this._activeQuery = null
        if (!this.destroyed && !this.suspended) this._refreshLater(false)
      }
    }

    // This is set at the very end, when the query completes successfully.
    this._closestNodes = query.closestNodes

    if (clock !== this._refreshes) return

    // In this is the latest query, unannounce has been fulfilled as well
    if (!announcing) this._needsUnannounce = false
  }

  async refresh () {
    if (this.destroyed) throw new Error('PeerDiscovery is destroyed')

    const server = this._serverSessions > 0
    const client = this._clientSessions > 0

    if (this.suspended) return

    if (server === this.isServer && client === this.isClient) {
      if (this._currentRefresh) return this._currentRefresh
      this._currentRefresh = this._refresh()
    } else {
      if (this._activeQuery) this._activeQuery.destroy()
      this.isServer = server
      this.isClient = client
      this._currentRefresh = this._refresh()
    }

    const refresh = this._currentRefresh
    try {
      await refresh
    } catch {
      return false
    } finally {
      if (refresh === this._currentRefresh) {
        this._currentRefresh = null
      }
    }

    return true
  }

  async flushed () {
    if (this.swarm.listening) await this.swarm.listening

    try {
      await this._currentRefresh
      return true
    } catch {
      return false
    }
  }

  async _destroyMaybe () {
    if (this.destroyed) return

    try {
      if (this._sessions.length === 0) await this.swarm.leave(this.topic)
      else if (this._serverSessions === 0 && this._needsUnannounce) await this.refresh()
    } catch (err) { // ignore network failures here, as we are tearing down
      safetyCatch(err)
    }
  }

  destroy () {
    if (this.destroying) return this.destroying
    this.destroying = this._destroy()
    return this.destroying
  }

  async _abort (log) {
    const id = log === noop ? '' : b4a.toString(this.topic, 'hex')

    log('Aborting discovery', id)
    if (this._wait) await this._wait
    log('Aborting discovery (post wait)', id)

    if (this._activeQuery) {
      this._activeQuery.destroy()
      this._activeQuery = null
    }
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }

    let nodes = this._closestNodes

    if (this._currentRefresh) {
      try {
        await this._currentRefresh
      } catch {
        // If the destroy causes the refresh to fail, suppress it.
      }
    }

    log('Aborting discovery (post refresh)', id)
    if (this._isActive()) return

    if (!nodes) nodes = this._closestNodes
    else if (this._closestNodes !== nodes) {
      const len = nodes.length
      for (const newer of this._closestNodes) {
        if (newer.id && !hasNode(nodes, len, newer)) nodes.push(newer)
      }
    }

    if (this._needsUnannounce) {
      log('Unannouncing discovery', id)
      if (nodes && nodes.length) await this.swarm.dht.unannounce(this.topic, this.swarm.keyPair, { closestNodes: nodes, onlyClosestNodes: true, force: true })
      this._needsUnannounce = false
      log('Unannouncing discovery (done)', id)
    }
  }

  _destroy () {
    if (this.destroyed) return
    this.destroyed = true
    return this._abort(noop)
  }

  async suspend ({ log = noop } = {}) {
    if (this.suspended) return
    this.suspended = true
    try {
      await this._abort(log)
    } catch {
      // ignore
    }
  }

  resume () {
    if (!this.suspended) return
    this.suspended = false
    this.refresh().catch(noop)
  }
}

class PeerDiscoverySession {
  constructor (discovery) {
    this.discovery = discovery
    this.isClient = false
    this.isServer = false
    this.destroyed = false
  }

  get swarm () {
    return this.discovery.swarm
  }

  get topic () {
    return this.discovery.topic
  }

  async refresh ({ client = this.isClient, server = this.isServer, limit = Infinity } = {}) {
    if (this.destroyed) throw new Error('PeerDiscovery is destroyed')
    if (!client && !server) throw new Error('Cannot refresh with neither client nor server option')

    if (client !== this.isClient) {
      this.isClient = client
      this.discovery._clientSessions += client ? 1 : -1
    }

    if (server !== this.isServer) {
      this.isServer = server
      this.discovery._serverSessions += server ? 1 : -1
    }

    this.discovery.limit = limit

    return this.discovery.refresh()
  }

  async flushed () {
    return this.discovery.flushed()
  }

  async destroy () {
    if (this.destroyed) return
    this.destroyed = true

    if (this.isClient) this.discovery._clientSessions--
    if (this.isServer) this.discovery._serverSessions--

    const index = this.discovery._sessions.indexOf(this)
    const head = this.discovery._sessions.pop()

    if (head !== this) this.discovery._sessions[index] = head

    return this.discovery._destroyMaybe()
  }
}

function hasNode (nodes, len, node) {
  for (let i = 0; i < len; i++) {
    const existing = nodes[i]
    if (existing.id && b4a.equals(existing.id, node.id)) return true
  }

  return false
}

function noop () {}
