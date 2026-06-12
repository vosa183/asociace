module.exports = async function(req, res) {
  // Povolení CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { token, from, to } = req.query;

  if (!token || !from || !to) {
    return res.status(400).json({ error: "Chybí parametry (token, from, to)." });
  }

  const cleanToken = token.trim();
  const url = `https://www.fio.cz/ib_api/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

  try {
    // 1. Dáme požadavku "falešnou občanku", ať vypadáme jako reálný člověk
    const fetchResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'cs,cs-CZ;q=0.9,en;q=0.8'
      }
    });

    // 2. Nečteme to rovnou jako JSON (aby to nepadalo), ale jako surový text
    const rawText = await fetchResponse.text();

    if (!fetchResponse.ok) {
       return res.status(fetchResponse.status).json({ 
         error: `Banka vrátila HTTP ${fetchResponse.status}.`,
         details: rawText.substring(0, 300)
       });
    }

    // 3. Zkusíme surový text bezpečně převést na JSON
    try {
      const data = JSON.parse(rawText);
      return res.status(200).json(data);
    } catch (parseError) {
      // 4. Pokud to spadne, banka nám místo JSONu poslala HTML. Pošleme ho do logu.
      return res.status(500).json({ 
        error: "Fio banka místo dat poslala HTML stránku (zřejmě firewall blokace Vercelu).", 
        details: rawText.substring(0, 800) 
      });
    }

  } catch (error) {
    return res.status(500).json({ error: `Chyba Vercel připojení: ${error.message}` });
  }
};
