export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const { count = 30 } = req.body || {};

  try {
    const dataRes = await fetch(
      'https://api.apify.com/v2/datasets/BUo287T8ovpCPlNe2/items?limit=1050',
      { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
    );

    const items = await dataRes.json();
    const arr = Array.isArray(items) ? items : [];

    // Shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

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
      if (captionLow.includes('ftmo') || captionLow.includes('funded') || captionLow.includes('propfirm')) score += 15;
      score = Math.min(score, 99);

      profiles.push({
        username,
        fullName,
        followers: item.ownerFollowersCount || 0,
        country: detectCountry(captionLow),
        hasTelegram: hasTg,
        telegramLink: tgMatch ? tgMatch[0] : null,
        hasReels: true,
        score
      });

      if (profiles.length >= count) break;
    }

    return res.status(200).json({ profiles, total: profiles.length });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}

function detectCountry(text) {
  if (text.includes('france') || text.includes('français')) return '🇫🇷';
  if (text.includes('españa') || text.includes('español')) return '🇪🇸';
  if (text.includes('italia') || text.includes('italiano')) return '🇮🇹';
  if (text.includes('uk') || text.includes('london')) return '🇬🇧';
  if (text.includes('maroc') || text.includes('morocco')) return '🇲🇦';
  if (text.includes('algerie') || text.includes('algeria')) return '🇩🇿';
  return '🌍';
}
