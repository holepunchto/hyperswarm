const discovery = require('@hyperswarm/discovery')
const sql = require('shuffled-priority-queue')
const utp = require('utp-native')
const net = require('net')
const { EventEmitter } = require('events')

/*

  priorities: [
    REDISCOVERED_PEER, (or proven failed >2 times in a row)
    PROVEN_PEER_FAILED_TWICE,
    DISCOVERED_REMOTE_PEER,
    DISCOVERED_LOCAL_PEER,
    PROVEN_PEER_FAILED,
    PROVEN_PEER,
    SUPER_PEER
  ]

  peer = {
    priority: {n}
    retries: 0,
    status: TCP_ONLY | PROVEN | BANNED
    peer,
  }

*/

const CONNECT_TIMEOUT = 10000
const RECONNECT_WAIT = [1000, 5000, 15000]
const TCP_ONLY = 0b0001
const PROVEN = 0b0010
const BANNED = 0b0100
const ACTIVE = 0b1000
const BANNED_OR_ACTIVE = BANNED | ACTIVE
const NOT_ACTIVE = ~ACTIVE

const NOT_BOUND = Symbol('SWARM_NOT_BOUND')
const BINDING = Symbol('SWARM_BINDING')
const BOUND = Symbol('SWARM_BOUND')
const CLOSING = Symbol('SWARM_CLOSING')
const CLOSED = Symbol('SWARM_CLOSED')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts) {
    if (!opts) opts = {}

    super()

    this.options = opts
    this.socket = opts.socket = opts.socket || utp()
    this.server = net.createServer()
    this.discovery = null

    this.queue = sql()
    this.peers = new Map()

    this._bound = NOT_BOUND
    this._topics = new Map()
    this._ticking = false

    const self = this

    this.server.on('connection', socket => self.emit('connection', socket, { type: 'tcp', client: false, peer: null }))
    this.socket.on('connection', socket => self.emit('connection', socket, { type: 'utp', client: false, peer: null }))

    this.setMaxListeners(0) // we can bind listening a lot
  }

  join (key, opts) {
    if (!opts) opts = {}

    const self = this

    this._bind(function () {
      self.leave(key)

      const localPort = self.address().port
      const lookup = !!(opts && opts.lookup)
      const hex = key.toString('hex')

      const topic = opts.announce
        ? self.discovery.announce(key, { port: 0, localPort, lookup })
        : self.discovery.lookup(key)

      topic.on('peer', peer => self.addPeer(peer))
      topic.on('update', () => self.emit('update'))

      self._topics.set(hex, topic)
    })

    return this
  }

  leave (key) {
    const self = this

    // ensure bind so we are aligned with the join calls
    this._bind(function () {
      const hex = key.toString('hex')
      const prev = self._topics.get(hex)
      if (prev) prev.destroy()
    })

    return this
  }

  address () {
    return this.socket.address()
  }

  listen (port) {
    if (this._bound !== NOT_BOUND) throw new Error('Swarm already bound')
    this._bound = BINDING

    const self = this
    let tries = 0
    tryListening(port || 0)

    function tryListening (port) {
      if (tries++ > 2) return self.emit('error', new Error('Could not bind swarm'))

      listen(self.server, port, function (err) {
        if (err) return tryListening(0)

        listen(self.socket, self.server.address().port, function (err) {
          if (err) {
            self.server.once('close', tryListening.bind(null, 0))
            self.server.close()
            return
          }

          self._bound = BOUND
          self.discovery = discovery(self.options)
          self.emit('listening')
        })
      })
    }
  }

  close () {
    if (this._bound === CLOSING) return

    if (this._bound === BINDING) {
      this.once('listening', this.close.bind(this))
      return
    }

    const self = this
    let missing = 2

    if (this._bound === NOT_BOUND) {
      this._bound = CLOSED
      missing = 1
      process.nextTick(onclose)
      return
    }

    this._bound = CLOSING

    this.server.once('close', onclose)
    this.socket.once('close', onclose)

    this.discovery.destroy()
    this.server.close()

    function onclose () {
      if (!--missing) {
        self.discovery = null
        self.emit('close')
      }
    }
  }

  banPeer (peer) {
    const id = peer.host + ':' + peer.port
    if (this.peers.has(id)) {
      const peer = this.peers.get(id)
      peer.status |= BANNED
      this.queue.remove(peer)
      return
    }

    this.peers.set(id, {
      priority: 0,
      retries: 0,
      status: BANNED,
      peer,
      _index: 0
    })
  }

  removePeer (peer) {
    const id = peer.host + ':' + peer.port
    const p = this.peers.get(id)
    if (!p) return
    this.peers.delete(id)
    this.queue.remove(p)
  }

  addPeer (peer) {
    if (this._bound !== BOUND) return

    const id = peer.host + ':' + peer.port

    // TODO: we need some gc logic for old useless peers like an LRU

    if (this.peers.has(id)) {
      const p = this.peers.get(id)
      if (p.status & BANNED_OR_ACTIVE || this.queue.has(p)) return
      p.priority = 0
      this.queue.add(p)
      return
    }

    const p = {
      priority: peer.local ? 3 : 2,
      retries: 0,
      status: peer.local ? TCP_ONLY : 0,
      peer,
      timeout: null,
      _index: 0
    } 

    this.peers.set(id, p)
    this.queue.add(p)
    this.emit('peer', peer)

    // We might get a bunch of peers in the same pick
    // so defer the connect so they are all queued
    this._connectNextNT()
  }

  _connectNextNT () {
    if (this._ticking) return
    this._ticking = true
    process.nextTick(connectNextNT, this)
  }

  _connectNext () {
    if (this._bound !== BOUND) return
    this._ticking = false

    const p = this.queue.shift()
    if (!p) return

    p.status |= ACTIVE
    this.connect(p.peer, this._onsocket.bind(this, p))
  }

  _onsocket (p, err, socket, info) {
    if (err) return this._onclose(p)

    p.status |= PROVEN
    p.retries = 0

    socket.on('error', socket.destroy)
    socket.on('close', this._onclose.bind(this, p))

    this.emit('connection', socket, info)
  }

  _onclose (p) {
    const maxRetries = p.status & PROVEN ? 3 : 1

    if (this._bound !== BOUND || (p.status & BANNED) || p.retries > maxRetries) {
      p.status &= NOT_ACTIVE
      p.priority = 0
    } else {
      p.timeout = setTimeout(this._requeue.bind(this, p), RECONNECT_WAIT[p.retries++])
    }

    this._connectNext()
  }

  _requeue (p) {
    p.timeout = null
    p.status &= NOT_ACTIVE
    p.priority = getPriority(p)
    if (this._bound !== BOUND || (p.status & BANNED)) return
    this.queue.add(p)
    this._connectNext()
  }

  connect (peer, cb) {
    this.emit('connecting', peer)

    let utp = null
    let missing = 1
    let done = false

    const self = this
    const timeout = setTimeout(ontimeout, CONNECT_TIMEOUT)
    const tcp = net.connect(peer.port, peer.host)

    tcp.on('connect', onconnect)
    tcp.on('error', onerror)
    tcp.on('close', onclose)

    if (!peer.referrer || (peer.status & TCP_ONLY)) return

    missing++
    this.discovery.holepunch(peer, onholepunch)

    function onholepunch (err) {
      if (err || done) return onclose()

      utp = self.socket.connect(peer.port, peer.host)
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

      cb(null, this, { type: this === utp ? 'utp' : 'tcp', client: true, peer })
    }

    function ontimeout () {
      if (finish()) cb(new Error('Timed out trying to connect to peer'))
    }

    function onclose () {
      if (!--missing && finish()) cb(new Error('Could not connect to peer'))
    }

    function finish () {
      if (done) return false
      done = true
      clearTimeout(timeout)
      return true
    }
  }

  _bind (cb) {
    switch (this._bound) {
      case NOT_BOUND: this.listen(0) // fallthrough
      case BINDING: return this.once('listening', cb)
      case BOUND: return cb()
      default: return cb(new Error('Swarm is closed'))
    }
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

function onerror (err) {
  this.destroy(err)
}

function connectNextNT (self) {
  self._connectNext()
}

function getPriority (p) {
  if (!(p.status & PROVEN) || (p.status & BANNED)) return 0
  if (p.retries === 3) return 1
  if (p.retries === 2) return 4
  if (p.retries === 1) return 5
  return 0
}
