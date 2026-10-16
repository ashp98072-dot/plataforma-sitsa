import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { accionManual, candidatosParaFila, listarConciliacion, recalcularImportacion, valesSinReporte } from "./combustible-c2c";

/**
 * C-2C contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT (3399 o 3407, solo local).
 * Aplica las migraciones REALES C-1, Estaciones, C-2B y C-2C sobre un esquema mínimo y fixture sintético (estructura HALEL; sin datos privados).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/flota/combustible-c2c.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `c2c_test_${randomUUID().replaceAll("-", "")}`;
const actor = { id: 91, username: "op" };
const sql = (archivo: string) => readFileSync(`sql/${archivo}`, "utf8");
let admin: mysql.Connection;

function sentencias(texto: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of texto.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  return out;
}
/** Una sola conexión: los scripts C-2B usan variables de sesión (@c2b_*). */
const ejecutar = async (texto: string) => {
  const c = await state.pool!.getConnection();
  try { for (const s of sentencias(texto)) await c.query(s); } finally { c.release(); }
};
const q = async <T extends RowDataPacket = RowDataPacket>(s: string, p: unknown[] = []) => (await state.pool!.query<T[]>(s, p))[0];

const vale = (n: number) => `0015730${n}`.slice(-8);
const placa = (n: number) => `C-${String(n).padStart(3, "0")}ABC`;
const datos = (n: number, o: Record<string, unknown> = {}) => JSON.stringify({
  hoja: "Hoja1", fila: n + 2, estado: "VALIDA", motivos: [], fechaReporte: "2026-10-10", placaNormalizada: placa(n), valeNormalizado: vale(n), galones: "10", precio: "25.5", total: "255",
  kilometraje: null, fingerprint: null, claveOperacion: null, duplicado: null, canonica: null, duplicadoPrevio: false,
  textos: { vale: vale(n), placa: placa(n), piloto: `PERSONA DEMO ${n}`, serie: "S", factura: `F${n}`, fecha: "", galones: "10", precio: "25.5", total: "255", km: "" }, ...o,
});
const filaDe: Record<number, number> = {};
const cargaId: Record<string, number> = {};
let n2 = 0;
async function insertarCarga(clave: string, o: { empresa?: number; proveedor?: number | null; numero: string; veh?: number; galones?: string; monto?: string; precio?: string; fecha?: string; piloto?: string; estado?: string }) {
  const [r] = await state.pool!.query<mysql.ResultSetHeader>(`INSERT INTO flota_combustible_cargas(empresa_id,vehiculo_id,tipo_combustible,galones,monto,numero_vale,fecha_consumo,precio_por_galon,proveedor_id,estado,piloto_nombre,ruta_relativa,nombre_original,creado_por,creado_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'x','x','u',NOW())`, [o.empresa ?? 1, o.veh ?? 1, "diesel", o.galones ?? "10.000", o.monto ?? "255.00", o.numero, o.fecha ?? "2026-10-10", o.precio ?? "25.50", o.proveedor === undefined ? 3 : o.proveedor, o.estado ?? "PENDIENTE", o.piloto ?? "PILOTO INTERNO"]);
  cargaId[clave] = Number(r.insertId); n2++;
  return cargaId[clave];
}
const fila = async (id: number) => (await q("SELECT * FROM flota_combustible_conciliacion_filas WHERE id=?", [id]))[0];
const estados = async () => Object.fromEntries((await q("SELECT id, estado_c2c FROM flota_combustible_conciliacion_filas WHERE conciliacion_id=10 AND duplicado_de_linea_id IS NULL")).map(r => [r.id, r.estado_c2c]));

