// Vercel serverless function: returns live Iranian bazaar prices in toman.
// Multi-source: primary = TGJU (direct server-side scrape, the original source);
// fallback = maintained Navasan mirrors. Cached in-memory for ~30s.
// All amounts are in Toman.
const fetch = globalThis.fetch;

const NAVASAN = [
  'https://raw.githubusercontent.com/HosseinOdd/Navasan-API/main/data/',
  'https://raw.githubusercontent.com/mazi8331/Navasan-API/main/data/',
  'https://raw.githubusercontent.com/isamanb/Navasan-API/main/data/'
];

const TMAN = (rial) => Math.round((Number(rial) || 0) / 10);

async function getText(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept-Language': 'fa,en' },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) return '';
  return await r.text();
}

// --- TGJU direct scrape ---
function tgjuRows(html) {
  const out = {};
  const re = /<tr[^>]*data-market-nameslug="([a-z0-9_]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1], row = m[2];
    let p = null;
    const dm = row.match(/data-price="([\d,]+)"/);
    if (dm) p = dm[1];
    else { const nm = row.match(/<td[^>]*>\s*([\d.,]+)\s*<\/td>/); if (nm) p = nm[1]; }
    if (p) out[slug] = parseInt(p.replace(/,/g, ''), 10);
  }
  return out;
}

async function scrapeTgju() {
  const [coinH, goldH, curH] = await Promise.all([
    getText('https://www.tgju.org/coin'),
    getText('https://www.tgju.org/gold-chart'),
    getText('https://www.tgju.org/currency')
  ]);
  if (!coinH && !goldH && !curH) return null;
  const coin = tgjuRows(coinH), gold = tgjuRows(goldH), cur = tgjuRows(curH);
  if (!coin.sekee && !coin.nim) return null;
  return {
    coins: { emami: TMAN(coin.sekee), nim: TMAN(coin.nim), rob: TMAN(coin.rob), gram: TMAN(coin.gerami) },
    gold: { g18: TMAN(gold.geram18) },
    fx: { usd: TMAN(cur.price_dollar_rl), eur: TMAN(cur.price_eur), gbp: TMAN(cur.price_gbp), aed: TMAN(cur.price_aed) },
    source: 'tgju'
  };
}

// --- Navasan mirror fallback (values already in toman) ---
async function navasan(base) {
  const [f, g] = await Promise.all([
    fetch(base + 'fiat.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }),
    fetch(base + 'gold.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
  ]);
  if (!f.ok || !g.ok) return null;
  const fj = await f.json(), gj = await g.json();
  if (!fj.usd || !fj.usd.value || !gj.sekkeh || !gj.sekkeh.value) return null;
  const v = (o) => (o && o.value != null ? Number(o.value) : null);
  return {
    coins: { emami: v(gj.sekkeh), nim: v(gj.nim), rob: v(gj.rob), gram: v(gj.gerami) },
    gold: { g18: v(gj['18ayar']) },
    fx: { usd: v(fj.usd), eur: v(fj.eur), gbp: v(fj.gbp), aed: v(fj.aed) },
    source: 'navasan'
  };
}

let cache = { data: null, at: 0 };
const CACHE_MS = 30000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30');
  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return res.status(200).json(cache.data);
  }
  let data = null;
  try { data = await scrapeTgju(); } catch (e) { /* fall through */ }
  if (!data) {
    for (const b of NAVASAN) {
      try { data = await navasan(b); if (data) break; } catch (e) { /* try next */ }
    }
  }
  if (!data) return res.status(502).json({ error: 'all price sources unavailable' });
  data.updated = Date.now();
  cache = { data, at: Date.now() };
  return res.status(200).json(data);
};
