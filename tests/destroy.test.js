const log = require('why-is-node-running')
const test = require('tape')
const network = require('../')
const crypto = require('crypto')

function createNetwork () {
  const net = network({
    ephemeral: true
  })

  net.discovery.holepunchable((err, yes) => {
    console.log('network is hole punchable?', err, yes)
    if (err) throw new Error('This test will not pass since the network is not HolePunchAble: ', err)
  })
  return net
}

function joinNetwork (net, topic) {
  const k = crypto.createHash('sha256')
    .update(topic)
    .digest()
  net.join(k, {
    announce: false,
    lookup: true
  })
}

function destroy (t) {
  let handles = process._getActiveHandles()
  console.log('handles length = ', handles.length)
  let requests = process._getActiveRequests()
  console.log('requests length = ', requests.length)
  log()
  t.end()
}
// Unfortunately, this test will hang if it fails.
test('Make sure we can destroy the network with a UTP socket in a second', t => {
  t.pass('We can pass!')
  let topics = ['topic1', 'topic2']
  let net1 = createNetwork()
  topics.forEach(topic => {
    joinNetwork(net1, topic)
  })
  let timeToWait = 200 // We need an "onready" event so I don't have to do this.
  setTimeout(() => {
    net1.destroy(destroy(t))
  }, timeToWait)
})
