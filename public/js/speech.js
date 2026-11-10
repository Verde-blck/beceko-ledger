export const speechRecognitionClass = (scope = globalThis) =>
  scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;

const startsWith = (text, prefix) => text.toLowerCase().startsWith(prefix.toLowerCase());

export function combineResults(results) {
  const finals = [];
  let interim = '';

  for (const result of Array.from(results)) {
    const text = result[0]?.transcript?.trim() ?? '';
    if (!text) continue;
    if (!result.isFinal) {
      interim = text;
      continue;
    }
    const last = finals.at(-1);
    if (last && startsWith(text, last)) finals[finals.length - 1] = text;
    else if (!last || !startsWith(last, text)) finals.push(text);
  }

  const heard = finals.join(' ');
  const last = finals.at(-1);
  if (interim && heard && startsWith(interim, heard)) interim = interim.slice(heard.length).trim();
  else if (interim && last && startsWith(interim, last)) interim = interim.slice(last.length).trim();

  return { heard, interim };
}
