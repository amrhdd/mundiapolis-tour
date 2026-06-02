require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const { buildTTSProviders, synthesizeSpeech } = require('../../providers');

const MAX_TTS_CHARS = 1500;
const ttsProviders = buildTTSProviders();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    let language = String(body.language || 'en').toLowerCase();
    if (!['en', 'fr', 'ar'].includes(language)) language = 'en';
    if (!text) return { statusCode: 400, body: JSON.stringify({ error: 'Text is required' }) };
    if (text.length > MAX_TTS_CHARS) {
      return { statusCode: 413, body: JSON.stringify({ error: 'Text too long' }) };
    }

    const { buffer, contentType } = await synthesizeSpeech({ providers: ttsProviders, text, language });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('TTS failed:', err.providerErrors || err.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Speech synthesis failed' }) };
  }
};
