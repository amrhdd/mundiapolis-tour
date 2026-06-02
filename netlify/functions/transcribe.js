require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const { buildSTTProviders, transcribeAudio } = require('../../providers');
const os = require('os');
const fs = require('fs');
const path = require('path');

const sttProviders = buildSTTProviders();

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Audio comes base64-encoded in the body
    const body = JSON.parse(event.body || '{}');
    const audioBase64 = body.audio;
    const mime = body.mime || 'audio/webm';
    if (!audioBase64) return { statusCode: 400, body: JSON.stringify({ error: 'No audio provided' }) };

    const audioBuffer = Buffer.from(audioBase64, 'base64');

    // Write to temp file
    const tmpPath = path.join(os.tmpdir(), `rec-${Date.now()}.webm`);
    fs.writeFileSync(tmpPath, audioBuffer);

    try {
      const { text, language } = await transcribeAudio({
        providers: sttProviders,
        filePath: tmpPath,
        fileMime: mime,
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language }),
      };
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  } catch (err) {
    console.error('Transcription failed:', err.providerErrors || err.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Transcription failed' }) };
  }
};
