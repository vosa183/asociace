<?php
header('Content-Type: application/json; charset=utf-8');

$token = $_GET['token'] ?? '';
$from = $_GET['from'] ?? '';
$to = $_GET['to'] ?? '';

if (!$token || !$from || !$to) {
    die(json_encode(["error" => "Chybí parametry pro spojení s bankou."]));
}

// Očištění pro bezpečnost
$token = trim(strip_tags($token));

$url = "https://www.fio.cz/ib_api/rest/periods/" . urlencode($token) . "/" . urlencode($from) . "/" . urlencode($to) . "/transactions.json";

// Vytvoření požadavku na Fio banku z tvého serveru
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
$response = curl_exec($ch);
$httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// Ošetření chyb a předání dat zpět na náš web
if ($httpcode !== 200) {
    echo json_encode([
        "error" => "Fio banka zamítla přístup (HTTP $httpcode). Porušili jste pravidlo 60 sekund nebo je klíč neplatný.", 
        "raw_response" => substr($response, 0, 200)
    ]);
} else {
    echo $response;
}
?>
