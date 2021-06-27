const { test } = require('./helpers')
const { timeout } = require('nonsynchronous')
const Hyperswarm = require('..')

test('one client, one server - first connection', async (bootstrap, t) => {
  t.plan(1)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  swarm2.on('connection', (conn, info) => {
    t.ok('swarm2 got a client connection')
  })

  const topic = Buffer.from(Buffer.alloc(32).fill('hello world'))
  await swarm1.join(topic, { server: true, client: false }).flushed()
  await swarm2.join(topic, { client: true, server: false }).flushed()

  await destroyAll(swarm1, swarm2)
})

function destroyAll (...args) {
  return Promise.all(args.map(a => a.destroy()))
}
