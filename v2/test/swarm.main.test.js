'use strict'
const { EventEmitter } = require('events')
const { randomBytes } = require('crypto')
const { NetworkResource } = require('@hyperswarm/network')
const { test } = require('tap')
const { once, done, promisifyMethod, whenifyMethod } = require('nonsynchronous')
const { dhtBootstrap, validSocket } = require('./util')
const hyperswarm = require('../swarm')
const net = require('net')

test('default ephemerality', async ({ is }) => {
  const swarm = hyperswarm({
    bootstrap: []
  })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.ephemeral, true)
  swarm.destroy()
})

test('destroyed property', async ({ is }) => {
  const swarm = hyperswarm({
    bootstrap: []
  })
  swarm.listen()
  is(swarm.destroyed, false)
  swarm.destroy()
  is(swarm.destroyed, true)
})

test('network property', async ({ is }) => {
  const swarm = hyperswarm({
    bootstrap: []
  })
  is(swarm.network instanceof NetworkResource, true)
  swarm.destroy()
})

test('ephemeral option', async ({ is }) => {
  const swarm = hyperswarm({
    ephemeral: false,
    bootstrap: []
  })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.ephemeral, false)
  swarm.destroy()
})

test('bootstrap option', async ({ is }) => {
  const { bootstrap, closeDht, port } = await dhtBootstrap()
  const swarm = hyperswarm({ bootstrap })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  is(swarm.network.discovery.dht.bootstrapNodes.length, 1)
  is(swarm.network.discovery.dht.bootstrapNodes[0].port, port)
  closeDht(swarm)
})

test('emits listening event when bound', async ({ pass }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  swarm.listen()
  await once(swarm, 'listening')
  pass('event emitted')
  swarm.destroy()
})

test('emits close event when destroyed', async ({ pass }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.destroy()
  await once(swarm, 'close')
  pass('event emitted')
})

test('join - missing key', async ({ throws }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.join(), Error('key is required and must be a 32-byte buffer'))
  throws(() => swarm.join('not a buffer but still 32 bytes.'), Error('key is required and must be a 32-byte buffer'))
  throws(() => swarm.join(Buffer.from('buffer but not 32 bytes.')), Error('key is required and must be a 32-byte buffer'))
  swarm.destroy()
})

test('join automatically binds', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  var bind = false
  swarm.network.bind = () => (bind = true)
  swarm.join(Buffer.from('key-key-key-key-key-key-key-key-'))
  is(bind, true)
  swarm.destroy()
})

test('join – emits error event when failing to bind', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const fauxError = Error('problem binding')
  swarm.network.bind = (cb) => process.nextTick(cb, fauxError)
  swarm.join(Buffer.from('key-key-key-key-key-key-key-key-'))
  const err = await once(swarm, 'error')
  is(err, fauxError)
  swarm.destroy()
})

test('join – default options', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  var lookupKey = null
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  swarm.network.lookup = (key) => {
    lookupKey = key
    return new EventEmitter()
  }
  swarm.join(key)
  await once(swarm, 'listening') // wait for bind
  is(lookupKey, key)
  swarm.destroy()
})

test('join - announce: false, lookup: true', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  var lookupKey = null
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  swarm.network.lookup = (key) => {
    lookupKey = key
    return new EventEmitter()
  }
  swarm.join(key, { announce: false, lookup: true })
  await once(swarm, 'listening') // wait for bind
  is(lookupKey, key)
  swarm.destroy()
})

test('join - announce: false, lookup: false', async ({ throws }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  throws(
    () => swarm.join(key, { announce: false, lookup: false }),
    Error('join options must enable lookup, announce or both, but not neither')
  )
  swarm.destroy()
})

test('join - emits update event when topic updates', async ({ pass }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  const topic = new EventEmitter()
  swarm.network.lookup = () => topic
  swarm.join(key)
  await once(swarm, 'listening')
  process.nextTick(() => topic.emit('update'))
  await once(swarm, 'updated')
  pass('event emitted')
  swarm.destroy()
})

test('join - emits peer event when topic recieves peer', async ({ plan, pass, is }) => {
  plan(2)

  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.lookup = () => topic
  swarm.join(key)
  await once(swarm, 'listening')

  swarm.once('peer', function (peer) {
    pass('event emitted')
    is(peer, fauxPeer)
    swarm.destroy()
  })

  topic.emit('peer', fauxPeer)
})

test('join - announce: true, lookup: false', async ({ is, fail }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  var announceKey = null
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.announce = (key) => {
    announceKey = key
    return topic
  }
  swarm.join(key, { announce: true, lookup: false })
  await once(swarm, 'listening')
  swarm.once('peer', () => {
    fail('peers should not be emitted when lookup is false')
  })
  process.nextTick(() => {
    topic.emit('peer', fauxPeer)
  })
  is(announceKey, key)
  swarm.destroy()
})

