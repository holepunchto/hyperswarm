'use strict'
const { test } = require('tap')
const { once, promisifyMethod } = require('./util')
const network = require('../')

test('listening and destroy', async ({ pass, same }) => {
  const swarm = network()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  pass('swarm is listening')
  same(typeof swarm.address().port, 'number')
  swarm.destroy()
  await once(swarm, 'close')
})

test('listening and destroy twice', async ({ pass, same }) => {
  const swarm = network()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  pass('swarm is listening')
  same(typeof swarm.address().port, 'number')
  swarm.destroy()
  swarm.destroy()
  await once(swarm, 'close')
})

test('destroy right away', async ({ pass, doesNotThrow }) => {
  const swarm = network()
  doesNotThrow(() => swarm.destroy())
  const swarm2 = network()
  promisifyMethod(swarm2, 'destroy')
  await swarm2.destroy()
  pass('closed')
})

test('destroy right away after listen', async ({ pass }) => {
  const swarm = network()
  swarm.listen()
  swarm.destroy()
  await once(swarm, 'close')
  pass('closed')
})
