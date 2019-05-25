'use strict'
const { promisify } = require('util')
const once = require('events.once')
const when = () => {
  var done = () => { throw Error('did not happen') }
  const fn = () => done()
  fn.done = promisify((cb) => { done = cb })
  return fn
}
const whenify = (fn, { asyncOps } = { asyncOps: 1 }) => {
  const until = when()
  const max = asyncOps - 1
  const result = (...args) => {
    const cb = args.pop()
    return fn(...args, (...args) => {
      cb(...args) // eslint-disable-line
      if (++result.count > max) until()
    })
  }
  result.count = 0
  result.done = until.done
  return result
}
const promisifyMethod = (instance, method) => {
  const result = promisify(instance[method])
  result.orig = instance[method]
  instance[method] = result
  return result
}
const immediate = promisify(setImmediate)
const timeout = promisify(setTimeout)
const all = Promise.all.bind(Promise)

module.exports = { when, whenify, immediate, timeout, once, promisifyMethod, promisify, all }
