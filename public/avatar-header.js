import { TalkingHead } from './talkinghead/modules/talkinghead.mjs';

const AVATAR_URL = '/talkinghead/avatars/avaturn.glb';

let head;

async function initHeaderAvatar() {
  const container = document.getElementById('avatar-header-mount');
  if (!container) return;

  try {
    head = new TalkingHead(container, {
      ttsEndpoint: null,
      cameraView: 'head',
      avatarMood: 'neutral',
      cameraDistance: 0.4,
      cameraPanY: 0.1,
      modelPixelRatio: 1,
      lightAmbientIntensity: 2,
    });

    await head.showAvatar({
      url: AVATAR_URL,
      body: 'M',
      avatarMood: 'neutral',
      lipsyncLang: 'fr',
    });

    // Static photo served its purpose — let the 3D canvas show
    container.style.background = 'transparent';
    window._talkingHead = head;
    console.log('Header avatar ready');

  } catch(e) {
    console.error('Header avatar failed:', e);
    // Static photo stays visible as fallback — no action needed
  }
}

export async function speakWithHead(audioUrl, lang = 'fr') {
  if (!head) return;
  try {
    const buf = await (await fetch(audioUrl)).arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf);
    await head.speakAudio(
      { audio: decoded, words: [], wtimes: [], wdurations: [] },
      { lipsyncLang: lang }
    );
  } catch(e) {
    console.warn('speakAudio failed:', e);
  }
}

// Lazy init: start 3D only when user first focuses the input
// Static photo shows until then — no render cost on page load
let started = false;
function startAvatarOnce() {
  if (started) return;
  started = true;
  initHeaderAvatar();
}

const input = document.getElementById('user-input');
if (input) {
  input.addEventListener('focus', startAvatarOnce, { once: true });
} else {
  // Fallback: init after a short delay if input not found
  setTimeout(initHeaderAvatar, 1000);
}
