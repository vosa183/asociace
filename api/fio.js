export default async function handler(req, res) {
    // Povolení CORS, aby ti fungovalo načítání v administraci banka.html
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { token, from, to } = req.query;

    if (!token || !from || !to) {
        return res.status(400).json({ error: "Chybí parametry (token, from, to)." });
    }

    const cleanToken = token.trim();
    
    // Tvoje správná, ověřená URL adresa Fio API (v1)
    const url = `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

    try {
        const fetchResponse = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!fetchResponse.ok) {
            const errText = await fetchResponse.text();
            return res.status(fetchResponse.status).json({ 
                error: `Banka vrátila HTTP ${fetchResponse.status}. (Pamatuj na pravidlo 30 sekund!)`,
                details: errText.substring(0, 300)
            });
        }

        const data = await fetchResponse.json();
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: `Kritická chyba Vercelu: ${error.message}` });
    }
}
