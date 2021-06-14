'use strict'
const peerInfo = require('./lib/peer-info')
const peerQueue = require('./lib/queue')
const { EventEmitter } = require('events')
const network = require('@hyperswarm/network')

const MAX_SERVER_SOCKETS = Infinity
const MAX_CLIENT_SOCKETS = Infinity
const MAX_PEERS = 24

const ERR_DESTROYED = 'swarm has been destroyed'
const ERR_MISSING_KEY = 'key is required and must be a 32-byte buffer'
const ERR_JOIN_OPTS = 'join options must enable lookup, announce or both, but not neither'

const kDrain = Symbol('hyperswarm.drain')
const kIncrPeerCount = Symbol('hyperswarm.incrPeerCount')
const kDecrPeerCount = Symbol('hyperswarm.decrPeerCount')
const kQueue = Symbol('hyperswarm.queue')
const kLeave = Symbol('hyperswarm.leave')
const kFlush = Symbol('hyperswarm.flush')
const kStatus = Symbol('hyperswarm.statuses')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      maxServerSockets = MAX_SERVER_SOCKETS,
      maxClientSockets = MAX_CLIENT_SOCKETS,
      maxPeers = MAX_PEERS,
      bootstrap,
      ephemeral,
      validatePeer = () => true,
      queue = {},
      id,
      port,
      announcePort,
      preferredPort
    } = opts

    this.network = network({
      id,
      bootstrap,
      ephemeral,
      port,
      announcePort,
      preferredPort,
      announceLocalAddress: !!opts.announceLocalAddress,
      bind: () => this.emit('listening'),
      socket: (socket, isTCP) => {
        const info = peerInfo(null, this[kQueue])
        info.connected(socket, isTCP)
        this.emit('connection', socket, info)
        this.serverSockets += 1
        this[kIncrPeerCount]()
        socket.on('close', () => {
          info.disconnected()
          this.serverSockets -= 1
          this.emit('disconnection', socket, info)
          this[kDecrPeerCount]()
        })
      },
      close: () => this.emit('close')
    })

    this.network.tcp.maxConnections = maxServerSockets
    this.network.utp.maxConnections = maxServerSockets

    this.destroyed = false
    this.prioritisedInflight = 0
    this.clientSockets = 0
    this.serverSockets = 0
    this.peers = 0

    this.maxPeers = maxPeers
    this.maxServerSockets = maxServerSockets
    this.maxClientSockets = maxClientSockets

    this.open = this.peers < this.maxPeers
    this.connections = this.network.sockets

    this.validatePeer = validatePeer

    this[kStatus] = new Map()
    this[kFlush] = []
    this[kQueue] = peerQueue(queue)
    this[kQueue].on('readable', this[kDrain](this[kQueue]))
  }

  [kDrain] (queue) {
    const onAttempt = () => {
      for (let i = 0; i < this[kFlush].length; i++) {
        if (this.clientSockets >= this.maxClientSockets || --this[kFlush][i][0] <= 0) {
          const cb = this[kFlush][i][1]
          this[kFlush][i--] = this[kFlush][this[kFlush].length - 1]
          this[kFlush].pop()
          cb(null)
        }
      }
    }
    const onConnect = (info, prioritised) => (err, socket, isTCP) => {
      if (prioritised) this.prioritisedInflight -= 1
      if (err) {
        this.clientSockets -= 1
        this[kDecrPeerCount]()
        queue.requeue(info)
        drain()
        onAttempt()
        return
      }
      info.connected(socket, isTCP)
      this.emit('connection', socket, info)
      socket.on('close', () => {
        info.disconnected()
        this.clientSockets -= 1
        this.emit('disconnection', socket, info)
        this[kDecrPeerCount]()
        queue.requeue(info)
        setImmediate(drain)
      })
      drain()
      onAttempt()
    }
    const drain = () => {
      if (this.open === false) return
      if (this.clientSockets >= this.maxClientSockets) return

      while (true) {
        const info = queue.shift()
        if (!info) return

        if (info.peer.topic) { // only connect to active topics ...
          const domain = this.network.discovery._domain(info.peer.topic)
          if (!this.network.discovery._domains.has(domain)) {
            onAttempt()
            continue
          }
        }

        if (info.prioritised) this.prioritisedInflight += 1
        this.clientSockets += 1
        this[kIncrPeerCount]()
        this.connect(info.peer, onConnect(info, info.prioritised))
        return
      }
    }
    return drain
  }
  [kIncrPeerCount] () {
    this.peers += 1
    this.open = this.peers < this.maxPeers
    if (this.open === false) {
      this.network.tcp.maxConnections = -1
      this.network.utp.maxConnections = -1
    }
  }
  [kDecrPeerCount] () {
    this.peers -= 1
    if (this.open) return
    this.open = this.peers < this.maxPeers
    // note: defensive conditional, to the best of knowledge
    // and after some investigation, else branch should never happen
    /* istanbul ignore else */
    if (this.open === true) {
      this.network.tcp.maxConnections = this.maxServerSockets
      this.network.utp.maxConnections = this.maxServerSockets
    }
  }
  address () {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    return this.network.address()
  }
  listen (port, cb) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    this.network.bind(port, cb)
  }
  status (key) {
    return this[kStatus].get(key.toString('hex')) || null
  }
  join (key, opts = {}, onjoin) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    if (typeof opts === 'function') return this.join(key, {}, opts)

    const { network } = this

    if (Buffer.isBuffer(key) === false || key.length !== 32) throw Error(ERR_MISSING_KEY)

    const { announce = false, lookup = true } = opts

    if (!announce && !lookup) throw Error(ERR_JOIN_OPTS)

    this[kStatus].set(key.toString('hex'), { announce, lookup })
    network.bind((err) => {
      if (err) {
        this.emit('error', err)
        return
      }
      this[kLeave](key)
      const topic = announce
        ? network.announce(key, { lookup })
        : network.lookup(key)

      if (onjoin) topic.flush(onjoin)
      topic.on('update', () => {
        this.emit('updated', { key })
      })
      if (lookup) {
        topic.on('peer', (peer) => {
          if (!this.validatePeer(peer)) {
            this.emit('peer-rejected', peer)
            return
          }
          this.emit('peer', peer)
          this[kQueue].add(peer)
        })
      }
      this.emit('join', key, opts)
    })
  }
  leave (key, onleave) {
    if (Buffer.isBuffer(key) === false || key.length !== 32) throw Error(ERR_MISSING_KEY)
    if (this.destroyed) return

    this[kStatus].delete(key.toString('hex'))
    this.network.bind((err) => {
      if (err) return // don't emit this, as we are leaving anyway
      this[kLeave](key, onleave)
      this.emit('leave', key)
    })
  }
  flush (cb) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    this.network.bind((err) => {
      if (err) return cb(err)
      this.network.discovery.flush(() => {
        const prio = this[kQueue].prioritised + this.prioritisedInflight
        if (prio === 0 || this.clientSockets >= this.maxClientSockets) cb()
        else this[kFlush].push([prio, cb])
      })
    })
  }

  [kLeave] (key, onleave) {
    const { network } = this

    const domain = network.discovery._domain(key)
    const topics = network.discovery._domains.get(domain)
    if (!topics) return

    for (const topic of topics) {
      if (Buffer.compare(key, topic.key) === 0) {
        topic.destroy()
        if (onleave) topic.once('close', onleave)
        break
      }
    }
  }
  remoteAddress () {
    const disc = this.network.discovery
    return disc && disc.dht.remoteAddress()
  }
  holepunchable () {
    const disc = this.network.discovery
    return disc && disc.dht.holepunchable()
  }
  connect (peer, cb) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    this.network.connect(peer, cb)
  }
  connectivity (cb) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    this.network.bind((err) => {
      if (err) {
        cb(err, {
          bound: false,
          boostrapped: false, // todo remove in next major
          bootstrapped: false,
          holepunched: false
        })
        return
      }
      this.network.discovery.holepunchable((err, holepunchable) => {
        if (err) {
          cb(err, {
            bound: true,
            boostrapped: false, // todo remove in next major
            bootstrapped: false,
            holepunched: false
          })
          return
        }
        cb(null, {
          bound: true,
          boostrapped: true, // todo remove in next major
          bootstrapped: true,
          holepunched: holepunchable
        })
      })
    })
  }
  destroy (cb) {
    this.destroyed = true
    this[kQueue].destroy()
    this.network.close(cb)
    this[kStatus].clear()

    const flush = this[kFlush]
    this[kFlush] = []
    for (const [, cb] of flush) cb(Error(ERR_DESTROYED))
  }
}

module.exports.Swarm = Swarm
