<?php
// Prueba local del MISMO BufferedQuery utilizado por ImportSql de phpMyAdmin.
// No abre conexiones ni ejecuta SQL. Requiere sql-parser 5.10.0 en .lab-runtime.
$repo = dirname(__DIR__, 3);
$library = $repo . '/.lab-runtime/sql-parser-5.10.0/src/';
spl_autoload_register(function ($class) use ($library) {
    $prefix = 'PhpMyAdmin\\SqlParser\\';
    if (str_starts_with($class, $prefix)) require $library . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
});
$sql = file_get_contents($repo . '/sql/import-phpmyadmin-2026-10-combustibles-pr2.sql');
$results = [];
foreach ([1, 7, 4096, strlen($sql)] as $size) {
    $buffer = new PhpMyAdmin\SqlParser\Utils\BufferedQuery();
    $statements = [];
    for ($offset = 0; $offset < strlen($sql); $offset += $size) {
        $buffer->query .= substr($sql, $offset, $size);
        while ($statement = $buffer->extract()) $statements[] = trim($statement);
    }
    while (trim($buffer->query) !== '') {
        $statement = $buffer->extract(true);
        if ($statement) $statements[] = trim($statement);
        elseif (trim($buffer->query) !== '') throw new RuntimeException('Fragmento sin extraer');
    }
    if (count($statements) !== 2) throw new RuntimeException('Se esperaban USE + un bloque; recibidos ' . count($statements));
    if (!str_starts_with($statements[0], 'USE `u611730801_Plataforma`')) throw new RuntimeException('USE incorrecto');
    if (!str_starts_with($statements[1], 'BEGIN NOT ATOMIC')) throw new RuntimeException('Bloque dividido');
    if (substr_count($statements[1], '-- BEGIN CB2_METADATA_CANONICO') !== 4) throw new RuntimeException('Contratos fragmentados');
    $results[] = ['chunkBytes' => $size, 'statements' => count($statements), 'blockSHA256' => hash('sha256', $statements[1])];
}
if (count(array_unique(array_column($results, 'blockSHA256'))) !== 1) throw new RuntimeException('Bloque varia con fragmentacion de lectura');
echo json_encode(['status' => 'PASS', 'parser' => 'phpmyadmin/sql-parser 5.10.0 BufferedQuery', 'php' => PHP_VERSION, 'sqlSHA256' => hash('sha256', $sql), 'results' => $results], JSON_PRETTY_PRINT), "\n";
