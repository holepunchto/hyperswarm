'use strict'
const { PassThrough } = require('stream')
const peerInfo = require('../lib/peer-info')
const { test } = require('tap')
const { once } = require('nonsynchronous')

test('default state', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  is(info.status, 34)
  is(info.type, 'utp')
  is(info.retries, 0)
  is(info.client, false)
  is(info.peer, null)
  is(info.stream, null)
})

test('default state w/ peer', async ({ is }) => {
  const peer = { port: 8000, host: '127.0.0.1' }
  const info = peerInfo(peer)
  is(info.firewalled, true)
  is(info.priority, 2)
  is(info.status, 34)
  is(info.type, 'utp')
  is(info.retries, 0)
  is(info.client, true)
  is(info.peer, peer)
  is(info.stream, null)
})

test('default state w/ local peer', async ({ is }) => {
  const peer = { port: 8000, host: '127.0.0.1', local: true }
  const info = peerInfo(peer)
  is(info.firewalled, true)
  is(info.priority, 3)
  is(info.status, 34)
  is(info.type, 'utp')
  is(info.retries, 0)
  is(info.client, true)
  is(info.peer, peer)
  is(info.stream, null)
})

test('update (status at default)', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  is(info.update(), true)
  is(info.priority, 2)
})

test('update (status at default w/ local peer)', async ({ is }) => {
  const peer = { port: 8000, host: '127.0.0.1', local: true }
  const info = peerInfo(peer)
  is(info.firewalled, true)
  is(info.priority, 3)
  is(info.update(), true)
  is(info.priority, 3)
})

test('reconnect sets reconnection strategy', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.reconnect(true)
  is(info.status, 58)
  info.reconnect(false)
  is(info.status, 56)
})

test('make active', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  is(info.status, 58)
})

test('make inactive (after active)', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  info.active(false)
  is(info.status, 50)
})

test('one requeue', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  info.connected()
  info.disconnected()
  info.active(false)
  is(info.requeue(), 0)
  is(info.retries, 1)
  is(info.update(), true)
  is(info.priority, 5)
})

test('two requeues', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  info.connected()
  info.disconnected()
  info.active(false)
  is(info.requeue(), 0)
  is(info.retries, 1)
  is(info.update(), true)
  is(info.priority, 5)
  is(info.requeue(), 1)
  is(info.retries, 2)
  is(info.update(), true)
  is(info.priority, 4)
})

test('three requeues', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  info.connected()
  info.disconnected()
  info.active(false)
  is(info.requeue(), 0)
  is(info.retries, 1)
  is(info.update(), true)
  is(info.priority, 5)
  is(info.requeue(), 1)
  is(info.retries, 2)
  is(info.update(), true)
  is(info.priority, 4)
  is(info.requeue(), 2)
  is(info.retries, 3)
  is(info.update(), true)
  is(info.retries, 3)
})

test('four requeues', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  info.connected()
  info.disconnected()
  info.active(false)
  is(info.requeue(), 0)
  is(info.retries, 1)
  is(info.update(), true)
  is(info.priority, 5)
  is(info.requeue(), 1)
  is(info.retries, 2)
  is(info.update(), true)
  is(info.priority, 4)
  is(info.requeue(), 2)
  is(info.retries, 3)
  is(info.update(), true)
  is(info.priority, 1)
  is(info.requeue(), -1)
  is(info.retries, 4)
  is(info.update(), false)
})

test('connected - utp', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  const isTCP = false
  info.connected(stream, isTCP)
  is(info.stream, stream)
  is(info.status, 59)
})

test('connected - tcp', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  is(info.stream, stream)
  is(info.status, 27)
})

test('connected resets retries count to 0', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  is(info.requeue(), 0)
  is(info.retries, 1)
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  is(info.stream, stream)
  is(info.retries, 0)
})

test('ban', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.ban()
  is(info.status, 62)
})

test('destroy', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.destroy()
  is(info.status, 62)
})

test('connected after destroy', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.destroy()
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  const err = await once(stream, 'error')
  is(err.message, 'Peer was banned')
})

test('connected after ban', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.ban()
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  const err = await once(stream, 'error')
  is(err.message, 'Peer was banned')
})

test('destroy after connected', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  info.destroy()
  await once(stream, 'close')
  is(info.status, 31)
})

test('destroy with error after connected', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  info.destroy(Error('test'))
  const err = await once(stream, 'error')
  is(err.message, 'test')
})

test('ban after connected', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  is(info.stream, stream)
  info.ban()
  const err = await once(stream, 'error')
  is(err.message, 'Peer was banned')
  is(info.stream, null)
})

test('destroy when stream already destroyed', async ({ fail }) => {
  const info = peerInfo()
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  stream.destroy()
  await once(stream, 'close')
  stream.destroy = () => fail('stream should not be destroyed if already closed')
  info.destroy()
})

test('ban when stream already destroyed', async ({ fail }) => {
  const info = peerInfo()
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  stream.destroy()
  await once(stream, 'close')
  stream.destroy = () => fail('stream should not be destroyed if already closed')
  info.destroy()
})

test('update will not reprioitize after connected', async ({ is }) => {
  const info = peerInfo()
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  info.connected(stream)
  is(info.update(), false)
  is(info.priority, 2)
})

test('update will not reprioitize after destroyed', async ({ is }) => {
  const info = peerInfo()
  is(info.priority, 2)
  info.active(true)
  info.destroy()
  is(info.update(), false)
  is(info.priority, 2)
})

test('update will not reprioitize after ban', async ({ is }) => {
  const info = peerInfo()
  is(info.priority, 2)
  info.active(true)
  info.destroy()
  is(info.update(), false)
  is(info.priority, 2)
})

test('requeue will be refused after ban', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.ban()
  is(info.requeue(), -1)
})

test('requeue will be refused after destroy', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.destroy()
  is(info.requeue(), -1)
})

test('requeue will be refused if reconnect is disabled', async ({ is }) => {
  const info = peerInfo()
  info.active(true)
  info.reconnect(false)
  is(info.requeue(), -1)
})

test('disconnected clears stream', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  const isTCP = false
  info.connected(stream, isTCP)
  is(info.stream, stream)
  info.disconnected()
  is(info.stream, null)
})

test('backoff increases retries and alters priority of client peers', async ({ is }) => {
  const info = peerInfo({ port: 8000, host: '127.0.0.1' })
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  is(info.stream, stream)
  is(info.retries, 0)
  is(info.priority, 2)
  is(info.client, true)
  is(info.backoff(), true)
  is(info.retries, 1)
  is(info.priority, 5)
  is(info.backoff(), true)
  is(info.retries, 2)
  is(info.priority, 4)
  is(info.backoff(), true)
  is(info.retries, 3)
  is(info.priority, 1)
  is(info.backoff(), false)
  is(info.retries, 4)
  is(info.priority, 1)
  is(info.backoff(), false)
  is(info.retries, 5)
  is(info.priority, 1)
})

test('backoff is a no-op on server peers', async ({ is }) => {
  const info = peerInfo()
  is(info.firewalled, true)
  is(info.priority, 2)
  info.active(true)
  const stream = PassThrough()
  const isTCP = true
  info.connected(stream, isTCP)
  is(info.stream, stream)
  is(info.retries, 0)
  is(info.priority, 2)
  is(info.client, false)
  is(info.backoff(), undefined)
  is(info.retries, 0)
  is(info.priority, 2)
})
