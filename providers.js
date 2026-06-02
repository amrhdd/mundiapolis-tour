// =============================================================================
// providers.js — AI provider registries with graceful fallback
// =============================================================================
// Each provider is self-enabling: if its env vars are set, it joins the chain.
// On error, we log the failure and fall through to the next provider.
// The first provider to succeed wins and its name is reported back to the caller.
//
// Required env vars per provider are listed in .env.example.
// =============================================================================

const fs = require('fs');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_TEMPERATURE = 0.7;

// ---------- Small helpers ----------
function truncate(s, n = 200) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

async function httpJSON(url, { method = 'POST', headers = {}, body, timeoutMs = 30_000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' || body instanceof Buffer || body instanceof FormData || body instanceof Blob
        ? body
        : JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${truncate(text)}`);
    }
    return res;
  } finally { clearTimeout(t); }
}

// ---------- Circuit breaker ----------
// Per-provider cooldown so we don't pound a provider that just told us to back off.
// Keyed by "<label>:<provider>" because a provider (e.g. groq) can appear in both
// chat and TTS chains with independent quotas.
const cooldowns = new Map();
const cooldownKey = (label, name) => `${label}:${name}`;

function remainingCooldownMs(label, name) {
  const until = cooldowns.get(cooldownKey(label, name)) || 0;
  const ms = until - Date.now();
  return ms > 0 ? ms : 0;
}
function setCooldown(label, name, seconds) {
  cooldowns.set(cooldownKey(label, name), Date.now() + seconds * 1000);
}
function clearCooldownFor(label, name) { cooldowns.delete(cooldownKey(label, name)); }

// Inspect an error and return a sensible cooldown in seconds.
// Tries to extract the provider-suggested retry-after; otherwise infers from status.
function parseCooldownSeconds(err) {
  const msg = String(err?.message || err || '');

  // "Please retry in 34.6s" / "retry in 34 seconds"
  let m = msg.match(/retry (?:in|after)\s+(\d+(?:\.\d+)?)\s*s(?:ec)?/i);
  if (m) return clampCooldown(Math.ceil(+m[1]));

  // Gemini-style "retryDelay": "34s" in the error body
  m = msg.match(/retryDelay["'\s:]+(\d+(?:\.\d+)?)s/i);
  if (m) return clampCooldown(Math.ceil(+m[1]));

  // Groq-style "Please try again in 1h38m23.712s"
  m = msg.match(/try again in (?:(\d+)h)?\s*(?:(\d+)m)?\s*(\d+(?:\.\d+)?)s/i);
  if (m) {
    const h = +m[1] || 0, mm = +m[2] || 0, ss = +m[3] || 0;
    return clampCooldown(h * 3600 + mm * 60 + Math.ceil(ss));
  }

  // Retry-After header often ends up in the text — e.g. "Retry-After: 42"
  m = msg.match(/retry-?after["'\s:]+(\d+)/i);
  if (m) return clampCooldown(+m[1]);

  // Fallback by kind
  if (/\b429\b|too many|rate[-\s]?limit|quota|exceeded/i.test(msg)) return 60;
  if (/\b(408|5\d\d)\b|ECONN|ETIMEDOUT|timeout|network/i.test(msg)) return 10;
  return 5; // unknown error — short breather so we don't spam
}
function clampCooldown(s) { return Math.min(3600, Math.max(5, s)); }

// Runs providers in order; skips any currently cooling down. First success returns.
async function tryChain(label, providers, fn) {
  const errors = [];
  const skipped = [];
  for (const p of providers) {
    const coolMs = remainingCooldownMs(label, p.name);
    if (coolMs > 0) {
      console.log(`[${label}] ⏭ ${p.name} (cooling down, retry in ${Math.ceil(coolMs / 1000)}s)`);
      skipped.push(p.name);
      continue;
    }
    try {
      const out = await fn(p);
      clearCooldownFor(label, p.name);
      console.log(`[${label}] ✓ ${p.name}`);
      return { ...out, provider: p.name };
    } catch (err) {
      const msg = truncate(err?.message || err, 180);
      const cd = parseCooldownSeconds(err);
      setCooldown(label, p.name, cd);
      console.warn(`[${label}] ✗ ${p.name} (cooling ${cd}s): ${msg}`);
      errors.push({ provider: p.name, error: msg });
    }
  }
  const err = new Error(
    errors.length === 0
      ? `All ${label} providers cooling down (${skipped.join(', ')})`
      : `All ${label} providers failed`
  );
  err.providerErrors = errors;
  err.skipped = skipped;
  throw err;
}

function snapshotCooldowns() {
  const out = {};
  for (const [key, until] of cooldowns) {
    const ms = until - Date.now();
    if (ms > 0) out[key] = Math.ceil(ms / 1000);
  }
  return out;
}

// =============================================================================
// CHAT — LLM providers
// =============================================================================

// Generic OpenAI-compatible chat completions (Groq, OpenRouter, Cerebras,
// Mistral, Together, SambaNova, GitHub Models, any clone)
async function openAICompatChat({ baseURL, apiKey, model, messages, extraHeaders = {} }) {
  const res = await httpJSON(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: { model, messages, max_tokens: DEFAULT_MAX_TOKENS, temperature: DEFAULT_TEMPERATURE },
  });
  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error(`Empty response: ${truncate(JSON.stringify(data))}`);
  return { reply };
}

function openAIStyleMessages(systemPrompt, history, message) {
  return [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];
}

function buildChatProviders(systemPrompt) {
  const providers = [];

  // --- 1. Google Gemini (native SDK) ---
  if (process.env.GEMINI_API_KEY) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
    });
    providers.push({
      name: 'gemini',
      call: async ({ message, history }) => {
        const geminiHistory = history.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        const chat = model.startChat({
          history: geminiHistory,
          generationConfig: { maxOutputTokens: DEFAULT_MAX_TOKENS, temperature: DEFAULT_TEMPERATURE },
        });
        const result = await chat.sendMessage(message);
        return { reply: result.response.text() };
      },
    });
  }

  // --- 2. Groq (native SDK, llama-3.3-70b) ---
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    providers.push({
      name: 'groq',
      call: async ({ message, history }) => {
        const completion = await groq.chat.completions.create({
          messages: openAIStyleMessages(systemPrompt, history, message),
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
          temperature: DEFAULT_TEMPERATURE,
          max_tokens: DEFAULT_MAX_TOKENS,
        });
        return { reply: completion.choices[0].message.content };
      },
    });
  }

  // --- 3. OpenRouter (aggregator — free models via OpenAI-compat) ---
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'openrouter',
      call: ({ message, history }) => openAICompatChat({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
        messages: openAIStyleMessages(systemPrompt, history, message),
        extraHeaders: {
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Amira Mundiapolis',
        },
      }),
    });
  }

  // --- 4. Cerebras (fast llama, OpenAI-compat) ---
  if (process.env.CEREBRAS_API_KEY) {
    providers.push({
      name: 'cerebras',
      call: ({ message, history }) => openAICompatChat({
        baseURL: 'https://api.cerebras.ai/v1',
        apiKey: process.env.CEREBRAS_API_KEY,
        model: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
        messages: openAIStyleMessages(systemPrompt, history, message),
      }),
    });
  }

  // --- 5. Mistral (native, strong on French — handy for a Casablanca bot) ---
  if (process.env.MISTRAL_API_KEY) {
    providers.push({
      name: 'mistral',
      call: ({ message, history }) => openAICompatChat({
        baseURL: 'https://api.mistral.ai/v1',
        apiKey: process.env.MISTRAL_API_KEY,
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        messages: openAIStyleMessages(systemPrompt, history, message),
      }),
    });
  }

  // --- 6. SambaNova (fast llama, OpenAI-compat) ---
  if (process.env.SAMBANOVA_API_KEY) {
    providers.push({
      name: 'sambanova',
      call: ({ message, history }) => openAICompatChat({
        baseURL: 'https://api.sambanova.ai/v1',
        apiKey: process.env.SAMBANOVA_API_KEY,
        model: process.env.SAMBANOVA_MODEL || 'Meta-Llama-3.3-70B-Instruct',
        messages: openAIStyleMessages(systemPrompt, history, message),
      }),
    });
  }

  // --- 7. GitHub Models (free dev tier, many models incl. GPT-4o-mini) ---
  if (process.env.GITHUB_MODELS_TOKEN) {
    providers.push({
      name: 'github-models',
      call: ({ message, history }) => openAICompatChat({
        baseURL: 'https://models.inference.ai.azure.com',
        apiKey: process.env.GITHUB_MODELS_TOKEN,
        model: process.env.GITHUB_MODELS_NAME || 'gpt-4o-mini',
        messages: openAIStyleMessages(systemPrompt, history, message),
      }),
    });
  }

  // --- 8. Cohere (native shape — v2 chat) ---
  if (process.env.COHERE_API_KEY) {
    providers.push({
      name: 'cohere',
      call: async ({ message, history }) => {
        const res = await httpJSON('https://api.cohere.com/v2/chat', {
          headers: { Authorization: `Bearer ${process.env.COHERE_API_KEY}` },
          body: {
            model: process.env.COHERE_MODEL || 'command-r-plus-08-2024',
            messages: openAIStyleMessages(systemPrompt, history, message),
            max_tokens: DEFAULT_MAX_TOKENS,
            temperature: DEFAULT_TEMPERATURE,
          },
        });
        const data = await res.json();
        // Cohere v2 returns { message: { content: [{ type:'text', text }] } }
        const parts = data?.message?.content || [];
        const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
        if (!text) throw new Error(`Empty response: ${truncate(JSON.stringify(data))}`);
        return { reply: text };
      },
    });
  }

  return providers;
}

async function chatCompletion({ providers, message, history }) {
  return tryChain('chat', providers, p => p.call({ message, history }));
}

// =============================================================================
// STT — Speech-to-Text
// =============================================================================

function buildSTTProviders() {
  const providers = [];

  // --- 1. Groq Whisper (fastest, returns detected language) ---
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    providers.push({
      name: 'groq-whisper',
      call: async ({ filePath }) => {
        const transcription = await groq.audio.transcriptions.create({
          file: fs.createReadStream(filePath),
          model: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
          response_format: 'verbose_json',
        });
        return { text: transcription.text || '', language: transcription.language || null };
      },
    });
  }

  // --- 2. Cloudflare Workers AI (Whisper) ---
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    providers.push({
      name: 'cloudflare-whisper',
      call: async ({ filePath }) => {
        const buffer = fs.readFileSync(filePath);
        const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/openai/whisper`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/octet-stream',
          },
          body: buffer,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${truncate(await res.text().catch(() => ''))}`);
        const data = await res.json();
        const text = data?.result?.text || '';
        if (!text) throw new Error('Empty transcript');
        // Cloudflare Whisper does not return detected language
        return { text, language: null };
      },
    });
  }

  return providers;
}

async function transcribeAudio({ providers, filePath, fileMime }) {
  return tryChain('stt', providers, p => p.call({ filePath, fileMime }));
}

// =============================================================================
// TTS — Text-to-Speech
// =============================================================================
// Each provider returns { buffer: Buffer, contentType: string } and declares
// which languages it supports via `supports(lang)`.

// Split text at sentence boundaries for providers with per-request char caps.
function splitText(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  const sentences = text.split(/(?<=[.!?؟。])\s+/);
  let current = '';
  for (const s of sentences) {
    if ((current + ' ' + s).trim().length <= maxLength) {
      current = (current + ' ' + s).trim();
    } else {
      if (current) chunks.push(current);
      if (s.length > maxLength) {
        for (let i = 0; i < s.length; i += maxLength) chunks.push(s.slice(i, i + maxLength));
        current = '';
      } else { current = s; }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Concatenate WAV buffers by rewriting the RIFF/data chunk headers.
function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE buffer');
  }
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const headerEnd = offset + 8;
      return { header: buf.slice(0, headerEnd), audio: buf.slice(headerEnd, headerEnd + size) };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('No data chunk found in WAV');
}
function mergeWavBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  const parsed = buffers.map(parseWav);
  const audio = Buffer.concat(parsed.map(p => p.audio));
  const header = Buffer.from(parsed[0].header);
  header.writeUInt32LE(audio.length, header.length - 4);
  header.writeUInt32LE(header.length + audio.length - 8, 4);
  return Buffer.concat([header, audio]);
}

function buildTTSProviders() {
  const providers = [];

  // --- 1. Groq Orpheus (English + Arabic, 200-char limit per chunk → we chunk) ---
  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    providers.push({
      name: 'groq-orpheus',
      supports: (lang) => lang === 'en' || lang === 'ar',
      call: async ({ text, language }) => {
        const { model, voice } = language === 'ar'
          ? { model: 'canopylabs/orpheus-arabic-saudi', voice: process.env.GROQ_TTS_VOICE_AR || 'aisha' }
          : { model: 'canopylabs/orpheus-v1-english',  voice: process.env.GROQ_TTS_VOICE_EN || 'hannah' };
        const chunks = splitText(text, 180);
        const bufs = [];
        for (const chunk of chunks) {
          const response = await groq.audio.speech.create({ model, voice, input: chunk, response_format: 'wav' });
          bufs.push(Buffer.from(await response.arrayBuffer()));
        }
        return { buffer: mergeWavBuffers(bufs), contentType: 'audio/wav' };
      },
    });
  }

  // --- 2. ElevenLabs (high quality, multilingual via eleven_multilingual_v2) ---
  if (process.env.ELEVENLABS_API_KEY) {
    providers.push({
      name: 'elevenlabs',
      supports: (lang) => ['en', 'fr', 'ar'].includes(lang),
      call: async ({ text, language }) => {
        // One voice works across languages with multilingual_v2 model
        const voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // Sarah (default)
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${truncate(await res.text().catch(() => ''))}`);
        return { buffer: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' };
      },
    });
  }

  // --- 3. Cartesia (fast neural; English + French via multilingual models) ---
  if (process.env.CARTESIA_API_KEY) {
    providers.push({
      name: 'cartesia',
      supports: (lang) => ['en', 'fr'].includes(lang),
      call: async ({ text, language }) => {
        const voiceId = language === 'fr'
          ? (process.env.CARTESIA_VOICE_FR || '65b25c5d-ff07-4687-a04c-da2f43ef6fa9')
          : (process.env.CARTESIA_VOICE_EN || '79a125e8-cd45-4c13-8a67-188112f4dd22');
        const res = await httpJSON('https://api.cartesia.ai/tts/bytes', {
          headers: {
            'X-API-Key': process.env.CARTESIA_API_KEY,
            'Cartesia-Version': '2024-06-10',
          },
          body: {
            model_id: process.env.CARTESIA_MODEL || 'sonic-2',
            transcript: text,
            voice: { mode: 'id', id: voiceId },
            output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
            language: language === 'fr' ? 'fr' : 'en',
          },
        });
        return { buffer: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' };
      },
    });
  }

  return providers;
}

async function synthesizeSpeech({ providers, text, language }) {
  const eligible = providers.filter(p => p.supports(language));
  if (eligible.length === 0) {
    const err = new Error(`No TTS provider supports language "${language}"`);
    err.code = 'NO_PROVIDER_FOR_LANGUAGE';
    throw err;
  }
  return tryChain('tts', eligible, p => p.call({ text, language }));
}

module.exports = {
  buildChatProviders,
  buildSTTProviders,
  buildTTSProviders,
  chatCompletion,
  transcribeAudio,
  synthesizeSpeech,
  snapshotCooldowns,
};
