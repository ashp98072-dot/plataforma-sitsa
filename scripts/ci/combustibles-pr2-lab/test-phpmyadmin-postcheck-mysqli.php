<?php
// Solo cb2_lab sintetico por named pipe local; sin next_result() ni multi_query().
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$p = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if (!preg_match('/^cb2-[0-9a-f-]{36}$/D', $p['pipe']) || !str_starts_with($p['sql'], 'USE `cb2_lab`;')) throw new RuntimeException('Solo laboratorio local');
$repo = dirname(__DIR__, 3);
spl_autoload_register(function ($class) use ($repo) {
 $prefix = 'PhpMyAdmin\\SqlParser\\';
 if (str_starts_with($class, $prefix)) require $repo . '/.lab-runtime/sql-parser-5.10.0/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
});
$db = mysqli_init();
$db->real_connect('.', 'root', '', null, 0, '\\\\.\\pipe\\' . $p['pipe']);
if (stripos($db->host_info, 'pipe') === false) throw new RuntimeException('No PIPE local');
$db->set_charset('utf8mb4');
$db->query("SET SESSION sql_mode='NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'");
$db->query('SET SESSION innodb_strict_mode=OFF');
$db->query('SET @cb2_schema=NULL');
$buffer = new PhpMyAdmin\SqlParser\Utils\BufferedQuery();
$buffer->query = $p['sql'];
$steps = [];
$output = [];
while (trim($buffer->query) !== '') {
 $statement = $buffer->extract(true);
 if (!$statement) continue;
 $r = $db->query($statement);
 $fields = 0;
 if ($r instanceof mysqli_result) { $fields = $r->field_count; $output = array_merge($output, $r->fetch_all(MYSQLI_NUM)); $r->free(); }
 if ($db->more_results()) throw new RuntimeException('Resultados pendientes');
 $db->query('SET FOREIGN_KEY_CHECKS=ON');
 $db->query('SET CHECK_CONSTRAINT_CHECKS=ON');
 $steps[] = ['prefix' => substr($statement, 0, 22), 'fields' => $fields, 'pending' => false, 'cleanup' => 'OK'];
}
if (count($steps) !== 4 || count($output) !== 1 || $steps[2]['fields'] !== 0 || $steps[3]['fields'] !== 9) throw new RuntimeException('No hay un unico resultado superior');
$row = $output[0];
if (array_slice($row, 0, 4) !== $p['expected']) throw new RuntimeException('Resultado inesperado: ' . json_encode($row));
if (array_slice($row, 5) !== ['cb2_lab','1','NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION','0']) throw new RuntimeException('Contexto/restauracion incorrectos');
if ($row[2] !== null) {
 $data = json_decode($row[4], true, 512, JSON_THROW_ON_ERROR);
 if (count($data) !== 15 || array_sum($data) !== (int)$row[3]) throw new RuntimeException('Detalle incorrecto');
} elseif ($row[4] !== null) throw new RuntimeException('No debe consultar datos con metadata incompatible');
$flags = $db->query('SELECT @@foreign_key_checks,@@check_constraint_checks')->fetch_row();
if ($flags !== ['1','1']) throw new RuntimeException('Flags alteradas');
echo json_encode(['status'=>'PASS','php'=>PHP_VERSION,'client'=>mysqli_get_client_info(),'transport'=>$db->host_info,'steps'=>$steps,'result'=>$row,'flags'=>$flags], JSON_PRETTY_PRINT), "\n";
$db->close();
