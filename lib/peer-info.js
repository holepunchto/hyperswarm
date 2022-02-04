const { EventEmitter } = require('events')
const HashMap = require('turbo-hash-map')

const VERY_LOW_PRIORITY = 0
const LOW_PRIORITY = 1
const NORMAL_PRIORITY = 2
const HIGH_PRIORITY = 3
const VERY_HIGH_PRIORITY = 4

module.exports = class PeerInfo extends EventEmitter {
  constructor ({ publicKey, relayAddresses }) {
    super()

    this.publicKey = publicKey
    this.relayAddresses = relayAddresses

    this.reconnecting = true
    this.proven = false
    this.banned = false
    this.tried = false

    // Set by the Swarm
    this.queued = false
    this.client = false
    this.topics = []

    this.attempts = 0
    this.priority = NORMAL_PRIORITY

    // Used by shuffled-priority-queue
    this._index = 0

    // Used for flush management
    this._flushTick = 0

    // Used for topic multiplexing
    this._seenTopics = new HashMap()
  }

  get server () {
    return !this.client
  }

  get prioritized () {
    return this.priority >= NORMAL_PRIORITY
  }

  _getPriority () {
    const peerIsStale = this.tried && !this.proven
    if (peerIsStale || this.attempts > 3) return VERY_LOW_PRIORITY
    if (this.attempts === 3) return LOW_PRIORITY
    if (this.attempts === 2) return HIGH_PRIORITY
    if (this.attempts === 1) return VERY_HIGH_PRIORITY
    return NORMAL_PRIORITY
  }

  _connected () {
    this.proven = true
    this.attempts = 0
  }

  _disconnected () {
    this.attempts++
  }

  _deprioritize () {
    this.attempts = 3
  }

  _reset () {
    this.client = false
    this.proven = false
    this.tried = false
    this.attempts = 0
  }

  _updatePriority () {
    if (this.banned || this.queued || this.attempts > 3) return false
    this.priority = this._getPriority()
    return true
  }

  _topic (topic) {
    if (this._seenTopics.has(topic)) return
    this._seenTopics.set(topic)
    this.topics.push(topic)
    this.emit('topic', topic)
  }

  reconnect (val) {
    this.reconnecting = !!val
  }

  ban (val) {
    this.banned = !!val
  }
}
