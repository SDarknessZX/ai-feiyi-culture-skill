import assert from 'node:assert/strict'
import test from 'node:test'
import { isBlankSignalStats } from './imageValidation.js'

test('rejects fully black image signal statistics', () => {
  assert.equal(isBlankSignalStats({ YAVG: 0, YHIGH: 0, YMAX: 0 }), true)
  assert.equal(isBlankSignalStats({ YAVG: 2.5, YHIGH: 5, YMAX: 10 }), true)
})

test('keeps dark but visibly detailed images', () => {
  assert.equal(isBlankSignalStats({ YAVG: 8, YHIGH: 15, YMAX: 40 }), false)
  assert.equal(isBlankSignalStats({ YAVG: 2, YHIGH: 5, YMAX: 80 }), false)
})
