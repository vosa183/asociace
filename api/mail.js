import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  // Ochrana - přijímáme pouze příkazy k odeslání (POST)
  if (req.method !== 'POST') {
    return res.status(405).send('Pouze metoda POST');
  }
  
  // Přijmeme od našeho webu komu to letí, předmět a samotný text
  const { to, subject, message } = req.body;

  // Vercel si tajně vytáhne údaje z Environment Variables (trezoru)
  const user = process.env.EMAIL_UZIVATEL; 
  const pass = process.env.EMAIL_HESLO;
  const host = process.env.SMTP_HOST; 
  const port = process.env.SMTP_PORT || 465;

  // Nastavení odesílacího serveru
  const transporter = nodemailer.createTransport({
    host: host, 
    port: port,
    secure: port == 465, // true pro port 465, jinak false
    auth: {
      user: user,
      pass: pass,
    },
  });

  try {
    // Fyzické odeslání e-mailu
    await transporter.sendMail({
      from: `"Česká asociace prší" <${user}>`, // Aby to vypadalo hezky v hlavičce
      to: to, // Sem se vloží ten e-mail hráče/diskutujících, který nám pošle náš web
      subject: subject,
      text: message,
    });
    
    // Potvrzení pro náš web, že e-mail úspěšně odešel
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Chyba odeslání e-mailu ze serveru:', error);
    res.status(500).json({ error: 'Chyba odeslání e-mailu ze serveru' });
  }
}
