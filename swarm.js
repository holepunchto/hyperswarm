'use strict'
const peerInfo = require('./lib/peer-info')
const peerQueue = require('./lib/queue')
const { EventEmitter } = require('events')
const guts = require('@hyperswarm/guts')

const MAX_PEERS_DEFAULT = 3
const ERR_MISSING_KEY = 'key is required and must be a buffer'

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const {
      maxPeers = MAX_PEERS_DEFAULT,
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
      },
      close: () => this.emit('close')
    })
    queue.on('readable', this._drain(queue))
    this.peers = 0
    this.maxPeers = maxPeers
    this.emphemeral = ephemeral !== false
    this.network = network
    this.queue = queue
  }
  _drain (queue) {
    const onConnect = (info) => (err, socket, isTCP) => {
      if (err) {
        this.peers -= 1
        queue.requeue(info)
        drain()
        return
      }
      info.connected(socket, isTCP)
      this.emit('connection', socket, info)
      socket.on('close', () => {
        this.peers -= 1
        info.disconnected()
        queue.requeue(info)
      })
      drain()
    }
    const drain = () => {
      if (this.peers >= this.maxPeers) return
      const info = queue.shift()
      if (!info) return 
      this.peers += 1
      this.network.connect(info.peer, onConnect(info))
    }
    return drain
  }
  address () {
    return this.network.address()
  }
  listen (port, cb) {
    this.network.bind(port, cb)
  }
  join (key, opts = {}) {
    const { network } = this

    if (Buffer.isBuffer(key) === false) throw Error(ERR_MISSING_KEY)

    const { announce = false, lookup = true } = opts

    if (!announce && !lookup) return

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
      topic.on('peer', (peer) => {
        this.emit('peer', peer)
        this.queue.add(peer)
      })
    })
  }
  leave (key) {
    if (Buffer.isBuffer(key) === false) throw Error(ERR_MISSING_KEY)
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
    this.network.connect(peer, cb)
  }
  connectivity (cb) {
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
    this.queue.destroy()
    this.network.close(cb)
  }
}

module.exports.Swarm = Swarm
