'use strict'
const { test } = require('tap')
const { done, whenifyMethod, promisifyMethod } = require('nonsynchronous')
const hyperswarm = require('../')

test('when unable to bind', async ({ is }) => {
  const swarm = hyperswarm()
  const fauxErr = Error('problem binding')
  swarm.network.bind = (cb) => process.nextTick(cb, fauxErr)
  whenifyMethod(swarm, 'connectivity')
  swarm.connectivity((err, { bound, bootstrapped, holepunched }) => {
    is(err, fauxErr)
    is(bound, false)
    is(bootstrapped, false)
    is(holepunched, false)
  })
  await swarm.connectivity[done]
})

test('when able to bind but unable to bootstrap', async ({ is }) => {
  const swarm = hyperswarm()
  const fauxErr = Error('problem holepunching')
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.network.discovery.holepunchable = (cb) => process.nextTick(cb, fauxErr)
  whenifyMethod(swarm, 'connectivity')
  swarm.connectivity((err, { bound, bootstrapped, holepunched }) => {
    is(err, fauxErr)
    is(bound, true)
    is(bootstrapped, false)
    is(holepunched, false)
  })
  await swarm.connectivity[done]
  swarm.destroy()
})

test('when able to bind and bootstrap but unable to holepunch', async ({ is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.network.discovery.holepunchable = (cb) => process.nextTick(cb, null, false)
  whenifyMethod(swarm, 'connectivity')
  swarm.connectivity((err, { bound, bootstrapped, holepunched }) => {
    is(err, null)
    is(bound, true)
    is(bootstrapped, true)
    is(holepunched, false)
  })
  await swarm.connectivity[done]
  swarm.destroy()
})

test('when able to bind, bootstrap and holepunch', async ({ is }) => {
  const swarm = hyperswarm()
  promisifyMethod(swarm, 'listen')
  await swarm.listen()
  swarm.network.discovery.holepunchable = (cb) => process.nextTick(cb, null, true)
  whenifyMethod(swarm, 'connectivity')
  swarm.connectivity((err, { bound, bootstrapped, holepunched }) => {
    is(err, null)
    is(bound, true)
    is(bootstrapped, true)
    is(holepunched, true)
  })
  await swarm.connectivity[done]
  swarm.destroy()
})
