const BulkTimer = require('./bulk-timer')

const BACKOFF_JITTER = 500
const BACKOFF_S = 1000 + Math.round(BACKOFF_JITTER * Math.random())
const BACKOFF_M = 5000 + Math.round(BACKOFF_JITTER * Math.random())
const BACKOFF_L = 15000 + Math.round(BACKOFF_JITTER * Math.random())

module.exports = class RetryTimer {
  constructor (push, { backoffs = [BACKOFF_S, BACKOFF_M, BACKOFF_L], jitter = BACKOFF_JITTER } = {}) {
    this.jitter = jitter
    this.backoffs = backoffs

    this._sTimer = new BulkTimer(backoffs[0] + Math.round(jitter * Math.random()), push)
    this._mTimer = new BulkTimer(backoffs[1] + Math.round(jitter * Math.random()), push)
    this._lTimer = new BulkTimer(backoffs[2] + Math.round(jitter * Math.random()), push)
  }

  _selectRetryTimer (peerInfo) {
    if (peerInfo.banned || !peerInfo.reconnecting || peerInfo.attempts > 3) return null
    if (peerInfo.attempts === 0) return this._sTimer
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

  add (peerInfo) {
    const timer = this._selectRetryTimer(peerInfo)
    if (!timer) return null
    timer.add(peerInfo)
  }

  destroy () {
    this._sTimer.destroy()
    this._mTimer.destroy()
    this._lTimer.destroy()
  }
}
