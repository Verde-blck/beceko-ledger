import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

const base = { LEDGER_PIN: '2468', SESSION_SECRET: 'a'.repeat(32) };

test('the statement thank-you line comes from STATEMENT_CLOSING', () => {
  assert.equal(loadConfig(base).statementClosing, 'Thank you for your patronage.');
  assert.equal(loadConfig({ ...base, STATEMENT_CLOSING: '  We appreciate your business.  ' }).statementClosing, 'We appreciate your business.');
  assert.equal(loadConfig({ ...base, STATEMENT_CLOSING: '   ' }).statementClosing, 'Thank you for your patronage.');
});
