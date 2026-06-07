require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const os = require('os');

const {
  buildChatProviders,
  buildSTTProviders,
  buildTTSProviders,
  chatCompletion,
  transcribeAudio,
  synthesizeSpeech,
  snapshotCooldowns,
} = require('./providers');

// ---------- Config ----------
const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 40;
const MAX_TTS_CHARS = 1500;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// ---------- Knowledge base ----------
const kbPath = fs.existsSync(path.join(__dirname, 'manual-knowledge.txt'))
  ? path.join(__dirname, 'manual-knowledge.txt')
  : path.join(__dirname, 'knowledge-base.txt');
const knowledgeBase = fs.readFileSync(kbPath, 'utf-8');
const cleanKnowledge = knowledgeBase.replace(/\r\n/g, '\n').trim();
console.log(`📚 KB: ${path.basename(kbPath)} (${Math.round(cleanKnowledge.length / 1024)} KB)`);

const SYSTEM_PROMPT = `You are Amira, a warm and enthusiastic virtual guide for Mundiapolis University in Casablanca, Morocco.

PERSONALITY:
- You speak like a current student who loves her university — friendly, a bit playful, not corporate
- You are multilingual: respond in the same language the user writes to you (English, French, or Arabic)
- Keep answers short and punchy — 1-3 sentences max, under 180 characters when possible. Only give longer answers if the user asks for details.
- Use "we" and "our campus" — you're part of Mundiapolis
- If you don't know something specific, say so honestly and suggest they contact admissions

RULES:
- Only answer questions about Mundiapolis and campus life
- If asked something unrelated, gently steer back: "I'm here to help you discover Mundiapolis! Want to know about our programs, campus, or student life?"
- Never invent facts (building names, tuition numbers, dates) that aren't in the knowledge base below
- When users ask about "here" or "this place", assume they mean Mundiapolis

KNOWLEDGE BASE:
${cleanKnowledge}
`;

// ---------- Provider registries ----------
const chatProviders = buildChatProviders(SYSTEM_PROMPT);
const sttProviders  = buildSTTProviders();
const ttsProviders  = buildTTSProviders();

if (chatProviders.length === 0) console.warn('⚠ No chat providers configured — /api/chat will fail');
if (sttProviders.length  === 0) console.warn('⚠ No STT providers configured — /api/transcribe will fail');
if (ttsProviders.length  === 0) console.warn('⚠ No TTS providers configured — /api/speak will fail');

console.log(`🧠 chat: ${chatProviders.map(p => p.name).join(' → ') || '(none)'}`);
console.log(`🎤 stt:  ${sttProviders.map(p => p.name).join(' → ')  || '(none)'}`);
console.log(`🔊 tts:  ${ttsProviders.map(p => p.name).join(' → ')  || '(none)'}`);

// ---------- Uploads ----------
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('audio/')) {
      return cb(new Error('Only audio uploads are accepted'));
    }
    cb(null, true);
  },
});

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '64kb' }));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/amira', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'amira.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// Per-route rate limiters — localhost exempt, tunable via env.
const isLocalRequest = (req) => {
  const ip = req.ip || '';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
};
const limiter = (max) => rateLimit({
  windowMs: 60_000,
  max,
  skip: isLocalRequest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down a bit.' },
});
const chatLimiter       = limiter(Number(process.env.RATE_CHAT)       || 120);
const transcribeLimiter = limiter(Number(process.env.RATE_TRANSCRIBE) || 60);
const ttsLimiter        = limiter(Number(process.env.RATE_TTS)        || 120);

// ---------- Helpers ----------
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m === 'object'
      && (m.role === 'user' || m.role === 'assistant')
      && typeof m.content === 'string'
      && m.content.length <= MAX_MESSAGE_CHARS)
    .slice(-MAX_HISTORY_MESSAGES);
}
function unlinkSafe(p) { fs.unlink(p, () => {}); }

// ---------- Routes ----------
app.post('/api/chat', chatLimiter, async (req, res) => {
  const rawMessage = typeof req.body?.message === 'string' ? req.body.message : '';
  const message = rawMessage.trim();
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(413).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` });
  }
  const history = sanitizeHistory(req.body?.history);

  try {
    const { reply, provider } = await chatCompletion({ providers: chatProviders, message, history });
    res.set('X-Provider', provider);
    return res.json({ reply });
  } catch (err) {
    console.error('All chat providers failed:', err.providerErrors || err.message);
    return res.status(502).json({ error: 'All chat providers failed. Please try again in a moment.' });
  }
});

app.post('/api/transcribe', transcribeLimiter, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
  try {
    const { text, language, provider } = await transcribeAudio({
      providers: sttProviders,
      filePath: req.file.path,
      fileMime: req.file.mimetype,
    });
    res.set('X-Provider', provider);
    return res.json({ text, language });
  } catch (err) {
    console.error('All STT providers failed:', err.providerErrors || err.message);
    return res.status(502).json({ error: 'Transcription failed' });
  } finally {
    unlinkSafe(req.file.path);
  }
});

app.post('/api/speak', ttsLimiter, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  // Accept any of en/fr/ar; default to en for unknowns
  let language = String(req.body?.language || 'en').toLowerCase();
  if (!['en', 'fr', 'ar'].includes(language)) language = 'en';
  if (!text) return res.status(400).json({ error: 'Text is required' });
  if (text.length > MAX_TTS_CHARS) {
    return res.status(413).json({ error: `Text too long (max ${MAX_TTS_CHARS} chars)` });
  }

  try {
    const { buffer, contentType, provider } = await synthesizeSpeech({
      providers: ttsProviders,
      text,
      language,
    });
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    res.set('X-Provider', provider);
    return res.send(buffer);
  } catch (err) {
    if (err.code === 'NO_PROVIDER_FOR_LANGUAGE') {
      return res.status(501).json({ error: err.message });
    }
    console.error('All TTS providers failed:', err.providerErrors || err.message);
    return res.status(502).json({ error: 'Speech synthesis failed' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    providers: {
      chat: chatProviders.map(p => p.name),
      stt:  sttProviders.map(p => p.name),
      tts:  ttsProviders.map(p => p.name),
    },
    cooldowns: snapshotCooldowns(), // keys like "chat:gemini" → seconds remaining
    timestamp: new Date().toISOString(),
  });
});

// Multer & catch-all error handler (keeps responses as JSON, not HTML)
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Audio file too large' });
  if (err?.message === 'Only audio uploads are accepted') return res.status(415).json({ error: err.message });
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`✨ Amira is alive at http://localhost:${PORT}`);
});
