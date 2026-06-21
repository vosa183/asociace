<?php
// Zobrazení chyb pro případnou diagnostiku
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Zabezpečení proti tomu, aby ti to spouštěl někdo cizí
$secretKey = 'asociace2026'; 

if (!isset($_GET['key']) || $_GET['key'] !== $secretKey) {
    die("Neopravneny pristup. Chybi nebo je spatny bezpecnostni klic.");
}

echo "CRON spuštěn...<br>\n";

// Základní nastavení Supabase
$supabaseUrl = 'https://gqciprgrzdpckhhqcsjx.supabase.co';
// Tady používáme tvůj public klíč. (Předpokladem je, že tabulka registrations má vypnuté RLS, jak jsme to dělali u banka.html)
$supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxY2lwcmdyemRwY2toaHFjc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk4MDksImV4cCI6MjA5MTU3NTgwOX0.6ptq3mzu-RmWn2pKJFDY7Wk3syckQObPFjEfYRgEK-k';

// Pomocná funkce pro dotazy do Supabase
function supabaseRequest($method, $endpoint, $data = null) {
    global $supabaseUrl, $supabaseKey;
    $url = $supabaseUrl . '/rest/v1/' . $endpoint;
    
    $headers = [
        "apikey: $supabaseKey",
        "Authorization: Bearer $supabaseKey",
        "Content-Type: application/json",
        "Prefer: return=representation"
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    if ($data) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }

    $response = curl_exec($ch);
    curl_close($ch);
    return json_decode($response, true);
}

// Pomocná funkce pro odeslání e-mailu přes tvoje API
function sendMailAPI($to, $subject, $message) {
    $ch = curl_init('https://www.asociaceprsi.cz/api/mail');
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'to' => $to,
        'subject' => $subject,
        'message' => $message
    ]));
    curl_exec($ch);
    curl_close($ch);
}

// --- 1. ZÍSKÁNÍ FIO TOKENU ZE SUPABASE ---
$settings = supabaseRequest('GET', 'system_settings?id=eq.1&select=fio_token');
$fioToken = $settings[0]['fio_token'] ?? null;

if (!$fioToken) {
    die("Fio token nebyl v databazi nalezen.");
}

// --- 2. STAŽENÍ DAT Z FIO BANKY ---
$toDate = date('Y-m-d');
$fromDate = date('Y-m-d', strtotime('-14 days'));
$fioUrl = "https://www.fio.cz/ib_api/rest/periods/" . urlencode(trim($fioToken)) . "/$fromDate/$toDate/transactions.json";

