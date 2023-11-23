const test = require('brittle')
const crypto = require('hypercore-crypto')
const createTestnet = require('hyperdht/testnet')
const { timeout } = require('./helpers')

const Hyperswarm = require('..')

const NUM_SWARMS = 10
const NUM_TOPICS = 15
const NUM_FORCE_DISCONNECTS = 30

const STARTUP_DURATION = 1000 * 5
const TEST_DURATION = 1000 * 45
const CHAOS_DURATION = 1000 * 10

const BACKOFFS = [
  100,
  1000,
  CHAOS_DURATION, // Summed value till here should be > CHAOS_DURATION, and this particular value should be less than TEST_DURATION - CHAOS_DURATION
  10000 // Note: the fourth backoff is irrelevant for this test, as it only triggers when peerInfo.explicit is true
]

test('chaos - recovers after random disconnections (takes ~60s)', async (t) => {
  t.timeout(90000)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarms = []
  const topics = []
  const connections = []
  const peersBySwarm = new Map()

  for (let i = 0; i < NUM_SWARMS; i++) {
    const swarm = new Hyperswarm({ bootstrap, backoffs: BACKOFFS, jitter: 0 })
    swarms.push(swarm)
    peersBySwarm.set(swarm, new Set())
    swarm.on('connection', conn => {
      connections.push(conn)

      conn.on('error', noop)
      conn.on('close', () => {
        clearInterval(timer)
        const idx = connections.indexOf(conn)
        if (idx === -1) return
        connections.splice(idx, 1)
      })

      const timer = setInterval(() => {
        conn.write(Buffer.alloc(10))
      }, 100)
      conn.write(Buffer.alloc(10))
    })
  }
  for (let i = 0; i < NUM_TOPICS; i++) {
    const topic = crypto.randomBytes(32)
    topics.push(topic)
  }

  for (const topic of topics) {
    const numSwarms = Math.round(Math.random() * NUM_SWARMS)
    const topicSwarms = new Set()
    for (let i = 0; i < numSwarms; i++) {
      topicSwarms.add(swarms[Math.floor(Math.random() * NUM_SWARMS)])
    }
    for (const swarm of topicSwarms) {
      const peers = peersBySwarm.get(swarm)
      for (const s of topicSwarms) {
        if (swarm === s) continue
        peers.add(s.keyPair.publicKey.toString('hex'))
      }
      await swarm.join(topic).flushed()
    }
  }

  for (const s of swarms) await s.flush()
  await timeout(STARTUP_DURATION)

  for (const [swarm, expectedPeers] of peersBySwarm) {
    t.alike(swarm.connections.size, expectedPeers.size, 'swarm has the correct number of connections after startup')
    const missingKeys = []
    for (const conn of swarm.connections) {
      const key = conn.remotePublicKey.toString('hex')
      if (!expectedPeers.has(key)) missingKeys.push(key)
    }
    t.alike(missingKeys.length, 0, 'swarm is not missing any expected peers after startup')
  }

  // Randomly destroy connections during the chaos period.
  for (let i = 0; i < NUM_FORCE_DISCONNECTS; i++) {
    const timeout = Math.floor(Math.random() * CHAOS_DURATION) // Leave a lot of room at the end for reestablishing connections (timeouts)
    setTimeout(() => {
      if (!connections.length) return
      const idx = Math.floor(Math.random() * connections.length)
      const conn = connections[idx]
      conn.destroy()
    }, timeout)
  }

  await timeout(TEST_DURATION) // Wait for the chaos to resolve

  for (const [swarm, expectedPeers] of peersBySwarm) {
    t.alike(swarm.connections.size, expectedPeers.size, 'swarm has the correct number of connections')
    const missingKeys = []
    for (const conn of swarm.connections) {
      const key = conn.remotePublicKey.toString('hex')
      if (!expectedPeers.has(key)) missingKeys.push(key)
    }
    t.alike(missingKeys.length, 0, 'swarm is not missing any expected peers')
  }

  for (const swarm of swarms) await swarm.destroy()
})

function noop () {}
