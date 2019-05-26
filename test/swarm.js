'use strict'

const { test } = require('tap')
const { once, promisifyMethod } = require('./util')
const hyperswarm = require('../swarm')
const net = require('net')

test('ephemeral option')

test('bootstrap option')

test('emits listening event when bound')
test('emits close event when destroyed')
test('emits connection event when peer connects')
test('emits connection event when connected to a peer')

test('connect two peers')

test('join - missing key')

test('join')

test('join - announce: false, lookup: true')

test('join - announce: false, lookup: false')

test('join - announce: true, lookup: false')

test('join – emits error event when failing to bind')

test('join - emits update event when topic updates')

test('join - emits peer event when topic detects peer')

test('leave - missing key')

test('leave destroys the topic for a given pre-existing key')

test('leave does not throw when a given key was never joined')

test('joining the same topic twice will leave the topic before rejoining')

test('by default connects up to a maximum of MAX_PEERS_DEFAULT (16) peers')

test('maxPeers option controls maximum peers that a swarm will connect to')

test('after meeting maximum peers threshhold, allows new peers to be connected to when existing peer connections close')

test('retries connecting to peers that have closed')

test('retries connecting to peers that errored while connecting')

test('connect to a peer with a plain TCP client', async ({ pass, same, is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  const { port } = swarm.address()
  const client = net.connect(port)
  const [ connection, info ] = await once(swarm, 'connection')
  pass('server connected')
  once(client, 'connect')
  pass('client connected')
  is(info.type, 'tcp')
  client.write('a')
  const [ data ] = await once(connection, 'data')
  same(data, Buffer.from('a'))
  connection.destroy()
  await once(connection, 'close')
  pass('server disconnected')
  await once(client, 'close')
  pass('client disconnected')
  swarm.destroy()
  await once(swarm, 'close')
  pass('swarm closed')
})
