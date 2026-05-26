export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const { count = 30 } = req.body || {};

  try {
    // Use existing dataset directly - no new run needed
    const dataRes = await fetch(
      'https://api.apify.com/v2/datasets/XBjqa0LdpMdTWPfxD/items?limit=500',
      { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
    );

    if (!dataRes.ok) throw new Error('Erreur dataset: ' + dataRes.status);

    const items = await dataRes.json();
    const arr = Array.isArray(items) ? items : [];

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
      if (captionLow.includes('xfunded') || captionLow.includes('ftmo') || captionLow.includes('funded') || captionLow.includes('propfirm') || captionLow.includes('prop firm')) score += 15;
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
