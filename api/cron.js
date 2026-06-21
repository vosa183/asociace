export default async function handler(req, res) {
    // Bezpečnostní klíč, aby skript nespouštěl někdo cizí
    const secretKey = 'asociace2026';
    if (req.query.key !== secretKey) {
        return res.status(401).send("Neoprávněný přístup.");
    }

    const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

    // Pomocná funkce pro Supabase (místo cURL v PHP)
    async function supabaseRequest(method, endpoint, body = null) {
        const options = {
            method,
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
        };
        if (body) options.body = JSON.stringify(body);
        const r = await fetch(`${supabaseUrl}/rest/v1/${endpoint}`, options);
        return r.json();
    }

    // Pomocná funkce pro odeslání mailu přes tvé API
    async function sendMailAPI(to, subject, message) {
        await fetch('https://www.asociaceprsi.cz/api/mail', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, message })
        });
    }

    try {
        // 1. Zjistíme Fio token
        const settings = await supabaseRequest('GET', 'system_settings?id=eq.1&select=fio_token');
        const fioToken = settings && settings[0] ? settings[0].fio_token : null;
        if (!fioToken) throw new Error("Fio token nenalezen.");

        // 2. Stažení dat z banky
        const toDate = new Date().toISOString().split('T')[0];
        const fromDateObj = new Date();
        fromDateObj.setDate(fromDateObj.getDate() - 14);
        const fromDate = fromDateObj.toISOString().split('T')[0];
        
        const fioUrl = `https://www.fio.cz/ib_api/rest/periods/${encodeURIComponent(fioToken.trim())}/${fromDate}/${toDate}/transactions.json`;
        const fioRes = await fetch(fioUrl);
        const fioData = await fioRes.json();
        const transactions = fioData?.accountStatement?.transactionList?.transaction || [];

        // 3. Načtení registrací a profilů
        const regs = await supabaseRequest('GET', 'registrations?payment_status=eq.false&select=*,tournaments(title)');
        const profiles = await supabaseRequest('GET', 'profiles?select=player_id_card,email');

        const emailMap = {};
        if (Array.isArray(profiles)) {
            profiles.forEach(p => { if (p.email) emailMap[p.player_id_card] = p.email; });
        }

        const matchedRegIds = [];

        // 4. Automatické párování
        for (let t of transactions) {
            const castka = t.column1 ? parseFloat(t.column1.value) : 0;
            const vs = t.column5 ? String(t.column5.value).trim() : null;

            if (castka > 0 && vs) {
                for (let reg of regs) {
                    if (reg.player_id_card === vs && !matchedRegIds.includes(reg.id)) {
                        // Aktualizace v databázi
                        await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { payment_status: true });
                        matchedRegIds.push(reg.id);
                        
                        // Odeslání mailu o platbě
                        const email = emailMap[vs];
                        if (email) {
                            const tTitle = reg.tournaments?.title || 'Turnaj';
                            const msg = `Dobrý den,\n\npotvrzujeme, že Vaše platba za turnaj "${tTitle}" byla úspěšně zpracována a spárována.\n\nTěšíme se na Vás u stolu!\nČeská asociace v karetní hře prší z.s.`;
                            await sendMailAPI(email, `Potvrzení přijetí platby - ${tTitle}`, msg);
                        }
                        break;
                    }
                }
            }
        }

        // 5. Hlídání času (varování 48h a smazání 72h)
        const unpaidRegs = regs.filter(r => !matchedRegIds.includes(r.id));
        const now = Date.now();
        const limit48h = now - (48 * 60 * 60 * 1000);
        const limit72h = now - (72 * 60 * 60 * 1000);

        for (let reg of unpaidRegs) {
            const regTime = new Date(reg.created_at).getTime();
            const vs = reg.player_id_card;
            const email = emailMap[vs];
            const tTitle = reg.tournaments?.title || 'Turnaj';

            if (regTime < limit72h) {
                // SMAZAT A POSLAT STORNO
                await supabaseRequest('DELETE', `registrations?id=eq.${reg.id}`);
                if (email) {
                    const cancelMsg = `Dobrý den,\n\nVaše registrace na turnaj "${tTitle}" byla automaticky zrušena.\n\nDo 72 hodin jsme neobdrželi platbu startovného a Vaše místo tak muselo být uvolněno dalším zájemcům.\n\nPokud se chcete turnaje přesto zúčastnit, proveďte prosím novou registraci na webu a platbu obratem uhradte.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                    await sendMailAPI(email, `Storno registrace pro nezaplacení - ${tTitle}`, cancelMsg);
                }
            } else if (regTime < limit48h && !reg.warning_sent) {
                // POSLAT VAROVÁNÍ
                await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { warning_sent: true });
                if (email) {
                    const warnMsg = `Dobrý den,\n\nblíží se termín splatnosti Vašeho startovného na turnaj "${tTitle}".\n\nPokud nedojde k úhradě a spárování platby do 24 hodin, bude Vaše registrace systémem automaticky zrušena a místo přenecháno dalším zájemcům.\n\nPlatební údaje a rychlý QR kód k platbě naleznete po přihlášení na webu asociace v sekci Turnaje.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                    await sendMailAPI(email, "Upozornění: Blíží se storno registrace turnaje", warnMsg);
                }
            }
        }

        return res.status(200).send(`ÚDRŽBA DOKONČENA. Spárováno plateb: ${matchedRegIds.length}`);
    } catch (e) {
        return res.status(500).send(`CHYBA: ${e.message}`);
    }
}
