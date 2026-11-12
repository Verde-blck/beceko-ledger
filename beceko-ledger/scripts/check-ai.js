import { aiSettings } from '../src/config.js';
import {
  aiErrorDetail,
  claudeClient,
  createClaudeExtractor,
  createExtractor,
  createGeminiExtractor,
  geminiClient,
  providerLabel,
  rankFlashModels,
} from '../src/extract.js';

const TEST_NOTE = 'Korede paid another 5k from his debt';
const CUSTOMERS = ['Korede'];
const MAX_ATTEMPTS = 4;

const ai = aiSettings(process.env);
for (const warning of ai.warnings) console.error(warning);
if (!ai.provider) {
  console.error('No AI key is set. Add ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY to .env.');
  process.exit(1);
}

function report(name, error) {
  const { status, message } = aiErrorDetail(error);
  console.error(`${name} failed${status ? ` (${status})` : ''}: ${message}`);
  return { status, message };
}

async function tryOtherClaudeModels() {
  const ids = [];
  for await (const model of claudeClient(ai.anthropicApiKey).models.list()) ids.push(model.id);
  const candidates = ids.filter((id) => /haiku|sonnet/.test(id) && id !== ai.anthropicModel).slice(0, MAX_ATTEMPTS);
  for (const model of candidates) {
    try {
      await createClaudeExtractor({ apiKey: ai.anthropicApiKey, model })(TEST_NOTE, CUSTOMERS);
      return model;
    } catch (error) {
      report(model, error);
    }
  }
  return null;
}

async function tryOtherGeminiModels() {
  const names = [];
  for await (const entry of await geminiClient(ai.geminiApiKey).models.list()) {
    if (entry.supportedActions?.includes('generateContent')) names.push(entry.name.replace(/^models\//, ''));
  }
  const candidates = rankFlashModels(names).filter((name) => name !== ai.geminiModel).slice(0, MAX_ATTEMPTS);
  for (const model of candidates) {
    try {
      await createGeminiExtractor({ apiKey: ai.geminiApiKey, model })(TEST_NOTE, CUSTOMERS);
      return model;
    } catch (error) {
      report(model, error);
    }
  }
  return null;
}

try {
  const events = await createExtractor(ai)(TEST_NOTE, CUSTOMERS);
  console.log(`Quick entry is working with ${providerLabel(ai)}. The test note "${TEST_NOTE}" was read as:`);
  console.log(JSON.stringify(events, null, 2));
  process.exit(0);
} catch (error) {
  const { status, message } = report(providerLabel(ai), error);
  if (status === null) {
    console.error('Could not reach the AI service. Check the internet connection and try again.');
    process.exit(1);
  }
  if (status === 401 || status === 403) {
    console.error('The key was rejected. Check it was copied in full, or create a new one.');
    process.exit(1);
  }
  if (status === 400 && /credit balance/i.test(message)) {
    console.error('The Claude account has no credit. Add credit in the Claude Console, then run this again.');
    process.exit(1);
  }
  if (status === 429 || status >= 500) {
    console.error('The service is busy or the limit has been reached. Wait a minute and run this again.');
    process.exit(1);
  }
}

console.log('\nTrying other models your key can use...');
const variable = ai.provider === 'claude' ? 'ANTHROPIC_MODEL' : 'GEMINI_MODEL';
let working = null;
try {
  working = ai.provider === 'claude' ? await tryOtherClaudeModels() : await tryOtherGeminiModels();
} catch (error) {
  report('Listing models', error);
}
if (working) {
  console.log(`\n${working} works. Set this in .env (and in Railway's variables), then restart:\n\n${variable}=${working}`);
  process.exit(0);
}
console.error('\nNo model worked with this key. Send the messages above for help.');
process.exit(1);
