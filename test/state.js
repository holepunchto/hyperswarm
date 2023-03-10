const test = require('brittle')
const Hyperswarm = require('..')
const createTestnet = require('@hyperswarm/testnet')

test('connecting', async (t) => {
  t.plan(9)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })
  const topic = Buffer.alloc(32).fill('hello world')

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  t.is(swarm2.connecting, 0)

  swarm2.once('state', function (event) {
    t.is(event, 'connecting')
    t.is(swarm2.connecting, 1)

    swarm2.once('state', function (event) {
      t.is(event, 'connecting')
      t.is(swarm2.connecting, 0)
    })
  })

  swarm1.on('connection', function (socket) {
    socket.end()
    socket.on('close', () => t.pass())
  })

  swarm2.on('connection', function (socket) {
    socket.end()
    socket.on('close', () => t.pass())
  })

  const discovery = swarm1.join(topic, { server: true, client: false })
  await discovery.flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()
})
