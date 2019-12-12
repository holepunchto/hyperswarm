'use strict'

const spq = require('shuffled-priority-queue')
const { EventEmitter } = require('events')
const peerInfo = require('./peer-info')
const timer = require('./bulk-timer')
const noop = () => {}
module.exports = (opts) => new PeerQueue(opts)

const BACKOFF_S = 1000
const BACKOFF_M = 5000
const BACKOFF_L = 15000
const FORGET_UNRESPONSIVE = 7500
const FORGET_BANNED = Infinity

class PeerQueue extends EventEmitter {
  constructor (opts = {}) {
    super()

    const {
      requeue = [ BACKOFF_S, BACKOFF_M, BACKOFF_L ],
      forget = {
        unresponsive: FORGET_UNRESPONSIVE,
        banned: FORGET_BANNED
      }
    } = opts

    const [
      s = BACKOFF_S,
      m = BACKOFF_M,
      l = BACKOFF_L
    ] = requeue
    const backoff = [s, m, l, ...requeue.slice(3)]

    const {
      unresponsive = FORGET_UNRESPONSIVE,
      banned = FORGET_BANNED
    } = forget

    this.destroyed = false
    this._infos = new Map()
    this._queue = spq()
    this._multiplex = !!opts.multiplex

    const push = this._push.bind(this)
    const release = this._release.bind(this)
    this._requeue = backoff.map(ms => timer(ms, push))
    this._remove = [unresponsive, banned].map((ms) => {
      return ms < Infinity
        ? timer(ms, release)
        : { push: noop, destroy: noop } // noop for infinite time
    })

    this._dedup = new Map()
  }

  deduplicate (localId, remoteId, peer) {
    const id = localId.toString('hex') + '\n' + remoteId.toString('hex')
    const other = this._dedup.get(id)

    if (!other) {
      this._dedup.set(id, peer)
      peer.stream.on('close', this._ondedupclose.bind(this, peer, id))
      return false
    }

    const cmp = Buffer.compare(localId, remoteId)

    if (cmp === 0) {
      // destroy and ban connections to ourself
      other.destroy(new Error('Connected to self'))
      peer.destroy(new Error('Connected to self'))
      return true
    }

    if (cmp < 0 ? peer.client : !peer.client) {
      if (other.client && !other.banned) peer.duplicate = other
      other.destroy(new Error('Duplicate connection'))
      this._dedup.set(id, peer)
      peer.stream.on('close', this._ondedupclose.bind(this, peer, id))
      return false
    }

    if (peer.client && !peer.banned) other.duplicate = peer
    peer.destroy(new Error('Duplicate connection'))
    return true
  }

  _ondedupclose (peer, id) {
    if (this._dedup.get(id) === peer) this._dedup.delete(id)

    if (!peer.duplicate || !peer.duplicate.client || !peer.duplicate.banned) return

    // double check that this is exactly the one we banned earlier

    if (this._infos === null || this._infos.get(toID(peer.duplicate.peer, this._multiplex)) !== peer.duplicate) return

    // remove and add to give it lowest possible prio
    this.remove(peer.duplicate.peer)
    this.add(peer.duplicate.peer)
  }

  _release (batch) {
    for (const info of batch) this.remove(info.peer)
  }

  _push (batch) {
    const empty = !this._queue.head()
    let readable = false

    for (const info of batch) {
      info.active(false)
      if (info.update() === false) {
        this._remove[info.banned ? 1 : 0].push(info)
        continue
      }
      this._queue.add(info)
      readable = true
    }
    if (empty && readable) this.emit('readable')
  }

  requeue (info) {
    if (this.destroyed) return false
    const queue = info.requeue()
    if (queue === -1) {
      // Either we exhausted reconnect attempts, the peer was banned or
      // reconnect is disabled. In any case - we have to remove the peer.
      this._remove[info.banned ? 1 : 0].push(info)
      return false
    }
    this._requeue[queue].push(info)
    return true
  }

  shift () {
    if (this.destroyed) return null
    const info = this._queue.shift()
    if (info) info.active(true)
    return info
  }

  add (peer) {
    if (this.destroyed) return

    // TODO: support a multiplex: true flag, that will make the info object emit a
    // 'topic' event instead of making dup connections, per topic
    const id = toID(peer, this._multiplex)

    let info = this._infos.get(id)
    const existing = !!info

    if (!info) {
      info = peerInfo(peer, this)
      this._infos.set(id, info)
    }
    info.topic(peer.topic)
    if (this._multiplex && existing) return

    if (this._queue.has(info)) return
    if (!info.update()) return

    const empty = !this._queue.head()
    this._queue.add(info)
    if (empty) this.emit('readable')
  }

  remove (peer) {
    if (this.destroyed) return

    const id = toID(peer, this._multiplex)
    const info = this._infos.get(id)

    if (info) {
      info.destroy()
      this._queue.remove(info)
      this._infos.delete(id)
    }
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true

    for (const timer of this._requeue) timer.destroy()
    for (const timer of this._remove) timer.destroy()

    this._infos = null
    this._queue = null
  }
}

function toID (peer, multiplex) {
  const baseID = peer.host + ':' + peer.port
  if (multiplex) return baseID
  return baseID + (peer.topic ? '@' + peer.topic.toString('hex') : '')
}

module.exports.PeerQueue = PeerQueue
