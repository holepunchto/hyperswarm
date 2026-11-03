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
