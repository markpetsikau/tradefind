export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const HOST = 'instagram-scraper-stable-api.p.rapidapi.com';

  // Ces 3 comptes sont nos sources — on prend leurs followers
  const sourceAccounts = ['billstrading', 'intersoldi_', 'leplussimple_trading'];
  const { count = 30, needTelegram = true } = req.body || {};

  const allProfiles = [];
  const seen = new Set();

  for (const account of sourceAccounts) {
    if (allProfiles.length >= count * 3) break;

    try {
      // Get followers of this account
      const r = await fetch(`https://${HOST}/get_ig_user_followers_v2.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': HOST
        },
        body: `username_or_url=https://www.instagram.com/${account}/&data=following&amount=50`
      });

      const data = await r.json();
      const users = data?.data?.followers || data?.followers || data?.users || data?.data || [];

      for (const u of (Array.isArray(users) ? users : [])) {
        const username = u.username || u.user?.username;
        if (!username || seen.has(username)) continue;
        seen.add(username);

        const followers = u.follower_count || u.followers || u.edge_followed_by?.count || 0;
        if (followers < 1000) continue;

        const bio = u.biography || u.bio || '';
        const bioLow = bio.toLowerCase();

        if (needTelegram) {
          if (!bioLow.includes('t.me') && !bioLow.includes('telegram')) continue;
        }

        const tgMatch = bio.match(/t\.me\/[\w]+/i);
        const tgLink = tgMatch ? tgMatch[0] : null;

        let score = 50;
        if (tgLink) score += 25;
        if (followers > 10000) score += 10;
        if (followers > 50000) score += 10;
        if (u.is_verified) score += 10;
        if (bioLow.includes('xfunded') || bioLow.includes('ftmo') || bioLow.includes('funded')) score += 10;
        score = Math.min(score, 99);

        allProfiles.push({
          username,
          fullName: u.full_name || u.name || '',
          followers,
          country: detectCountry(bioLow),
          hasTelegram: !!(tgLink || bioLow.includes('telegram')),
          telegramLink: tgLink,
          hasReels: true,
          score,
          source: `@${account}`
        });
      }
    } catch(e) {
      console.error(`Error for ${account}:`, e.message);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Si pas assez via followers, on essaie la recherche directe
  if (allProfiles.length < 5) {
    const queries = ['trading forex', 'day trader', 'trader forex france', 'crypto trader', 'funded trader'];
    for (const q of queries) {
      if (allProfiles.length >= count) break;
      try {
        const r = await fetch(`https://${HOST}/search_users_and_hashtags/?query=${encodeURIComponent(q)}&count=20`, {
          headers: {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': HOST
          }
        });
        const data = await r.json();
        const users = data?.users || data?.data?.users || [];
        for (const u of users) {
          const username = u.username;
          if (!username || seen.has(username)) continue;
          seen.add(username);
          const followers = u.follower_count || 0;
          if (followers < 1000) continue;
          const bio = u.biography || '';
          const bioLow = bio.toLowerCase();
          const tgMatch = bio.match(/t\.me\/[\w]+/i);
          let score = 60;
          if (tgMatch) score += 20;
          if (followers > 10000) score += 10;
          allProfiles.push({
            username,
            fullName: u.full_name || '',
            followers,
            country: detectCountry(bioLow),
            hasTelegram: !!tgMatch,
            telegramLink: tgMatch ? tgMatch[0] : null,
            hasReels: true,
            score: Math.min(score, 99),
            source: 'recherche'
          });
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const sorted = allProfiles.sort((a, b) => b.score - a.score).slice(0, count);
  return res.status(200).json({ profiles: sorted, total: sorted.length });
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
