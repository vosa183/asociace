export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Pouze metoda POST');
  }
  
  const { subject, message } = req.body;
  // Tento klíč si nastavíš v administraci Vercelu v sekci Environment Variables
  const SECRET_URL = process.env.TAJNA_ADRESA_PRO_MAIL; 

  try {
    await fetch(SECRET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: subject, message: message })
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Chyba odeslání' });
  }
}
