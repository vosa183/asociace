export default async function handler(req, res) {
  // Povolení CORS pro jistotu
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const { token, from, to } = req.query;

  if (!token || !from || !to) {
    return res.status(400).json({ error: "Chybí parametry (token, from, to)." });
  }

  const cleanToken = token.trim();
  const url = `https://www.fio.cz/ib_api/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

  try {
    const fetchResponse = await fetch(url);
    
    // Fio banka posílá data v ISO-8859-2, zkusíme to rovnou zpracovat
    if (!fetchResponse.ok) {
       return res.status(fetchResponse.status).json({ error: `Fio banka zamítla přístup (HTTP Status: ${fetchResponse.status}). Pravděpodobně pravidlo 60 sekund.`});
    }

    const data = await fetchResponse.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: `Chyba Vercel serveru: ${error.message}` });
  }
}
