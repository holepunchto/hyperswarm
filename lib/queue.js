const spq = require('shuffled-priority-queue')
const BulkTimer = require('./bulk-timer')

const BACKOFF_S = 1000
const BACKOFF_M = 5000
const BACKOFF_L = 15000

module.exports = class PeerQueue {
  constructor ({ onreadable = noop, backoffs = [BACKOFF_S, BACKOFF_M, BACKOFF_L] } = {}) {
    this._queue = spq()
    this._onreadable = onreadable
    this.destroyed = false

    const push = this._push.bind(this)
    this._sTimer = new BulkTimer(backoffs[0], push)
    this._mTimer = new BulkTimer(backoffs[1], push)
    this._lTimer = new BulkTimer(backoffs[2], push)
  }

  _selectRetryDelay (peerInfo) {
    if (peerInfo.banned || !peerInfo.reconnecting || peerInfo.attempts > 3) return null
    if (peerInfo.proven) {
      switch (peerInfo.attempts) {
        case 1: return this._sTimer
        case 2: return this._mTimer
        case 3: return this._lTimer
      }
    } else {
      switch (peerInfo.attempts) {
        case 1: return this._mTimer
        case 2: return this._lTimer
        case 3: return this._lTimer
      }
    }
  }

  _push (batch) {
    const empty = !this._queue.head()
    let readable = false

    for (const peerInfo of batch) {
      if (peerInfo._updatePriority() === false) continue
      peerInfo.queued = true
      this._queue.add(peerInfo)
      readable = true
    }

    if (empty && readable) this._onreadable()
  }

  get length () {
    return this._queue.length
  }

  queue (peer) {
    if (this.destroyed) return
    const empty = !this._queue.head()
    peer.queued = true
    this._queue.add(peer)
    if (empty) this._onreadable()
  }

  queueLater (peer) {
    if (this.destroyed) return
    const timer = this._selectRetryDelay(peer)
    if (!timer) return
    timer.add(peer)
  }

  shift () {
    const peerInfo = this._queue.shift()
    if (peerInfo) peerInfo.queued = false
    return peerInfo
  }

  destroy () {
    this.destroyed = true
    this._sTimer.destroy()
    this._mTimer.destroy()
    this._lTimer.destroy()
  }
}

function noop () {}
