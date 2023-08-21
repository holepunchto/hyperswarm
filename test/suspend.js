const test = require('brittle')
const createTestnet = require('hyperdht/testnet')

const Hyperswarm = require('..')

test('suspend + resume', async (t) => {
  t.plan(4)

  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  const topic = Buffer.alloc(32).fill('hello world')

  swarm1.on('connection', function (socket) {
    t.pass('swarm1 received connection')
    socket.on('error', () => {})
  })

  swarm2.on('connection', function (socket) {
    t.pass('swarm2 received connection')
    socket.on('error', () => {})
  })

  const discovery = swarm1.join(topic, { server: true, client: false })
  await discovery.flushed()

  swarm2.join(topic, { client: true, server: false })
  await swarm2.flush()

  t.comment('suspended swarm2')
  swarm2.suspend()

  setTimeout(() => {
    t.comment('resumed swarm2')
    swarm2.resume()
  }, 2000)
})
