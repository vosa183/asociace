import { createClient } from '@supabase/supabase-js';

// Připojení do databáze
const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
// Zde je tvůj klíč pro bezpečný zápis na pozadí
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';
const db = createClient(supabaseUrl, supabaseKey);

// Funkce na ořezání háčků, čárek a zmenšení písma
function removeAccents(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export default async function handler(req, res) {
    // 1. Ochrana: Aby ti ten skript nespouštěl náhodný kolemjdoucí
    if (req.query.key !== 'moje-tajne-heslo-123') {
        return res.status(401).json({ success: false, message: 'Neoprávněný přístup' });
    }

    let log = [];
    try {
        // 2. Stažení Fio tokenu z databáze
        const { data: settings, error: settingsError } = await db.from('system_settings').select('fio_token').eq('id', 1).single();
        if (settingsError || !settings || !settings.fio_token) {
            throw new Error('Chybí nebo nelze načíst Fio token z databáze: ' + (settingsError?.message || ''));
        }

        // 3. Zjištění data (posledních 14 dní)
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 14);

        const fStr = fromDate.toISOString().split('T')[0];
        const tStr = toDate.toISOString().split('T')[0];

        // 4. Dotaz přímo na Fio banku
        const fioUrl = `https://www.fio.cz/ib_api/rest/periods/${settings.fio_token.trim()}/${fStr}/${tStr}/transactions.json`;
        const fioRes = await fetch(fioUrl);
        
        // OPRAVA BOTY S LIMITEM: Pokud Fio vrátí chybovou HTML stránku (dotaz pod 30s), nesmíme volat .json()
        const contentType = fioRes.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const rawErrorText = await fioRes.text();
            return res.status(200).json({ 
                success: false, 
                message: 'Fio banka nevrátila validní data. Pravděpodobně byl porušen limit 30 sekund mezi dotazy.',
                detail: rawErrorText.substring(0, 200)
            });
        }

        const fioData = await fioRes.json();
        if (fioData.error) throw new Error(fioData.error);
        
        const trans = fioData.accountStatement.transactionList.transaction || [];
        let matchedCount = 0;

        // 5. Zpracování transakcí (Tohle se ti na screenu useklo)
        for (const t of trans) {
            const castka = t.column1 ? parseFloat(t.column1.value) : 0;
            const vs = t.column5 ? String(t.column5.value).trim() : null;
            const zpravaOriginal = t.column16 ? String(t.column16.value).trim() : "";

            // TADY JE TVOJE TVRDÁ PODMÍNKA! 
            // - Musí to být příchozí platba (castka > 0)
            // - MUSÍ to mít VS (vs)
            // - MUSÍ to mít nějakou zprávu (zpravaOriginal !== "")
            if (castka > 0 && vs && zpravaOriginal !== "") {
                const zpravaOrezana = removeAccents(zpravaOriginal);

                // Zkusíme najít nezaplacené registrace k tomuto VS
                const { data: regs, error: regsError } = await db
                    .from('registrations')
                    .select('id, payment_status, player_id_card, tournaments(name)')
                    .eq('player_id_card', vs)
                    .eq('payment_status', false);

                if (!regsError && regs && regs.length > 0) {
                    for (const reg of regs) {
                        const turnajNazev = reg.tournaments?.name || "";
                        const turnajNazevOrezany = removeAccents(turnajNazev);

                        // KONTROLA 2: Shoduje se název turnaje se zprávou?
                        if (turnajNazevOrezany !== "" && zpravaOrezana.includes(turnajNazevOrezany)) {
                            
                            // PROŠLO VŠÍM - SPÁRUJEME!
                            const { error: updateError } = await db
                                .from('registrations')
                                .update({ payment_status: true })
                                .eq('id', reg.id);

                            if (!updateError) {
                                matchedCount++;
                                log.push(`[SPÁROVÁNO] VS: ${vs} | Částka: ${castka} Kč | Turnaj: ${turnajNazev}`);
                            } else {
                                log.push(`[CHYBA ZÁPISU] VS: ${vs} | Selhal zápis statusu platby: ${updateError.message}`);
                            }
                            
                            break; // Skočíme na další platbu z banky
                        }
                    }
                }
            } else if (castka > 0) {
                // Zapíšeme do logu, pokud platba přišla, ale chybělo VS nebo zpráva
                log.push(`[IGNOROVÁNO - NEKOMPLETNÍ ÚDAJE] Částka: ${castka} Kč | VS: ${vs || 'CHYBÍ'} | Zpráva: "${zpravaOriginal || 'CHYBÍ'}"`);
            }
        }

        return res.status(200).json({ success: true, processed: matchedCount, log: log });

    } catch (error) {
        // Vracíme status 200, aby cron-job.org nehlásil výpadek, když se jedná o dočasnou nedostupnost Fio API
        return res.status(200).json({ success: false, error: error.message, log: log });
    }
}
