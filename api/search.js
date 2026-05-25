export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, minFollowers, maxFollowers, count, needTelegram, countries } = req.body;

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  const RAPIDAPI_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';

  if (!RAPIDAPI_KEY) {
    return res.status(500).json({ error: 'Clé RapidAPI manquante dans les variables d\'environnement' });
  }

  // Build search queries based on type and countries
  const countryKeywords = {
    france: ['france', 'français', 'paris', 'lyon', 'marseille'],
    espagne: ['españa', 'spain', 'madrid', 'barcelona', 'spanish'],
    italie: ['italia', 'italy', 'rome', 'milan', 'italiano'],
    uk: ['uk', 'london', 'england', 'british', 'united kingdom'],
    allemagne: ['germany', 'deutschland', 'berlin', 'german'],
    usa: ['usa', 'america', 'new york', 'american'],
    maroc: ['maroc', 'morocco', 'casablanca', 'marocain'],
    algerie: ['algerie', 'algeria', 'alger', 'algerien']
  };

  // Build queries
  const baseQueries = [type, `${type} france`, `${type} españa`, `${type} italia`, `${type} uk`, `${type} signals`, `${type} telegram`];
  
  if (countries && countries.length > 0) {
    countries.forEach(c => {
      const words = countryKeywords[c] || [];
      words.slice(0, 2).forEach(w => baseQueries.push(`${type} ${w}`));
    });
  }

  const uniqueQueries = [...new Set(baseQueries)].slice(0, 8);
  const allProfiles = [];
  const seenUsernames = new Set();

  for (const query of uniqueQueries) {
    if (allProfiles.length >= count * 4) break;

    try {
      const response = await fetch(
        `https://${RAPIDAPI_HOST}/search_users_and_hashtags/?query=${encodeURIComponent(query)}&count=20`,
        {
          method: 'GET',
          headers: {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': RAPIDAPI_HOST
          }
        }
      );

      if (!response.ok) {
        console.error(`RapidAPI error for query "${query}": ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      // Handle different response formats
      const users = data.users || data.data?.users || data.result?.users || [];
      
      for (const user of users) {
        const username = user.username || user.user?.username;
        if (!username || seenUsernames.has(username)) continue;
        seenUsernames.add(username);

        const followers = user.follower_count || user.followers_count || user.edge_followed_by?.count || 0;
        const bio = user.biography || user.bio || user.user?.biography || '';
        const bioLow = bio.toLowerCase();

        // Filter by followers
        if (followers < (minFollowers || 0)) continue;
        if (followers > (maxFollowers || 999999999)) continue;

        // Filter by telegram if required
        if (needTelegram) {
          if (!bioLow.includes('t.me') && !bioLow.includes('telegram') && !bioLow.includes('telgram')) continue;
        }

        // Extract telegram link
        const tgMatch = bio.match(/t\.me\/[\w]+/i);
        const telegramLink = tgMatch ? tgMatch[0] : null;

        // Detect country from bio
        const country = detectCountry(bioLow, countries);

        // Calculate XFunded score
        let score = 50;
        if (telegramLink) score += 20;
        if (user.is_verified) score += 10;
        if (followers > 10000) score += 10;
        if (followers > 50000) score += 5;
        if (bioLow.includes('xfunded') || bioLow.includes('ftmo') || bioLow.includes('prop firm') || bioLow.includes('funded')) score += 10;
        if (bioLow.includes('signal') || bioLow.includes('cours') || bioLow.includes('formation')) score += 5;
        score = Math.min(score, 99);

        allProfiles.push({
          username,
          fullName: user.full_name || user.name || '',
          followers,
          country,
          hasTelegram: !!(telegramLink || bioLow.includes('telegram')),
          telegramLink,
          hasReels: user.has_clips || user.reel_media || true,
          bio: bio.substring(0, 100),
          isVerified: user.is_verified || false,
          score
        });
      }
    } catch (err) {
      console.error(`Error fetching query "${query}":`, err.message);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  // Sort by score and limit
  const sorted = allProfiles
    .sort((a, b) => b.score - a.score)
    .slice(0, count || 30);

  return res.status(200).json({
    profiles: sorted,
    total: sorted.length,
    queriesRun: uniqueQueries.length
  });
}

function detectCountry(bioLow, selectedCountries) {
  if (!selectedCountries) return '🌍';
  
  const flags = {
    france: '🇫🇷',
    espagne: '🇪🇸',
    italie: '🇮🇹',
    uk: '🇬🇧',
    allemagne: '🇩🇪',
    usa: '🇺🇸',
    maroc: '🇲🇦',
    algerie: '🇩🇿'
  };

  const keywords = {
    france: ['france', 'français', 'paris', 'lyon', 'marseille', 'bordeaux', 'nantes'],
    espagne: ['españa', 'spanish', 'madrid', 'barcelona', 'español', 'spain'],
    italie: ['italia', 'italian', 'rome', 'milan', 'italiano', 'italy'],
    uk: ['uk', 'london', 'england', 'british', 'england', 'scotland'],
    allemagne: ['germany', 'deutsch', 'berlin', 'münchen', 'german'],
    usa: ['usa', 'america', 'new york', 'los angeles', 'american'],
    maroc: ['maroc', 'morocco', 'casablanca', 'rabat', 'marocain'],
    algerie: ['algerie', 'algeria', 'alger', 'oran', 'algerien']
  };

  for (const country of (selectedCountries || [])) {
    const words = keywords[country] || [];
    if (words.some(w => bioLow.includes(w))) {
      return flags[country] || '🌍';
    }
  }

  return '🌍';
}
