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

  get prioritised () {
    if (!this._queue) return 0
    const p = this._queue.priorities
    let cnt = 0
    for (let i = 2; i < p.length; i++) cnt += p[i].length
    return cnt
  }

  get length () {
    return this._queue.length
  }

  deduplicate (localId, remoteId, peer) {
    if (!peer.stream) return false

    const id = localId.toString('hex') + '\n' + remoteId.toString('hex')
    const cmp = Buffer.compare(localId, remoteId)

    peer._dedup = id

    if (cmp === 0) {
      peer.destroy(new Error('Connected to self'))
      return true
    }

    const other = this._dedup.get(id)

    if (!other) {
      this._dedup.set(id, peer)
      return false
    }

    const otherIsDuplicate = (other.type === peer.type)
      ? (cmp < 0 ? peer.client : !peer.client)
      : other.type === 'utp'

    if (otherIsDuplicate) { // this one is not the dup
      this._dropDuplicate(peer, other, id)
      return false
    } else { // this one is the dup
      this._dropDuplicate(other, peer, id)
      return true
    }
  }

  _dropDuplicate (peer, duplicatePeer, id) {
    duplicatePeer.duplicate = true
    duplicatePeer.emit('duplicate')
    this._dedup.set(id, peer)
    if (!duplicatePeer.client) return
    duplicatePeer.ban(true)
    peer.stream.on('close', this._unbanduplicate.bind(this, peer, duplicatePeer, id))
  }

  disconnected (peer) {
    if (peer._dedup && this._dedup.get(peer._dedup) === peer) {
      this._dedup.delete(peer._dedup)
    }
  }

  _unbanduplicate (peer, duplicatePeer, id) {
    // if we banned the surviving peer, dont unban anyone
    if (peer.banned) return

    // double check that this is exactly the one we banned earlier
    if (this._infos === null || this._infos.get(toID(duplicatePeer, this._multiplex)) !== duplicatePeer) return

    // remove and add to give it lowest possible prio
    this.remove(duplicatePeer)
    this.add(duplicatePeer)
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
    if (peer.topic) info.topic(peer.topic)
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
