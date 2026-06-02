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
    });

    await head.showAvatar({
      url: AVATAR_URL,
      body: 'M',
      avatarMood: 'neutral',
      lipsyncLang: 'fr',
    });

    window._talkingHead = head;
    console.log('Header avatar ready');

  } catch(e) {
    console.error('Header avatar failed:', e);
    container.innerHTML = '<div class="avatar-pulse"></div><span>A</span>';
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

initHeaderAvatar();
