import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '@google/genai';
import { aiSettings } from '../src/config.js';
import { EXTRACTION_PROMPT } from '../src/prompt.js';
import { aiErrorDetail, createClaudeExtractor, quickEntryProblem, rankFlashModels } from '../src/extract.js';

const geminiError = (status, message) =>
  new ApiError({ status, message: JSON.stringify({ error: { code: status, message } }) });

const claudeError = (status, type, message) =>
  Object.assign(new Error(`${status} ${message}`), { status, error: { type: 'error', error: { type, message } } });

function fakeClaude(response) {
  const calls = [];
  return {
    calls,
    client: { messages: { create: async (body) => (calls.push(body), response) } },
  };
}

test('Claude is used when its key is set, and the choice can be forced', () => {
  assert.equal(aiSettings({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).provider, 'claude');
  assert.equal(aiSettings({ GEMINI_API_KEY: 'g' }).provider, 'gemini');
  assert.equal(aiSettings({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_PROVIDER: 'Gemini' }).provider, 'gemini');
  assert.equal(aiSettings({}).provider, '');
  assert.equal(aiSettings({ ANTHROPIC_API_KEY: 'a' }).anthropicModel, 'claude-haiku-5-5');

  const missing = aiSettings({ AI_PROVIDER: 'claude' });
  assert.equal(missing.provider, '');
  assert.match(missing.warnings[0], /ANTHROPIC_API_KEY is empty/);
});

test('the Claude extractor asks for structured JSON and reads only the text block', async () => {
  const events = [{ customer_name: 'Korede', kind: 'Payment', description: 'Payment', total_cost: null, amount_paid: 5000, clears_balance: false, needs_review: false, review_reason: '' }];
  const { client, calls } = fakeClaude({
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: JSON.stringify({ events }) }],
  });

  const result = await createClaudeExtractor({ model: 'claude-haiku-5-5', client })('korede paid 5k', ['Korede']);
  assert.equal(result[0].kind, 'PAYMENT');
  assert.equal(result[0].amount_paid, 5000);

  const [body] = calls;
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.equal(body.system, EXTRACTION_PROMPT);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.effort, 'low');
  assert.equal('temperature' in body, false);
  assert.match(body.messages[0].content, /Existing customers: \["Korede"\]/);
  assert.match(body.messages[0].content, /"korede paid 5k"/);
});

test('a refused or cut-off Claude reply is an error, not an empty result', async () => {
  const refused = fakeClaude({ stop_reason: 'refusal', content: [] });
  await assert.rejects(createClaudeExtractor({ model: 'm', client: refused.client })('x', []), /declined/);
  const cut = fakeClaude({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"events": [' }] });
  await assert.rejects(createClaudeExtractor({ model: 'm', client: cut.client })('x', []), /ran out of room/);
});

test('AI failures are explained in plain terms for both providers', () => {
  assert.match(quickEntryProblem(geminiError(401, 'API key not valid.')), /key was rejected/);
  assert.match(quickEntryProblem(claudeError(401, 'authentication_error', 'invalid x-api-key')), /key was rejected/);
  assert.match(quickEntryProblem(claudeError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')), /run out of credit/);
  assert.match(quickEntryProblem(geminiError(404, 'This model is no longer available.')), /no longer available/);
  assert.match(quickEntryProblem(claudeError(404, 'not_found_error', 'model: claude-old')), /no longer available/);
  assert.match(quickEntryProblem(claudeError(429, 'rate_limit_error', 'Too many requests')), /limit/);
  assert.match(quickEntryProblem(claudeError(529, 'overloaded_error', 'Overloaded')), /busy/);
  assert.match(quickEntryProblem(new Error('socket hang up')), /Could not read that/);
});

test('the error message is pulled out of either provider’s format', () => {
  assert.deepEqual(aiErrorDetail(geminiError(404, 'Model gone.')), { status: 404, message: 'Model gone.' });
  assert.deepEqual(aiErrorDetail(claudeError(401, 'authentication_error', 'invalid x-api-key')), { status: 401, message: 'invalid x-api-key' });
  assert.deepEqual(aiErrorDetail(new Error('offline')), { status: null, message: 'offline' });
});

test('newest general Flash models are tried first, lite models last', () => {
  const listed = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-omni-flash-preview', 'gemini-3.8-flash', 'gemini-3.7-flash'];
  assert.deepEqual(rankFlashModels(listed), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']);
});