test('join - announce: true, lookup: true', async ({ plan, is }) => {
  plan(2)

  const swarm = hyperswarm({ bootstrap: [] })
  var announceKey = null
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  const topic = new EventEmitter()
  const fauxPeer = { port: 8080, host: '127.0.0.1', local: true, referrer: null, topic: key }
  swarm.network.announce = (key) => {
    announceKey = key
    topic.key = key
    return topic
  }
  swarm.join(key, { announce: true, lookup: true })
  await once(swarm, 'listening')

  swarm.once('peer', function (peer) {
    is(peer, fauxPeer)
    is(announceKey, key)
    swarm.destroy()
  })

  topic.emit('peer', fauxPeer)
})

test('leave - missing key', async ({ throws }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  throws(() => swarm.leave(), Error('key is required and must be a 32-byte buffer'))
  throws(() => swarm.leave('not a buffer but still 32 bytes.'), Error('key is required and must be a 32-byte buffer'))
  throws(() => swarm.leave(Buffer.from('buffer but not 32 bytes.')), Error('key is required and must be a 32-byte buffer'))
  swarm.destroy()
})

test('leave destroys the topic for a given pre-existing key', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.concat([Buffer.alloc(28), Buffer.from('key1')])
  const key2 = Buffer.concat([Buffer.alloc(28), Buffer.from('key2')])
  const { lookup } = swarm.network
  var topicDestroyed = false
  var topic = null
  swarm.network.lookup = (key) => {
    return (topic = lookup.call(swarm.network, key))
  }
  swarm.join(key2)
  swarm.join(key)
  await once(swarm, 'listening') // wait for bind
  const { destroy } = topic
  topic.destroy = () => {
    topicDestroyed = true
    return destroy.call(topic)
  }
  swarm.leave(key)
  await once(swarm, 'leave')
  is(topicDestroyed, true)
  swarm.destroy()
})

test('leave does not throw when a given key was never joined', async ({ doesNotThrow }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.from('key1key1key1key1key1key1key1key1')
  const key2 = Buffer.from('key2key2key2key2key2key2key2key2')
  swarm.join(key)
  await once(swarm, 'listening')
  doesNotThrow(() => swarm.leave(key2))
  swarm.destroy()
})

test('joining the same topic twice will leave the topic before rejoining', async ({ is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
  const key = Buffer.from('key-key-key-key-key-key-key-key-')
  const { lookup } = swarm.network
  var topicDestroyed = false
  var topic = null
  swarm.network.lookup = (key) => {
    return (topic = lookup.call(swarm.network, key))
  }
  swarm.join(key)
  await once(swarm, 'listening')
  const { destroy } = topic
  swarm.network.bind = (cb) => cb()
  topic.destroy = () => {
    topicDestroyed = true
    return destroy.call(topic)
  }
  swarm.join(key)
  is(topicDestroyed, true)
  swarm.destroy()
})

test('connect to a swarm with a plain TCP client', async ({ pass, same, is }) => {
  const swarm = hyperswarm({ bootstrap: [] })
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

test('connect two peers directly', async ({ is }) => {
  const swarm1 = hyperswarm({ bootstrap: [] })
  const swarm2 = hyperswarm({ bootstrap: [] })
  swarm1.listen()
  await once(swarm1, 'listening')

  whenifyMethod(swarm2, 'connect')
  const peer = {
    host: '127.0.0.1',
    port: swarm1.address().port
  }
  swarm2.connect(peer, (err, socket, isTcp) => {
    is(err, null)
    is(validSocket(socket), true)
    is(typeof isTcp, 'boolean')
  })

  await swarm2.connect[done]

  swarm1.destroy()
  swarm2.destroy()
})

test('connect two peers using join (announcing peer and lookup peer)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: false
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: false,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  closeDht(peer1, peer2)
})

test('connect two peers using join (announcing peer and announcing + lookup peer)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: false
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: true,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  closeDht(peer1, peer2)
})

test('connect two peers using join (both announcing + lookup peers)', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const peer1 = hyperswarm({ bootstrap })
  const peer2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  peer1.join(key, {
    announce: true,
    lookup: true
  })

  await once(peer1, 'listening')
  peer2.join(key, {
    announce: true,
    lookup: true
  })
  await once(peer2, 'listening')
  var connectingPeer
  peer2.network.connect = (peer) => {
    connectingPeer = peer
  }
  const [ peer ] = await once(peer2, 'peer')
  is(peer, connectingPeer)
  peer1.leave(key)
  peer2.leave(key)
  closeDht(peer1, peer2)
})

test('emits connection event upon connecting to a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ peer ] = await once(swarm2, 'peer')
  const [ socket, info ] = await once(swarm2, 'connection')
  is(validSocket(socket), true)
  is(info.peer, peer)
  is(info.client, true)
  swarm1.leave(key)
  swarm2.leave(key)
  closeDht(swarm1, swarm2)
})

