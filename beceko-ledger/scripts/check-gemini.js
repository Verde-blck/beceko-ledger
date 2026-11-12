import { createExtractor, geminiClient, geminiErrorDetail, rankFlashModels } from '../src/extract.js';

const TEST_NOTE = 'Korede paid another 5k from his debt';
const MAX_ATTEMPTS = 4;

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

if (!apiKey) {
  console.error('GEMINI_API_KEY is empty in .env.');
  process.exit(1);
}

const tryModel = (geminiModel) =>
  createExtractor({ geminiApiKey: apiKey, geminiModel })(TEST_NOTE, ['Korede']);

function report(name, error) {
  const { status, message } = geminiErrorDetail(error);
  console.error(`${name} failed${status ? ` (${status})` : ''}: ${message}`);
  return status;
}

async function availableFlashModels() {
  const names = [];
  for await (const entry of await geminiClient(apiKey).models.list()) {
    if (entry.supportedActions?.includes('generateContent')) names.push(entry.name.replace(/^models\//, ''));
  }
  return rankFlashModels(names);
}

try {
  const events = await tryModel(model);
  console.log(`Gemini is working with ${model}. The test note "${TEST_NOTE}" was read as:`);
  console.log(JSON.stringify(events, null, 2));
  process.exit(0);
} catch (error) {
  const status = report(model, error);
  if (status === 401 || status === 403) {
    console.error('The key was rejected. Create a new key in Google AI Studio and paste it into .env.');
    process.exit(1);
  }
}

console.log('\nTrying other models your key can use...');
for (const candidate of (await availableFlashModels()).filter((name) => name !== model).slice(0, MAX_ATTEMPTS)) {
  try {
    await tryModel(candidate);
    console.log(`\n${candidate} works. Set this in .env and restart the app:\n\nGEMINI_MODEL=${candidate}`);
    process.exit(0);
  } catch (error) {
    report(candidate, error);
  }
}

console.error('\nNo model worked with this key. Send the messages above for help.');
process.exit(1);
