<?php
// Solo prueba de importador local: memoria stdin, pipe UUID cb2 propio y esquema cb2_lab.
// No hay next_result(): queremos detectar cualquier dependencia de drenaje adicional.
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$payload = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$pipe = $payload['pipe'];
if (!preg_match('/^cb2-[0-9a-f-]{36}$/D', $pipe)) throw new RuntimeException('Pipe no auditado');
if (!str_starts_with($payload['sql'], 'USE `cb2_lab`;')) throw new RuntimeException('Solo cb2_lab sintetico');
$repo = dirname(__DIR__, 3);
spl_autoload_register(function ($class) use ($repo) {
    $prefix = 'PhpMyAdmin\\SqlParser\\';
    if (str_starts_with($class, $prefix)) require $repo . '/.lab-runtime/sql-parser-5.10.0/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
});
function connection($pipe) {
    $db = mysqli_init();
    $db->real_connect('.', 'root', '', null, 0, '\\\\.\\pipe\\' . $pipe);
    if (stripos($db->host_info, 'pipe') === false) throw new RuntimeException('Transporte no local PIPE');
    $db->set_charset('utf8mb4');
    return $db;
}
$legacy = connection($pipe);
$first = $legacy->query('BEGIN NOT ATOMIC SELECT 1; SELECT 2; END');
$first->free();
$reproduced = null;
try { $legacy->query('SET FOREIGN_KEY_CHECKS = ON'); }
catch (mysqli_sql_exception $e) { $reproduced = $e->getCode(); }
$legacy->close();
if ($reproduced !== 2014) throw new RuntimeException('No se reprodujo 2014: ' . $reproduced);
$db = connection($pipe);
$db->query("SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'");
$db->query('SET SESSION innodb_strict_mode=OFF');
$db->query('SET @cb2_schema=NULL');
$buffer = new PhpMyAdmin\SqlParser\Utils\BufferedQuery();
$buffer->query = $payload['sql'];
$steps = [];
$output = [];
while (trim($buffer->query) !== '') {
    $statement = $buffer->extract(true);
    if (!$statement) continue;
    $result = $db->query($statement); // Igual flujo buffered simple; no multi_query ni drenaje.
    $fields = 0;
    if ($result instanceof mysqli_result) {
        $fields = $result->field_count;
        $output = array_merge($output, $result->fetch_all(MYSQLI_NUM));
        $result->free();
    }
    if ($db->more_results()) throw new RuntimeException('Resultados adicionales pendientes');
    $db->query('SET FOREIGN_KEY_CHECKS = ON'); // Operacion que fallaba en Hostinger.
    $db->query('SET CHECK_CONSTRAINT_CHECKS = ON');
    $steps[] = ['prefix' => substr($statement, 0, 22), 'fields' => $fields, 'pending' => false, 'cleanup' => 'OK'];
}
if (count($steps) !== 4 || count($output) !== 1) throw new RuntimeException('Numero de sentencias/resultados inesperado');
$row = $output[0];
if (array_slice($row, 0, 4) !== ['CB2_IMPORT_FINAL', 'FINAL', '15', '0']) throw new RuntimeException('Import no FINAL');
$data = json_decode($row[4], true, 512, JSON_THROW_ON_ERROR);
if (count($data) !== 15 || array_sum($data) !== 0) throw new RuntimeException('Incidencias de datos');
if (array_slice($row, 5) !== ['cb2_lab', '1', 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', '0']) throw new RuntimeException('Contexto/restauracion incorrectos');
$counts = $db->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='cb2_lab' AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas','flota_cb2_consumos','flota_cb2_filas')")->fetch_row();
if ($counts !== ['4']) throw new RuntimeException('No hay cuatro tablas');
$checks = $db->query('SELECT @@foreign_key_checks,@@check_constraint_checks')->fetch_row();
if ($checks !== ['1','1']) throw new RuntimeException('Controles desactivados');
echo json_encode(['status' => 'PASS', 'php' => PHP_VERSION, 'client' => mysqli_get_client_info(), 'transport' => $db->host_info, 'legacyReproduced' => $reproduced, 'steps' => $steps, 'result' => $row, 'checks' => $checks, 'tables' => $counts], JSON_PRETTY_PRINT), "\n";
$db->close();
