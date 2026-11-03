const test = require('brittle')
const b4a = require('b4a')
const { EventEmitter } = require('events')

const Hyperswarm = require('..')

const BACKOFFS = [1e6, 1e6, 1e6, 1e6]

test('explicit idle list - connecting a middle peer keeps the others reachable', (t) => {
  const { swarm, dht } = createSwarm({ maxParallel: 0 })
  const keys = [key(1), key(2), key(3)]
  for (const k of keys) swarm.joinPeer(k)

  t.is(swarm._explicitIdle.length, 3)
  checkIdle(t, swarm)

  // Server connection from the middle peer swaps the last peer into its slot
  const conn = inbound(swarm, keys[1])
  t.is(swarm._explicitIdle.length, 2)
  checkIdle(t, swarm)

  // Every remaining idle peer still gets dialed, including the swapped-in one
  swarm.maxParallel = Infinity
  swarm._attemptClientConnections()
  t.alike(dht.dialed.map(hex).sort(), [keys[0], keys[2]].map(hex).sort())
  t.is(swarm._explicitIdle.length, 0)

  conn.destroy()
  t.is(swarm._explicitIdle.length, 0, 'peer is dialed again right away after its connection closes')
  checkIdle(t, swarm)

  swarm._timer.destroy()
})

test('explicit idle list - leavePeer removes the peer', (t) => {
  const { swarm } = createSwarm({ maxParallel: 0 })
  const keys = [key(1), key(2), key(3)]
  for (const k of keys) swarm.joinPeer(k)

  swarm.leavePeer(keys[0])
  t.is(swarm._explicitIdle.length, 2)
  checkIdle(t, swarm)

  const conn = inbound(swarm, keys[0])
  conn.destroy()
  t.is(swarm._explicitIdle.length, 2, 'a left peer is not added back when its connection closes')
  checkIdle(t, swarm)

  swarm._timer.destroy()
})

test('explicit idle list - matches explicit peers without a connection under random ops', (t) => {
  const { swarm, dht } = createSwarm({ maxParallel: 2 })
  const keys = []
  for (let i = 1; i <= 12; i++) keys.push(key(i))

  const random = rng(42)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const live = () => dht.conns.filter((c) => !c.destroyed)
  let ok = true

  for (let step = 0; step < 20000 && ok; step++) {
    const op = random()
    if (op < 0.2) swarm.joinPeer(pick(keys))
    else if (op < 0.3) swarm.leavePeer(pick(keys))
    else if (op < 0.5) {
      const pending = live().filter((c) => !c.opened)
      if (pending.length) pick(pending).open()
    } else if (op < 0.7) {
      const conns = live()
      if (conns.length) pick(conns).destroy()
    } else if (op < 0.85) inbound(swarm, pick(keys))
    else {
      for (const p of swarm.explicitPeers) {
        p.attempts = 0
        p.disconnectedTime = 0
      }
      swarm._attemptClientConnections()
    }
    ok = idleMatches(swarm)
  }

  t.ok(ok, 'idle list matches after every op')
  swarm._timer.destroy()
})

function checkIdle(t, swarm) {
  t.ok(idleMatches(swarm), 'idle list matches explicit peers without a connection')
}

function idleMatches(swarm) {
  const idle = swarm._explicitIdle
  const expected = [...swarm.explicitPeers].filter((p) => !swarm._allConnections.has(p.publicKey))
  if (idle.length !== expected.length) return false
  for (const p of expected) if (idle[p._explicitIdx] !== p) return false
  for (const p of swarm.peers.values()) {
    if (p._explicitIdx !== -1 && idle[p._explicitIdx] !== p) return false
  }
  return true
}

class FakeConn extends EventEmitter {
  constructor(publicKey, remotePublicKey, isInitiator) {
    super()
    this.publicKey = publicKey
    this.remotePublicKey = remotePublicKey
    this.isInitiator = isInitiator
    this.rawBytesRead = 0
    this.rawBytesWritten = 0
    this.opened = false
    this.destroyed = false
  }

  sendKeepAlive() {}

  open() {
    this.opened = true
    this.emit('open')
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
  }
}

function createSwarm(opts) {
  const keyPair = { publicKey: key(0), secretKey: b4a.alloc(64) }
  const dht = new EventEmitter()
  dht.conns = []
  dht.dialed = []
  dht.createServer = () => ({ listen: () => Promise.resolve(), close: () => Promise.resolve() })
  dht.connect = (publicKey) => {
    const conn = new FakeConn(keyPair.publicKey, publicKey, true)
    dht.conns.push(conn)
    dht.dialed.push(publicKey)
    return conn
  }
  const swarm = new Hyperswarm({ dht, keyPair, backoffs: BACKOFFS, jitter: 0, ...opts })
  return { swarm, dht }
}

function inbound(swarm, publicKey) {
  const conn = new FakeConn(swarm.keyPair.publicKey, publicKey, false)
  swarm.dht.conns.push(conn)
  swarm._handleServerConnection(conn)
  return conn
}

function key(i) {
  return b4a.alloc(32, i)
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function hex(b) {
  return b4a.toString(b, 'hex')
}
