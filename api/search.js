export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const { count = 30, runId } = req.body || {};
  if (!APIFY_KEY) return res.status(500).json({ error: 'Clé Apify manquante' });

  // If runId provided, fetch results from existing run
  if (runId) {
    try {
      const statusRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}`,
        { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
      );
      const statusData = await statusRes.json();
      const status = statusData.data?.status;

      if (status === 'RUNNING' || status === 'READY') {
        return res.status(200).json({ status: 'RUNNING', runId });
      }

      // Get results
      const dataRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs/${runId}/dataset/items?limit=500`,
        { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
      );
      const items = await dataRes.json();
      const profiles = processItems(Array.isArray(items) ? items : [], count);
      return res.status(200).json({ status: 'DONE', profiles, total: profiles.length });

    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // Start new run
  try {
    const runRes = await fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${APIFY_KEY}` },
      body: JSON.stringify({
        hashtags: ['fundedtrader', 'propfirm', 'ftmo', 'propfirmtrader', 'fundedaccount', 'apextrader', 'tradingchallenge'],
        resultsLimit: 150,
        proxy: { useApifyProxy: true }
      })
    });

    const runData = await runRes.json();
    const newRunId = runData.data?.id;
    if (!newRunId) throw new Error('Pas de run ID');

    return res.status(200).json({ status: 'STARTED', runId: newRunId });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}

function processItems(arr, count) {
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
    if (captionLow.includes('ftmo') || captionLow.includes('funded') || captionLow.includes('propfirm') || captionLow.includes('prop firm')) score += 15;
    score = Math.min(score, 99);
    profiles.push({
      username, fullName,
      followers: item.ownerFollowersCount || 0,
      country: detectCountry(captionLow + ' ' + fullName.toLowerCase()),
      hasTelegram: hasTg,
      telegramLink: tgMatch ? tgMatch[0] : null,
      hasReels: true, score
    });
    if (profiles.length >= count) break;
  }
  return profiles.sort((a, b) => b.score - a.score);
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
