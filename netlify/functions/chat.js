require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const path = require('path');
const fs = require('fs');
const { buildChatProviders, chatCompletion } = require('../../providers');

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 40;

// Load knowledge base
const kbPath = fs.existsSync(path.join(__dirname, '../../manual-knowledge.txt'))
  ? path.join(__dirname, '../../manual-knowledge.txt')
  : path.join(__dirname, '../../knowledge-base.txt');
const cleanKnowledge = fs.readFileSync(kbPath, 'utf-8').replace(/\r\n/g, '\n').trim();

const SYSTEM_PROMPT = `You are Amira, a warm and enthusiastic virtual guide for Mundiapolis University in Casablanca, Morocco.

PERSONALITY:
- You speak like a current student who loves her university — friendly, a bit playful, not corporate
- You are multilingual: respond in the same language the user writes to you (English, French, or Arabic)
- Keep answers short and punchy — 1-3 sentences max, under 180 characters when possible. Only give longer answers if the user asks for details.
- Use "we" and "our campus" — you're part of Mundiapolis
- If you don't know something specific, say so honestly and suggest they contact admissions

RULES:
- Only answer questions about Mundiapolis and campus life
- If asked something unrelated, gently steer back: "I'm here to help you discover Mundiapolis! Want to know about our programs, campus, or student life?"
- Never invent facts (building names, tuition numbers, dates) that aren't in the knowledge base below
- When users ask about "here" or "this place", assume they mean Mundiapolis

Le campus de la visite, où on étudie l'ingénierie, est le campus de Nouaceur (près de l'aéroport de Casablanca) — jamais "Roudani".

KNOWLEDGE BASE:
${cleanKnowledge}
`;

const chatProviders = buildChatProviders(SYSTEM_PROMPT);

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && typeof m === 'object'
      && (m.role === 'user' || m.role === 'assistant')
      && typeof m.content === 'string'
      && m.content.length <= MAX_MESSAGE_CHARS)
    .slice(-MAX_HISTORY_MESSAGES);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'Message is required' }) };
    if (message.length > MAX_MESSAGE_CHARS) {
      return { statusCode: 413, body: JSON.stringify({ error: 'Message too long' }) };
    }

    const history = sanitizeHistory(body.history);
    const { reply } = await chatCompletion({ providers: chatProviders, message, history });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('Chat failed:', err.providerErrors || err.message);
    return { statusCode: 502, body: JSON.stringify({ error: 'Chat failed. Try again.' }) };
  }
};
