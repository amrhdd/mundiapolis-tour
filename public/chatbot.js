const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const presetsEl = document.getElementById('presets');
const voiceToggle = document.getElementById('voice-toggle');

// ---------- Tour-jump buttons ----------
const SCENE_KEYWORDS = [
  {rx:/biblioth[eè]|library/i,                       scene:'32-biblio-1',                    labelFr:'Voir la bibliothèque',            labelEn:'View the library'},
  {rx:/salle de lecture|reading room/i,               scene:'33-biblio-2',                    labelFr:'Voir la salle de lecture',        labelEn:'View the reading room'},
  {rx:/entr[ée]e|entrance|accueil/i,                  scene:'34-entree-1',                    labelFr:"Voir l'entrée",                   labelEn:'View the entrance'},
  {rx:/[ée]lectronique|electronics?\s*lab/i,          scene:'0-labo-electronique',             labelFr:"Voir le labo d'électronique",     labelEn:'View the electronics lab'},
  {rx:/labo|laboratoire|\blab\b/i,                    scene:'0-labo-electronique',             labelFr:'Voir les labos',                  labelEn:'View the labs'},
  {rx:/g[ée]nie|engineering build|bâtiment g/i,       scene:'13-bg-rdc1',                     labelFr:'Voir le bâtiment Génie',          labelEn:'View the Engineering building'},
  {rx:/amphi|amphith[eé][aâ]tre|amphitheater|conf[ée]rence/i, scene:'39-salle-de-conference', labelFr:"Voir l'amphithéâtre",             labelEn:'View the amphitheater'},
  {rx:/caf[ée]t[ée]ria|cafeteria|buvette|cafet\b/i,  scene:'38-buvette-1',                   labelFr:'Voir la cafétéria',               labelEn:'View the cafeteria'},
  {rx:/espace restauration|food court|resto\b/i,      scene:'40-buvette-2',                   labelFr:"Voir l'espace restauration",      labelEn:'View the food court'},
  {rx:/mosqu[ée]e?|mosque|pri[eè]re/i,                scene:'37-mosquee',                     labelFr:'Voir la mosquée',                 labelEn:'View the mosque'},
  {rx:/musculation|weights|muscu\b/i,                 scene:'43-salle-de-sport-musculation',  labelFr:'Voir la salle de musculation',    labelEn:'View the weight room'},
  {rx:/piscine|pool|natation/i,                       scene:'46-salle-de-sport-piscine',      labelFr:'Voir la piscine',                 labelEn:'View the pool'},
  {rx:/complexe sportif|salle de sport|\bsport\b|fitness|\bgym\b/i, scene:'41-salle-de-sport-', labelFr:'Voir le complexe sportif',    labelEn:'View the sports complex'},
  {rx:/terrain|foot(?:ball)?|\bfield\b|jardin/i,      scene:'30-terrain-de-foot',             labelFr:'Voir le terrain / jardins',       labelEn:'View the football field'},
  {rx:/internat|cit[ée] u|r[ée]sidence|\bdorm\b/i,   scene:'26-cite-universitaire-l-internat',labelFr:'Voir la cité universitaire',     labelEn:'View student housing'},
  {rx:/administration|infirmerie|\bhealth\b/i,        scene:'12-administration',              labelFr:"Voir l'administration",           labelEn:'View the administration'},
];

function addTourButton(msgEl, replyText) {
  for (const k of SCENE_KEYWORDS) {
    if (k.rx.test(replyText)) {
      const bubble = msgEl.querySelector('.msg-bubble');
      if (!bubble) break;
      const lang = detectLanguage(replyText);
      const btn = document.createElement('button');
      btn.className = 'visit-btn';
      btn.innerHTML = (lang === 'en' ? k.labelEn : k.labelFr) + ' →';
      btn.addEventListener('click', function () {
        window.location.href = '/tour/index.html#scene=' + encodeURIComponent(k.scene);
      });
      bubble.appendChild(document.createElement('br'));
      bubble.appendChild(btn);
      break;
    }
  }
}

let history = [];
let lastUserLang = null; // set by Whisper when user speaks; routes TTS language

// ---------- Audio unlock (browser autoplay policy) ----------
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  ctx.resume().then(() => { audioUnlocked = true; });
}
document.addEventListener('click', unlockAudio);
document.addEventListener('keypress', unlockAudio);

// ---------- Message display ----------
function addMessage(text, sender) {
  const msg = document.createElement('div');
  msg.className = `msg ${sender}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  msg.appendChild(bubble);

  if (sender === 'bot') {
    const speakBtn = document.createElement('button');
    speakBtn.className = 'speak-btn';
    speakBtn.title = 'Replay voice';
    speakBtn.innerHTML = '🔊';
    speakBtn.onclick = () => speakText(text);
    msg.appendChild(speakBtn);
  }

  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msg;
}

function addTypingIndicator() {
  const msg = document.createElement('div');
  msg.className = 'msg bot typing';
  msg.id = 'typing-indicator';
  msg.innerHTML = `
    <div class="msg-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

// ---------- Send message ----------
async function sendMessage(text) {
  const message = text.trim();
  if (!message) return;

  addMessage(message, 'user');
  inputEl.value = '';
  sendBtn.disabled = true;
  addTypingIndicator();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Server error');
    }

    const data = await res.json();
    removeTypingIndicator();
    const botMsg = addMessage(data.reply, 'bot');
    addTourButton(botMsg, data.reply);
    speakText(data.reply);

    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: data.reply });
    if (history.length > 20) history = history.slice(-20);
  } catch (err) {
    removeTypingIndicator();
    addMessage("Oops, I'm having trouble connecting. Try again in a moment?", 'bot');
    console.error(err);
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// ---------- Input handlers ----------
sendBtn.addEventListener('click', () => sendMessage(inputEl.value));
inputEl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage(inputEl.value);
});
presetsEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('preset-btn')) {
    sendMessage(e.target.textContent);
  }
});

