const test = require('brittle')
const createTestnet = require('@hyperswarm/testnet')
const Hyperswarm = require('../')

test('many servers', async t => {
  const { bootstrap } = await createTestnet(3, t.teardown)
  const topic = Buffer.alloc(32).fill('hello')

  const sub = t.test()
  const cnt = 10

  sub.plan(cnt)

  const swarms = []
  for (let i = 0; i < cnt; i++) {
    swarms.push(new Hyperswarm({ bootstrap }))
  }

  for (const swarm of swarms) {
    const missing = new Set()
    let done = false

    swarm.on('connection', conn => {
      missing.add(conn.remotePublicKey.toString('hex'))

      conn.on('error', noop)
      conn.on('close', function () {
        missing.delete(conn.remotePublicKey.toString('hex'))
      })

      if (!done && missing.size === cnt - 1) {
        done = true
        sub.pass('swarm fully connected')
      }
    })
  }

  const discovery = swarms[0].join(topic, { server: true })
  await discovery.flushed()

  for (const swarm of swarms) swarm.join(topic, { client: false, server: true })

  await Promise.all(swarms.map(s => s.flush()))

  for (const swarm of swarms) swarm.join(topic)

  const then = Date.now()
  await sub

  t.pass('fully connected swarm in ' + (Date.now() - then) + 'ms')

  for (const swarm of swarms) await swarm.destroy()
})

function noop () {}
