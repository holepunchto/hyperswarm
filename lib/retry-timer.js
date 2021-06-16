const BulkTimer = require('./bulk-timer')

const BACKOFF_S = 1000
const BACKOFF_M = 5000
const BACKOFF_L = 15000

module.exports = class RetryTimer {
  constructor (push) {
    this._sTimer = new BulkTimer(BACKOFF_S, push)
    this._mTimer = new BulkTimer(BACKOFF_M, push)
    this._lTimer = new BulkTimer(BACKOFF_L, push)
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

  add (peerInfo) {
    const timer = this._selectRetryDelay(peerInfo)
    if (!timer) return null
    timer.add(peerInfo)
  }

  destroy () {
    this._sTimer.destroy()
    this._mTimer.destroy()
    this._lTimer.destroy()
  }
}
