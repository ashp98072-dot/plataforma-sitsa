// DIAGNÓSTICO DE SOLO LECTURA previo a la simplificación de Canecas (#688). No ejecuta DDL ni DML: reutiliza los verificadores de los
// instaladores (contratos de redistribución, FIFO, catálogos y ventas anterior), el preflight/postcheck de la simplificación y el
// estado de sus objetos. Impone `SET SESSION TRANSACTION READ ONLY` y se detiene si el servidor no lo confirma, de modo que ninguna
// sentencia de escritura puede ejecutarse en su sesión. No imprime credenciales ni cadenas de conexión.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verificarContratoRedistribucion, verificarCriterioFifo } from './contrato-redistribucion.mjs';
import { verificarContratoCatalogos, verificarMapeoProveedoresCompleto } from './contrato-catalogos.mjs';
import { verificarContratoVentas } from './contrato-ventas.mjs';
import { verificarContratoSimplificacion } from './contrato-simplificacion.mjs';
import { obtenerEstadoSimplificacion } from './ejecutar-simplificacion-controlado.mjs';
import { privilegiosDirectos } from './privilegios.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sql = name => readFileSync(path.join(root, 'sql', name), 'utf8');
export const PRIVILEGIOS_REQUERIDOS = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'];
const MIGRACIONES = ['fase1', 'costos-wip', 'salidas-fifo-wip', 'redistribucion-wip', 'catalogos-wip', 'ventas-wip'];

/** Tablas de Canecas que deben existir antes de la simplificación: las que crean sus 6 migraciones anteriores (17 en total). */
export function tablasEsperadasPrevias() {
  const tablas = MIGRACIONES.flatMap(m => [...sql(`migrate-2026-11-canecas-${m}.sql`).matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(canecas_[a-z_]+)/g)].map(x => x[1]));
  return [...new Set(tablas)].sort();
}

const filasDe = resultados => (Array.isArray(resultados) ? resultados : []).flat().filter(f => f && typeof f === 'object' && 'verificacion' in f);
const mensaje = error => String(error?.message ?? error?.code ?? 'ERROR').replace(/^DETENER:\s*/, '').slice(0, 300); // sin credenciales: solo el mensaje de nuestras comprobaciones o el código SQL

