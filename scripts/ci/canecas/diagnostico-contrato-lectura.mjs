// Diagnóstico únicamente de lectura. El esquema y sus valores predeterminados pueden ser sensibles.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { obtenerContratoBase, compararContratoBase } from './contrato-base.mjs';

const tablas = ['empresas', 'usuarios', 'canecas_productos', 'canecas_ubicaciones', 'canecas_saldos', 'canecas_compras', 'canecas_recepciones', 'canecas_movimientos'];

export async function diagnosticar(connection, esperado) {
  const [identidad] = await connection.query('SELECT DATABASE() AS base, VERSION() AS version, @@SESSION.sql_mode AS sql_mode, @@SESSION.innodb_strict_mode AS innodb_strict_mode, @@SESSION.foreign_key_checks AS foreign_key_checks, @@SESSION.check_constraint_checks AS check_constraint_checks');
  if (!identidad[0]?.base) throw Error('DETENER: falta base seleccionada');
  const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
  if (!Array.isArray(grants) || !grants.length) throw Error('DETENER: grants no visibles');
  const baseEscapada = String(identidad[0].base).replace(/`/g, '``');
  const privilegios = new Set();
  for (const row of grants) {
    const grant = String(Object.values(row)[0]);
    const local = grant.indexOf(` ON \`${baseEscapada}\`.* TO `);
    const pos = local >= 0 ? local : grant.indexOf(' ON *.* TO ');
    if (pos >= 0 && grant.startsWith('GRANT ')) for (const item of grant.slice(6, pos).split(',')) privilegios.add(item.trim().toUpperCase());
  }
  const faltantes = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'].filter(p => !privilegios.has(p) && !privilegios.has('ALL PRIVILEGES'));
  let definicionesVisibles = 0;
  for (const tabla of tablas) {
    const [rows] = await connection.query(`SHOW CREATE TABLE \`${tabla}\``);
    if (rows.length !== 1 || typeof rows[0]['Create Table'] !== 'string') throw Error(`DETENER: SHOW CREATE incompleto para ${tabla}`);
    definicionesVisibles++;
  }
  const contrato = await obtenerContratoBase(connection);
  let comparacion = 'SIN_CONTRATO_ESPERADO';
  if (esperado) {
    if (esperado.formato !== 1 || esperado.base !== identidad[0].base || !esperado.contrato) throw Error('DETENER: contrato esperado inválido o base distinta');
    compararContratoBase(esperado.contrato, contrato);
    comparacion = 'COINCIDE_REQUIERE_REVISION';
  }
  const sesion = identidad[0];
  const comprobaciones = { privilegios_directos_faltantes: faltantes, roles_no_interpretados: true,
    restricciones_activas: Number(sesion.foreign_key_checks) === 1 && Number(sesion.check_constraint_checks) === 1,
    sql_estricto_actual: /(?:^|,)STRICT_(?:TRANS|ALL)_TABLES(?:,|$)/.test(String(sesion.sql_mode)),
    innodb_estricto_actual: Number(sesion.innodb_strict_mode) === 1 };
  return { sesion, comprobaciones, definiciones_visibles: definicionesVisibles, contrato, comparacion,
    aviso: 'Revisar visibilidad, definiciones, permisos efectivos y preflight; una coincidencia no autoriza DDL.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CANECAS_SQL_HOST: host, CANECAS_SQL_CA: ca, CANECAS_SQL_DATABASE: database, CANECAS_SQL_USER: user, CANECAS_SQL_PASSWORD: password, CANECAS_SQL_PORT: rawPort } = process.env;
  const port = rawPort === undefined ? 3306 : Number(rawPort);
  const args = process.argv.slice(2);
  if (!host || !ca || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535 || (args.length !== 0 && (args.length !== 2 || args[0] !== '--esperado'))) {
    console.error('DETENER: configurar host, CA TLS, base, usuario y contraseña; opcional: --esperado archivo.json');
    process.exitCode = 1;
  } else {
    let connection;
    try {
      const esperado = args.length ? JSON.parse(readFileSync(args[1], 'utf8')) : null;
      const mysql = await import('mysql2/promise');
      connection = await mysql.createConnection({ host, port, database, user, password, ssl: { ca: readFileSync(ca), rejectUnauthorized: true }, multipleStatements: false });
      const result = await diagnosticar(connection, esperado);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      // Los mensajes del servidor pueden contener cuentas, hosts o datos sensibles.
      console.error('DETENER: diagnóstico incompleto o incompatible; revisar configuración, visibilidad y contrato esperado.');
      process.exitCode = 1;
    } finally { if (connection) await connection.end(); }
  }
}
