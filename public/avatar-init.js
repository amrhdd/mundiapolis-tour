import { initAvatar, avatarSpeak, avatarGreet } from './avatar.js';

const panel = document.getElementById('av-panel');
const toggle = document.getElementById('av-toggle');
const input = document.getElementById('av-input');
const send = document.getElementById('av-send');
const msgs = document.getElementById('av-msgs');
const dot = document.getElementById('av-dot');
const canvas = document.getElementById('av-canvas');

let open = false, initialized = false, history = [];

toggle.addEventListener('click', async () => {
  open = !open;
  panel.classList.toggle('open', open);
  if (open && !initialized) {
    initialized = true;
    await initAvatar(canvas);
    avatarGreet();
  }
});

async function sendMsg(text) {
  text = text.trim();
  if (!text) return;
  addMsg(text, 'u');
  input.value = '';
  send.disabled = true;
  dot.style.display = 'flex';
  try {
    const lang = /[؀-ۿ]/.test(text) ? 'ar' : /\b(le|la|je|tu|bonjour)\b/i.test(text) ? 'fr' : 'en';
    const { reply } = await (await fetch('/api/chat', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: text, history })
    })).json();
    const blob = await (await fetch('/api/speak', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ text: reply, language: lang })
    })).blob();
    const url = URL.createObjectURL(blob);
    addMsg(reply, 'b');
    await avatarSpeak(reply, url, lang);
    URL.revokeObjectURL(url);
    history.push({ role:'user', content:text }, { role:'assistant', content:reply });
    if (history.length > 20) history = history.slice(-20);
  } catch(e) { addMsg("Something went wrong, try again.", 'b'); }
  finally { send.disabled = false; dot.style.display = 'none'; }
}

send.addEventListener('click', () => sendMsg(input.value));
input.addEventListener('keypress', e => e.key === 'Enter' && sendMsg(input.value));

function addMsg(text, who) {
  const d = document.createElement('div');
  d.className = 'avm ' + who;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}
