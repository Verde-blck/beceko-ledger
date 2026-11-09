import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@google/genai';
import { geminiErrorDetail, quickEntryProblem, rankFlashModels } from '../src/extract.js';

const apiError = (status, message) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, message } }) });

test('Gemini failures are explained in plain terms', () => {
  assert.match(quickEntryProblem(apiError(401, 'API key not valid.')), /key was rejected/);
  assert.match(quickEntryProblem(apiError(400, 'API key expired. Please renew the API key.')), /key was rejected/);
  assert.match(quickEntryProblem(apiError(404, 'This model models/gemini-2.5-flash is no longer available.')), /no longer available/);
  assert.match(quickEntryProblem(apiError(429, 'Resource exhausted.')), /free limit/);
  assert.match(quickEntryProblem(new Error('socket hang up')), /Could not read that/);
});

test('the API message is pulled out of the JSON body', () => {
  assert.deepEqual(geminiErrorDetail(apiError(404, 'Model gone.')), { status: 404, message: 'Model gone.' });
  assert.deepEqual(geminiErrorDetail(new Error('offline')), { status: null, message: 'offline' });
});

test('newest general Flash models are tried first, lite models last', () => {
  const listed = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-omni-flash-preview',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
  ];
  assert.deepEqual(rankFlashModels(listed), [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ]);
});
