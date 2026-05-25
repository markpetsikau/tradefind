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
    // Get results from the LAST successful run directly — no waiting
    const dataRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/last/dataset/items?limit=500&status=SUCCEEDED`,
      { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
    );

    if (!dataRes.ok) throw new Error('Impossible de récupérer les données: ' + dataRes.status);

    const items = await dataRes.json();
    const arr = Array.isArray(items) ? items : [];

    if (arr.length === 0) {
      // Launch a new run in background and return message
      fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_KEY}` },
        body: JSON.stringify({
          hashtags: ['trading', 'forextrader', 'daytrader', 'fundedtrader', 'tradingforex'],
          resultsLimit: 150,
          proxy: { useApifyProxy: true }
        })
      }).catch(() => {});

      return res.status(200).json({
        profiles: [],
        total: 0,
        message: 'Première recherche en cours (2-3 min) — relance dans quelques minutes'
      });
    }

    // Process results
    const seen = new Set();
    const profiles = [];

    for (const item of arr) {
      if (!item) continue;
      const username = item.ownerUsername || item.owner?.username;
      const fullName = item.ownerFullName || item.owner?.fullName || '';
      if (!username || seen.has(username)) continue;
      seen.add(username);

      const caption = item.caption || item.text || '';
      const captionLow = caption.toLowerCase();
      const tgMatch = caption.match(/t\.me\/[\w]+/i);
      const hasTg = !!(tgMatch || captionLow.includes('telegram'));

      let score = 60;
      if (hasTg) score += 20;
      if (captionLow.includes('xfunded') || captionLow.includes('ftmo') || captionLow.includes('funded')) score += 15;
      if (captionLow.includes('signal') || captionLow.includes('formation')) score += 5;
      score = Math.min(score, 99);

      profiles.push({
        username,
        fullName,
        followers: item.ownerFollowersCount || 0,
        country: detectCountry(captionLow + ' ' + fullName.toLowerCase()),
        hasTelegram: hasTg,
        telegramLink: tgMatch ? tgMatch[0] : null,
        hasReels: true,
        score
      });

      if (profiles.length >= count) break;
    }

    // Also launch new run in background to refresh data
    fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_KEY}` },
      body: JSON.stringify({
        hashtags: ['trading', 'forextrader', 'daytrader', 'fundedtrader', 'tradingforex'],
        resultsLimit: 150,
        proxy: { useApifyProxy: true }
      })
    }).catch(() => {});

    profiles.sort((a, b) => b.score - a.score);
    return res.status(200).json({ profiles, total: profiles.length });

  } catch(err) {
    console.error(err.message);
    return res.status(500).json({ error: err.message });
  }
}

function detectCountry(text) {
  if (text.includes('france') || text.includes('français') || text.includes('paris')) return '🇫🇷';
  if (text.includes('españa') || text.includes('madrid') || text.includes('español')) return '🇪🇸';
  if (text.includes('italia') || text.includes('milan') || text.includes('italiano')) return '🇮🇹';
  if (text.includes('uk') || text.includes('london') || text.includes('england')) return '🇬🇧';
  if (text.includes('maroc') || text.includes('morocco')) return '🇲🇦';
  if (text.includes('algerie') || text.includes('algeria')) return '🇩🇿';
  return '🌍';
}
