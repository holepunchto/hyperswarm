const REFRESH_INTERVAL = 1000 * 60 * 10 // 10 min
const RANDOM_JITTER = 1000 * 60 * 2 // 2 min
const DELAY_GRACE_PERIOD = 1000 * 30 // 30s

module.exports = class PeerDiscovery {
  constructor (swarm, topic, { server = true, client = true, onpeer = noop, onerror = noop }) {
    this.swarm = swarm
    this.topic = topic
    this.isClient = client
    this.isServer = server
    this.destroyed = false

    this._onpeer = onpeer
    this._onerror = onerror

    this._activeQuery = null
    this._timer = null
    this._currentRefresh = null
    this._closestNodes = null
    this._firstAnnounce = true

    this.refresh().catch(this._onerror)
  }

  _ready () {
    return this.swarm.listen()
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
    const clear = this.isServer && this._firstAnnounce
    if (clear) this._firstAnnounce = false

    const opts = {
      clear,
      closestNodes: this._closestNodes
    }

    const query = this._activeQuery = this.isServer
      ? this.swarm.dht.announce(this.topic, this.swarm.keyPair, this.swarm.server.nodes, opts)
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
  }

  async refresh ({ client = this.isClient, server = this.isServer } = {}) {
    if (this.destroyed) throw new Error('PeerDiscovery is destroyed')
    if (!client && !server) throw new Error('Cannot refresh with neither client nor server option')

    await this._ready()
    if (this.destroyed) return

    if (server === this.isServer && client === this.isClient) {
      if (this._currentRefresh) {
        return this._currentRefresh
      }
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
    await this._ready()
    return this._currentRefresh
  }

  async destroy () {
    if (this.destroyed) return
    this.destroyed = true
    await this._ready()

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
      } catch (_) {
        // If the destroy causes the refresh to fail, suppress it.
      }
    }

    if (!this.isServer) return
    return this.swarm.dht.unannounce(this.topic, this.swarm.keyPair)
  }
}

function noop () {}
