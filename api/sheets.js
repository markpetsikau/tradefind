export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { profiles } = req.body || {};
  if (!profiles || profiles.length === 0) return res.status(400).json({ error: 'Pas de profils à exporter' });

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) return res.status(500).json({ error: 'Credentials Google manquants' });

  try {
    // Get access token
    const token = await getAccessToken(clientEmail, privateKey);

    // Create new Google Sheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: `TradeFind — Influenceurs Trading ${new Date().toLocaleDateString('fr-FR')}` },
        sheets: [{ properties: { title: 'Influenceurs' } }]
      })
    });

    const sheet = await createRes.json();
    const spreadsheetId = sheet.spreadsheetId;
    const spreadsheetUrl = sheet.spreadsheetUrl;

    // Prepare data
    const headers = ['#', 'Username Instagram', 'Nom complet', 'Abonnés', 'Pays', 'Telegram', 'Lien Telegram', 'Reels', 'Score XFunded', 'Lien Profil'];
    const rows = profiles.map((p, i) => [
      i + 1,
      '@' + p.username,
      p.fullName || '',
      p.followers || 0,
      p.country || '🌍',
      p.hasTelegram ? 'Oui' : 'Non',
      p.telegramLink ? 'https://' + p.telegramLink : '',
      p.hasReels ? 'Oui' : 'Non',
      p.score || 0,
      `https://www.instagram.com/${p.username}/`
    ]);

    // Write data
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Influenceurs!A1:J${rows.length + 1}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headers, ...rows] })
    });

    // Format header row
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.23, green: 0.51, blue: 0.96 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)'
          }
        }]
      })
    });

    return res.status(200).json({ url: spreadsheetUrl, spreadsheetId });

  } catch(err) {
    console.error(err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const signingInput = `${header}.${payload}`;

  // Import private key
  const pemContents = privateKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token Google invalide');
  return tokenData.access_token;
}
