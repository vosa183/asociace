// Postupně, v malých bezpečných dávkách, vyprazdňuje frontu hromadných mailů (mail_queue).
// Volat opakovaně po pár minutách (externí scheduler jako cron-job.org - Vercel Hobby cron
// v souboru vercel.json umí jen 1x denně, což by na frontu tisíců mailů nestačilo).
//
// Nastavení externího scheduleru:
//   URL:      https://www.asociaceprsi.cz/api/process-mail-queue?key=asociace2026
//   Interval: každých 10 minut (nenastavuj častěji - viz BATCH_SIZE níže)

const BATCH_SIZE = 15;       // kolik mailů se pošle za jedno spuštění
const DELAY_MS = 2500;       // pauza mezi jednotlivými maily uvnitř dávky (ms)

export default async function handler(req, res) {
    if (req.query.key !== 'asociace2026') {
        return res.status(401).send("Neoprávněný přístup.");
    }

    const supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

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

    async function sendMailAPI(to, subject, message) {
        try {
            const r = await fetch('https://www.asociaceprsi.cz/api/mail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, subject, message })
            });
            return r.ok;
        } catch (e) {
            console.error(`Chyba odesílání mailu (${to}):`, e.message);
            return false;
        }
    }

    try {
        // 1. Vezmeme malou dávku čekajících mailů (nejstarší první)
        const pending = await supabaseRequest(
            'GET',
            `mail_queue?status=eq.pending&select=*&order=created_at.asc&limit=${BATCH_SIZE}`
        );
        if (!Array.isArray(pending)) throw new Error("Chyba čtení fronty z databáze.");

        if (pending.length === 0) {
            return res.status(200).send("Fronta je prázdná, nic k odeslání.");
        }

        // 2. Hned si je označíme jako 'sending', ať je nesebere souběžné spuštění (pojistka
        // proti překryvu, kdyby scheduler dvakrát spustil endpoint těsně po sobě).
        const ids = pending.map(p => p.id);
        await supabaseRequest('PATCH', `mail_queue?id=in.(${ids.join(',')})`, { status: 'sending' });

        // 3. Pošleme je jeden po druhém s pauzou - žádné paralelní dávky, tohle běží
        // samo o sobě už jako malá dávka v rámci celé fronty.
        let sent = 0, failed = 0;
        for (const item of pending) {
            const ok = await sendMailAPI(item.to_email, item.subject, item.body);
            if (ok) {
                await supabaseRequest('PATCH', `mail_queue?id=eq.${item.id}`, { status: 'sent', sent_at: new Date().toISOString() });
                sent++;
            } else {
                await supabaseRequest('PATCH', `mail_queue?id=eq.${item.id}`, { status: 'failed', error: 'Odeslání selhalo (viz api/mail logy)' });
                failed++;
            }
            await new Promise(r => setTimeout(r, DELAY_MS));
        }

        const remaining = await supabaseRequest('GET', 'mail_queue?status=eq.pending&select=id');
        const remainingCount = Array.isArray(remaining) ? remaining.length : '?';

        return res.status(200).send(`Dávka zpracována. Odesláno: ${sent}. Chyba: ${failed}. Zbývá ve frontě: ${remainingCount}.`);
    } catch (e) {
        console.error("Chyba zpracování fronty mailů:", e);
        return res.status(500).send(`CHYBA: ${e.message}`);
    }
}
