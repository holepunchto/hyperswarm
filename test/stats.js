const test = require('brittle')
const createTestnet = require('hyperdht/testnet')

const Hyperswarm = require('..')

test('connectionsOpened and connectionsClosed stats', async (t) => {
  const { bootstrap } = await createTestnet(3, t.teardown)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })

  const tOpen = t.test('Open connection')
  tOpen.plan(4)
  const tClose = t.test('Close connection')
  tClose.plan(4)

  t.teardown(async () => {
    await swarm1.destroy()
    await swarm2.destroy()
  })

  swarm2.on('connection', (conn) => {
    conn.on('error', noop)

    tOpen.is(swarm2.stats.connects.opened, 1, 'opened connection is in stats')
    tOpen.is(swarm2.stats.connects.attempted, 1, 'attemped connection is in stats')
    tClose.is(swarm2.stats.connects.closed, 0, 'sanity check')

    conn.on('close', () => {
      tClose.is(swarm2.stats.connects.closed, 1, 'closed connection is in stats')
    })

    conn.end()
  })

  swarm1.on('connection', (conn) => {
    conn.on('error', () => noop)

    conn.on('open', () => {
      tOpen.is(swarm1.stats.connects.opened, 1, 'opened server connection is in stats')
      tOpen.is(swarm1.stats.connects.attempted, 1, 'attempted connection is in status')
      tClose.is(swarm1.stats.connects.closed, 0, 'Sanity checks')
    })

    conn.on('close', () => {
      tClose.is(swarm1.stats.connects.closed, 1, 'closed connections is in stats')
    })

    conn.end()
  })

  const topic = Buffer.alloc(32).fill('hello world')
  await swarm1.join(topic, { server: true, client: false }).flushed()
  swarm2.join(topic, { client: true, server: false })

  await tClose
})

function noop () {}
