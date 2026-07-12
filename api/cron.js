export default async function handler(req, res) {
    // Bezpečnostní klíč proti neoprávněnému spuštění
    if (req.query.key !== 'asociace2026') {
        return res.status(401).send("Neoprávněný přístup.");
    }

    const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

    // FUNKCE NA ODSTRANĚNÍ HÁČKŮ, ČÁREK, INTERPUNKCE A VÍCENÁSOBNÝCH MEZER
    // (řeší např. "1 rocnik" vs "1. rocnik" - chybějící tečka dřív rozbila celé párování)
    function normalizeForMatch(str) {
        if (!str) return "";
        return str
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")   // diakritika (háčky, čárky)
            .toLowerCase()
            .replace(/[.,;:!?"'`]/g, "")       // interpunkce
            .replace(/\s+/g, " ")              // více mezer -> jedna
            .trim();
    }

    // Levenshteinova vzdálenost - kolik znaků se musí změnit, aby byly dva řetězce stejné
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
            }
        }
        return dp[m][n];
    }

    // Fuzzy "obsahuje" - v haystack hledá okno podobně dlouhé jako needle (název turnaje),
    // které se od něj liší nejvýš o pár znaků (překlep, chybějící/přebývající písmeno).
    // Tolerance je omezená (max 4 znaky), takže se to nikdy nespáruje s úplně jiným turnajem.
    function fuzzyIncludes(haystack, needle, maxErrorRate = 0.15, minTolerance = 1, maxTolerance = 4) {
        if (!needle) return false;
        const nLen = needle.length;
        const maxDist = Math.min(maxTolerance, Math.max(minTolerance, Math.round(nLen * maxErrorRate)));

        if (haystack.length < nLen - maxDist) return false;

        for (let start = 0; start <= haystack.length - (nLen - maxDist); start++) {
            for (let winLen = nLen - maxDist; winLen <= nLen + maxDist; winLen++) {
                if (winLen <= 0 || start + winLen > haystack.length) continue;
                const window = haystack.substring(start, start + winLen);
                if (levenshtein(window, needle) <= maxDist) return true;
            }
        }
        return false;
    }

    // Vrátí pole samostatných čísel obsažených ve zprávě (např. "startovne 123" -> ["123"]).
    // Používá se pro párování podle ID-T: číslo turnaje musí být ve zprávě jako CELÉ samostatné
    // číslo, ne jen jako podřetězec jiného čísla (fuzzy/Levenshtein na krátká čísla je nebezpečný -
    // "123" by se snadno spletlo s "124" nebo "12"), proto se zde záměrně NEPOUŽÍVÁ tolerance na překlep.
    function extractDigitTokens(str) {
        if (!str) return [];
        return str.match(/\d+/g) || [];
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
            const r = await fetch('https://www.asociaceprsi.cz/api/mail', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, subject, message })
            });
            if (!r.ok) {
                const errBody = await r.text().catch(() => '');
                console.error(`Chyba odesílání mailu (${to}): HTTP ${r.status} - ${errBody}`);
                return false;
            }
            return true;
        } catch (e) {
            console.error(`Chyba odesílání mailu (${to}):`, e.message);
            return false;
        }
    }

    let fioSkipped = false;
    let transactions = [];

    try {
        // 1. ZÍSKÁNÍ TOKENU ZE SPRÁVNÉ TABULKY
        const settings = await supabaseRequest('GET', 'system_settings?id=eq.1&select=fio_token,fio_last_call_at');
        const fioToken = settings && settings[0] ? settings[0].fio_token : null;
        
        if (!fioToken) {
            throw new Error("Fio token nebyl v tabulce system_settings nalezen.");
        }

        // Sdílené hlídání pravidla 30 s se stránkou banka.html (api/fio.js). Cron neumí (a
        // nemá) čekat desítky vteřin uvnitř jednoho běhu - je jednodušší a bezpečnější párování
        // plateb pro TENTO běh přeskočit (proběhne příští hodinu) a rovnou pokračovat na
        // upomínky/storna, která žádná data z Fio nepotřebují.
        const lastCallStr = settings && settings[0] ? settings[0].fio_last_call_at : null;
        if (lastCallStr && (Date.now() - new Date(lastCallStr).getTime()) / 1000 < 32) {
            fioSkipped = true;
        } else {
            await supabaseRequest('PATCH', 'system_settings?id=eq.1', { fio_last_call_at: new Date().toISOString() });

            // 2. Stažení dat z banky
            const toDate = new Date().toISOString().split('T')[0];
            const fromDateObj = new Date();
            fromDateObj.setDate(fromDateObj.getDate() - 14);
            const fromDate = fromDateObj.toISOString().split('T')[0];
            
            const cleanToken = fioToken.trim();
            const fioUrl = `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(cleanToken)}/${fromDate}/${toDate}/transactions.json`;
            
            const fioController = new AbortController();
            const fioTimeout = setTimeout(() => fioController.abort(), 25000);
            let fioRes;
            try {
                fioRes = await fetch(fioUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, signal: fioController.signal });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    throw new Error("Fio API neodpovědělo do 25 sekund (pravidlo 30 s jsme už ošetřili výše, takže o to tentokrát nejde - Fio momentálně nereaguje).");
                }
                throw fetchErr;
            } finally {
                clearTimeout(fioTimeout);
            }

            if (!fioRes.ok) {
                throw new Error(`Fio API vrátilo chybu HTTP ${fioRes.status}.`);
            }

            const fioData = await fioRes.json();
            transactions = fioData?.accountStatement?.transactionList?.transaction || [];
        }

        // 3. Načtení dat ze Supabase (proběhne vždy - upomínky/storna Fio data nepotřebují;
        // pokud bylo párování plateb výše přeskočeno kvůli pravidlu 30 s, transactions je
        // prázdné pole a párování níže prostě nic nenajde, žádná chyba z toho nevznikne)
        // POZN.: is_substitute se natahuje rovnou, aby šlo náhradníky vyfiltrovat z párování
        // plateb a z 48h/72h připomínkového cyklu - náhradníci zatím nic platit nemají.
        const regs = await supabaseRequest('GET', 'registrations?payment_status=eq.false&select=*,tournaments(title,ID_T,capacity)');
        if (!Array.isArray(regs)) throw new Error("Chyba čtení registrací z databáze.");
        
        const profiles = await supabaseRequest('GET', 'profiles?select=player_id_card,email');
        const emailMap = {};
        if (Array.isArray(profiles)) {
            profiles.forEach(p => { if (p.email) emailMap[p.player_id_card] = p.email; });
        }

        // Náhradníci (waitlist) se do párování plateb ani do 48h/72h cyklu vůbec nezapojují.
        const payableRegs = regs.filter(r => !r.is_substitute);

        let matchedCount = 0;
        let mailFailCount = 0;
        const matchedRegIds = [];

        // 4. PÁROVÁNÍ (rychlá část, jen v paměti - žádné síťové volání, aby se to nezdržovalo):
        // VS musí sedět přesně (je to číslo, tolerance by mohla spárovat cizí platbu jinému
        // hráči). Zpráva pro příjemce se páruje primárně podle ID-T turnaje - musí se ve zprávě
        // objevit jako CELÉ samostatné číslo (žádná tolerance na překlep - u krátkých čísel by
        // fuzzy porovnání snadno spárovalo platbu k jinému turnaji). Pokud turnaj ještě nemá
        // přidělené ID-T (starší turnaje založené před zavedením ID-T), použije se jako záloha
        // původní porovnání podle názvu turnaje s tolerancí na drobný překlep.
        const matches = []; // { reg, tTitle }
        for (let t of transactions) {
            const castka = t.column1 ? parseFloat(t.column1.value) : 0;
            const vs = t.column5 ? String(t.column5.value).trim().toLowerCase() : '';
            const zpravaPuvodni = t.column16 ? String(t.column16.value) : '';
            const zpravaNorm = normalizeForMatch(zpravaPuvodni);

            if (castka > 0 && vs !== '' && zpravaNorm !== '') {
                for (let reg of payableRegs) {
                    const hracId = String(reg.player_id_card).trim().toLowerCase();
                    const idT = reg.tournaments?.ID_T ? String(reg.tournaments.ID_T).trim() : '';
                    const nazevTurnajePuvodni = String(reg.tournaments?.title || '');
                    const nazevTurnajeNorm = normalizeForMatch(nazevTurnajePuvodni);

                    let zpravaSedi = false;
                    if (idT !== '') {
                        const cislaVeZprave = extractDigitTokens(zpravaNorm);
                        zpravaSedi = cislaVeZprave.includes(idT);
                    } else if (nazevTurnajeNorm !== '') {
                        zpravaSedi = zpravaNorm.includes(nazevTurnajeNorm) || fuzzyIncludes(zpravaNorm, nazevTurnajeNorm);
                    }

                    if (vs === hracId && zpravaSedi && !matchedRegIds.includes(reg.id)) {
                        matchedRegIds.push(reg.id);
                        matches.push(reg);
                        break;
                    }
                }
            }
        }

        // Síťová část (zápis do DB + e-maily) se teď spustí PRO VŠECHNY nálezy najednou
        // paralelně, místo aby čekala na každý jednotlivě - to je to, co dřív nejvíc
        // natahovalo dobu běhu a padalo to na timeoutu.
        await Promise.all(matches.map(async (reg) => {
            await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { payment_status: true });
            matchedCount++;

            const email = emailMap[reg.player_id_card];
            if (email) {
                const tTitle = reg.tournaments?.title || 'Turnaj';
                const msg = `Dobrý den,\n\npotvrzujeme, že Vaše platba za turnaj "${tTitle}" byla úspěšně zpracována a spárována.\n\nTěšíme se na Vás u stolu!\nČeská asociace v karetní hře prší z.s.`;
                const mailOk = await sendMailAPI(email, `Potvrzení přijetí platby - ${tTitle}`, msg);
                if (!mailOk) mailFailCount++;
            } else {
                console.error(`Platba spárována (reg ${reg.id}, hráč ${reg.player_id_card}), ale v profilu chybí e-mail - potvrzovací mail neodeslán.`);
                mailFailCount++;
            }
        }));

        // 5. HLÍDÁNÍ ČASU (Varování po 48h a smazání po 72h) - týká se jen skutečných
        // (neplacených) registrací, náhradníci (is_substitute) se sem vůbec nedostanou,
        // protože pro ně žádná platba zatím není vyžadována.
        const unpaidRegs = payableRegs.filter(r => !matchedRegIds.includes(r.id));
        const now = Date.now();
        const limit48h = now - (48 * 60 * 60 * 1000);
        const limit72h = now - (72 * 60 * 60 * 1000);

        const toDelete = unpaidRegs.filter(r => new Date(r.created_at).getTime() < limit72h);
        const toWarn = unpaidRegs.filter(r => {
            const t = new Date(r.created_at).getTime();
            return t >= limit72h && t < limit48h && !r.warning_sent;
        });

        // Zápisy do DB + e-maily se opět odpalují paralelně, ne jeden po druhém.
        await Promise.all(toDelete.map(async (reg) => {
            const email = emailMap[reg.player_id_card];
            const tTitle = reg.tournaments?.title || 'Turnaj';
            await supabaseRequest('DELETE', `registrations?id=eq.${reg.id}`);
            if (email) {
                const cancelMsg = `Dobrý den,\n\nVaše registrace na turnaj "${tTitle}" byla automaticky zrušena.\n\nDo 72 hodin jsme neobdrželi platbu startovného a Vaše místo tak muselo být uvolněno dalším zájemcům.\n\nPokud se chcete turnaje přesto zúčastnit, proveďte prosím novou registraci na webu a platbu obratem uhradte.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                await sendMailAPI(email, `Storno registrace pro nezaplacení - ${tTitle}`, cancelMsg);
            }
        }));

        await Promise.all(toWarn.map(async (reg) => {
            const email = emailMap[reg.player_id_card];
            const tTitle = reg.tournaments?.title || 'Turnaj';
            await supabaseRequest('PATCH', `registrations?id=eq.${reg.id}`, { warning_sent: true });
            if (email) {
                const warnMsg = `Dobrý den,\n\nblíží se termín splatnosti Vašeho startovného na turnaj "${tTitle}".\n\nPokud nedojde k úhradě a spárování platby do 24 hodin, bude Vaše registrace systémem automaticky zrušena a místo přenecháno dalším zájemcům.\n\nPlatební údaje a rychlý QR kód k platbě naleznete po přihlášení na webu asociace v sekci Turnaje.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.`;
                await sendMailAPI(email, "Upozornění: Blíží se storno registrace turnaje", warnMsg);
            }
        }));

        // 6. Náhradníci (waitlist): pro každý turnaj, kde smazáním neplatiče vzniklo volné
        // místo, rozešleme e-mail všem, kdo jsou na něj zapsaní jako náhradník.
        let waitlistNotified = 0;
        const affectedTournamentIds = [...new Set(toDelete.map(r => r.tournament_id))];
        for (const tId of affectedTournamentIds) {
            const freedTitle = toDelete.find(r => r.tournament_id === tId)?.tournaments?.title || 'Turnaj';
            const capacity = toDelete.find(r => r.tournament_id === tId)?.tournaments?.capacity || 0;

            const currentActive = await supabaseRequest('GET', `registrations?tournament_id=eq.${tId}&is_substitute=eq.false&select=id`);
            const activeCount = Array.isArray(currentActive) ? currentActive.length : 0;
            if (capacity > 0 && activeCount >= capacity) continue; // mezitím se místo zase zaplnilo

            const substitutes = await supabaseRequest('GET', `registrations?tournament_id=eq.${tId}&is_substitute=eq.true&select=player_id_card`);
            if (!Array.isArray(substitutes) || substitutes.length === 0) continue;

            const subject = `📢 Uvolnilo se místo na turnaji "${freedTitle}"!`;
            const body = `Dobrý den,\n\nna turnaji "${freedTitle}", na který jste zapsán/a jako náhradník, se uvolnilo místo.\n\nOzvěte se prosím co nejdříve asociaci (odpovědí na tento e-mail nebo přes web), ať Vás můžeme přepsat mezi řádné účastníky - místo je volné jen do doby, než ho obsadí jiný zájemce.\n\nČeská asociace v karetní hře prší z.s.`;

            await Promise.all(substitutes.map(async (s) => {
                const email = emailMap[s.player_id_card];
                if (email) { await sendMailAPI(email, subject, body); waitlistNotified++; }
            }));
        }

        return res.status(200).send(`ÚDRŽBA DOKONČENA. ${fioSkipped ? 'Párování plateb PŘESKOČENO (Fio byla nedávno dotázána - proběhne příští běh). ' : ''}Spárováno nových plateb: ${matchedCount}. Neodeslané potvrzovací e-maily: ${mailFailCount}. Upozorněno náhradníků: ${waitlistNotified}.`);
    } catch (e) {
        console.error("Chyba automatu:", e);
        return res.status(500).send(`CHYBA AUTOMATU: ${e.message}`);
    }
}
