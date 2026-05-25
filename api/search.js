export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const { count = 30 } = req.body || {};
  if (!APIFY_KEY) return res.status(500).json({ error: 'Clé Apify manquante' });

  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_KEY}` },
      body: JSON.stringify({
        hashtags: ['trading', 'forextrader', 'daytrader', 'tradingforex', 'fundedtrader'],
        resultsLimit: 150,
        proxy: { useApifyProxy: true }
      })
    });

    const runData = await runRes.json();
    const runId = runData.data?.id;
    if (!runId) throw new Error('Pas de run ID');

    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 40) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;
      const s = await fetch(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}`, {
        headers: { 'Authorization': `Bearer ${APIFY_KEY}` }
      });
      status = (await s.json()).data?.status || 'FAILED';
    }

    if (status !== 'SUCCEEDED') throw new Error('Run échoué: ' + status);

    const dataRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}/dataset/items?limit=500`, {
      headers: { 'Authorization': `Bearer ${APIFY_KEY}` }
    });

    const items = await dataRes.json();
    const arr = Array.isArray(items) ? items : Object.values(items || {});

    // Deduplicate by username
    const seen = new Set();
    const profiles = [];

    for (const item of arr) {
      if (!item) continue;

      // Apify hashtag scraper returns posts — extract owner info
      const username = item.ownerUsername || item.owner?.username;
      const fullName = item.ownerFullName || item.owner?.fullName || '';

      if (!username || seen.has(username)) continue;
      seen.add(username);

      // Get post URL to link to profile
      const postUrl = item.url || item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : '';

      // Extract telegram from caption
      const caption = item.caption || item.text || '';
      const captionLow = caption.toLowerCase();
      const tgMatch = caption.match(/t\.me\/[\w]+/i);
      const hasTg = !!(tgMatch || captionLow.includes('telegram'));

      let score = 60;
      if (hasTg) score += 20;
      if (captionLow.includes('xfunded') || captionLow.includes('ftmo') || captionLow.includes('funded')) score += 15;
      if (captionLow.includes('signal') || captionLow.includes('formation') || captionLow.includes('cours')) score += 5;
      score = Math.min(score, 99);

      profiles.push({
        username,
        fullName,
        followers: 0, // not available from hashtag scraper
        country: detectCountry(captionLow + ' ' + fullName.toLowerCase()),
        hasTelegram: hasTg,
        telegramLink: tgMatch ? tgMatch[0] : null,
        hasReels: true,
        score,
        profileUrl: `https://www.instagram.com/${username}/`
      });

      if (profiles.length >= count) break;
    }

    profiles.sort((a, b) => b.score - a.score);
    return res.status(200).json({ profiles, total: profiles.length });

  } catch(err) {
    console.error(err.message);
    return res.status(500).json({ error: err.message });
  }
}

function detectCountry(text) {
  if (text.includes('france') || text.includes('français') || text.includes('paris')) return '🇫🇷';
  if (text.includes('españa') || text.includes('madrid') || text.includes('barcelona') || text.includes('español')) return '🇪🇸';
  if (text.includes('italia') || text.includes('rome') || text.includes('milan') || text.includes('italiano')) return '🇮🇹';
  if (text.includes('uk') || text.includes('london') || text.includes('england')) return '🇬🇧';
  if (text.includes('maroc') || text.includes('morocco')) return '🇲🇦';
  if (text.includes('algerie') || text.includes('algeria')) return '🇩🇿';
  return '🌍';
}
