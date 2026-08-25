const { EventEmitter, once } = require('events')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const DHT = require('hyperdht')
const { createDHT } = require('./helpers')

const Hyperswarm = require('..')

test('relay fallback policy matches relay-eligible holepunch errors', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const cases = [
    ['HOLEPUNCH_ABORTED', true],
    ['HOLEPUNCH_DOUBLE_RANDOMIZED_NATS', true],
    ['REMOTE_NOT_HOLEPUNCHABLE', true],
    ['CANNOT_HOLEPUNCH', true],
    ['REMOTE_ABORTED', false]
  ]

  for (const [code, expected] of cases) {
    const lc = t.test(code)
    lc.plan(4)

    const { swarm, peerInfo, relayAttempts, relayKey } = createForceRelayingHarness(bootstrap, code)

    swarm._connect(peerInfo, false)
    await once(swarm, 'update')

    lc.ok(
      peerInfo.disconnectedTime > 0 && swarm._allConnections.size === 0,
      code + ' should close the direct attempt'
    )

    lc.is(
      peerInfo.forceRelaying,
      expected,
      code +
        (expected
          ? ' should force relaying on the next retry'
          : ' should not force relaying on the next retry')
    )

    swarm._connect(peerInfo, false)
    await once(swarm, 'update')

    lc.ok(
      relayAttempts.length === 2 && swarm._allConnections.size === 0,
      code + ' should close the retry attempt'
    )

    lc.alike(
      relayAttempts,
      expected ? [null, relayKey] : [null, null],
      expected
        ? 'the retry should switch from direct connect to blind relay'
        : 'the retry should stay on the direct path'
    )

    await swarm.destroy()
  }
})

function createForceRelayingHarness(bootstrap, code) {
  const relayKey = DHT.keyPair(Buffer.alloc(32, 'force-relay')).publicKey
  const peerKey = DHT.keyPair(Buffer.alloc(32, code)).publicKey
  const relayAttempts = []

  const swarm = new Hyperswarm({
    dht: createDHT(bootstrap),
    relayThrough(force) {
      relayAttempts.push(force ? relayKey : null)
      return force ? relayKey : null
    }
  })

  swarm.dht.connect = function (publicKey) {
    const conn = new EventEmitter()
    const err = Object.assign(new Error(code), { code })

    conn.remotePublicKey = publicKey

    setTimeout(() => {
      conn.emit('error', err)
      conn.emit('close')
    }, 0)

    return conn
  }

  return {
    swarm,
    peerInfo: swarm._upsertPeer(peerKey),
    relayAttempts,
    relayKey
  }
}
