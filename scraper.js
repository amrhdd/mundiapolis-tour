const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG
// ============================================================
const BASE_URL = 'https://www.mundiapolis.ma';
const MAX_PAGES = 60;
const DELAY_MS = 1000;
const OUTPUT_JSON = path.join(__dirname, 'mundiapolis-data.json');
const OUTPUT_KB = path.join(__dirname, 'knowledge-base.txt'); // auto-generated from JSON
// ============================================================
// EXTRA SOURCES — external pages with Mundiapolis info
// ============================================================
const EXTRA_URLS = [
  'https://smartstudent.africa/partner/mundiapolis/',
  'https://www.mba.ma/mundiapolis-journee-portes-ouvertes-11-avril-2026/',
  'https://www.mundiapolis.ma/mentions-legales',
  'https://www.mundiapolis.ma/structure-et-outils',
  'https://www.mundiapolis.ma/actualites',
  'https://www.mundiapolis.ma/evenements',
];
const SKIP_PATTERNS = [
  '/wp-admin', '/login', '/cart', '/checkout',
  '.pdf', '.jpg', '.png', '.zip', '#',
  'facebook.com', 'instagram.com', 'twitter.com',
  'linkedin.com', 'youtube.com', 'mailto:', 'tel:'
];

// ============================================================
// CATEGORIZER — auto-tags pages by URL/title keywords
// ============================================================
function categorize(url, title) {
  const text = (url + ' ' + title).toLowerCase();
  if (text.match(/program|formation|cursus|école|faculty|master|bachelor|ingénieur|licence/))
    return 'programs';
  if (text.match(/admission|inscription|candidature|apply|frais|tuition/))
    return 'admissions';
  if (text.match(/campus|facility|facilities|infrastructure|biblioth|sport|cafet/))
    return 'facilities';
  if (text.match(/vie.étudiant|student.life|club|association|activit/))
    return 'student_life';
  if (text.match(/contact|adresse|address|phone|email|direction/))
    return 'contact';
  if (text.match(/international|partner|échange|exchange|honoris/))
    return 'international';
  if (text.match(/actualit|news|event|événement|agenda/))
    return 'news';
  if (text.match(/about|histoire|history|présentation|vision|mission/))
    return 'about';
  return 'general';
}

// ============================================================
// HELPERS
// ============================================================
const visited = new Set();
const queue = [BASE_URL];
const pages = [];

function shouldSkip(url) {
  return SKIP_PATTERNS.some(p => url.includes(p));
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractLinks($, currentUrl) {
  const links = [];
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('/')) href = BASE_URL + href;
    if (!href.startsWith(BASE_URL)) return;
    if (shouldSkip(href)) return;
    href = href.split('#')[0].replace(/\/$/, '');
    if (href && !visited.has(href)) links.push(href);
  });
  return [...new Set(links)];
}

function extractStructured($, url) {
  // Remove noise
  $('script, style, noscript, nav, header, footer, iframe, ' +
    '.menu, .navigation, .sidebar, .widget, .cookie, ' +
    '.breadcrumb, .pagination, [class*="menu"], [class*="nav"]').remove();

  const title = cleanText($('title').text() || $('h1').first().text() || url);

  // Extract headings as sections
  const sections = [];
  let currentSection = null;

  $('h1, h2, h3, h4, p, ul, ol, table').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const text = cleanText($(el).text());
    if (!text || text.length < 5) return;

    if (['h1', 'h2', 'h3', 'h4'].includes(tag)) {
      if (currentSection) sections.push(currentSection);
      currentSection = { heading: text, paragraphs: [], bullets: [] };
    } else if (tag === 'p' && text.length > 20) {
      if (!currentSection) currentSection = { heading: 'General', paragraphs: [], bullets: [] };
      currentSection.paragraphs.push(text);
    } else if (tag === 'ul' || tag === 'ol') {
      if (!currentSection) currentSection = { heading: 'General', paragraphs: [], bullets: [] };
      $(el).find('li').each((_, li) => {
        const liText = cleanText($(li).text());
        if (liText.length > 3) currentSection.bullets.push(liText);
      });
    } else if (tag === 'table') {
      // Extract table as key-value pairs
      if (!currentSection) currentSection = { heading: 'Table', paragraphs: [], bullets: [] };
      $(el).find('tr').each((_, tr) => {
        const cells = $(tr).find('td, th').map((_, td) => cleanText($(td).text())).get();
        if (cells.length > 0 && cells.some(c => c.length > 0)) {
          currentSection.bullets.push(cells.join(' | '));
        }
      });
    }
  });

  if (currentSection) sections.push(currentSection);

  // Extract meta description for summary
  const metaDesc = cleanText(
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || ''
  );

  // Extract any contact info visible on page
