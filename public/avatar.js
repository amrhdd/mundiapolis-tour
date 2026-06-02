import { TalkingHead } from './talkinghead/modules/talkinghead.mjs';

const AVATAR_URL = '/talkinghead/avatars/avaturn.glb'
;

let head, ready = false;

export async function initAvatar(container) {
  try {
    head = new TalkingHead(container, { ttsEndpoint: null, cameraView: 'head', avatarMood: 'neutral' });
    await head.showAvatar({ url: AVATAR_URL, body: 'M', avatarMood: 'neutral' }, p => {
      const bar = document.getElementById('av-bar');
      if (bar) bar.style.width = Math.round(p * 100) + '%';
    });
    ready = true;
    container.style.opacity = '1';
    container.style.background = 'transparent';
    document.getElementById('av-loader')?.remove();
  } catch(e) {
    console.error('Avatar failed:', e);
    document.getElementById('av-loader')?.remove();
  }
}

export async function avatarSpeak(text, audioUrl, lang = 'fr') {
  if (!ready) return;
  try {
    const buf = await (await fetch(audioUrl)).arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf);
    await head.speakAudio({ audio: decoded, words: [], wtimes: [], wdurations: [] }, { lipsyncLang: lang });
  } catch(e) { console.warn('speakAudio failed:', e); }
}

export function avatarGreet() {
  if (!ready) return;
  head.setMood('happy');
  setTimeout(() => head.setMood('neutral'), 2500);
}
