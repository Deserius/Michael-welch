import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcRoastCost,
  clampDuration,
  clampIntensity,
  linesPerPersona,
  BASE_COST,
} from '../api/_pricing.js';

const std = (n) => Array.from({ length: n }, () => ({ tier: 'standard' }));
const prem = (n) => Array.from({ length: n }, () => ({ tier: 'premium' }));

test('base roast costs a single credit', () => {
  const { total, breakdown } = calcRoastCost({ personas: std(3) });
  assert.equal(total, BASE_COST);
  assert.equal(breakdown.premium_personas, 0);
});

test('premium personas add one credit each', () => {
  assert.equal(calcRoastCost({ personas: prem(2) }).total, 1 + 2);
  assert.equal(calcRoastCost({ personas: [...prem(2), ...std(2)] }).total, 3);
});

test('premium model adds two credits', () => {
  assert.equal(calcRoastCost({ personas: std(1), premiumModel: true }).total, 3);
});

test('premium voices add one credit', () => {
  assert.equal(calcRoastCost({ personas: std(1), premiumVoices: true }).total, 2);
});

test('everything stacked is additive', () => {
  const { total, breakdown } = calcRoastCost({
    personas: [...prem(3), ...std(2)],
    premiumModel: true,
    premiumVoices: true,
  });
  assert.deepEqual(breakdown, {
    base: 1,
    premium_personas: 3,
    premium_model: 2,
    premium_voices: 1,
  });
  assert.equal(total, 7);
});

test('subscribers are never charged', () => {
  const { total } = calcRoastCost({
    personas: prem(5),
    premiumModel: true,
    premiumVoices: true,
    subscriber: true,
  });
  assert.equal(total, 0);
});

test('null personas are ignored rather than throwing', () => {
  const { total } = calcRoastCost({ personas: [null, undefined, { tier: 'standard' }] });
  assert.equal(total, 1);
});

test('duration is clamped to 3..10 minutes', () => {
  assert.equal(clampDuration(1), 3);
  assert.equal(clampDuration(99), 10);
  assert.equal(clampDuration(7), 7);
  assert.equal(clampDuration('6'), 6);
  assert.equal(clampDuration(undefined), 5);
  assert.equal(clampDuration('nope'), 5);
});

test('intensity is clamped to 1..5', () => {
  assert.equal(clampIntensity(0), 1);
  assert.equal(clampIntensity(9), 5);
  assert.equal(clampIntensity(4), 4);
  assert.equal(clampIntensity(undefined), 3);
});

test('longer roasts produce more lines per persona', () => {
  assert.ok(linesPerPersona(10, 2) > linesPerPersona(3, 2));
});

test('lines per persona never drops below two', () => {
  assert.equal(linesPerPersona(3, 30), 2);
  assert.equal(linesPerPersona(5, 0), 2);
});