$ch = curl_init($fioUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$fioResponse = curl_exec($ch);
curl_close($ch);

$fioData = json_decode($fioResponse, true);
$transactions = $fioData['accountStatement']['transactionList']['transaction'] ?? [];

echo "Z banky staženo " . count($transactions) . " transakcí.<br>\n";

// --- 3. NAČTENÍ NEZAPLACENÝCH REGISTRACÍ A PROFILŮ ---
$regs = supabaseRequest('GET', 'registrations?payment_status=eq.false&select=*,tournaments(title)');
$profiles = supabaseRequest('GET', 'profiles?select=player_id_card,email');

if (!is_array($regs)) {
    die("Chyba při stahování registrací ze Supabase. Zkontrolujte RLS pravidla.");
}

// Vytvoříme si jednoduchou mapu e-mailů podle SPZ (player_id_card)
$emailMap = [];
if (is_array($profiles)) {
    foreach ($profiles as $p) {
        if (!empty($p['email'])) {
            $emailMap[$p['player_id_card']] = $p['email'];
        }
    }
}

// --- 4. AUTOMATICKÉ PÁROVÁNÍ PLATEB ---
$matchedRegIds = [];
foreach ($transactions as $t) {
    $castka = isset($t['column1']) ? (float)$t['column1']['value'] : 0;
    $vs = isset($t['column5']) ? trim((string)$t['column5']['value']) : null;

    if ($castka > 0 && $vs) {
        foreach ($regs as $reg) {
            // Pokud najdeme shodu VS s hráčskou značkou a ještě jsme ho v tomto běhu neoznačili
            if ($reg['player_id_card'] === $vs && !in_array($reg['id'], $matchedRegIds)) {
                echo "-> Páruji úspěšně platbu pro značku: $vs<br>\n";
                
                // Označíme jako zaplacené v DB
                supabaseRequest('PATCH', 'registrations?id=eq.'.$reg['id'], ['payment_status' => true]);
                $matchedRegIds[] = $reg['id'];
                
                // Pošleme uvítací e-mail
                if (isset($emailMap[$vs])) {
                    $email = $emailMap[$vs];
                    $tTitle = $reg['tournaments']['title'] ?? 'Turnaj';
                    $msg = "Dobrý den,\n\npotvrzujeme, že Vaše platba za turnaj \"$tTitle\" byla úspěšně zpracována a spárována.\n\nTěšíme se na Vás u stolu!\nČeská asociace v karetní hře prší z.s.";
                    sendMailAPI($email, "Potvrzení přijetí platby - $tTitle", $msg);
                }
                break; // Vyskakujeme z vnitřního cyklu, jdeme na další transakci
            }
        }
    }
}

// Odstraníme z pole těch, co nezaplatili, ty, co jsme právě spárovali
$unpaidRegs = array_filter($regs, function($r) use ($matchedRegIds) {
    return !in_array($r['id'], $matchedRegIds);
});

// --- 5. KONTROLA ČASU (VYŠKRTÁVÁNÍ A VAROVÁNÍ) ---
$now = time();
$timeLimit48h = strtotime('-48 hours', $now);
$timeLimit72h = strtotime('-72 hours', $now);

foreach ($unpaidRegs as $reg) {
    $regTime = strtotime($reg['created_at']);
    $vs = $reg['player_id_card'];
    $email = $emailMap[$vs] ?? null;
    $tTitle = $reg['tournaments']['title'] ?? 'Turnaj';

    if ($regTime < $timeLimit72h) {
        // A. PŘESÁHLO 72 HODIN -> TVRDÉ SMAZÁNÍ
        echo "-> Mažu expir. registraci pro VS: $vs (starší jak 72h)<br>\n";
        supabaseRequest('DELETE', 'registrations?id=eq.'.$reg['id']);
        
        if ($email) {
            $cancelMsg = "Dobrý den,\n\nVaše registrace na turnaj \"$tTitle\" byla automaticky zrušena.\n\nDo 72 hodin jsme neobdrželi platbu startovného a Vaše místo tak muselo být uvolněno dalším zájemcům.\n\nPokud se chcete turnaje přesto zúčastnit, proveďte prosím novou registraci na webu a platbu obratem uhradte.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.";
            sendMailAPI($email, "Storno registrace pro nezaplacení - $tTitle", $cancelMsg);
        }
    } 
    elseif ($regTime < $timeLimit48h && (!isset($reg['warning_sent']) || $reg['warning_sent'] === false)) {
        // B. PŘESÁHLO 48 HODIN A VAROVÁNÍ NEBYLO ODESLÁNO -> POSLAT VAROVÁNÍ
        echo "-> Posílám 48h varování pro VS: $vs<br>\n";
        // Nastavíme v DB, že bylo varování odesláno
        supabaseRequest('PATCH', 'registrations?id=eq.'.$reg['id'], ['warning_sent' => true]);
        
        if ($email) {
            $warnMsg = "Dobrý den,\n\nblíží se termín splatnosti Vašeho startovného na turnaj \"$tTitle\".\n\nPokud nedojde k úhradě a spárování platby do 24 hodin, bude Vaše registrace systémem automaticky zrušena a místo přenecháno dalším zájemcům.\n\nPlatební údaje a rychlý QR kód k platbě naleznete po přihlášení na webu asociace v sekci Turnaje.\n\nDěkujeme za pochopení,\nČeská asociace v karetní hře prší z.s.";
            sendMailAPI($email, "Upozornění: Blíží se storno registrace turnaje", $warnMsg);
        }
    }
}

echo "ÚDRŽBA DOKONČENA.<br>\n";
?>
