// Kvíz z webu: přihlášení hráče (QR kartička) a odpovědi. Zápis přes service key (DB zamčená).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Pouze POST' });
  const { mode, tournament_id, player_id_card, answer, reaction_ms, question_index } = req.body || {};
  if (!tournament_id || !player_id_card) return res.status(400).json({ error: 'Chybí data.' });

  const URL = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !SVC) return res.status(500).json({ error: 'Server není nakonfigurován.' });
  const h = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };
  const vs = ('' + player_id_card).replace(/\D/g, '');
  if (!vs) return res.status(400).json({ error: 'Neplatné ID.' });

  // --- Přihlášení do kvízu (po naskenování kartičky) ---
  if (mode === 'join') {
    let name = '';
    try { const pr = await fetch(URL + '/rest/v1/profiles?player_id_card=eq.' + vs + '&select=full_name', { headers: h }); const pj = await pr.json(); if (pj && pj[0]) name = pj[0].full_name || ''; } catch (e) {}
    if (!name) { try { const dr = await fetch(URL + '/rest/v1/player_database?player_id_card=eq.' + vs + '&select=full_name', { headers: h }); const dj = await dr.json(); if (dj && dj[0]) name = dj[0].full_name || ''; } catch (e) {} }
    if (!name) name = 'Hráč ' + vs;
    const rr = await fetch(URL + '/rest/v1/quiz_registrations?on_conflict=tournament_id,player_id_card', { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ tournament_id, player_id_card: vs, full_name: name }) });
    if (!rr.ok) { const e = await rr.text(); return res.status(500).json({ error: e }); }
    return res.status(200).json({ ok: true, name });
  }

  // --- Odpověď na otázku ---
  if (mode === 'answer') {
    if (question_index == null) return res.status(400).json({ error: 'Chybí otázka.' });
    // hráč musí být přihlášený do kvízu
    const cr = await fetch(URL + '/rest/v1/quiz_registrations?tournament_id=eq.' + tournament_id + '&player_id_card=eq.' + vs + '&select=player_id_card', { headers: h });
    const cj = await cr.json();
    if (!cj || !cj[0]) return res.status(403).json({ error: 'Nejsi přihlášený do kvízu.' });
    let rt = parseInt(reaction_ms, 10); if (!(rt >= 0)) rt = 999999; if (rt < 100) rt = 100; // anti-cheat: minimální reakce
    const ar = await fetch(URL + '/rest/v1/quiz_answers?on_conflict=tournament_id,question_index,player_id_card', { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ tournament_id, question_index, player_id_card: vs, answer: ('' + (answer ?? '')), reaction_ms: rt }) });
    if (!ar.ok) { const e = await ar.text(); return res.status(500).json({ error: e }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Neznámý mode.' });
}
