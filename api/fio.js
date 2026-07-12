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

    const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

    // Fio přísně blokuje dotazy častější než 1x za 30 s NA STEJNÝ TOKEN - a to bez ohledu na
    // to, odkud dotaz přišel. Automatický cron (api/cron.js) volá Fio taky, na pozadí, bez
    // vědomí uživatele. Proto se čas posledního dotazu ukládá sdíleně do system_settings a
    // kontroluje se TADY, PŘED voláním Fio - uživatel tak hned dostane přesnou informaci
    // ("počkej ještě X s"), místo aby 15-25 s čekal na timeout s matoucí obecnou hláškou.
    let lastCallElapsed = null;
    try {
        const settingsResp = await fetch(`${supabaseUrl}/rest/v1/system_settings?id=eq.1&select=fio_last_call_at`, {
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }
        });
        const settingsData = await settingsResp.json();
        const lastCallStr = settingsData?.[0]?.fio_last_call_at;
        if (lastCallStr) {
            lastCallElapsed = (Date.now() - new Date(lastCallStr).getTime()) / 1000;
        }
    } catch (e) {
        console.error('Nepodařilo se ověřit čas posledního dotazu na Fio (pokračuji dál):', e);
    }

    if (lastCallElapsed !== null && lastCallElapsed < 32) {
        const waitFor = Math.ceil(32 - lastCallElapsed);
        return res.status(429).json({
            error: `Fio banka byla naposledy dotázána před ${Math.floor(lastCallElapsed)} s (ať už odsud, nebo automatickým cronem na pozadí) - Fio povoluje dotaz max. 1x za 30 s. Počkejte prosím ještě ${waitFor} s a zkuste to znovu.`
        });
    }

    // Zapíšeme čas HNED, před samotným voláním Fio, ať se souběžné požadavky nepřekryjí.
    try {
        await fetch(`${supabaseUrl}/rest/v1/system_settings?id=eq.1`, {
            method: 'PATCH',
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ fio_last_call_at: new Date().toISOString() })
        });
    } catch (e) {
        console.error('Nepodařilo se zapsat čas dotazu na Fio (pokračuji dál):', e);
    }

    // Tvoje správná, ověřená URL adresa Fio API (v1)
    const url = `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(cleanToken)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}/transactions.json`;

    try {
        const fioController = new AbortController();
        const fioTimeout = setTimeout(() => fioController.abort(), 25000);
        let fetchResponse;
        try {
            fetchResponse = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                signal: fioController.signal
            });
        } catch (fetchErr) {
            if (fetchErr.name === 'AbortError') {
                return res.status(504).json({
                    error: "Fio API neodpovědělo do 25 sekund. Pravidlo 30 s jsme právě zkontrolovali výše, takže o to tentokrát nejde - Fio banka je pravděpodobně momentálně pomalá nebo dočasně nedostupná. Zkuste to prosím za pár minut znovu."
                });
            }
            throw fetchErr;
        } finally {
            clearTimeout(fioTimeout);
        }

        if (!fetchResponse.ok) {
            const errText = await fetchResponse.text();
            return res.status(fetchResponse.status).json({
                error: `Banka vrátila HTTP ${fetchResponse.status}.`,
                details: errText.substring(0, 300)
            });
        }

        const data = await fetchResponse.json();
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: `Kritická chyba Vercelu: ${error.message}` });
    }
}