// Extract any contact info visible on page
  const pageText = $('body').text() || '';
  const emails = (pageText.match(/[\w.-]+@[\w.-]+\.[a-z]{2,}/gi) || []);
  const phones = (pageText.match(/(\+212|0)[\s.-]?[\d\s.-]{8,}/g) || []);

  return {
    url,
    title,
    category: categorize(url, title),
    meta_description: metaDesc,
    sections: sections.filter(s =>
      s.paragraphs.length > 0 || s.bullets.length > 0
    ),
    contact_found: {
      emails: [...new Set(emails)],
      phones: [...new Set(phones)]
    },
    scraped_at: new Date().toISOString()
  };
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MundiapolisBot/1.0)',
        'Accept-Language': 'fr,en;q=0.9,ar;q=0.8'
      }
    });
    const ct = res.headers['content-type'] || '';
    if (!ct.includes('text/html')) return null;
    return res.data;
  } catch (err) {
    console.log(`  ⚠ Skipped: ${url} — ${err.message}`);
    return null;
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// MAIN CRAWL
// ============================================================
async function crawl() {
  console.log('🚀 Starting Mundiapolis JSON scraper...\n');
  // Add extra external sources to queue
  for (const url of EXTRA_URLS) {
    if (!queue.includes(url)) queue.push(url);
  }

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[${visited.size}/${MAX_PAGES}] ${url}`);

    const html = await fetchPage(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    const pageData = extractStructured($, url);

    // Only save pages with real content
    if (pageData.sections.length > 0 || pageData.meta_description) {
      pages.push(pageData);
    }

    const links = extractLinks($, url);
    for (const link of links) {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    }

    await delay(DELAY_MS);
  }

  console.log(`\n✅ Done! ${visited.size} pages crawled, ${pages.length} with content`);
  saveOutput();
}

// ============================================================
// OUTPUT — saves both JSON and a flat knowledge-base.txt
// ============================================================
function saveOutput() {
  // 1. Save full structured JSON
  const output = {
    metadata: {
      university: 'Mundiapolis University',
      website: BASE_URL,
      generated_at: new Date().toISOString(),
      total_pages: pages.length,
      categories: [...new Set(pages.map(p => p.category))]
    },
    pages: pages
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf-8');
  const jsonKB = Math.round(fs.statSync(OUTPUT_JSON).size / 1024);
  console.log(`\n📦 JSON saved: ${OUTPUT_JSON} (${jsonKB} KB)`);

  // 2. Also auto-generate a flat knowledge-base.txt from the JSON
  // (this is what your server.js reads — no manual work needed)
  const lines = [];
  lines.push('MUNDIAPOLIS UNIVERSITY — KNOWLEDGE BASE');
  lines.push(`Source: ${BASE_URL} | Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Group by category for cleaner reading
  const categories = [...new Set(pages.map(p => p.category))];
  for (const cat of categories) {
    const catPages = pages.filter(p => p.category === cat);
    lines.push(`\n${'='.repeat(50)}`);
    lines.push(`CATEGORY: ${cat.toUpperCase().replace('_', ' ')}`);
    lines.push('='.repeat(50));

    for (const page of catPages) {
      lines.push(`\n[${page.title}]`);
      lines.push(`URL: ${page.url}`);
      if (page.meta_description) lines.push(`Summary: ${page.meta_description}`);

      for (const section of page.sections) {
        lines.push(`\n  ${section.heading}:`);
        section.paragraphs.forEach(p => lines.push(`  ${p}`));
        section.bullets.forEach(b => lines.push(`  • ${b}`));
      }

      if (page.contact_found.emails.length > 0) {
        lines.push(`  Emails: ${page.contact_found.emails.join(', ')}`);
      }
      if (page.contact_found.phones.length > 0) {
        lines.push(`  Phones: ${page.contact_found.phones.join(', ')}`);
      }
    }
  }

  fs.writeFileSync(OUTPUT_KB, lines.join('\n'), 'utf-8');
  const kbKB = Math.round(fs.statSync(OUTPUT_KB).size / 1024);
  console.log(`📄 knowledge-base.txt auto-updated: ${OUTPUT_KB} (${kbKB} KB)`);

  console.log('\n🎯 What you got:');
  console.log('  mundiapolis-data.json  → full structured data (for RAG, databases, etc.)');
  console.log('  knowledge-base.txt     → auto-updated, Amira reads this immediately');
  console.log('\n✨ Run `npm run merge` (if you have manual facts), then restart the server.');

  // Print category summary
  console.log('\n📊 Content by category:');
  for (const cat of categories) {
    const count = pages.filter(p => p.category === cat).length;
    console.log(`  ${cat.padEnd(15)} ${count} pages`);
  }
}

crawl().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});