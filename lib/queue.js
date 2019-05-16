'use strict'

const spq = require('shuffled-priority-queue')
const { EventEmitter } = require('events')
const peerInfo = require('./peer-info')
const timer = require('./bulk-timer')

module.exports = (opts) => new PeerQueue(opts)

class PeerQueue extends EventEmitter {
  constructor (opts = {}) {
    super()

    const {
      requeue = [ 1000, 5000, 15000 ]
    } = opts

    this.destroyed = false
    this._infos = new Map()
    this._queue = spq()

    const push = this._push.bind(this)

    this._requeue = requeue.map(ms => timer(ms, push))
  }

  _push (batch) {
    const empty = !this._queue.head()
    let readable = false

    for (const info of batch) {
      info.active(false)
      if (!info.update()) continue
      this._queue.add(info)
      readable = true
    }

    if (empty && readable) this.emit('readable')
  }

  requeue (info) {
    if (this.destroyed) return false
    const queue = info.requeue()
    if (queue === -1) return false
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

    const id = toID(peer)

    let info = this._infos.get(id)

    if (!info) {
      info = peerInfo(peer)
      this._infos.set(id, info)
    }

    if (this._queue.has(info)) return
    if (!info.update()) return

    const empty = !this._queue.head()
    this._queue.add(info)
    if (empty) this.emit('readable')
  }

  remove (peer) {
    if (this.destroyed) return

    const id = toID(peer)
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

    for (const timer of this._requeue) {
      timer.destroy()
    }

    this._infos = null
    this._queue = null
  }
}

function toID (peer) {
  return peer.host + ':' + peer.port
}
