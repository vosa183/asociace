<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

echo "<div style='font-family: sans-serif; padding: 20px;'>";
echo "<h2>Test odchozího spojení z webhostingu</h2>";

$url = "https://www.fio.cz/ib_api/rest/periods/12345/2026-01-01/2026-01-02/transactions.json";
echo "<p>Zkouším zavolat Fio banku na adrese: <code>$url</code></p>";

if (!function_exists('curl_init')) {
    echo "<p style='color:red;'><strong>CHYBA: Funkce cURL je na vašem hostingu zcela ZAKÁZÁNA.</strong></p>";
} else {
    echo "<p>cURL je aktivní, zahajuji spojení...</p>";
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    // Vypnutí ověřování SSL (častý problém hostingu)
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpcode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($error) {
        echo "<div style='background:#fee2e2; border:1px solid #ef4444; padding:15px; border-radius:5px;'>";
        echo "<h3 style='color:#b91c1c; margin-top:0;'>Spojení selhalo!</h3>";
        echo "<strong>Chybová zpráva serveru:</strong> " . htmlspecialchars($error);
        echo "<p>Váš hosting blokuje odchozí spojení nebo zlobí DNS překlad.</p>";
        echo "</div>";
    } else {
        echo "<div style='background:#dcfce7; border:1px solid #22c55e; padding:15px; border-radius:5px;'>";
        echo "<h3 style='color:#15803d; margin-top:0;'>Spojení se podařilo!</h3>";
        echo "<p>Server Fio banky odpověděl kódem: <strong>$httpcode</strong></p>";
        echo "</div>";
    }
}
echo "</div>";
?>
