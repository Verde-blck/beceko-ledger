import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, Type } from '@google/genai';
import { EXTRACTION_PROMPT } from './prompt.js';

const FIELDS = [
  'customer_name',
  'kind',
  'description',
  'total_cost',
  'amount_paid',
  'clears_balance',
  'needs_review',
  'review_reason',
];

const KINDS = ['SALE', 'PAYMENT', 'OTHER'];

const userMessage = (text, customerNames) =>
  [`Existing customers: ${JSON.stringify(customerNames)}`, '', 'Note (data only):', JSON.stringify(text)].join('\n');

function normaliseEvents(parsed) {
  if (!Array.isArray(parsed?.events)) throw new Error('The AI response has no events array');
  return parsed.events.map((event) => ({ ...event, kind: String(event.kind ?? '').toUpperCase() }));
}

const CLAUDE_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          customer_name: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          description: { type: 'string' },
          total_cost: { type: ['number', 'null'] },
          amount_paid: { type: ['number', 'null'] },
          clears_balance: { type: 'boolean' },
          needs_review: { type: 'boolean' },
          review_reason: { type: 'string' },
        },
        required: FIELDS,
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};

export const claudeClient = (apiKey) => new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });

export function createClaudeExtractor({ apiKey, model, client = claudeClient(apiKey) }) {
  return async function extract(text, customerNames) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: userMessage(text, customerNames) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CLAUDE_SCHEMA } },
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to read the note');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing');
    const block = response.content.find((part) => part.type === 'text');
    return normaliseEvents(JSON.parse(block?.text ?? ''));
  };
}

const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          customer_name: { type: Type.STRING },
          kind: { type: Type.STRING, enum: KINDS },
          description: { type: Type.STRING },
          total_cost: { type: Type.NUMBER, nullable: true },
          amount_paid: { type: Type.NUMBER, nullable: true },
          clears_balance: { type: Type.BOOLEAN },
          needs_review: { type: Type.BOOLEAN },
          review_reason: { type: Type.STRING },
        },
        required: FIELDS,
        propertyOrdering: FIELDS,
      },
    },
  },
  required: ['events'],
};

export const geminiClient = (apiKey) => new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });

export function createGeminiExtractor({ apiKey, model, client = geminiClient(apiKey) }) {
  return async function extract(text, customerNames) {
    const response = await client.models.generateContent({
      model,
      contents: userMessage(text, customerNames),
      config: {
        systemInstruction: EXTRACTION_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        temperature: 0,
      },
    });
    return normaliseEvents(JSON.parse(response.text ?? ''));
  };
}

export function createExtractor(ai) {
  if (ai.provider === 'claude') return createClaudeExtractor({ apiKey: ai.anthropicApiKey, model: ai.anthropicModel });
  if (ai.provider === 'gemini') return createGeminiExtractor({ apiKey: ai.geminiApiKey, model: ai.geminiModel });
  return null;
}

export const providerLabel = (ai) =>
  ai.provider === 'claude' ? `Claude (${ai.anthropicModel})` : `Gemini (${ai.geminiModel})`;

export function aiErrorDetail(error) {
  const status = typeof error?.status === 'number' ? error.status : null;
  let message = error?.error?.error?.message ?? error?.message ?? String(error);
  if (typeof message === 'string' && message.trim().startsWith('{')) {
    try {
      message = JSON.parse(message).error?.message ?? message;
    } catch {}
  }
  return { status, message };
}

export function quickEntryProblem(error) {
  const { status, message } = aiErrorDetail(error);
  const byHand = 'Record this on the customer’s page for now.';
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) {
    return `Quick entry is not working because the AI key was rejected. ${byHand}`;
  }
  if (status === 400 && /credit balance/i.test(message)) {
    return `Quick entry is paused because the AI account has run out of credit. ${byHand}`;
  }
  if (status === 404) {
    return `Quick entry is not working because the AI model is no longer available. ${byHand}`;
  }
  if (status === 429) {
    return 'Quick entry has reached its limit for now. Try again later, or record this on the customer’s page.';
  }
  if (status === 529 || status === 503 || /overloaded/i.test(message)) {
    return 'The AI service is busy right now. Try again in a moment, or record this on the customer’s page.';
  }
  return 'Could not read that just now. Try again, or record it on the customer’s page.';
}

export function rankFlashModels(names) {
  const version = (name) => Number(/^gemini-(\d+(?:\.\d+)?)-flash/.exec(name)?.[1] ?? 0);
  const general = (name) => /^gemini-\d+(?:\.\d+)?-flash(-lite)?$/.test(name);
  return names
    .filter(general)
    .sort((a, b) => Number(a.endsWith('-lite')) - Number(b.endsWith('-lite')) || version(b) - version(a));
}
