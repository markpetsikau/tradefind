export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const { count = 30, needTelegram = true } = req.body || {};

  if (!APIFY_KEY) return res.status(500).json({ error: 'Clé Apify manquante' });

  const hashtags = ['trading', 'forextrader', 'daytrader', 'tradingforex', 'fundedtrader'];

  try {
    // Start Apify run
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${APIFY_KEY}`
      },
      body: JSON.stringify({
        hashtags: hashtags,
        resultsLimit: 100,
        proxy: { useApifyProxy: true }
      })
    });

    if (!runRes.ok) {
      const err = await runRes.json();
      throw new Error('Erreur Apify run: ' + runRes.status);
    }

    const runData = await runRes.json();
    const runId = runData.data?.id;
    if (!runId) throw new Error('Pas de run ID');

    // Wait for completion max 2 minutes
    let status = 'RUNNING';
    let attempts = 0;
    while (status === 'RUNNING' && attempts < 40) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;
      const statusRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}`, {
        headers: { 'Authorization': `Bearer ${APIFY_KEY}` }
      });
      const statusData = await statusRes.json();
      status = statusData.data?.status || 'FAILED';
    }

    if (status !== 'SUCCEEDED') throw new Error('Run échoué: ' + status);

    // Get dataset items
    const dataRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}/dataset/items?limit=500`, {
      headers: { 'Authorization': `Bearer ${APIFY_KEY}` }
    });

    const rawData = await dataRes.json();

    // Handle all possible formats
    let items = [];
    if (Array.isArray(rawData)) {
      items = rawData;
    } else if (rawData?.items && Array.isArray(rawData.items)) {
      items = rawData.items;
    } else if (rawData?.data && Array.isArray(rawData.data)) {
      items = rawData.data;
    } else {
      items = Object.values(rawData || {});
    }

    // Extract unique profiles
    const seen = new Set();
    const profiles = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const username = item.ownerUsername || item.owner?.username || item.username;
      if (!username || seen.has(username)) continue;
      seen.add(username);

      const followers = item.ownerFollowersCount || item.owner?.followersCount || item.followersCount || item.edge_followed_by?.count || 0;
      if (followers < 1000) continue;

      const bio = item.ownerBiography || item.owner?.biography || item.biography || '';
      const bioLow = bio.toLowerCase();

      if (needTelegram && !bioLow.includes('t.me') && !bioLow.includes('telegram')) continue;

      const tgMatch = bio.match(/t\.me\/[\w]+/i);
      let score = 50;
      if (tgMatch) score += 25;
      if (followers > 10000) score += 10;
      if (followers > 50000) score += 10;
      if (bioLow.includes('xfunded') || bioLow.includes('ftmo') || bioLow.includes('funded')) score += 10;
      score = Math.min(score, 99);

      profiles.push({
        username,
        fullName: item.ownerFullName || item.owner?.fullName || item.fullName || '',
        followers,
        country: detectCountry(bioLow),
        hasTelegram: !!(tgMatch || bioLow.includes('telegram')),
        telegramLink: tgMatch ? tgMatch[0] : null,
        hasReels: true,
        score
      });

      if (profiles.length >= count) break;
    }

    profiles.sort((a, b) => b.score - a.score);
    return res.status(200).json({ profiles, total: profiles.length });

  } catch(err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

function detectCountry(bio) {
  if (bio.includes('france') || bio.includes('français') || bio.includes('paris')) return '🇫🇷';
  if (bio.includes('españa') || bio.includes('madrid') || bio.includes('barcelona')) return '🇪🇸';
  if (bio.includes('italia') || bio.includes('rome') || bio.includes('milan')) return '🇮🇹';
  if (bio.includes('uk') || bio.includes('london') || bio.includes('england')) return '🇬🇧';
  if (bio.includes('maroc') || bio.includes('morocco')) return '🇲🇦';
  if (bio.includes('algerie') || bio.includes('algeria')) return '🇩🇿';
  return '🌍';
}
