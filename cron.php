export default async function handler(req, res) {
    // Bezpečnostní klíč proti neoprávněnému spuštění
    if (req.query.key !== 'asociace2026') {
        return res.status(401).send("Neoprávněný přístup.");
    }

    const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

    // PŘIDÁNO: Funkce pro odstranění diakritiky (háčků a čárek)
    function removeAccents(str) {
        if (!str) return "";
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    }

    // Pomocná funkce pro požadavky na Supabase
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
        try {
            await fetch('https://www.asociaceprsi.cz/api/mail', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, subject, message })
            });
        } catch (e) {
            console.error("Chyba odesílání mailu:", e.message);
        }
    }

    try {
        // 1. ZÍSKÁNÍ TOKENU ZE SPRÁVNÉ TABULKY
        const settings = await supabaseRequest('GET', 'system_settings?id=eq.1&select=fio_token');
        const fioToken = settings && settings[0] ? settings[0].fio_token : null;
        
        if (!fioToken) {
            throw new Error("Fio token nebyl v tabulce system_settings nalezen.");
        }

        // 2. Stažení dat z banky
        const toDate = new Date().toISOString().split('T')[0];
        const fromDateObj = new Date();
        fromDateObj.setDate(fromDateObj.getDate() - 14);
        const fromDate = fromDateObj.toISOString().split('T')[0];
        
        const cleanToken = fioToken.trim();
        const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(cleanToken)}/${fromDate}/${toDate}/transactions.json`;
        
        const fioRes = await fetch(fioUrl, { method: 'GET', headers: { 'Accept': 'application/json' }});

        if (!fioRes.ok) {
            throw new Error(`Fio API vrátilo chybu HTTP ${fioRes.status}. (Pravděpodobně porušeno pravidlo 30 sekund)`);
        }

        const fioData = await fioRes.json();
        const transactions = fioData?.accountStatement?.transactionList?.transaction || [];

        // 3. Načtení dat ze Supabase
        const regs = await supabaseRequest('GET', 'registrations?payment_status=eq.false&select=*,tournaments(title)');
        if (!Array.isArray(regs)) throw new Error("Chyba čtení registrací z databáze.");
        
        const profiles = await supabaseRequest('GET', 'profiles?select=player_id_card,email');
        const emailMap = {};
        if (Array.isArray(profiles)) {
            profiles.forEach(p => { if (p.email) emailMap[p.player_id_card] = p.email; });
        }

        let matchedCount = 0;
        const matchedRegIds = [];

        // 4. PŘÍSNÉ, ALE CHYTRÉ PÁROVÁNÍ
        for (let t of transactions) {
            const castka = t.column1 ? parseFloat(t.column1.value) : 0;
            const vs = t.column5 ? String(t.column5.value).trim().toLowerCase() : '';
            
            // Ořežeme zprávu z banky o háčky a čárky
            const zpravaOriginal = t.column16 ? String(t.column16.value) : '';
            const zprava = removeAccents(zpravaOriginal);

            // Obě pole (VS i zpráva) musí být v bance vyplněna
            if (castka > 0 && vs !== '' && zprava !== '') {
                for (let reg of regs) {
                    const hracId = String(reg.player_id_card).trim().toLowerCase();
                    
                    // Ořežeme název turnaje z DB o háčky a čárky
                    const nazevTurnaje = removeAccents(reg.tournaments?.title);

                    if (nazevTurnaje === '') continue; // Pojistka proti prázdnému názvu

                    // CHYTRÁ KONTROLA:
                    // Zpráva obsahuje název turnaje NEBO název turnaje obsahuje zprávu (a zpráva je delší než 3 znaky)
                    const isMessageMatching = zprava.includes(nazevTurnaje) || (zprava.length > 3 && nazevTurnaje.includes(zprava));

                    if (vs === hracId && isMessageMatching && !matchedRegIds.includes(reg.id)) {
                        
                        // Zápis zaplacení do databáze
                        await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { payment_status: true });
                        matchedRegIds.push(reg.id);
                        matchedCount++;
                        
                        // Odeslání e-mailu s potvrzením
                        const email = emailMap[reg.player_id_card];
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

        // 5. HLÍDÁNÍ ČASU (Varování po 48h a smazání po 72h)
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
                // SMAZÁNÍ + E-MAIL O STORNU
                await supabaseRequest('DELETE', `registrations?id=eq.${reg.id}`);
                if (email) {
                    const cancelMsg = `Dobrý den,\n\nVaše registrace na turnaj "${tTitle}" byla automaticky zrušena.\n\nDo 72 hodin jsme neobdrželi platbu startovného a Vaše místo tak muselo být uvolněno dalším zájemcům.\n\nPokud se chcete turnaje přesto zúčastnit, proveďte prosím novou registraci na webu a platbu obratem uhradte.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                    await sendMailAPI(email, `Storno registrace pro nezaplacení - ${tTitle}`, cancelMsg);
                }
            } else if (regTime < limit48h && !reg.warning_sent) {
                // ZÁPIS VAROVÁNÍ + E-MAIL (UPOZORNĚNÍ)
                await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { warning_sent: true });
                if (email) {
                    const warnMsg = `Dobrý den,\n\nblíží se termín splatnosti Vašeho startovného na turnaj "${tTitle}".\n\nPokud nedojde k úhradě a spárování platby do 24 hodin, bude Vaše registrace systémem automaticky zrušena a místo přenecháno dalším zájemcům.\n\nPlatební údaje a rychlý QR kód k platbě naleznete po přihlášení na webu asociace v sekci Turnaje.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                    await sendMailAPI(email, "Upozornění: Blíží se storno registrace turnaje", warnMsg);
                }
            }
        }

        return res.status(200).send(`ÚDRŽBA DOKONČENA. Spárováno nových plateb: ${matchedCount}`);
    } catch (e) {
        console.error("Chyba automatu:", e);
        return res.status(500).send(`CHYBA AUTOMATU: ${e.message}`);
    }
}
