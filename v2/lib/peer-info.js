'use strict'
const { EventEmitter } = require('events')

module.exports = (peer, queue) => new PeerInfo(peer, queue)

const PROVEN = 0b1
const RECONNECT = 0b10
const BANNED = 0b100
const ACTIVE = 0b1000
const TRIED = 0b10000
const FIREWALLED = 0b100000

const BANNED_OR_ACTIVE = BANNED | ACTIVE
const ACTIVE_OR_TRIED = ACTIVE | TRIED
const EMPTY = Buffer.alloc(32)

class PeerInfo extends EventEmitter {
  constructor (peer = null, queue) {
    super()
    this.priority = (peer && peer.local) ? 3 : (peer && peer.to && peer.to.host === peer.host) ? 1 : 2
    this.status = RECONNECT | FIREWALLED
    this.retries = this.priority === 1 ? 3 : 0
    this.peer = peer
    this.client = peer !== null
    this.stream = null
    this.duplicate = false
    this.topics = []
    this._seenTopics = new Set()
    this._index = 0
    this._queue = queue
    this._dedup = null // set by the queue
  }

  get prioritised () {
    return this.priority >= 2
  }

  get type () {
    return this.status & FIREWALLED ? 'utp' : 'tcp'
  }

  get firewalled () {
    return !!(this.status & FIREWALLED)
  }

  get banned () {
    return !!(this.status & BANNED)
  }

  deduplicate (remoteId, localId = EMPTY) {
    return this._queue.deduplicate(remoteId, localId, this)
  }

  backoff () {
    // server can not backoff:
    if (this.client === false) return
    // calling requeue will increase
    // retries
    this.requeue()

    if (this.status & BANNED) return false
    if (this.retries > 3) return false
    // set new priority based on retry count
    this.priority = priority(this)

    // return value of update
    // indicates whether backoff was possible
    return true
  }

  reconnect (val) {
    if (val) this.status |= RECONNECT
    else this.status &= ~RECONNECT
  }

  active (val) {
    if (val) this.status |= ACTIVE_OR_TRIED
    else this.status &= ~ACTIVE
  }

  connected (stream, isTCP) {
    if (isTCP) this.status &= ~FIREWALLED
    this.status |= PROVEN
    this.stream = stream
    this.retries = 0
    if (this.status & BANNED) this.ban()
  }

  disconnected () {
    this.stream = null
    // The info object is reused after disconnection, so we need to clear registered listeners/topics.
    this.topics = []
    this.removeAllListeners('topic')
    if (this._queue) this._queue.disconnected(this)
  }

  topic (topic) {
    const hex = topic.toString('hex')
    if (this._seenTopics.has(hex)) return
    this._seenTopics.add(hex)
    this.topics.push(topic)
    this.emit('topic', topic)
  }

  update () {
    if (this.status & BANNED_OR_ACTIVE) return false
    if (this.retries > 3) return false
    this.priority = priority(this)
    return true
  }

  ban (soft) {
    if (soft) {
      this.status |= BANNED
      if (this.stream && !this.stream.destroyed) this.stream.end()
      this.disconnected()
    } else {
      this.destroy(new Error('Peer was banned'))
    }
  }

  destroy (err) {
    this.status |= BANNED
    if (this.stream && !this.stream.destroyed) this.stream.destroy(err)
    this.disconnected()
  }

  requeue () {
    if (this.status & BANNED) return -1
    if (!(this.status & RECONNECT)) return -1
    if (this.retries >= 3) {
      // if we don't increment retries past 3
      // retries will never be > 3 in update method
      this.retries++
      return -1
    }
    return this.retries++
  }
}

function priority (info) {
  if ((info.status & TRIED) && !(info.status & PROVEN)) return 0
  if (info.retries === 3) return 1
  if (info.retries === 2) return 4
  if (info.retries === 1) return 5
  return (info.peer && info.peer.local) ? 3 : 2
}
