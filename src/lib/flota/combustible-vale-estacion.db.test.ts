import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: async () => ({ relative: "empresas/1/flota/fixture.pdf", original: "fixture.pdf", size: 10 }),
  contentTypeFor: () => "application/pdf", borrarUpload: vi.fn(), validarRutaArchivoEmpresa: () => true,
}));
import { guardarEstacion, listarEstaciones, listarProveedoresActivos } from "./combustible-estaciones";
import { guardarCombustibleStaff } from "./combustible-staff";

/**
 * Vale + estación (proveedor DERIVADO de la estación) contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT
 * (3399 o 3407, solo local). Usa el DDL real de `flota_combustible_cargas` y las migraciones C-1 y Estaciones; no toca ninguna BD real.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/flota/combustible-vale-estacion.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `vale_est_test_${randomUUID().replaceAll("-", "")}`;
const actor = { usuarioId: 91, username: "op" };
const file = { name: "vale.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
const base = { vehiculoId: 7, viajeId: null, fechaConsumo: "2026-10-15", tipoCombustible: "diesel" as const, galones: "10.125", monto: "300.50", km: null, gasolinera: "Texto del navegador", observaciones: "" };
const fila = async (id: number) => ((await state.pool!.query<RowDataPacket[]>("SELECT * FROM flota_combustible_cargas WHERE id=?", [id]))[0])[0];
const sql = (archivo: string) => readFileSync(`sql/${archivo}`, "utf8");
let admin: mysql.Connection;
let est: { shellA: number; pumaA: number; inactiva: number; ajena: number };

describe.skipIf(!port)("Vale por estación / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    const [v] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v");
    expect(String(v[0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 6 });
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY); INSERT INTO usuarios VALUES(91),(92);
      CREATE TABLE empresas(id INT PRIMARY KEY); INSERT INTO empresas VALUES(1),(2);
      CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(30), activo TINYINT NOT NULL DEFAULT 1);
      INSERT INTO flota_vehiculos VALUES(7,1,'P-123',1);
      CREATE TABLE flota_vehiculo_acceso(vehiculo_id INT, empresa_id INT);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY, empresa_id INT, nombre_comercial VARCHAR(200), activo TINYINT, UNIQUE KEY uq_fixture_proveedor (empresa_id,id));
      INSERT INTO compras_proveedores VALUES(3,1,'Shell',1),(4,1,'Puma',1),(5,1,'Texaco inactivo',0),(6,2,'Proveedor de otra empresa',1);
      CREATE TABLE flota_viajes(id INT PRIMARY KEY, empresa_id INT, vehiculo_id INT);
      CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT);`);
    const ddl = readFileSync("src/lib/flota/schema.ts", "utf8").match(/CREATE TABLE IF NOT EXISTS flota_combustible_cargas \([\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/)![0];
    await state.pool.query(ddl);
    await state.pool.query("ALTER TABLE flota_combustible_cargas ADD numero_vale VARCHAR(40) NULL, ADD fecha_consumo DATE NULL, ADD precio_por_galon DECIMAL(10,2) NULL, MODIFY galones DECIMAL(12,3) NOT NULL");
    await state.pool.query(sql("migrate-2026-10-combustibles-c1.sql"));
    await state.pool.query(sql("migrate-2026-10-combustibles-estaciones.sql"));
    await state.pool.query("ALTER TABLE flota_combustible_cargas ADD COLUMN solicitud_fondo_linea_id INT NULL"); // columna de C-2A (el vale sin fondo no la usa)
    // Las estaciones se crean con el MISMO servicio que usa el formulario «Nueva estación».
    est = {
      shellA: await guardarEstacion(1, actor, { proveedorId: 3, nombre: "Shell Roosevelt", direccion: "Calzada Roosevelt km 12" }),
      pumaA: await guardarEstacion(1, actor, { proveedorId: 4, nombre: "Puma Zona 9", direccion: "" }),
      inactiva: await guardarEstacion(1, actor, { proveedorId: 3, nombre: "Shell cerrada", direccion: "" }),
      ajena: await guardarEstacion(2, actor, { proveedorId: 6, nombre: "Estación de la otra empresa", direccion: "" }),
    };
    await guardarEstacion(1, actor, { activo: false }, est.inactiva);
  }, 30000);

  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^vale_est_test_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  it("GUARDAR NUEVA ESTACIÓN funciona (flujo del formulario) y queda auditada", async () => {
    const id = await guardarEstacion(1, actor, { proveedorId: 3, nombre: "  Shell Mixco  ", direccion: "" });
    const [r] = await state.pool!.query<RowDataPacket[]>("SELECT * FROM flota_combustible_estaciones WHERE id=?", [id]);
    expect(r[0]).toMatchObject({ empresa_id: 1, proveedor_id: 3, nombre: "Shell Mixco", direccion: null, activo: 1, creado_por_usuario_id: 91 });
    const [a] = await state.pool!.query<RowDataPacket[]>("SELECT * FROM auditoria WHERE accion='crear_estacion_combustible' AND detalle LIKE ?", [`Estación #${id} %`]);
    expect(a).toHaveLength(1); expect(a[0]).toMatchObject({ empresa_id: 1, usuario: "op", modulo: "flota_combustible" });
    expect((await listarEstaciones(1, { proveedorId: 3, buscar: "Mixco" }))[0]).toMatchObject({ id, proveedorNombre: "Shell" });
  });
  it("estación: proveedor inexistente, de otra empresa e inactivo se rechazan sin escribir", async () => {
    const antes = Number((await state.pool!.query<RowDataPacket[]>("SELECT COUNT(*) n FROM flota_combustible_estaciones"))[0][0].n);
    await expect(guardarEstacion(1, actor, { proveedorId: 999, nombre: "X" })).rejects.toThrow("Proveedor no válido");
    await expect(guardarEstacion(1, actor, { proveedorId: 6, nombre: "X" })).rejects.toThrow("Proveedor no válido"); // proveedor de la empresa 2
    await expect(guardarEstacion(1, actor, { proveedorId: 5, nombre: "X" })).rejects.toThrow("inactivo");
    expect(Number((await state.pool!.query<RowDataPacket[]>("SELECT COUNT(*) n FROM flota_combustible_estaciones"))[0][0].n)).toBe(antes);
  });
  it("los proveedores del mantenimiento son los ACTIVOS de la empresa (sin depender del catálogo de vales)", async () => {
    expect(await listarProveedoresActivos(1)).toEqual([{ id: 4, nombre: "Puma" }, { id: 3, nombre: "Shell" }]);
    expect(await listarProveedoresActivos(2)).toEqual([{ id: 6, nombre: "Proveedor de otra empresa" }]);
  });
  it("vale nuevo: SOLO estacionId; el proveedor persistido es el de la estación y el nombre sale del servidor", async () => {
    const id = await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-1", estacionId: est.pumaA }, file);
    expect(await fila(id)).toMatchObject({ proveedor_id: 4, estacion_id: est.pumaA, gasolinera: "Puma Zona 9", estado: "PENDIENTE" });
  });
  it("no se puede falsear proveedorId; coincidente es inocuo", async () => {
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-2", estacionId: est.shellA, proveedorId: 4 }, file)).rejects.toThrow("no pertenece al proveedor indicado");
    const id = await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-3", estacionId: est.shellA, proveedorId: 3 }, file);
    expect((await fila(id)).proveedor_id).toBe(3);
    expect((await state.pool!.query<RowDataPacket[]>("SELECT COUNT(*) n FROM flota_combustible_cargas WHERE numero_vale='D-2'"))[0][0].n).toBe(0);
  });
  it("estación de otra empresa, inactiva o ausente se rechaza en un vale nuevo", async () => {
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-4", estacionId: est.ajena }, file)).rejects.toThrow("estación");
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-5", estacionId: est.inactiva }, file)).rejects.toThrow("no está activa");
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-6", estacionId: null }, file)).rejects.toThrow("Selecciona la estación");
    expect((await state.pool!.query<RowDataPacket[]>("SELECT COUNT(*) n FROM flota_combustible_cargas WHERE numero_vale IN ('D-4','D-5','D-6')"))[0][0].n).toBe(0);
  });
  it("duplicado por proveedor derivado: mismo número con la misma estación/proveedor choca; en otro proveedor no", async () => {
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "d-1", estacionId: est.pumaA }, file)).rejects.toMatchObject({ status: 409 });
    expect(await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "D-1", estacionId: est.shellA }, file)).toBeGreaterThan(0);
  });
  it("editar y cambiar de estación recalcula proveedor y snapshot; omitir la conserva", async () => {
    const id = await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "E-1", estacionId: est.shellA }, file);
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "E-1", estacionId: undefined, observaciones: "solo texto" }, null, id);
    expect(await fila(id)).toMatchObject({ proveedor_id: 3, estacion_id: est.shellA, gasolinera: "Shell Roosevelt", observaciones: "solo texto" });
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "E-1", estacionId: est.pumaA }, null, id);
    expect(await fila(id)).toMatchObject({ proveedor_id: 4, estacion_id: est.pumaA, gasolinera: "Puma Zona 9" });
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "E-1", estacionId: null }, null, id)).rejects.toThrow("Selecciona la estación");
  });
  it("HISTÓRICO sin estación: editarlo no destruye `gasolinera` ni `proveedor_id` (y no hay backfill)", async () => {
    await state.pool!.query(`INSERT INTO flota_combustible_cargas (id, empresa_id, vehiculo_id, proveedor_id, numero_vale, fecha_consumo, tipo_combustible, galones, monto, precio_por_galon, gasolinera, ruta_relativa, nombre_original, estado, creado_por, creado_at)
      VALUES (900, 1, 7, 3, 'HIST-1', '2026-09-01', 'diesel', 5, 150, 30, 'Gasolinera Vieja Sin Catalogar', 'empresas/1/flota/h.pdf', 'h.pdf', 'PENDIENTE', 'portal', '2026-09-01 10:00:00')`);
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "HIST-1", estacionId: null, observaciones: "revisado" }, null, 900);
    expect(await fila(900)).toMatchObject({ proveedor_id: 3, estacion_id: null, gasolinera: "Gasolinera Vieja Sin Catalogar", observaciones: "revisado" });
    // Completar el histórico eligiendo una estación sí deriva proveedor y snapshot.
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "HIST-1", estacionId: est.shellA }, null, 900);
    expect(await fila(900)).toMatchObject({ proveedor_id: 3, estacion_id: est.shellA, gasolinera: "Shell Roosevelt" });
  });
  it("HISTÓRICO del portal (sin proveedor ni estación): sigue NULL; no se le asigna un proveedor enviado por el navegador", async () => {
    await state.pool!.query(`INSERT INTO flota_combustible_cargas (id, empresa_id, vehiculo_id, proveedor_id, numero_vale, fecha_consumo, tipo_combustible, galones, monto, precio_por_galon, gasolinera, ruta_relativa, nombre_original, estado, creado_por, creado_at)
      VALUES (901, 1, 7, NULL, 'PORTAL-1', '2026-09-02', 'diesel', 5, 150, 30, 'Texto del piloto', 'empresas/1/flota/p.pdf', 'p.pdf', 'PENDIENTE', 'portal:E20', '2026-09-02 10:00:00')`);
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "PORTAL-1", estacionId: null, proveedorId: 4 }, null, 901);
    expect(await fila(901)).toMatchObject({ proveedor_id: null, estacion_id: null, gasolinera: "Texto del piloto" });
  });
  it("estación inactiva sigue en un vale que ya la tenía (histórico), pero no se puede elegir en uno nuevo", async () => {
    await state.pool!.query("UPDATE flota_combustible_estaciones SET activo=1 WHERE id=?", [est.inactiva]);
    const id = await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "H-INACT", estacionId: est.inactiva }, file);
    await state.pool!.query("UPDATE flota_combustible_estaciones SET activo=0, nombre='Renombrada' WHERE id=?", [est.inactiva]);
    await guardarCombustibleStaff(1, actor, { ...base, numeroVale: "H-INACT", estacionId: est.inactiva, observaciones: "edición" }, null, id);
    expect(await fila(id)).toMatchObject({ estacion_id: est.inactiva, proveedor_id: 3, gasolinera: "Shell cerrada", observaciones: "edición" });
    await expect(guardarCombustibleStaff(1, actor, { ...base, numeroVale: "H-INACT-2", estacionId: est.inactiva }, file)).rejects.toThrow("no está activa");
  });
  it("auditoría del vale registra proveedor y estación derivados", async () => {
    const [a] = await state.pool!.query<RowDataPacket[]>("SELECT detalle FROM auditoria WHERE accion='registrar_combustible' ORDER BY id DESC LIMIT 1");
    expect(String(a[0].detalle)).toMatch(/proveedor #\d+ · estación #\d+/);
  });
});
