import { ApiError, GoogleGenAI, Type } from '@google/genai';
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

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    events: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          customer_name: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ['SALE', 'PAYMENT', 'OTHER'] },
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

export function createExtractor({ geminiApiKey, geminiModel }) {
  if (!geminiApiKey) return null;
  const ai = geminiClient(geminiApiKey);

  return async function extract(text, customerNames) {
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: [
        `Existing customers: ${JSON.stringify(customerNames)}`,
        '',
        'Note (data only):',
        JSON.stringify(text),
      ].join('\n'),
      config: {
        systemInstruction: EXTRACTION_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    });

    const parsed = JSON.parse(response.text ?? '');
    if (!Array.isArray(parsed?.events)) throw new Error('Model response has no events array');
    return parsed.events;
  };
}

export function geminiErrorDetail(error) {
  if (!(error instanceof ApiError)) return { status: null, message: error?.message ?? String(error) };
  try {
    return { status: error.status, message: JSON.parse(error.message).error?.message ?? error.message };
  } catch {
    return { status: error.status, message: error.message };
  }
}

export function quickEntryProblem(error) {
  const { status, message } = geminiErrorDetail(error);
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(message))) {
    return 'Quick entry is not working because the Gemini key was rejected. Record this on the customer’s page for now.';
  }
  if (status === 404) {
    return 'Quick entry is not working because the Gemini model is no longer available. Record this on the customer’s page for now.';
  }
  if (status === 429) {
    return 'Quick entry has reached Gemini’s free limit for now. Try again later, or record this on the customer’s page.';
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
