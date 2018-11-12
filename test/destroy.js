const network = require('../')
const tape = require('tape')

tape('listening and destroy', function (assert) {
  const swarm = network()

  swarm.listen(function () {
    assert.pass('swarm is listening')
    assert.same(typeof swarm.address().port, 'number')
    swarm.destroy()
  })

  swarm.once('close', function () {
    assert.end()
  })
})

tape('listening and destroy twice', function (assert) {
  const swarm = network()

  swarm.listen(function () {
    assert.pass('swarm is listening')
    assert.same(typeof swarm.address().port, 'number')
    swarm.destroy()
    swarm.destroy()
  })

  swarm.once('close', function () {
    swarm.destroy()
    assert.end()
  })
})

tape('destroy right away', function (assert) {
  const swarm = network()

  swarm.on('close', function () {
    assert.pass('closed')
    assert.end()
  })

  swarm.destroy()
})

tape('destroy right away after listen', function (assert) {
  const swarm = network()

  swarm.on('close', function () {
    assert.pass('closed')
    assert.end()
  })

  swarm.listen()
  swarm.destroy()
})
