const test = require('brittle')
const b4a = require('b4a')

const PeerInfo = require('../lib/peer-info')

test('peer info records each topic once, across inline and spilled ids', (t) => {
  const peerInfo = new PeerInfo({ publicKey: b4a.alloc(32, 1), relayAddresses: null })
  const topics = []
  let emitted = 0

  peerInfo.on('topic', () => emitted++)

  for (let id = 0; id < 100; id++) topics.push(b4a.alloc(32, id))
  for (let round = 0; round < 2; round++) {
    for (let id = 99; id >= 0; id--) peerInfo._topic(topics[id], id)
  }

  t.is(peerInfo.topics.length, 100)
  t.is(emitted, 100)
  t.is(peerInfo.topics[0], topics[99])
  t.is(peerInfo.topics[99], topics[0])
})

test('peer info keeps spilled topics across growth in any order', (t) => {
  const peerInfo = new PeerInfo({ publicKey: b4a.alloc(32, 1), relayAddresses: null })
  const ids = []
  let emitted = 0

  peerInfo.on('topic', () => emitted++)

  // Ascending, then interleaved below the existing ids, forcing several regrowths
  for (let id = 30; id < 60; id++) ids.push(id)
  for (let id = 1000; id > 60; id -= 31) ids.push(id)

  for (const id of ids) peerInfo._topic(b4a.alloc(32, id & 0xff), id)
  for (const id of ids) peerInfo._topic(b4a.alloc(32, id & 0xff), id)

  t.is(peerInfo.topics.length, ids.length, 'each topic recorded once')
  t.is(emitted, ids.length)
})

test('peer info spill size follows the peer, not the topic id', (t) => {
  const peerInfo = new PeerInfo({ publicKey: b4a.alloc(32, 1), relayAddresses: null })

  peerInfo._topic(b4a.alloc(32, 1), 100000)
  peerInfo._topic(b4a.alloc(32, 1), 100000)

  t.is(peerInfo.topics.length, 1)
  t.ok(peerInfo._topicSpill.length <= 4)
})
