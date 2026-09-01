// Zadávání výsledků stolu z webu. Hráč se prokáže SVOU kartičkou (QR) – z živého rozsazení
// se zjistí jeho stůl, ověří se, že u něj sedí, a zapíše se s auditem (kdo zadal). Přes service key.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Pouze POST' });
  const { mode, tournament_id, player_id_card, round, table, data } = req.body || {};
  if (!tournament_id || !player_id_card) return res.status(400).json({ error: 'Chybí data.' });

  const URL = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !SVC) return res.status(500).json({ error: 'Server není nakonfigurován.' });
  const h = { apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' };
  const vs = ('' + player_id_card).replace(/\D/g, '');
  if (!vs) return res.status(400).json({ error: 'Neplatné ID.' });

  // Živé rozsazení + aktuální kolo
  let seating = [], curRound = 1;
  try {
    const lr = await fetch(URL + '/rest/v1/live_state?tournament_id=eq.' + tournament_id + '&select=seating,current_round', { headers: h });
    const lj = await lr.json();
    if (lj && lj[0]) { seating = lj[0].seating || []; curRound = lj[0].current_round || 1; }
  } catch (e) {}

  const findMyTable = (card) => seating.find(t => (t.players || []).some(p => ('' + p.vs) === card));

  if (mode === 'table') {
    const t = findMyTable(vs);
    if (!t) return res.status(404).json({ error: 'Nesedíš u žádného stolu (možná ještě není rozlosováno).' });
    return res.status(200).json({ round: curRound, table: t.table, players: (t.players || []).map(p => ({ vs: p.vs, start: p.start, name: p.name })) });
  }

  if (mode === 'submit') {
    const t = seating.find(x => ('' + x.table) === ('' + table));
    if (!t) return res.status(400).json({ error: 'Stůl nenalezen.' });
    if (!(t.players || []).some(p => ('' + p.vs) === vs)) return res.status(403).json({ error: 'Nesedíš u tohoto stolu – zápis odmítnut.' });
    const arr = Array.isArray(data) ? data : [];
    const count = (t.players || []).length;
    const expected = count === 3 ? 72 : 80;
    const total = arr.reduce((s, x) => s + (parseInt(x.body, 10) || 0), 0);
    if (total !== expected) return res.status(400).json({ error: 'Nesedí celkový součet (' + total + ' místo ' + expected + ').' });
    const rr = await fetch(URL + '/rest/v1/table_results', { method: 'POST', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify({ tournament_id, round: round || curRound, table_num: ('' + table), entered_by: vs, data: arr }) });
    if (!rr.ok) { const e = await rr.text(); return res.status(500).json({ error: 'Zápis selhal: ' + e }); }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Neznámý mode.' });
}
