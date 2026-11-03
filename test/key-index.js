const test = require('brittle')
const b4a = require('b4a')

const KeyIndex = require('../lib/key-index')

test('key index matches a map under random inserts and deletes', (t) => {
  const index = new KeyIndex()
  const map = new Map()
  const keys = []

  for (let i = 0; i < 20000; i++) {
    if (keys.length === 0 || Math.random() < 0.55) {
      const key = randomKey()
      keys.push(key)
      index.set(key, i)
      map.set(b4a.toString(key, 'hex'), i)
    } else {
      const j = Math.floor(Math.random() * keys.length)
      const key = keys[j]
      keys[j] = keys[keys.length - 1]
      keys.pop()
      index.delete(key)
      map.delete(b4a.toString(key, 'hex'))
    }
  }

  t.is(index.size, map.size)
  let same = true
  for (const [hex, value] of map) {
    if (index.get(b4a.from(hex, 'hex')) !== value) same = false
  }
  t.ok(same, 'every key maps to its latest value')
  t.absent(index.has(randomKey()))
})

test('key index handles keys whose hashes fully collide', (t) => {
  const index = new KeyIndex()
  const keys = []

  // Same first 8 bytes means the same hash, so every key lands in one probe chain
  for (let i = 0; i < 100; i++) {
    const key = randomKey()
    key.fill(7, 0, 8)
    keys.push(key)
    index.set(key, i)
  }

  for (let i = 0; i < 100; i += 2) t.ok(index.delete(keys[i]))

  let ok = true
  for (let i = 0; i < 100; i++) {
    const expected = i % 2 === 0 ? undefined : i
    if (index.get(keys[i]) !== expected) ok = false
  }
  t.ok(ok, 'lookups stay correct after deleting from the chain')
  t.is(index.size, 50)
  t.absent(index.delete(keys[0]), 'deleting a missing key is a no-op')
})

test('key index set replaces the value of an existing key', (t) => {
  const index = new KeyIndex()
  const key = randomKey()

  index.set(key, 'a')
  index.set(b4a.from(key), 'b')

  t.is(index.size, 1)
  t.is(index.get(key), 'b')
})

function randomKey() {
  const key = b4a.alloc(32)
  for (let i = 0; i < 32; i++) key[i] = Math.floor(Math.random() * 256)
  return key
}
