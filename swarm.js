'use strict'
const peerInfo = require('./lib/peer-info')
const peerQueue = require('./lib/queue')
const { EventEmitter } = require('events')
const guts = require('@hyperswarm/guts')

module.exports = opts => new Swarm(opts)

class Swarm extends EventEmitter {
  constructor (opts = {}) {
    super()
    const { bootstrap, ephemeral } = opts
    const queue = peerQueue()
    const network = guts({
      bootstrap,
      ephemeral,
      bind: () => {
        this.emit('listening')
      },
      socket: (socket, isTCP) => {
        this._connected(socket, isTCP)
      },
      close: () => {
        this.emit('close')
      }
    })
    const onConnect = (err, socket, isTCP) => {
      if (err) return // todo, logging?
      this._connected(socket, isTCP)
    }
    queue.on('readable', () => {
      var peer = queue.shift()
      while (peer) {
        network.connect(peer, onConnect)
        peer = queue.shift()
      }
    })
    this.emphemeral = ephemeral !== false
    this.network = network
    this.queue = queue
  }
  _connected (socket, isTCP) {
    const info = peerInfo(null)
    info.connected(socket, isTCP)
    this.emit('connection', socket, info)
  }
  address () {
    return this.network.address()
  }
  listen (port, cb) {
    this.network.bind(port, cb)
  }
  join (key, opts = {}) {
    const { network, ephemeral } = this

    if (Buffer.isBuffer(key) === false) throw Error('KEY REQUIRED')

    const {
      announce = ephemeral === false
    } = opts
    const {
      lookup = announce === false
    } = opts

    if (announce === false && lookup === false) return

    network.bind()

    if (announce) network.announce(key)
    if (lookup) {
      this.leave(key)
      const topic = this.lookup(key)
      topic.on('update', () => this.emit('update'))
      topic.on('peer', (peer) => {
        this.emit('peer', peer)
        this.queue.add(peer)
      })
    }
  }
  leave (key) {
    if (Buffer.isBuffer(key) === false) throw Error('KEY REQUIRED')

    const { network } = this
    const domain = network.discovery._domain(key)
    const topics = network.discovery._domains.get(domain)
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
  destroy (cb) {
    this.network.close(cb)
  }
}

module.exports.Swarm = Swarm
