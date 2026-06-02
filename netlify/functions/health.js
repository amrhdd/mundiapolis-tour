require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const { buildChatProviders, buildSTTProviders, buildTTSProviders } = require('../../providers');

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'ok',
      providers: {
        chat: buildChatProviders('test').map(p => p.name),
        stt: buildSTTProviders().map(p => p.name),
        tts: buildTTSProviders().map(p => p.name),
      },
      timestamp: new Date().toISOString(),
    }),
  };
};
