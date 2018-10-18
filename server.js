const discovery = require('@hyperswarm/discovery')
const utp = require('utp-native')
const net = require('net')
const { EventEmitter } = require('events')

const DEFAULT_MAX_CONNECTIONS = 100

const NOT_BOUND = Symbol('SWARM_NOT_BOUND')
const BINDING = Symbol('SWARM_BINDING')
const BOUND = Symbol('SWARM_BOUND')
const CLOSING = Symbol('SWARM_CLOSING')
const CLOSED = Symbol('SWARM_CLOSED')

class Network extends EventEmitter {
  constructor (opts) {
    if (!opts) opts = {}

    super()

    this.options = opts
    this.maxConnections = DEFAULT_MAX_CONNECTIONS
    this.connections = new Set()
    this.connecting = 0

    this.utp = utp()
    this.tcp = net.createServer()

    this.utp.on('connection', socket => this._onsocket(socket, null, 'utp'))
    this.tcp.on('connection', socket => this._onsocket(socket, null, 'tcp'))

    this._status = NOT_BOUND

    // Set default maxConnections
    this.resume()
  }

  address () {
    return this.utp.address()
  }

  listen (port) {
    if (this._status !== NOT_BOUND) throw new Error('Swarm already bound')
    this._status = BINDING

    const self = this
    let tries = 0
    tryListening(port || 0)

    function tryListening (port) {
      if (tries++ > 2) return self.emit('error', new Error('Could not bind swarm'))

      listen(self.tcp, port, function (err) {
        if (err) return tryListening(0)

        listen(self.utp, self.tcp.address().port, function (err) {
          if (err) {
            self.tcp.once('close', tryListening.bind(null, 0))
            self.tcp.close()
            return
          }

          self._status = BOUND
          self.discovery = discovery(self.options)
          self.emit('listening')
        })
      })
    }
  }

  _onsocket (socket, info, type) {
    this.connections.add(socket)
    socket.on('error', socket.destroy)
    socket.on('close', this._onsocketclose.bind(this, socket, info))
    this.emit('connection', socket, { type, client: !!info, peer: info && info.peer })
  }

  _onsocketclose (socket, info) {
    this.connections.delete(socket)
  }

  _connect (info) {
    this.connecting++
    this.emit('connecting', info.peer)

    let utp = null
    let missing = 1
    let done = false

    const self = this
    const timeout = setTimeout(ontimeout, CONNECT_TIMEOUT)
    const tcp = net.connect(info.peer.port, info.peer.host)

    tcp.on('connect', onconnect)
    tcp.on('error', onerror)
    tcp.on('close', onclose)

    if (!peer.referrer || (peer.status & TCP_ONLY)) return

    missing++
    this.discovery.holepunch(peer, onholepunch)

    function onholepunch (err) {
      if (err || done) return onclose()

      utp = self.utp.connect(info.peer.port, info.peer.host)
      utp.on('connect', onconnect)
      utp.on('error', onerror)
      utp.on('close', onclose)
    }

    function onconnect () {
      if (!finish()) return this.destroy()

      if (utp) utp.removeListener('close', onclose)
      tcp.removeListener('close', onclose)

      if (this === utp) tcp.destroy()
      else if (utp) utp.destroy()
      
      self.connecting--
      self._onsocket(this, peer, this === utp ? 'utp' : 'tcp')   
    }

    function ontimeout () {
      if (finish()) self._onconnecterror(info)
    }

    function onclose () {
      if (!--missing && finish()) self._onconnecterror(info) 
    }

    function finish () {
      if (done) return false
      done = true
      clearTimeout(timeout)
      return true
    }
  }

  _onconnecterror (info) {
    this._connecting--
  }

  _bind (cb) {
    switch (this._status) {
      case NOT_BOUND: this.listen(0) // fallthrough
      case BINDING: return this.once('listening', cb)
      case BOUND: return cb()
      default: return cb(new Error('Swarm is closed'))
    }
  }

  _pause () {
    this.utp.maxConnections = 1
    this.tcp.maxConnections = 1
  }

  _resume () {
    this.utp.maxConnections = this.maxConnections
    this.tcp.maxConnections = this.maxConnections
  }
}

function listen (server, port, cb) {
  server.once('error', onerror)
  server.once('listening', onlistening)
  server.listen(port)

  function onerror (err) {
    server.removeListener('listening', onlistening)
    cb(err)
  }

  function onlistening () {
    server.removeListener('error', onerror)
    cb(null)
  }
}