test('emits connection event upon being connected to by a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ socket, info ] = await once(swarm1, 'connection')
  is(validSocket(socket), true)
  is(info.peer, null)
  is(info.client, false)
  swarm1.leave(key)
  swarm2.leave(key)
  closeDht(swarm1, swarm2)
})

test('emits disconnection event upon disconnecting from a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  const [ peer ] = await once(swarm2, 'peer')
  await once(swarm2, 'connection')
  swarm1.leave(key)
  swarm1.destroy()
  const [ socket, info ] = await once(swarm2, 'disconnection')
  is(validSocket(socket), true)
  is(info.peer, peer)
  is(info.client, true)
  swarm2.leave(key)
  closeDht(swarm2)
})

test('emits disconnection event upon being disconnected from by a peer', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  await Promise.all([once(swarm1, 'connection'), once(swarm2, 'connection')])
  swarm2.leave(key)
  swarm2.destroy()
  await once(swarm2, 'close')
  const [ socket, info ] = await once(swarm1, 'disconnection')
  is(validSocket(socket), true)
  is(info.peer, null)
  is(info.client, false)
  swarm1.leave(key)
  closeDht(swarm1)
})

test('connections tracks active connections count correctly', async ({ is }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap })
  const swarm2 = hyperswarm({ bootstrap })
  const key = randomBytes(32)
  swarm1.join(key, {
    announce: true,
    lookup: false
  })
  await once(swarm1, 'listening')
  swarm2.join(key, {
    announce: false,
    lookup: true
  })
  await once(swarm2, 'listening')
  is(swarm2.connections.size, 0)
  await Promise.all([
    once(swarm2, 'peer'),
    once(swarm2, 'connection')
  ])
  is(swarm2.connections.size, 1)
  swarm1.leave(key)
  swarm1.destroy()
  await once(swarm2, 'disconnection')
  is(swarm2.connections.size, 0)
  swarm2.leave(key)
  closeDht(swarm2)
})

test('can multiplex 100 topics over the same connection', async ({ same }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap, maxPeers: 20, queue: { multiplex: true } })
  const swarm2 = hyperswarm({ bootstrap, maxPeers: 20, queue: { multiplex: true } })

  const numTopics = 100
  var topics = []

  // Announce all topics.
  for (let i = 0; i < numTopics; i++) {
    const topic = randomBytes(32)
    topics.push(topic)
    swarm1.join(topic, {
      announce: true,
      lookup: false
    })
  }

  // Start listening for new connections, and briefly wait to flush the DHT.
  const l = listenForConnections(swarm2)
  await new Promise(resolve => setTimeout(resolve, 100))

  // Join all topics on the receiving end.
  for (let i = 0; i < numTopics; i++) {
    swarm2.join(topics[i], {
      announce: false,
      lookup: true
    })
  }

  const topicSet = new Set(topics.map(t => t.toString('hex')))

  for (const topic of topics) {
    const topicString = topic.toString('hex')
    if (topicSet.has(topicString)) topicSet.delete(topicString)
  }
  same(topicSet.size, 0)
  await l

  closeDht(swarm1, swarm2)

  function listenForConnections (swarm) {
    const emittedTopics = []

    return new Promise((resolve, reject) => {
      const failTimer = setTimeout(() => {
        reject(new Error('Did not establish connections in time.'))
      }, 5000)

      swarm.on('connection', (socket, info) => {
        for (let topic of info.topics) {
          pushTopic(topic)
        }

        info.on('topic', topic => {
          pushTopic(topic)
        })

        function pushTopic (topic) {
          emittedTopics.push(topic)
          if (emittedTopics.length === numTopics) {
            clearTimeout(failTimer)
            info.removeAllListeners('topic')
            return resolve(emittedTopics)
          }
        }
      })
    })
  }
})

test('can dedup connections', async ({ same, end }) => {
  const { bootstrap, closeDht } = await dhtBootstrap()
  const swarm1 = hyperswarm({ bootstrap, maxPeers: 20, queue: { multiplex: true } })
  const swarm2 = hyperswarm({ bootstrap, maxPeers: 20, queue: { multiplex: true } })

  swarm1.on('connection', (socket, info) => {
    socket.write('b')
    socket.once('data', function (id) {
      info.deduplicate(Buffer.from('b'), id)
    })
    socket.on('error', () => {})
  })
  swarm2.on('connection', (socket, info) => {
    socket.write('a')
    socket.once('data', function (id) {
      info.deduplicate(Buffer.from('a'), id)
    })
    socket.on('error', () => {})
  })

  const topic = randomBytes(32)

  swarm1.join(topic, { announce: true, lookup: true })
  swarm2.join(topic, { announce: true, lookup: true })

  await new Promise(resolve => setTimeout(resolve, 100))

  same(swarm1.connections.size, 1)
  same(swarm1.connections.size, 1)

  closeDht(swarm1, swarm2)
})
