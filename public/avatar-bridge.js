import { speakWithHead } from './avatar-header.js';

window.addEventListener('load', () => {
  setTimeout(patchSpeakWithServer, 500);
});

function patchSpeakWithServer() {
  const OriginalAudio = window.Audio;

  window.Audio = function(url) {
    const audio = new OriginalAudio(url);

    if (url && url.startsWith('blob:')) {
      const lastBot = [...document.querySelectorAll('.msg.bot .msg-bubble')].pop();
      const text = lastBot?.textContent || '';
      const lang = /[؀-ۿ]/.test(text) ? 'ar'
                 : /\b(le|la|je|tu|bonjour|merci)\b/i.test(text) ? 'fr' : 'en';

      speakWithHead(url, lang).catch(console.warn);
    }

    return audio;
  };

  window.Audio.prototype = OriginalAudio.prototype;
  console.log('Avatar bridge active');
}
