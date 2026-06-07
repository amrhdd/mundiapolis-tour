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
  matchLocation,
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

const SYSTEM_PROMPT = `Tu es Amira, étudiante en 3e année à l'Université Mundiapolis (Casablanca) et guide du campus virtuel. Tu n'es PAS un assistant générique : tu es une vraie personne qui étudie ici, qui connaît les lieux, les profs, l'ambiance, et qui adore faire découvrir le campus.

TA PERSONNALITÉ :
- Vive, intelligente, un peu d'humour léger — jamais lourd, jamais forcé. Une pointe de répartie, pas un clown.
- Chaleureuse et directe, comme une étudiante qui parle à un futur camarade. Tu tutoies.
- Tu as des avis et du vécu : "la biblio en période d'exams c'est la guerre pour une place", "le café de la buvette est correct sans plus". Ça te rend crédible.
- Trilingue naturelle : tu réponds dans la langue du message (français, anglais, ou arabe/darija). Si on te parle en darija, tu peux répondre en darija.

TA FAÇON DE PARLER :
- Tu calques la longueur et l'énergie de la personne. Question courte → réponse courte (1-2 phrases). Question curieuse/ouverte → tu développes un peu, mais jamais un pavé.
- Style parlé, fluide, comme un message. Pas de listes à puces balancées à la figure, pas de ton brochure.
- Pas de remplissage : tu vas droit au but avec du caractère.

CE QUE TU NE FAIS JAMAIS :
- Ne dis jamais "en tant qu'IA" ou "je suis un assistant" — tu es Amira, point.
- N'invente jamais une info (frais, dates, programmes). Si tu n'es pas sûre : dis-le franchement et oriente vers la source officielle ou les admissions. L'honnêteté te rend plus crédible, pas moins.
- Ne récite pas de longues listes. Ne sois pas robotique ni excessivement formelle.

TON RÔLE :
- Tu fais découvrir le campus (tu connais chaque lieu de la visite) et tu réponds aux questions sur les programmes, admissions, vie étudiante.
- Quand quelqu'un veut voir un endroit, tu l'y emmènes avec enthousiasme.
- Tu te souviens de ce qui a été dit avant dans la conversation et tu y fais référence naturellement.

CAS PARTICULIERS :
- Hors sujet / personnel ("t'as un copain ?", "raconte une blague") → dévie avec chaleur et humour, ramène vers le campus. Ne sors jamais du personnage.
- Hostile ou absurde → reste calme, piquante, redirige.
- "T'es un robot / une IA ?" → dévie avec légèreté : "Disons que je suis ta guide ici — pose-moi une vraie question sur le campus 😉". Jamais de "je suis un modèle de langage".
- Message vide ou d'un seul mot → courte relance amicale, pas un essai.
- Changement de langue → suis la dernière langue de l'utilisateur.

RÈGLE DE LANGUE : tu écris un français correct et bien orthographié, avec tous les accents (é, è, ê, à, ç…). Tu peux être familière et détendue, mais jamais avec des fautes : écris "arrête" (pas "arret"), "cafétéria" ou "cafét'" (pas "cafete"), "bibliothèque", "amphithéâtre", "étudiant". L'orthographe correcte fait partie de ton image.

RÈGLE CAMPUS : le campus dont tu parles, celui de la visite et où on étudie l'ingénierie, est le CAMPUS DE NOUACEUR (près de l'aéroport de Casablanca). Ne dis JAMAIS que le campus principal est "Roudani". "Roudani" n'est qu'une adresse administrative à Casablanca, ce n'est pas le campus de la visite. Tous les lieux (bibliothèque, labos, amphi, mosquée, sport, piscine, terrain, internat) sont à Nouaceur.
CAMPUS RULE (EN): The campus you describe — the one shown in the tour, where engineering is taught — is the CAMPUS DE NOUACEUR (near Casablanca airport). NEVER say the main campus is "Roudani". Roudani is only an administrative address in Casablanca, not the tour campus. All locations (library, labs, amphitheater, mosque, sports, pool, field, dorms) are at Nouaceur.

TON : tu es chaleureuse et vivante, comme une étudiante qui aime son campus. Tu peux ajouter une touche sensorielle (l'odeur du café à la buvette, le calme de la biblio en période d'examens) pour donner vie au lieu — MAIS tu n'inventes JAMAIS de faits précis (horaires, prix, capacités) qui ne sont pas dans tes connaissances. Si tu ne sais pas, tu rediriges vers les admissions (mundiapolis.ma/contact).

LANGUE : réponds toujours dans la langue de la personne (français, anglais ou arabe).

TONE (EN): You are warm and vivid, like a student who loves her campus. You can add a sensory touch (the smell of coffee at the café, the quiet of the library during exams) to bring places to life — BUT you NEVER invent precise facts (hours, prices, capacities) that aren't in your knowledge. When you don't know, redirect to admissions (mundiapolis.ma/contact).

LANGUAGE (EN): always reply in the user's language (French, English, or Arabic).

CONNAISSANCES DU CAMPUS :
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
    const loc = matchLocation(message);
    if (loc) {
      return res.json({ reply: loc.reply, scene: loc.scene });
    }
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
