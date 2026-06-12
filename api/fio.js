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
    // Nativní fetch v Node.js (Vercel) automaticky následuje 301 a 302 přesměrování
    const fetchResponse = await fetch(url);
    
    if (!fetchResponse.ok) {
       const errText = await fetchResponse.text();
       return res.status(fetchResponse.status).json({ 
         error: `Banka vrátila HTTP ${fetchResponse.status}. (Možná pravidlo 60 sekund)`,
         details: errText.substring(0, 200)
       });
    }

    const data = await fetchResponse.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: `Chyba Vercel připojení: ${error.message}` });
  }
};
