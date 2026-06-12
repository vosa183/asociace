const https = require('https');
const http = require('http');

module.exports = function(req, res) {
  // Povolení CORS pro tvůj web
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { token, from, to } = req.query;

  if (!token || !from || !to) {
    return res.status(400).json({ error: "Chybí parametry (token, from, to)." });
  }

  const cleanToken = token.trim();
  const initialUrl = `https://www.fio.cz/ib_api/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

  function makeRequest(currentUrl, redirectCount = 0) {
    // Pojistka proti zacyklení přesměrování
    if (redirectCount > 5) {
      return res.status(500).json({ error: "Fio banka se zacyklila v přesměrování." });
    }

    const client = currentUrl.startsWith('https') ? https : http;

    client.get(currentUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (fioRes) => {
      // Automatické následování přesměrování (HTTP 301/302), na kterém jsme prve ztroskotali
      if (fioRes.statusCode >= 300 && fioRes.statusCode < 400 && fioRes.headers.location) {
        let nextUrl = fioRes.headers.location;
        if (!nextUrl.startsWith('http')) {
           nextUrl = new URL(nextUrl, currentUrl).href;
        }
        return makeRequest(nextUrl, redirectCount + 1);
      }

      let rawData = '';
      fioRes.on('data', (chunk) => { rawData += chunk; });
      fioRes.on('end', () => {
        if (fioRes.statusCode !== 200) {
          return res.status(fioRes.statusCode).json({
            error: `Banka vrátila HTTP ${fioRes.statusCode}`,
            html_dump: rawData.substring(0, 1000)
          });
        }

        try {
          const parsed = JSON.parse(rawData);
          res.status(200).json(parsed);
        } catch (e) {
          res.status(500).json({
            error: "Fio banka místo dat poslala HTML chybovou stránku.",
            html_dump: rawData.substring(0, 1000)
          });
        }
      });
    }).on('error', (e) => {
      res.status(500).json({ error: `Kritická chyba Vercelu: ${e.message}` });
    });
  }

  makeRequest(initialUrl);
};
