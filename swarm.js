const net = require('net')
const utp = require('utp-native')
const peerInfo = require('./lib/peer-info')
const discovery = require('@hyperswarm/discovery')
const { EventEmitter } = require('events')
const assert = require('assert')

const NOT_BOUND = Symbol('NETWORK_NOT_BOUND')
const BINDING = Symbol('NETWORK_BINDING')
const BOUND = Symbol('NETWORK_BOUND')
const CLOSING = Symbol('NETWORK_CLOSING')
const CLOSED = Symbol('NETWORK_CLOSED')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts) {
    if (!opts) opts = {}

    super()

    this._tcp = net.createServer()
    this._utp = utp(opts)
    this._status = NOT_BOUND

    this.discovery = null

    this._utp.on('connection', this._onsocket.bind(this, false))
    this._tcp.on('connection', this._onsocket.bind(this, true))
  }

  address () {
    return this._tcp.address()
  }

  _onsocket (isTCP, s, info) {
    if (!info) info = peerInfo(null)
    info.connected(s, isTCP)
    onclose(s, info.disconnected.bind(info))
    this.emit('connection', s, info)
  }

  listen (port, onlistening) {
    if (typeof port === 'function') return this.listen(0, port)

    assert(this._status === NOT_BOUND, 'Network already bound')
    this._status = BINDING

    if (!port) port = 0
    if (onlistening) this.once('listening', onlistening)

    const self = this
    bind(0)

    function bind (tries) {
      listenBoth(self._tcp, self._utp, port, function (err) {
        if (!err) return bound()
        listenBoth(self._tcp, self._utp, 0, function (err) {
          if (!err) return bound()
          onerror(err)
        })
      })

      function onerror (err) {
        if (self._status === CLOSING) {
          self._status = CLOSED
          self.emit('close')
          return
        }

        if (++tries < 3) return bind(tries)
        self._status = NOT_BOUND
        self.emit('error', err)
      }
    }

    function bound () {
      if (self._status === CLOSING) return self._destroy()

      const opts = Object.assign({ socket: self._utp }, self.options)

      self._status = BOUND
      self.discovery = discovery(opts)
      self.emit('listening')
    }
  }

  destroy (onclose) {
    if (this._status === CLOSED) {
      if (onclose) process.nextTick(onclose)
      return
    }

    if (onclose) this.once('close', onclose)

    if (this._status === BOUND) {
      this._destroy()
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

  _destroy () {
    this._status = CLOSING

    const self = this
    let missing = 2

    this._tcp.once('close', onclose)
    this._utp.once('close', onclose)

    if (this.discovery) {
      missing++
      this.discovery.on('close', onclose)
      this.discovery.on('close', ondiscoveryclose)
      this.discovery.destroy()
    } else {
      ondiscoveryclose()
    }

    function ondiscoveryclose () {
      self.discovery = null
      self._tcp.close()
      self._utp.close()
    }

    function onclose () {
      if (--missing) return
      self._status = CLOSED
      self.emit('close')
    }
  }
}

module.exports.Swarm = Swarm

function listenBoth (tcp, utp, port, cb) {
  listen(tcp, port, function (err) {
    if (err) return cb(err)

    listen(utp, port, function (err) {
      if (err) {
        tcp.once('close', cb)
        tcp.close()
        return
      }

      cb(null)
    })
  })
}

function listen (server, port, cb) {
  server.on('listening', done)
  server.on('error', done)
  server.listen(port)

  function done (err) {
    server.removeListener('listening', done)
    server.removeListener('error', done)
    cb(err)
  }
}

function onclose (s, cb) {
  s.on('error', s.destroy)
  s.on('close', cb)
}
