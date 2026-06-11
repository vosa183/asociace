<?php
// Zapnutí vypisování chyb pro odhalení problémů na hostingu
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Nastavení hlavičky na JSON
header('Content-Type: application/json; charset=utf-8');

$token = $_GET['token'] ?? '';
$from = $_GET['from'] ?? '';
$to = $_GET['to'] ?? '';

if (!$token || !$from || !$to) {
    die(json_encode(["error" => "Chybí parametry pro spojení s bankou (token, from, to)."]));
}

// Očištění pro bezpečnost
$token = trim(strip_tags($token));
$from = trim(strip_tags($from));
$to = trim(strip_tags($to));

$url = "https://www.fio.cz/ib_api/rest/periods/" . urlencode($token) . "/" . urlencode($from) . "/" . urlencode($to) . "/transactions.json";

// 1. ZKUSÍME PRIMÁRNÍ METODU PŘES cURL
if (function_exists('curl_init')) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    
    // Zásadní pro obcházení problémů se zastaralými certifikáty na sdílených hostinzích
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); 
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

    $response = curl_exec($ch);
    $curl_error = curl_error($ch);
    $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    // Pokud cURL narazil na interní chybu
    if ($response === false) {
        die(json_encode(["error" => "Kritická chyba cURL na hostingu: " . $curl_error]));
    }

    // Pokud banka vrátila jiný kód než 200 OK
    if ($httpcode !== 200) {
        die(json_encode(["error" => "Fio banka zamítla přístup (HTTP Status: $httpcode).", "raw_response" => substr($response, 0, 200)]));
    }

    // Úspěch!
    echo $response;
} 
// 2. POKUD JE cURL ZAKÁZANÝ, ZKUSÍME ZÁLOŽNÍ METODU
else {
    $options = [
        "http" => [
            "method" => "GET",
            "timeout" => 15,
            "ignore_errors" => true
        ],
        "ssl" => [
            "verify_peer" => false,
            "verify_peer_name" => false
        ]
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);
    
    if ($response === false) {
        die(json_encode(["error" => "Váš webhosting blokuje jak cURL, tak odchozí HTTP spojení (file_get_contents). Kontaktujte podporu hostingu."]));
    }
    
    echo $response;
}
?>
