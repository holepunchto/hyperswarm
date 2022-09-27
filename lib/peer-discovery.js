const safetyCatch = require('safety-catch')

const REFRESH_INTERVAL = 1000 * 60 * 10 // 10 min
const RANDOM_JITTER = 1000 * 60 * 2 // 2 min
const DELAY_GRACE_PERIOD = 1000 * 30 // 30s

module.exports = class PeerDiscovery {
  constructor (swarm, topic, { wait = null, onpeer = noop, onerror = safetyCatch }) {
    this.swarm = swarm
    this.topic = topic
    this.isClient = false
    this.isServer = false
    this.destroyed = false
    this.destroying = null

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

  session ({ server = true, client = true, onerror = safetyCatch }) {
    if (this.destroyed) throw new Error('PeerDiscovery is destroyed')
    const session = new PeerDiscoverySession(this)
    session.refresh({ server, client }).catch(onerror)
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

  // TODO: Allow announce to be an argument to this
  // TODO: Maybe announce should be a setter?
  async _refresh () {
    const clock = ++this._refreshes

    if (this._wait) {
      await this._wait
      this._wait = null
      if (clock !== this._refreshes) return
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
      if (clock !== this._refreshes) return
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
        if (!this.isClient) continue
        for (const peer of data.peers) {
          this._onpeer(peer, data)
        }
      }
    } finally {
      if (this._activeQuery === query) {
        this._activeQuery = null
        if (!this.destroyed) this._refreshLater(false)
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

    if (this.destroyed) return

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
    } finally {
      if (refresh === this._currentRefresh) {
        this._currentRefresh = null
      }
    }
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
    if (this._sessions.length === 0) await this.swarm.leave(this.topic)
    else if (this._serverSessions === 0 && this._needsUnannounce) await this.refresh()
  }

  destroy () {
    if (this.destroying) return this.destroying
    this.destroying = this._destroy()
    return this.destroying
  }

  async _destroy () {
    if (this.destroyed) return
    this.destroyed = true

    if (this._wait) await this._wait

    if (this._activeQuery) {
      this._activeQuery.destroy()
      this._activeQuery = null
    }
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }

    if (this._currentRefresh) {
      try {
        await this._currentRefresh
      } catch {
        // If the destroy causes the refresh to fail, suppress it.
      }
    }

    if (this._needsUnannounce) {
      await this.swarm.dht.unannounce(this.topic, this.swarm.keyPair)
      this._needsUnannounce = false
    }
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

  async refresh ({ client = this.isClient, server = this.isServer } = {}) {
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

function noop () {}
