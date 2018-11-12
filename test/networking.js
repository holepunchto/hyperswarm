const tape = require('tape')
const network = require('../')
const net = require('net')

tape('connect directly', function (assert) {
  assert.plan(7)

  const swarm = network()

  swarm.on('close', function () {
    assert.pass('swarm closed')
  })

  swarm.on('connection', function (socket, info) {
    assert.pass('server connected')
    assert.same(info.type, 'tcp')

    socket.on('data', function (data) {
      assert.same(data, Buffer.from('a'))
      socket.destroy()
      swarm.destroy()
    })

    socket.on('close', function () {
      assert.pass('server disconnected')
    })
  })

  swarm.listen(function () {
    const { port } = swarm.address()
    const socket = net.connect(port)

    socket.on('connect', function () {
      assert.pass('client connected')
    })

    socket.on('close', function () {
      assert.pass('client disconnected')
    })

    socket.write('a')
  })
})
