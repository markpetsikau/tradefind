export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const APIFY_KEY = process.env.APIFY_KEY;
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const { count = 30 } = req.body || {};

  try {
    // Get usernames from existing dataset
    const dataRes = await fetch(
      'https://api.apify.com/v2/datasets/BUo287T8ovpCPlNe2/items?limit=1050',
      { headers: { 'Authorization': `Bearer ${APIFY_KEY}` } }
    );

    const items = await dataRes.json();
    const arr = Array.isArray(items) ? items : [];

    // Get unique usernames shuffled
    const seen = new Set();
    const usernames = [];
    const shuffled = arr.sort(() => Math.random() - 0.5);
    
    for (const item of shuffled) {
      const username = item.ownerUsername || item.owner?.username;
      if (!username || seen.has(username)) continue;
      seen.add(username);
      usernames.push(username);
      if (usernames.length >= count * 2) break;
    }

    // Fetch real profile info for each username via RapidAPI
    const profiles = [];
    for (const username of usernames.slice(0, count)) {
      try {
        const profileRes = await fetch(
          `https://instagram-scraper-stable-api.p.rapidapi.com/get_user_profile_info_v2.php?username_or_id_or_url=${username}`,
          {
            headers: {
              'x-rapidapi-key': RAPIDAPI_KEY,
              'x-rapidapi-host': 'instagram-scraper-stable-api.p.rapidapi.com'
            }
          }
        );
        
        const profileData = await profileRes.json();
        const user = profileData?.data || profileData?.user || profileData;
        
        const followers = user?.edge_followed_by?.count || user?.follower_count || user?.followers || 0;
        const bio = user?.biography || user?.bio || '';
        const bioLow = bio.toLowerCase();
        const tgMatch = bio.match(/t\.me\/[\w]+/i);
        const hasTg = !!(tgMatch || bioLow.includes('telegram'));

        let score = 60;
        if (hasTg) score += 20;
        if (followers > 10000) score += 10;
        if (followers > 50000) score += 10;
        if (bioLow.includes('ftmo') || bioLow.includes('funded') || bioLow.includes('propfirm')) score += 10;
        score = Math.min(score, 99);

        profiles.push({
          username,
          fullName: user?.full_name || user?.fullName || '',
          followers,
          country: detectCountry(bioLow),
          hasTelegram: hasTg,
          telegramLink: tgMatch ? tgMatch[0] : null,
          hasReels: true,
          score
        });

      } catch(e) {
        // If profile fetch fails, add with basic info
        profiles.push({
          username,
          fullName: '',
          followers: 0,
          country: '🌍',
          hasTelegram: false,
          telegramLink: null,
          hasReels: true,
          score: 60
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
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