describe.skipIf(!port)("C-2C conciliación proveedor ↔ vale / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    const [v] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v");
    expect(String(v[0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 8, dateStrings: true });
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(91),(92);
      CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO empresas VALUES(1),(2);
      CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(30), activo TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre_comercial VARCHAR(200), activo TINYINT, UNIQUE KEY uq_fixture_proveedor (empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES(3,1,'Halel',1),(4,1,'Puma',1),(6,2,'Otra empresa',1);
      CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
      CREATE TABLE tms_solicitudes_fondo(id INT PRIMARY KEY, empresa_id INT, codigo VARCHAR(30), estado VARCHAR(20));
      CREATE TABLE tms_solicitud_fondo_lineas(id INT PRIMARY KEY, empresa_id INT, solicitud_id INT, categoria VARCHAR(30), vehiculo_id INT, placa VARCHAR(30), empleado_nombre VARCHAR(100), cantidad DECIMAL(12,3), monto DECIMAL(12,2));`);
    const placas = Array.from({ length: 10 }, (_, i) => `(${i + 1},1,'${placa(i + 1)}',1)`).concat(["(14,1,'C-999XYZ',1)"]);
    await state.pool.query(`INSERT INTO flota_vehiculos VALUES ${placas.join(",")}`);
    const schema = readFileSync("src/lib/flota/schema.ts", "utf8");
    for (const tabla of ["flota_combustible_cargas", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"]) {
      await state.pool.query(schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`))![0]);
    }
    await state.pool.query("ALTER TABLE flota_combustible_cargas ADD numero_vale VARCHAR(40) NULL, ADD fecha_consumo DATE NULL, ADD precio_por_galon DECIMAL(10,2) NULL, MODIFY galones DECIMAL(12,3) NOT NULL");
    await state.pool.query(sql("migrate-2026-10-combustibles-c1.sql"));
    await state.pool.query(sql("migrate-2026-10-combustibles-estaciones.sql"));
    await state.pool.query("ALTER TABLE flota_combustible_cargas ADD COLUMN solicitud_fondo_linea_id INT NULL");
    await ejecutar(sql("migrate-2026-10-combustibles-c2b-importaciones.sql"));
    // Importaciones C-2B: #10 (proveedor 3, empresa 1), #11 (proveedor 4, empresa 1), #12 (empresa 2).
    await state.pool.query(`INSERT INTO flota_combustible_conciliaciones(id,empresa_id,nombre_original,ruta_relativa,mime,tamano,hoja,subido_por,creado_at,proveedor_id,proveedor_nombre,archivo_sha256,perfil_parser,version_parser,estado_importacion,resumen_importacion,subido_por_usuario_id)
      VALUES(10,1,'a.xlsx','r',NULL,1,'Hoja1','op',NOW(),3,'Halel',REPEAT('a',64),'HALEL',1,'IMPORTADA','{}',91),(11,1,'b.xlsx','r',NULL,1,'Hoja1','op',NOW(),4,'Puma',REPEAT('b',64),'HALEL',1,'IMPORTADA','{}',91),
            (12,2,'c.xlsx','r',NULL,1,'Hoja1','op',NOW(),6,'Otra',REPEAT('c',64),'HALEL',1,'IMPORTADA','{}',91)`);
    // 20 ocurrencias → 10 canónicas + 10 duplicados exactos (nunca participan).
    for (let n = 1; n <= 10; n++) {
      const [r] = await state.pool.query<mysql.ResultSetHeader>(`INSERT INTO flota_combustible_conciliacion_filas(empresa_id,conciliacion_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_previo)
        VALUES(1,10,?,'DESCARTADA','x',NOW(),'Hoja1','VALIDA',?,'[]',?,0)`, [n + 2, datos(n), `${n}`.padStart(64, "f")]);
      filaDe[n] = Number(r.insertId);
    }
    for (let n = 1; n <= 10; n++) {
      await state.pool.query(`INSERT INTO flota_combustible_conciliacion_filas(empresa_id,conciliacion_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_tipo,duplicado_previo,duplicado_de_linea_id)
        VALUES(1,10,?,'DESCARTADA','x',NOW(),'Hoja2','VALIDA',?,'[]',?,'EXACTO',0,?)`, [n + 2, datos(n, { hoja: "Hoja2" }), `${n}`.padStart(64, "f"), filaDe[n]]);
    }
    await state.pool.query(`INSERT INTO flota_combustible_conciliacion_filas(empresa_id,conciliacion_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_previo)
      VALUES(2,12,3,'DESCARTADA','x',NOW(),'Hoja1','VALIDA',?,'[]',?,0)`, [datos(1), "9".padStart(64, "e")]);
    // Vales internos (proveedor 3).
    await insertarCarga("v1", { numero: vale(1), veh: 1 });                                            // exacta
    await insertarCarga("v2", { numero: vale(2), veh: 2, monto: "255.50" });                          // monto +0.50
    await insertarCarga("v3", { numero: vale(3), veh: 3, monto: "255.01" });                          // dentro de tolerancia
    await insertarCarga("v4", { numero: vale(4), veh: 14 });                                            // placa distinta
    await insertarCarga("v5", { numero: vale(5), veh: 5, fecha: "2026-10-12" });                        // fecha distinta
    await insertarCarga("v6", { numero: ` ${vale(6).toLowerCase()} `, veh: 6, piloto: "OTRO PILOTO" }); // piloto distinto + espacios/minúsculas
    await insertarCarga("v7otro", { numero: vale(7), veh: 7, proveedor: 4 });                         // OTRO proveedor: no debe emparejar
    await insertarCarga("v8a", { numero: vale(8), veh: 8 }); await insertarCarga("v8b", { numero: vale(8), veh: 8 }); // ambiguo
    await insertarCarga("v9", { numero: vale(9), veh: 9, galones: "10.500" });                         // galones +0.5
    await insertarCarga("v10cero", { numero: "157310", veh: 10 });                                      // sin ceros: NO empareja con 00157310
    await insertarCarga("zz", { numero: "ZZ-1", veh: 1 });                                              // sin reporte
    await insertarCarga("zz2", { numero: "ZZ-2", veh: 2, estado: "APROBADO", fecha: "2026-09-01" });   // sin reporte, otra fecha
  }, 60000);

  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^c2c_test_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  it("migración C-2C: sin datos previos, idempotente y con postcheck sin problemas", async () => {
    const antes = await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas");
    await ejecutar(sql("migrate-2026-10-combustibles-c2c-conciliacion.sql"));
    await ejecutar(sql("migrate-2026-10-combustibles-c2c-conciliacion.sql")); // segunda ejecución
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas"))[0].n).toBe(antes[0].n);
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas WHERE estado_c2c IS NOT NULL OR carga_vinculada_id IS NOT NULL"))[0].n).toBe(0);
    const cols = await q("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' AND COLUMN_NAME IN ('estado_c2c','modo_c2c','carga_vinculada_id','carga_sugerida_id','diferencias_c2c','calculado_en','confirmado_por_usuario_id','confirmado_en')");
    expect(cols[0].n).toBe(8);
    await ejecutar(sql("postcheck-2026-10-combustibles-c2c-conciliacion.sql"));
    // Nada de lo anterior tocó los 20 renglones C-2B ni las cargas.
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas WHERE conciliacion_id=10"))[0].n).toBe(20);
  });

  it("recalcular: 20 ocurrencias → 10 canónicas clasificadas; duplicados exactos no participan", async () => {
    const r = await recalcularImportacion(1, 10, actor);
    expect(r).toMatchObject({ exactas: 3, conDiferencias: 4, sinVale: 2, ambiguas: 1, manualesConservadas: 0, noParticipan: 10 });
    const e = await estados();
    expect(e[filaDe[1]]).toBe("COINCIDENCIA_EXACTA");
    expect(e[filaDe[2]]).toBe("COINCIDENCIA_CON_DIFERENCIAS");
    expect(e[filaDe[3]]).toBe("COINCIDENCIA_EXACTA");   // Q0.01 dentro de tolerancia
    expect(e[filaDe[4]]).toBe("COINCIDENCIA_CON_DIFERENCIAS"); // placa
    expect(e[filaDe[5]]).toBe("COINCIDENCIA_CON_DIFERENCIAS"); // fecha: sigue siendo coincidencia fuerte (por vale), solo con diferencia visible
    expect(e[filaDe[6]]).toBe("COINCIDENCIA_EXACTA");   // piloto no bloquea; espacios/mayúsculas normalizados
    expect(e[filaDe[7]]).toBe("SIN_VALE_INTERNO");      // el único vale con ese número es de OTRO proveedor
    expect(e[filaDe[8]]).toBe("AMBIGUA");
    expect(e[filaDe[9]]).toBe("COINCIDENCIA_CON_DIFERENCIAS"); // galones
    expect(e[filaDe[10]]).toBe("SIN_VALE_INTERNO");     // no se quitan ceros a la izquierda
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas WHERE conciliacion_id=10 AND duplicado_de_linea_id IS NOT NULL AND (estado_c2c IS NOT NULL OR carga_vinculada_id IS NOT NULL)"))[0].n).toBe(0);
    // Exacta automática = vínculo AUTO; con diferencias = solo sugerencia; ambigua = sin vínculo.
    expect(await fila(filaDe[1])).toMatchObject({ modo_c2c: "AUTO", carga_vinculada_id: cargaId.v1, carga_sugerida_id: null, confirmado_en: null });
    expect(await fila(filaDe[2])).toMatchObject({ carga_vinculada_id: null, carga_sugerida_id: cargaId.v2 });
    expect(await fila(filaDe[8])).toMatchObject({ carga_vinculada_id: null, carga_sugerida_id: null });
    // El vale NUNCA se modifica.
    expect((await q("SELECT monto, galones, estado, proveedor_id FROM flota_combustible_cargas WHERE id=?", [cargaId.v2]))[0]).toMatchObject({ monto: "255.50", estado: "PENDIENTE", proveedor_id: 3 });
  });

  it("diferencias estructuradas por campo con ambos valores", async () => {
    const l = await listarConciliacion(1, 10, { estado: "COINCIDENCIA_CON_DIFERENCIAS" });
    const por = (n: number) => l!.filas.find(f => f.id === filaDe[n])!;
    expect(por(2).diferencias).toEqual([expect.objectContaining({ campo: "MONTO", tipo: "DISTINTA", proveedor: "255", interno: "255.50", delta: "0.5" })]);
    expect(por(4).diferencias.map(d => d.campo)).toEqual(["PLACA"]);
    expect(por(5).diferencias.map(d => d.campo)).toEqual(["FECHA"]);
    expect(por(9).diferencias.map(d => d.campo)).toEqual(["GALONES"]);
    expect(por(2).vale).toMatchObject({ numeroVale: vale(2), sugerido: true });
    expect(l!.resumen).toMatchObject({ COINCIDENCIA_EXACTA: 3, COINCIDENCIA_CON_DIFERENCIAS: 4, SIN_VALE_INTERNO: 2, AMBIGUA: 1 });
  });

  it("recalcular es idempotente (mismo resultado, sin cambios)", async () => {
    const antes = await q("SELECT id, estado_c2c, modo_c2c, carga_vinculada_id, carga_sugerida_id, diferencias_c2c FROM flota_combustible_conciliacion_filas ORDER BY id");
    const r = await recalcularImportacion(1, 10, actor);
    expect(r.sinCambios).toBe(10);
    expect(await q("SELECT id, estado_c2c, modo_c2c, carga_vinculada_id, carga_sugerida_id, diferencias_c2c FROM flota_combustible_conciliacion_filas ORDER BY id")).toEqual(antes);
  });

  it("vales sin reporte: respeta proveedor y rango de fecha_consumo; no incluye los vinculados ni los que tienen reporte", async () => {
    const todos = (await valesSinReporte(1, { proveedorId: 3 })).vales.map(v => v.numeroVale).sort();
    expect(todos).toEqual(["157310", "ZZ-1", "ZZ-2"].sort()); // v7otro es de otro proveedor; los demás tienen reporte
    expect((await valesSinReporte(1, { proveedorId: 3, desde: "2026-10-01" })).vales.map(v => v.numeroVale).sort()).toEqual(["157310", "ZZ-1"]);
    expect((await valesSinReporte(1, { proveedorId: 3, estado: "APROBADO" })).vales.map(v => v.numeroVale)).toEqual(["ZZ-2"]);
    expect((await valesSinReporte(1, { proveedorId: 3, placa: "C-010" })).vales.map(v => v.numeroVale)).toEqual(["157310"]);
    expect((await valesSinReporte(2, {})).totalReal).toBe(0); // otra empresa
  });

  it("candidatos de una fila ambigua: ambos vales, con disponibilidad", async () => {
    const c = await candidatosParaFila(1, filaDe[8]);
    expect(c!.map(x => x.id).sort()).toEqual([cargaId.v8a, cargaId.v8b].sort());
    expect(c!.every(x => x.disponible)).toBe(true);
  });

  it("confirmación manual de la AMBIGUA: vínculo MANUAL, auditoría y recálculo posterior NO la pisa", async () => {
    const r = await accionManual(1, filaDe[8], actor, { accion: "confirmar", cargaId: cargaId.v8a });
    expect(r).toMatchObject({ estado: "COINCIDENCIA_EXACTA", cargaVinculadaId: cargaId.v8a });
    expect(await fila(filaDe[8])).toMatchObject({ modo_c2c: "MANUAL", confirmado_por_usuario_id: 91 });
    const aud = await q("SELECT * FROM auditoria WHERE accion='conciliacion_proveedor_confirmar'");
    expect(aud).toHaveLength(1);
    const det = JSON.parse(String(aud[0].detalle));
    expect(det).toMatchObject({ importacionId: 10, filaId: filaDe[8], valeId: cargaId.v8a, usuarioId: 91, antes: { estado: "AMBIGUA" }, despues: { estado: "COINCIDENCIA_EXACTA", cargaVinculadaId: cargaId.v8a } });
    expect(aud[0]).toMatchObject({ empresa_id: 1, usuario: "op", modulo: "flota_combustible" });
    const rec = await recalcularImportacion(1, 10, actor);
    expect(rec.manualesConservadas).toBe(1);
    expect(await fila(filaDe[8])).toMatchObject({ modo_c2c: "MANUAL", carga_vinculada_id: cargaId.v8a });
  });

  it("vale ya vinculado a otra fila: no disponible (409) y deja de contar como sin reporte", async () => {
    await expect(accionManual(1, filaDe[7], actor, { accion: "confirmar", cargaId: cargaId.v8a })).rejects.toMatchObject({ status: 409 });
    expect((await valesSinReporte(1, { proveedorId: 3 })).vales.map(v => v.id)).not.toContain(cargaId.v8a);
  });

  it("proveedor distinto: se rechaza confirmar un vale de otro proveedor", async () => {
    await expect(accionManual(1, filaDe[7], actor, { accion: "confirmar", cargaId: cargaId.v7otro })).rejects.toThrow("otro proveedor");
    expect((await fila(filaDe[7])).carga_vinculada_id).toBeNull();
  });

  it("concurrencia: dos filas confirman el MISMO vale a la vez → una gana, la otra 409 'Actualiza y vuelve a intentar.'", async () => {
    const res = await Promise.allSettled([
      accionManual(1, filaDe[7], actor, { accion: "confirmar", cargaId: cargaId.zz }),
      accionManual(1, filaDe[10], actor, { accion: "confirmar", cargaId: cargaId.zz }),
    ]);
    expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rechazo = res.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ status: 409 });
    expect(String(rechazo.reason.message)).toContain("Actualiza y vuelve a intentar");
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id=?", [cargaId.zz]))[0].n).toBe(1);
  });

  it("estado esperado desactualizado → 409", async () => {
    await expect(accionManual(1, filaDe[2], actor, { accion: "descartar", motivo: "no aplica" }, { estado: "COINCIDENCIA_EXACTA", cargaVinculadaId: null })).rejects.toMatchObject({ status: 409 });
  });

  it("con diferencias: confirmar igual, cambiar por otro vale, quitar y restablecer", async () => {
    // 1) confirmar el sugerido (con diferencias).
    expect(await accionManual(1, filaDe[2], actor, { accion: "confirmar", cargaId: cargaId.v2 })).toMatchObject({ estado: "COINCIDENCIA_CON_DIFERENCIAS", cargaVinculadaId: cargaId.v2 });
    // 2) cambiar a otro vale (libera el anterior).
    await insertarCarga("v2bis", { numero: vale(2), veh: 2 });
    expect(await accionManual(1, filaDe[2], actor, { accion: "confirmar", cargaId: cargaId.v2bis })).toMatchObject({ estado: "COINCIDENCIA_EXACTA", cargaVinculadaId: cargaId.v2bis });
    expect((await q("SELECT COUNT(*) n FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id=?", [cargaId.v2]))[0].n).toBe(0);
    // 3) quitar el vínculo → SIN_VALE_INTERNO manual, el recálculo lo respeta.
    expect(await accionManual(1, filaDe[2], actor, { accion: "quitar" })).toMatchObject({ estado: "SIN_VALE_INTERNO", cargaVinculadaId: null });
    await recalcularImportacion(1, 10, actor);
    expect(await fila(filaDe[2])).toMatchObject({ estado_c2c: "SIN_VALE_INTERNO", modo_c2c: "MANUAL" });
    // 4) restablecer → vuelve a automático; el recálculo ahora ve DOS vales con esa clave → AMBIGUA.
    await accionManual(1, filaDe[2], actor, { accion: "restablecer" });
    expect(await fila(filaDe[2])).toMatchObject({ estado_c2c: "PENDIENTE", modo_c2c: null });
    await recalcularImportacion(1, 10, actor);
    expect((await fila(filaDe[2])).estado_c2c).toBe("AMBIGUA");
    // Ningún vale cambió en todo el flujo.
    expect((await q("SELECT monto FROM flota_combustible_cargas WHERE id=?", [cargaId.v2]))[0].monto).toBe("255.50");
  });

  it("descartar exige motivo y queda auditado; el recálculo la respeta", async () => {
    await expect(accionManual(1, filaDe[9], actor, { accion: "descartar", motivo: " " })).rejects.toThrow("motivo");
    await accionManual(1, filaDe[9], actor, { accion: "descartar", motivo: "Reporte duplicado por el proveedor" });
    await recalcularImportacion(1, 10, actor);
    expect(await fila(filaDe[9])).toMatchObject({ estado_c2c: "DESCARTADA_MANUAL", modo_c2c: "MANUAL" });
    expect((await q("SELECT COUNT(*) n FROM auditoria WHERE accion='conciliacion_proveedor_descartar' AND detalle LIKE '%Reporte duplicado%'"))[0].n).toBe(1);
  });

  it("el UNIQUE de la BD impide dos filas con el mismo vale aun saltándose el servicio", async () => {
    await expect(state.pool!.query("UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id=?, estado_c2c='COINCIDENCIA_EXACTA' WHERE id=?", [cargaId.v1, filaDe[4]])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(state.pool!.query("UPDATE flota_combustible_conciliacion_filas SET carga_vinculada_id=? WHERE id=?", [cargaId.v9, filaDe[9]])).rejects.toMatchObject({ errno: 4025 }); // vínculo sin estado coherente
  });

  it("aislamiento por empresa: la empresa 2 no ve ni opera filas/vales/importaciones de la 1", async () => {
    await expect(recalcularImportacion(2, 10, actor)).rejects.toMatchObject({ status: 404 });
    await expect(accionManual(2, filaDe[1], actor, { accion: "quitar" })).rejects.toMatchObject({ status: 404 });
    expect(await listarConciliacion(2, 10)).toBeNull();
    expect(await candidatosParaFila(2, filaDe[8])).toBeNull();
    // La importación 12 (empresa 2, proveedor 6) no emparejó con vales de la empresa 1 aunque el número coincida.
    await recalcularImportacion(2, 12, actor);
    expect((await q("SELECT estado_c2c FROM flota_combustible_conciliacion_filas WHERE conciliacion_id=12"))[0].estado_c2c).toBe("SIN_VALE_INTERNO");
  });

  it("importación de otro proveedor (#11) no vincula vales del proveedor 3", async () => {
    await state.pool!.query(`INSERT INTO flota_combustible_conciliacion_filas(empresa_id,conciliacion_id,fila_excel,estado,motivo,creado_at,hoja_origen,estado_parseo,datos_importacion,origen_celdas,fingerprint,duplicado_previo)
      VALUES(1,11,3,'DESCARTADA','x',NOW(),'Hoja1','VALIDA',?,'[]',?,0)`, [datos(1), "1".padStart(64, "d")]);
    const r = await recalcularImportacion(1, 11, actor);
    expect(r).toMatchObject({ sinVale: 1, exactas: 0 });
    expect(n2).toBeGreaterThan(10);
  });
});
