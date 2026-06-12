const https = require('https');

module.exports = function(req, res) {
  // Povolení CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { token, from, to } = req.query;

  if (!token || !from || !to) {
    return res.status(400).json({ error: "Chybí parametry (token, from, to)." });
  }

  const cleanToken = token.trim();
  const url = `https://www.fio.cz/ib_api/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

  https.get(url, (fioRes) => {
    let rawData = '';
    
    fioRes.on('data', (chunk) => { rawData += chunk; });
    
    fioRes.on('end', () => {
      if (fioRes.statusCode !== 200) {
        return res.status(fioRes.statusCode).json({ 
          error: `Fio banka zamítla přístup (HTTP ${fioRes.statusCode}). Pravděpodobně pravidlo 60 sekund.`, 
          details: rawData.substring(0, 200) 
        });
      }
      
      try {
        const parsedData = JSON.parse(rawData);
        res.status(200).json(parsedData);
      } catch (e) {
        res.status(500).json({ error: "Banka nevrátila platný JSON.", details: rawData.substring(0, 200) });
      }
    });
  }).on('error', (e) => {
    res.status(500).json({ error: `Chyba připojení Vercelu k Fio: ${e.message}` });
  });
};