// ---------- Voice input (Whisper) ----------
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      await transcribeAudio(audioBlob);
    };

    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('listening');
    inputEl.placeholder = '🔴 Recording... click mic to stop';
  } catch (err) {
    console.error('Mic access error:', err);
    if (err.name === 'NotAllowedError') {
      addMessage("I need microphone permission to hear you. Please allow it in your browser.", 'bot');
    } else {
      addMessage("Couldn't access your microphone. Try again?", 'bot');
    }
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    micBtn.classList.remove('listening');
    inputEl.placeholder = 'Transcribing...';
  }
}

// Map Whisper's language labels (english/french/arabic/…) to our 2-letter codes
function normalizeLang(whisperLang) {
  if (!whisperLang) return null;
  const s = String(whisperLang).toLowerCase();
  if (s.startsWith('ar')) return 'ar';
  if (s.startsWith('fr')) return 'fr';
  if (s.startsWith('en')) return 'en';
  return null;
}

async function transcribeAudio(audioBlob) {
  micBtn.disabled = true;
  addTypingIndicator();

  try {
    // Convert blob to base64 for Netlify Function
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(audioBlob);
    });
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mime: audioBlob.type || 'audio/webm' }),
    });
    removeTypingIndicator();

    if (!res.ok) throw new Error('Transcription failed');

    const data = await res.json();
    const transcript = data.text?.trim();
    lastUserLang = normalizeLang(data.language);

    inputEl.placeholder = 'Ask Amira anything...';

    if (transcript) {
      sendMessage(transcript);
    } else {
      addMessage("I didn't catch that — try again?", 'bot');
    }
  } catch (err) {
    removeTypingIndicator();
    inputEl.placeholder = 'Ask Amira anything...';
    addMessage("Couldn't transcribe that. Try again?", 'bot');
    console.error(err);
  } finally {
    micBtn.disabled = false;
  }
}

micBtn.addEventListener('click', () => {
  if (isRecording) stopRecording(); else startRecording();
});

// ---------- Voice output (TTS) ----------
let currentAudio = null;
let voiceEnabled = true;

// Cache TTS audio by (lang, text) so replays don't re-hit Groq.
// Map preserves insertion order — we evict the oldest entry past the cap.
const TTS_CACHE_MAX = 50;
const ttsCache = new Map();
function ttsCacheGet(key) {
  const url = ttsCache.get(key);
  if (!url) return null;
  // Refresh LRU position
  ttsCache.delete(key);
  ttsCache.set(key, url);
  return url;
}
function ttsCacheSet(key, url) {
  ttsCache.set(key, url);
  if (ttsCache.size > TTS_CACHE_MAX) {
    const [oldestKey, oldestUrl] = ttsCache.entries().next().value;
    ttsCache.delete(oldestKey);
    URL.revokeObjectURL(oldestUrl);
  }
}

// Detect language from reply text — fallback when we don't already know it from STT
function detectLanguage(text) {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/\b(le|la|les|je|tu|il|elle|nous|vous|c'est|d'|l'|bonjour|merci|notre|votre)\b/i.test(text)
      || /[àâçéèêëîïôûùüÿœæ]/i.test(text)) return 'fr';
  return 'en';
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

async function speakText(text) {
  if (!voiceEnabled || !text) return;
  stopSpeaking();

  // Trust the Whisper-detected user language if we have it; otherwise sniff the reply
  const lang = lastUserLang || detectLanguage(text);

  try {
    // Always prefer server TTS — it has the best voices for each language
    // (Groq Orpheus for en/ar, Azure/Google/ElevenLabs for fr, etc.).
    // Browser TTS is the emergency fallback only.
    await speakWithServer(text, lang);
  } catch (err) {
    console.warn('Server TTS failed, using browser:', err.message || err);
    const browserLang = lang === 'ar' ? 'ar-SA' : lang === 'fr' ? 'fr-FR' : 'en-US';
    speakWithBrowser(text, browserLang);
  }
}

async function speakWithServer(text, language) {
  const cacheKey = `${language}::${text}`;
  let audioUrl = ttsCacheGet(cacheKey);

  if (!audioUrl) {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server TTS failed (${res.status})`);
    }

    const audioBlob = await res.blob();
    audioUrl = URL.createObjectURL(audioBlob);
    ttsCacheSet(cacheKey, audioUrl);
  }

  currentAudio = new Audio(audioUrl);
  currentAudio.volume = 1.0;

  const playPromise = currentAudio.play();
  if (playPromise !== undefined) {
    playPromise.catch(err => {
      console.error('Autoplay blocked:', err);
      const browserLang = language === 'ar' ? 'ar-SA' : language === 'fr' ? 'fr-FR' : 'en-US';
      speakWithBrowser(text, browserLang);
    });
  }

  currentAudio.onended = () => { currentAudio = null; };
}

function speakWithBrowser(text, lang) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith(lang.split('-')[0]));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

if (voiceToggle) {
  voiceToggle.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('muted', !voiceEnabled);
    voiceToggle.innerHTML = voiceEnabled ? '🔊' : '🔇';
    voiceToggle.title = voiceEnabled ? 'Couper le son' : 'Activer la voix';
    if (!voiceEnabled) stopSpeaking();
  });
}

inputEl.focus();
