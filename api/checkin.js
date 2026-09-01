// Check-in příchozích z webu. Zápis dělá jen tato funkce přes service key (DB zůstává zamčená).
// Ověřuje, že volající je přihlášený organizátor s rolí zc / zcp / superadmin.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Pouze POST' });

  const { mode, tournament_id, player_id_card, amount_paid, method, organizer_token } = req.body || {};
  if (!tournament_id || !player_id_card) return res.status(400).json({ error: 'Chybí data (turnaj / hráč).' });

  const URL = process.env.SUPABASE_URL;
  const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.SUPABASE_ANON_KEY || SVC;
  if (!URL || !SVC) return res.status(500).json({ error: 'Server není nakonfigurován (chybí Supabase klíče).' });

  const svcHeaders = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };

  // --- Ověření volajícího přes jeho přihlašovací token ---
  let role = null, byName = '', callerId = null;
  try {
    if (organizer_token) {
      const ur = await fetch(URL + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + organizer_token } });
      if (ur.ok) {
        const u = await ur.json();
        callerId = u.id;
        const pr = await fetch(URL + '/rest/v1/profiles?id=eq.' + u.id + '&select=role,full_name', { headers: svcHeaders });
        const pj = await pr.json();
        if (pj && pj[0]) { role = pj[0].role; byName = pj[0].full_name || ''; }
      }
    }
  } catch (e) {}
  if (!callerId) return res.status(403).json({ error: 'Nejsi přihlášen. Přihlas se na webu.' });

  // Přístup: buď jsi přiřazený POŘADATEL tohoto turnaje, nebo jsi superadmin.
  let organizerId = null;
  try {
    const lr = await fetch(URL + '/rest/v1/live_state?tournament_id=eq.' + tournament_id + '&select=organizer_id', { headers: svcHeaders });
    const lj = await lr.json(); if (lj && lj[0]) organizerId = lj[0].organizer_id;
  } catch (e) {}
  const allowed = (role === 'superadmin') || (organizerId && organizerId === callerId);
  if (!allowed) {
    return res.status(403).json({ error: 'Nejsi přiřazený pořadatel tohoto turnaje.' });
  }

  const vs = ('' + player_id_card).replace(/\D/g, '');

  // --- Vyhledání hráče (jméno + platba) ---
  if (mode === 'lookup') {
    let name = '', paid = false, fee = 100, registered = false;
    try {
      const rr = await fetch(URL + '/rest/v1/registrations?tournament_id=eq.' + tournament_id + '&player_id_card=eq.' + vs + '&select=payment_status', { headers: svcHeaders });
      const rj = await rr.json(); if (rj && rj[0]) { registered = true; paid = !!rj[0].payment_status; }
      const pr = await fetch(URL + '/rest/v1/profiles?player_id_card=eq.' + vs + '&select=full_name', { headers: svcHeaders });
      const pj = await pr.json(); if (pj && pj[0] && pj[0].full_name) name = pj[0].full_name;
      if (!name) {
        const dr = await fetch(URL + '/rest/v1/player_database?player_id_card=eq.' + vs + '&select=full_name', { headers: svcHeaders });
        const dj = await dr.json(); if (dj && dj[0] && dj[0].full_name) name = dj[0].full_name;
      }
      const tr = await fetch(URL + '/rest/v1/tournaments?id=eq.' + tournament_id + '&select=fee', { headers: svcHeaders });
      const tj = await tr.json(); if (tj && tj[0] && tj[0].fee != null) fee = tj[0].fee;
    } catch (e) { return res.status(500).json({ error: 'Chyba vyhledání: ' + e.message }); }
    return res.status(200).json({ found: registered || !!name, name: name || ('Hráč ' + vs), paid, fee, registered });
  }

  // --- Zápis odbavení (check-in) ---
  if (mode === 'commit') {
    try {
      const cr = await fetch(URL + '/rest/v1/checkins', {
        method: 'POST',
        headers: { ...svcHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ tournament_id, player_id_card: vs, scanned_by: byName || role, amount_paid: amount_paid || 0, method: method || 'card' })
      });
      if (!cr.ok) { const e = await cr.text(); return res.status(500).json({ error: 'Zápis selhal: ' + e }); }
      return res.status(200).json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Chyba zápisu: ' + e.message }); }
  }

  return res.status(400).json({ error: 'Neznámý mode.' });
}
