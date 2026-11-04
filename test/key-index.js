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

test('key index handles long probe chains', (t) => {
  const index = new KeyIndex()
  const keys = []

  // Fill most of the table so probe chains are long and wrap around
  for (let i = 0; i < 100; i++) {
    const key = randomKey()
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

test('key index deletes from a probe chain that wraps around', (t) => {
  // A fresh index has 16 slots, so a key's slot in it is its home slot
  const last = keyWithHome(15)
  const keys = [last(), last(), last(), keyWithHome(0)(), keyWithHome(1)()]

  // Chain: slots 15, 0, 1 hold the home-15 keys, slots 2 and 3 the others
  let ok = true
  for (let i = 0; i < keys.length; i++) {
    const index = new KeyIndex()
    keys.forEach((key, j) => index.set(key, j))
    index.delete(keys[i])

    for (let j = 0; j < keys.length; j++) {
      if (index.get(keys[j]) !== (j === i ? undefined : j)) ok = false
    }
  }
  t.ok(ok, 'every other key is still found after deleting any one')

  const index = new KeyIndex()
  keys.forEach((key, j) => index.set(key, j))
  for (let i = 0; i < keys.length; i++) {
    index.delete(keys[i])
    for (let j = i + 1; j < keys.length; j++) {
      if (index.get(keys[j]) !== j) ok = false
    }
  }
  t.ok(ok, 'remaining keys are found while the chain is emptied')
  t.is(index.size, 0)
})

test('key index spreads keys that share a long prefix', (t) => {
  const index = new KeyIndex()

  for (let i = 0; i < 1024; i++) {
    const key = b4a.alloc(32, 7)
    key.writeUInt32LE(i, 28)
    index.set(key, i)
  }

  let longest = 0
  let run = 0
  for (const slot of index._slots) {
    run = slot === 0 ? 0 : run + 1
    if (run > longest) longest = run
  }

  t.ok(longest < 64, 'longest probe run is ' + longest)
})

test('key index set replaces the value of an existing key', (t) => {
  const index = new KeyIndex()
  const key = randomKey()

  index.set(key, 'a')
  index.set(b4a.from(key), 'b')

  t.is(index.size, 1)
  t.is(index.get(key), 'b')
})

function keyWithHome(home) {
  return function () {
    while (true) {
      const key = randomKey()
      const index = new KeyIndex()
      index.set(key, 0)
      if (index._slots[home] !== 0) return key
    }
  }
}

function randomKey() {
  const key = b4a.alloc(32)
  for (let i = 0; i < 32; i++) key[i] = Math.floor(Math.random() * 256)
  return key
}
