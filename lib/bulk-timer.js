module.exports = class BulkTimer {
  constructor(time, fn) {
    this._time = time
    this._fn = fn
    this._interval = null
    this._next = []
    this._pending = []
    this._destroyed = false
  }

  destroy() {
    if (this._destroyed) return
    this._destroyed = true
    clearInterval(this._interval)
    this._interval = null
  }

  _ontick() {
    if (!this._next.length && !this._pending.length) return
    if (this._next.length) this._fn(this._next)
    this._next = this._pending
    this._pending = []
  }

  add(info) {
    if (this._destroyed) return
    if (!this._interval) {
      this._interval = setInterval(this._ontick.bind(this), Math.floor(this._time * 0.66))
    }

    this._pending.push(info)
  }
}
