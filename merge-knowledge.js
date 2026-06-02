const fs = require('fs');

// Read all sources
const scraped = fs.existsSync('knowledge-base.txt')
  ? fs.readFileSync('knowledge-base.txt', 'utf-8') : '';

const manual = fs.existsSync('manual-knowledge.txt')
  ? fs.readFileSync('manual-knowledge.txt', 'utf-8') : '';

// Merge — manual facts first (most reliable), scraped second
const merged = `
================================================================
MUNDIAPOLIS UNIVERSITY — COMPLETE KNOWLEDGE BASE
Sources: Official website + verified external sources + manual research
================================================================

${manual}

================================================================
ADDITIONAL CONTENT FROM WEBSITE SCRAPE
================================================================

${scraped}
`.trim();

fs.writeFileSync('knowledge-base.txt', merged, 'utf-8');
const kb = Math.round(fs.statSync('knowledge-base.txt').size / 1024);
console.log(`✅ Merged knowledge base: ${kb} KB`);
console.log('Restart server — Amira now has verified + scraped knowledge!');