/** Devuelve { base, version, comprobaciones: [{ nombre, estado: 'OK'|'FALLO'|'OMITIDA'|'INFO', detalle }], falla }. Una falla no detiene las demás. */
export async function diagnosticarPrevio(connection) {
  const comprobaciones = [];
  const registrar = (nombre, estado, detalle = '') => comprobaciones.push({ nombre, estado, detalle });
  const comprobar = async (nombre, fn) => { try { registrar(nombre, 'OK', (await fn()) ?? ''); } catch (error) { registrar(nombre, 'FALLO', mensaje(error)); } };

  const [identidad] = await connection.query('SELECT DATABASE() AS base, VERSION() AS version');
  const base = identidad[0]?.base, version = String(identidad[0]?.version ?? '');
  if (!base) throw Error('DETENER: no hay base seleccionada');

  // Solo lectura impuesta por el servidor para esta sesión; si no queda confirmada, no se consulta nada más.
  const [anterior] = await connection.query('SELECT @@SESSION.tx_read_only AS ro');
  await connection.query('SET SESSION TRANSACTION READ ONLY');
  try {
    const [ro] = await connection.query('SELECT @@SESSION.tx_read_only AS ro');
    if (Number(ro[0]?.ro) !== 1) throw Error('DETENER: no se pudo imponer la sesión de solo lectura; no se ejecuta el diagnóstico');

    await comprobar('Versión del servidor 11.8.9-MariaDB', async () => { if (!version.startsWith('11.8.9-MariaDB')) throw Error(`versión ${version.split('-')[0]} distinta de 11.8.9`); return version; });
    await comprobar('Privilegios directos de la cuenta (SELECT, CREATE, ALTER, INDEX, REFERENCES, TRIGGER)', async () => {
      const [grants] = await connection.query('SHOW GRANTS FOR CURRENT_USER');
      const permisos = privilegiosDirectos(grants, base);
      const faltan = PRIVILEGIOS_REQUERIDOS.filter(p => !permisos.has(p) && !permisos.has('ALL PRIVILEGES'));
      if (faltan.length) throw Error(`faltan: ${faltan.join(', ')}`);
      return permisos.has('ALL PRIVILEGES') ? 'ALL PRIVILEGES' : [...permisos].sort().join(', ');
    });
    await comprobar('Modos de sesión del instalador (foreign_key_checks y check_constraint_checks activos)', async () => {
      const [m] = await connection.query('SELECT @@SESSION.foreign_key_checks fk, @@SESSION.check_constraint_checks ck, @@SESSION.sql_mode modo, @@SESSION.innodb_strict_mode strict');
      if (Number(m[0]?.fk) !== 1 || Number(m[0]?.ck) !== 1) throw Error('foreign_key_checks/check_constraint_checks no están activos en la sesión');
      return `sql_mode=${m[0].modo || '(vacío)'}; innodb_strict_mode=${m[0].strict}; el instalador activa SQL estricto en su sesión`;
    });
    await comprobar('Las 17 tablas de Canecas de las migraciones anteriores existen', async () => {
      const esperadas = tablasEsperadasPrevias();
      const [filas] = await connection.query("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'canecas\\_%'");
      const presentes = new Set(filas.map(f => f.t));
      const faltan = esperadas.filter(t => !presentes.has(t));
      if (faltan.length) throw Error(`faltan: ${faltan.join(', ')}`);
      const nuevas = [...presentes].filter(t => !esperadas.includes(t)).sort();
      return `${esperadas.length} esperadas presentes${nuevas.length ? `; además: ${nuevas.join(', ')}` : ''}`;
    });

    // Estado de la simplificación: decide si corresponde el contrato anterior de ventas (antes) o el nuevo (después).
    let estado = null;
    await comprobar('Estado de la simplificación (ausente, completa o parcial)', async () => {
      estado = await obtenerEstadoSimplificacion(connection);
      if (estado.every(n => n === 0)) return 'ausente: corresponde instalar';
      if (estado.every(n => n === 1)) return 'completa: ya instalada';
      throw Error('PARCIAL: instalación incompleta; usar sql/recuperacion-canecas-simplificacion-solo-lectura.sql');
    });
    const instalada = Array.isArray(estado) && estado.every(n => n === 1);

    // Verificadores existentes de los instaladores (no se duplica su lógica).
    await comprobar('Contrato de redistribución (tablas, columnas, índices, FK, CHECK y triggers)', () => verificarContratoRedistribucion(connection));
    await comprobar('Criterio FIFO ejecutable en el esquema instalado', () => verificarCriterioFifo(connection));
    await comprobar('Contrato de catálogos (proveedores y clientes de Canecas)', () => verificarContratoCatalogos(connection));
    if (instalada) {
      registrar('Contrato de ventas ANTERIOR', 'OMITIDA', 'la simplificación ya está instalada: corresponde el contrato nuevo');
      await comprobar('Contrato de simplificación (ventas, productos, compras y secuencias)', () => verificarContratoSimplificacion(connection));
    } else {
      await comprobar('Contrato de ventas anterior (canecas_ventas, mapeo y sus 4 triggers)', () => verificarContratoVentas(connection));
    }
    try { await verificarMapeoProveedoresCompleto(connection); registrar('Compras históricas con proveedor de Canecas mapeado', 'INFO', 'todas mapeadas'); }
    catch (error) { registrar('Compras históricas con proveedor de Canecas mapeado', 'INFO', mensaje(error)); } // informativo: no bloquea la simplificación

    // Preflight / postcheck de solo lectura de la propia simplificación.
    const [antes, despues] = instalada ? ['postcheck-2026-11-canecas-simplificacion-wip.sql', 15] : ['preflight-2026-11-canecas-simplificacion-wip.sql', 22];
    await comprobar(`${instalada ? 'Postcheck' : 'Preflight'} de la simplificación (${despues} comprobaciones de solo lectura)`, async () => {
      const [resultados] = await connection.query(sql(antes));
      const filas = filasDe(resultados);
      if (filas.length !== despues) throw Error(`se esperaban ${despues} comprobaciones y se obtuvieron ${filas.length}`);
      const detener = filas.filter(f => f.resultado === 'DETENER');
      for (const f of filas) registrar(`  · ${f.verificacion}`, f.resultado === 'DETENER' ? 'FALLO' : f.resultado === 'OK' ? 'OK' : 'INFO', f.resultado === 'OK' || f.resultado === 'DETENER' ? '' : String(f.resultado));
      if (detener.length) throw Error(`${detener.length} comprobación(es) en DETENER: ${detener.map(f => f.verificacion).join('; ')}`);
      return `${filas.length} comprobaciones sin DETENER`;
    });
  } finally {
    await connection.query(Number(anterior[0]?.ro) === 1 ? 'SET SESSION TRANSACTION READ ONLY' : 'SET SESSION TRANSACTION READ WRITE');
  }
  return { base, version, comprobaciones, falla: comprobaciones.some(c => c.estado === 'FALLO') };
}

