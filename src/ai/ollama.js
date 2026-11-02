'use strict';
// Phase 6: Local AI (Ollama) client wrapper.
// AI output is advisory and labeled with uncertainty. It is never the sole verification and can never change a status by itself.
// The zero-payment setting is not reachable by any AI tool.

const DEFAULT_MODEL = 'phi3:mini';
const MAX_INPUT_CHARS = 4000;
const OLLAMA_BASE = 'http://localhost:11434';

// Strip markup and cap length for untrusted input (prompt-injection defense).
function fenceInput(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/<[^>]*>/g, ' ');          // strip HTML/XML tags
  t = t.replace(/```[\s\S]*?```/g, ' [code block] ');   // fence code fences
  t = t.replace(/`[^`]*`/g, ' [inline code] ');       // fence inline code
  t = t.replace(/#{1,6}\s/g, ' ');                    // strip heading markers
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, MAX_INPUT_CHARS);
}

function fenceOutput(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, ' ').replace(/```[\s\S]*?```/g, ' [code block] ');
}

async function ollamaChat({ baseUrl = OLLAMA_BASE, model = DEFAULT_MODEL, messages, temperature = 0.2, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, options: { temperature } })
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const j = await res.json();
  const content = j && j.message ? j.message.content : '';
  return { content: fenceOutput(content), model, done: j.done !== false };
}

async function ollamaListModels({ baseUrl = OLLAMA_BASE, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ollama tags http ${res.status}`);
  const j = await res.json();
  return (j && j.models || []).map(m => ({ name: m.name, size: m.size, modified: m.modified_at }));
}

module.exports = { ollamaChat, ollamaListModels, fenceInput, fenceOutput, DEFAULT_MODEL, MAX_INPUT_CHARS, OLLAMA_BASE };
