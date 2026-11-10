import assert from 'node:assert/strict';
import test from 'node:test';
import { combineResults } from '../public/js/speech.js';

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

test('separate final phrases are joined (desktop Chrome)', () => {
  const { heard, interim } = combineResults([result('Korede paid', true), result(' another 5k', true), result('from his', false)]);
  assert.equal(heard, 'Korede paid another 5k');
  assert.equal(interim, 'from his');
});

test('repeated growing phrases are not doubled (Chrome on Android)', () => {
  const { heard, interim } = combineResults([
    result('Korede paid', true),
    result('Korede paid another 5k', true),
    result('Korede paid another 5k from his debt', false),
  ]);
  assert.equal(heard, 'Korede paid another 5k');
  assert.equal(interim, 'from his debt');
});

test('a shorter repeat of the last phrase is ignored', () => {
  assert.equal(combineResults([result('Mama Chidi paid 3000', true), result('Mama Chidi', true)]).heard, 'Mama Chidi paid 3000');
});

test('empty and blank results are skipped', () => {
  assert.deepEqual(combineResults([result('  ', true), result('', false)]), { heard: '', interim: '' });
});