export function formatearDiagnostico(r) {
  const marca = { OK: '[ OK    ]', FALLO: '[ FALLO ]', OMITIDA: '[ OMIT. ]', INFO: '[ INFO  ]' };
  const lineas = [`Diagnóstico previo de SOLO LECTURA — base ${r.base} — ${r.version}`, ''];
  for (const c of r.comprobaciones) lineas.push(`${marca[c.estado]} ${c.nombre}${c.detalle ? ` — ${c.detalle}` : ''}`);
  const fallos = r.comprobaciones.filter(c => c.estado === 'FALLO' && !c.nombre.startsWith('  ·')).length;
  lineas.push('', r.falla ? `RESULTADO: BLOQUEADO (${fallos} comprobación(es) en FALLO). No instalar hasta resolverlo.` : 'RESULTADO: SIN BLOQUEOS. El esquema previo coincide con los contratos y el preflight no detiene.');
  lineas.push('Este diagnóstico no modifica nada. La instalación requiere además respaldo restaurable, Canecas sin escrituras y autorización expresa.');
  return lineas.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { CANECAS_SQL_HOST: host, CANECAS_SQL_CA: ca, CANECAS_SQL_DATABASE: database, CANECAS_SQL_USER: user, CANECAS_SQL_PASSWORD: password, CANECAS_SQL_PORT: rawPort } = process.env;
  const port = rawPort === undefined ? 3306 : Number(rawPort);
  if (process.argv.slice(2).join(' ') !== '--solo-lectura' || !host || !ca || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('DETENER: uso `node diagnostico-previo-simplificacion.mjs --solo-lectura` con CANECAS_SQL_HOST, _CA (TLS), _DATABASE, _USER y _PASSWORD en el entorno.'); process.exitCode = 1;
  } else {
    let connection;
    try {
      const mysql = await import('mysql2/promise');
      connection = await mysql.createConnection({ host, port, database, user, password, ssl: { ca: readFileSync(ca), rejectUnauthorized: true }, multipleStatements: true });
      const resultado = await diagnosticarPrevio(connection);
      console.log(formatearDiagnostico(resultado));
      if (resultado.falla) process.exitCode = 2;
    } catch (error) { console.error('DETENER: no se pudo completar el diagnóstico.', error.message?.startsWith('DETENER:') ? error.message : (error.code || 'ERROR')); process.exitCode = 1; }
    finally { if (connection) await connection.end(); }
  }
}
