'use strict'
const peerInfo = require('./lib/peer-info')
const { EventEmitter } = require('events')
const assert = require('assert')
const guts = require('@hyperswarm/guts')

const NOT_BOUND = Symbol('NETWORK_NOT_BOUND')
const BINDING = Symbol('NETWORK_BINDING')
const BOUND = Symbol('NETWORK_BOUND')
const CLOSING = Symbol('NETWORK_CLOSING')
const CLOSED = Symbol('NETWORK_CLOSED')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const { bootstrap, ephemeral, socket } = opts
    this.network = guts({
      bootstrap,
      discovery: { ephemeral, socket },
      socket: this._onsocket.bind(this),
      close: this._onclose.bind(this)
    })

    this._status = NOT_BOUND
  }

  address () {
    return this.network.address()
  }
  _onclose () {
    this._status = CLOSED
    this.emit('close')
  }
  _onsocket (socket, isTCP, info = peerInfo(null)) {
    info.connected(socket, isTCP)
    this.emit('connection', socket, info)
  }

  listen (port, cb) {
    assert(this._status === NOT_BOUND, 'Network already bound')
    if (typeof port === 'function') {
      cb = port
      port = 0
    }
    this._status = BINDING
    const bound = (err) => {
      if (err) {
        if (this._status === CLOSING) {
          this._status = CLOSED
          this.emit('close')
          return
        }
        this._status = NOT_BOUND
        this.emit('error', err)
        if (cb) cb(err)
        return
      }
      if (this._status === CLOSING) return
      this._status = BOUND
      this.emit('listening')
      if (cb) cb()
    }
    this.network.bind(port, bound)
  }

  destroy (cb) {
    if (this._status === CLOSED) {
      if (cb) process.nextTick(cb)
      return
    }

    if (cb) this.once('close', cb)

    if (this._status === BINDING || this._status === BOUND) {
      this._status = CLOSING
      this.network.close()
      return
    }
    if (this._status === CLOSING) {
      return
    }
    if (this._status === NOT_BOUND) {
      this._status = CLOSED
      this.emit('close')
      return
    }

    this._status = CLOSING
  }
}

module.exports.Swarm = Swarm
