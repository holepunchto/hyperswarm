const test = require('brittle')
const crypto = require('hypercore-crypto')
const random = require('math-random-seed')
const { timeout } = require('nonsynchronous')
const createTestnet = require('@hyperswarm/testnet')

const Hyperswarm = require('..')

const BACKOFFS = [
  100,
  200,
  300
]

test('chaos - recovers after random disconnections (takes ~60s)', async (t) => {
  t.timeout(90000)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const SEED = 'hyperswarm v3'
  const NUM_SWARMS = 10
  const NUM_TOPICS = 15
  const NUM_FORCE_DISCONNECTS = 30

  const STARTUP_DURATION = 1000 * 5
  const TEST_DURATION = 1000 * 45
  const CHAOS_DURATION = 1000 * 10

  const swarms = []
  const topics = []
  const connections = []
  const peersBySwarm = new Map()
  const rand = random(SEED)

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
    const numSwarms = Math.round(rand() * NUM_SWARMS)
    const topicSwarms = []
    for (let i = 0; i < numSwarms; i++) {
      topicSwarms.push(swarms[Math.floor(rand() * NUM_SWARMS)])
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

  await Promise.all(swarms.map(s => s.flush()))
  await timeout(STARTUP_DURATION)

  // Randomly destroy connections during the chaos period.
  for (let i = 0; i < NUM_FORCE_DISCONNECTS; i++) {
    const timeout = Math.floor(rand() * CHAOS_DURATION) // Leave a lot of room at the end for reestablishing connections (timeouts)
    setTimeout(() => {
      if (!connections.length) return
      const idx = Math.floor(rand() * connections.length)
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
