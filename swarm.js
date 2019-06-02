'use strict'
const peerInfo = require('./lib/peer-info')
const peerQueue = require('./lib/queue')
const { EventEmitter } = require('events')
const guts = require('@hyperswarm/guts')

const MAX_SERVER_SOCKETS = Infinity
const MAX_CLIENT_SOCKETS = 16
const MAX_PEERS = 24

const ERR_DESTROYED = 'swarm has been destroyed'
const ERR_MISSING_KEY = 'key is required and must be a buffer'
const ERR_JOIN_OPTS = 'join options must enable lookup, announce or both, but not neither'

const kDrain = Symbol('hyperswarm.drain')
const kIncrPeerCount = Symbol('hyperswarm.incrPeerCount')
const kDecrPeerCount = Symbol('hyperswarm.decrPeerCount')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      maxServerSockets = MAX_SERVER_SOCKETS,
      maxClientSockets = MAX_CLIENT_SOCKETS,
      maxPeers = MAX_PEERS,

      bootstrap,
      ephemeral
    } = opts
    const queue = peerQueue()

    const network = guts({
      bootstrap,
      ephemeral,
      bind: () => this.emit('listening'),
      socket: (socket, isTCP) => {
        const info = peerInfo(null)
        info.connected(socket, isTCP)
        this.emit('connection', socket, info)
        this.serverSockets += 1
        this[kIncrPeerCount]()
        socket.once('close', () => {
          this.serverSockets -= 1
          this.emit('disconnection', socket, info)
          this[kDecrPeerCount]()
        })
      },
      close: () => this.emit('close')
    })

    network.tcp.maxConnections = maxServerSockets
    network.utp.maxConnections = maxServerSockets

    queue.on('readable', this[kDrain](queue))
    this.destroyed = false
    this.clientSockets = 0
    this.serverSockets = 0
    this.peers = 0
    this.maxPeers = maxPeers
    this.acceptingPeers = this.peers < maxPeers
    this.maxServerSockets = maxServerSockets
    this.maxClientSockets = maxClientSockets
    this.ephemeral = ephemeral !== false
    this.network = network
    this.queue = queue
  }
  [kDrain] (queue) {
    const onConnect = (info) => (err, socket, isTCP) => {
      if (err) {
        this.clientSockets -= 1
        this[kDecrPeerCount]()
        queue.requeue(info)
        drain()
        return
      }
      info.connected(socket, isTCP)
      this.emit('connection', socket, info)
      socket.on('close', () => {
        this.clientSockets -= 1
        this.emit('disconnection', socket, info)
        this[kDecrPeerCount]()
        info.disconnected()
        queue.requeue(info)
        setImmediate(drain)
      })
      drain()
    }
    const drain = () => {
      if (this.clientSockets >= this.maxClientSockets) return
      const info = queue.shift()
      if (!info) return
      this.clientSockets += 1
      this[kIncrPeerCount]()
      this.network.connect(info.peer, onConnect(info))
    }
    return drain
  }
  [kIncrPeerCount] () {
    this.peers += 1
    this.acceptingPeers = this.peers < this.maxPeers
    if (this.acceptingPeers === false) {
      this.network.tcp.maxConnections = -1
      this.network.utp.maxConnections = -1
    }
  }
  [kDecrPeerCount] () {
    this.peers -= 1
    if (this.acceptingPeers) return
    this.acceptingPeers = this.peers < this.maxPeers
    this.network.tcp.maxConnections = this.maxServerSockets
    this.network.utp.maxConnections = this.maxServerSockets
  }
  address () {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    return this.network.address()
  }
  listen (port, cb) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    this.network.bind(port, cb)
  }
  join (key, opts = {}) {
    if (this.destroyed) throw Error(ERR_DESTROYED)
    const { network } = this

    if (Buffer.isBuffer(key) === false) throw Error(ERR_MISSING_KEY)

    const { announce = false, lookup = true } = opts

    if (!announce && !lookup) throw Error(ERR_JOIN_OPTS)
    network.bind((err) => {
      if (err) {
        this.emit('error', err)
        return
      }
      this.leave(key)
      const topic = announce
        ? network.announce(key, { lookup })
        : network.lookup(key)

      topic.on('update', () => this.emit('update'))
      if (lookup) {
        topic.on('peer', (peer) => {
          this.emit('peer', peer)
          this.queue.add(peer)
        })
      }
    })
  }
  leave (key) {
    if (Buffer.isBuffer(key) === false) throw Error(ERR_MISSING_KEY)
    if (this.destroyed) return
    const { network } = this
    const domain = network.discovery._domain(key)
    const topics = network.discovery._domains.get(domain)
    if (!topics) return

    for (const topic of topics) {
      if (Buffer.compare(key, topic.key) === 0) {
        topic.destroy()
        break
      }
    }
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
          boostrapped: false,
          holepunched: false
        })
        return
      }
      this.network.discovery.holepunchable((err, holepunchable) => {
        if (err) {
          cb(err, {
            bound: true,
            boostrapped: false,
            holepunched: false
          })
          return
        }
        cb(null, {
          bound: true,
          boostrapped: true,
          holepunched: holepunchable
        })
      })
    })
  }
  destroy (cb) {
    this.destroyed = true
    this.queue.destroy()
    this.network.close(cb)
  }
}

module.exports.Swarm = Swarm
