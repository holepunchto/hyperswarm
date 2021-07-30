const Hyperswarm = require('..')
const crypto = require('hypercore-crypto')
const { timeout } = require('nonsynchronous')

const { test, destroyAll } = require('./helpers')

test('max client concurrency of one will serialize connections', async (bootstrap, t) => {
  const servers = []
  for (let i = 0; i < 5; i++) {
    servers.push(new Hyperswarm({ bootstrap }))
  }
  const client = new Hyperswarm({
    bootstrap,
    maxParallelFast: 1
  })

  let connections = 0
  client.on('connection', () => {
    connections++
    t.same(client._currentFast, 1)
  })

  const topic = crypto.randomBytes(32)
  await Promise.all(servers.map(s => s.join(topic, { server: true, client: false }).flushed()))

  client.join(topic, { server: false, client: true })

  await timeout(500)
  t.same(connections, 5)
  t.same(client._currentFast, 0)

  await destroyAll(client, ...servers)
  t.end()
})

test('max client concurrency of two', async (bootstrap, t) => {
  const servers = []
  for (let i = 0; i < 5; i++) {
    servers.push(new Hyperswarm({ bootstrap }))
  }
  const client = new Hyperswarm({
    bootstrap,
    maxParallelFast: 2
  })

  let connections = 0
  client.on('connection', () => {
    connections++
    if (connections < 5) t.same(client._currentFast, 2)
    else t.same(client._currentFast, 1)
  })

  const topic = crypto.randomBytes(32)
  await Promise.all(servers.map(s => s.join(topic, { server: true, client: false }).flushed()))

  client.join(topic, { server: false, client: true })

  await timeout(500)
  t.same(connections, 5)
  t.same(client._currentFast, 0)

  await destroyAll(client, ...servers)
  t.end()
})
