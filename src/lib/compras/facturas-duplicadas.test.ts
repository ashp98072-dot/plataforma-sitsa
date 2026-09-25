import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  query: vi.fn(), audit: vi.fn(), tenant: vi.fn(), permisos: vi.fn(),
  conn: { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: async () => m.conn }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(async () => ({ id: 50 })) }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: m.tenant }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: m.permisos }));
import { facturaVerificarGet } from "./requerimiento-api";
import { buscarFacturaExistente, clavesLockFacturas, type Lector } from "./facturas-duplicadas";
import { ErrorCompra, guardarRequerimiento } from "./requerimientos";
import { crearRequerimientoSchema, editarRequerimientoSchema } from "./requerimiento-schema";
import type { PermisoModulo } from "@/lib/permisos-shared";

const linea = { fecha: "2026-09-17", proveedor_id: 3, vehiculo_id: null, repuesto_descripcion: "Filtro", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25" };
const payload = { fecha_requerimiento: "2026-09-17", entidad_requirente_id: 4, requirente_usuario_id: 9, lineas: [linea] };
const fila = (o: Record<string, unknown> = {}) => ({ linea_id: 193, requerimiento_id: 42, requerimiento_codigo: "RC-2026-000042", requerimiento_estado: "Autorizada", fecha: "2026-09-21", serie_factura: "A123", numero_factura: "45872", proveedor_nombre_snapshot: "MULTISERVICIOS LOS TRES", ...o });

describe("buscarFacturaExistente (misma identidad que el formulario)", () => {
  it("13/14) consulta por empresa + proveedor + serie + número normalizados y devuelve el requerimiento existente", async () => {
    const leer = vi.fn<Lector>(async () => [fila()] as never);
    const r = await buscarFacturaExistente(leer, 1, 3, " a123 ", " 45872 ");
    expect(r).toMatchObject({ requerimientoId: 42, requerimientoCodigo: "RC-2026-000042", proveedorNombre: "MULTISERVICIOS LOS TRES", fecha: "2026-09-21", estado: "Autorizada", lineaId: 193 });
    expect(leer.mock.calls[0][1]).toEqual([1, 3, "45872", "A123"]);
    expect(leer.mock.calls[0][0]).toContain("l.empresa_id = ? AND l.proveedor_id = ?");
    expect(leer.mock.calls[0][0]).toContain("INNER JOIN compras_requerimientos r ON r.empresa_id = l.empresa_id");
    expect(leer.mock.calls[0][0]).not.toContain("r.estado <>"); // cualquier estado cuenta
  });
  it("15) sin filas → null; 16) un falso positivo de colación (p. ej. '0458' vs '458' no; guion distinto) no bloquea", async () => {
    expect(await buscarFacturaExistente(vi.fn<Lector>(async () => [] as never), 1, 3, "A", "1")).toBeNull();
    expect(await buscarFacturaExistente(vi.fn<Lector>(async () => [fila({ serie_factura: "A-123" })] as never), 1, 3, "A123", "45872")).toBeNull();
  });
  it("sin número o sin proveedor no consulta la BD", async () => {
    const leer = vi.fn<Lector>(async () => [] as never);
    expect(await buscarFacturaExistente(leer, 1, 3, "A", "  ")).toBeNull();
    expect(await buscarFacturaExistente(leer, 1, 0, "A", "1")).toBeNull();
    expect(leer).not.toHaveBeenCalled();
  });
  it("17) al editar excluye SOLO la propia línea (otra línea del mismo requerimiento sí cuenta)", async () => {
    const leer = vi.fn<Lector>(async () => [] as never);
    await buscarFacturaExistente(leer, 1, 3, "A", "1", { excluirLineaId: 10 });
    expect(leer.mock.calls[0][0]).toContain("AND l.id <> ?");
    expect(leer.mock.calls[0][0]).not.toContain("requerimiento_id <> ?");
    expect(leer.mock.calls[0][1]).toEqual([1, 3, "1", "A", 10]);
  });
  it("FOR UPDATE solo cuando se pide (guardado)", async () => {
    const leer = vi.fn<Lector>(async () => [] as never);
    await buscarFacturaExistente(leer, 1, 3, "A", "1");
    await buscarFacturaExistente(leer, 1, 3, "A", "1", { bloquear: true });
    expect(leer.mock.calls[0][0]).not.toContain("FOR UPDATE");
    expect(leer.mock.calls[1][0]).toContain("FOR UPDATE");
  });
});

describe("endpoint GET …/compras/requerimientos/facturas/verificar", () => {
  let permisos: PermisoModulo[];
  const get = (qs: string) => facturaVerificarGet(new Request(`https://x.test/api?${qs}`), "sitsa");
  beforeEach(() => {
    vi.resetAllMocks();
    permisos = [{ modulo: "compras_requerimientos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: false }];
    m.permisos.mockImplementation(async () => permisos);
    m.tenant.mockResolvedValue({ empresa: { id: 7, modulos: ["tms"] }, session: { id: 8, username: "operador", rol: "Operaciones" } });
    m.query.mockResolvedValue([]);
  });
  it("18) 200 existe:true con la factura; 19) existe:false", async () => {
    m.query.mockResolvedValueOnce([fila()]);
    const a = await get("proveedorId=3&serie=A123&numero=45872");
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ existe: true, factura: { requerimientoCodigo: "RC-2026-000042" } });
    const b = await get("proveedorId=3&serie=A123&numero=99999");
    expect(await b.json()).toEqual({ existe: false });
    expect(a.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("20) la empresa sale de la sesión, no del cliente", async () => {
    await get("proveedorId=3&numero=1&empresaId=99&empresa_id=99");
    expect(m.query.mock.calls[0][1][0]).toBe(7);
    expect(m.query.mock.calls[0][1]).not.toContain(99);
  });
  it("21) excluye solo lineaId; 22) sin lineaId no excluye nada", async () => {
    await get("proveedorId=3&numero=1&lineaId=10");
    expect(m.query.mock.calls[0][0]).toContain("l.id <> ?");
    await get("proveedorId=3&numero=1");
    expect(m.query.mock.calls[1][0]).not.toContain("l.id <> ?");
  });
  it("23) 400 con proveedor no válido o parámetros manipulados; sin número → existe:false sin consultar", async () => {
    expect((await get("numero=1")).status).toBe(400);
    expect((await get("proveedorId=abc&numero=1")).status).toBe(400);
    expect((await get("proveedorId=3&numero=1&lineaId=1e2")).status).toBe(400);
    expect((await get(`proveedorId=3&numero=${"9".repeat(101)}`)).status).toBe(400);
    expect(m.query).not.toHaveBeenCalled();
    expect(await (await get("proveedorId=3&numero=%20")).json()).toEqual({ existe: false });
    expect(m.query).not.toHaveBeenCalled();
  });
  it("24) exige permiso propio de Requerimientos (ver)", async () => {
    permisos = [{ modulo: "compras_proveedores", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true }];
    const res = await get("proveedorId=3&numero=1");
    expect(res.status).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe("guardarRequerimiento — revalidación en el servidor", () => {
  let duplicadas: Record<string, unknown>[], cabecera: Record<string, unknown>, lock: number;
  const sqls = () => m.conn.query.mock.calls.map(c => String(c[0]));
  const crear = (lineas: Record<string, unknown>[] = [{ ...linea, numero_factura: "45872", serie_factura: "A123" }]) =>
    guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, lineas }), false);
  const editar = (lineas: Record<string, unknown>[]) =>
    guardarRequerimiento(1, 8, "editor", editarRequerimientoSchema.parse({ ...payload, version: 2, lineas }), true, 12);
  beforeEach(() => {
    vi.resetAllMocks(); duplicadas = []; lock = 1; cabecera = { id: 12, codigo: "RC-2026-000012", estado: "Pendiente", version: 2, total: "10.25" };
    m.conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ l: lock }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ l: 1 }]];
      if (sql.includes("INNER JOIN compras_requerimientos r")) return [duplicadas];
      if (sql.includes("FROM compras_linea_documentos")) return [[]];
      if (sql.includes("FROM compras_requerimientos")) return [[cabecera]];
      if (sql.includes("FROM compras_requerimiento_lineas")) return [[{ ...linea, id: 21, serie_factura: "A123", numero_factura: "45872" }]];
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
      if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real", rol_global: "Operaciones" }]];
      if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1, nombre_comercial: "Proveedor real", razon_social: "S", nit: "1", banco: "B", numero_cuenta: "c", dias_credito: 0 }]];
      if (sql.includes("FROM flota_vehiculos")) return [[]];
      throw new Error(`SQL inesperado: ${sql}`);
    });
    m.conn.execute.mockResolvedValue([{ insertId: 12, affectedRows: 1 }]); m.query.mockResolvedValue([]);
  });
  it("25) factura nueva se guarda", async () => {
    await crear();
    expect(m.conn.commit).toHaveBeenCalledOnce();
  });
  it("26/27) duplicada en BD → 409 con el mensaje exacto; nada se confirma y se hace rollback", async () => {
    duplicadas = [fila()];
    const error = await crear().catch(e => e);
    expect(error).toBeInstanceOf(ErrorCompra);
    expect(error).toMatchObject({ status: 409, message: "La factura A123 / 45872 ya existe en el requerimiento RC-2026-000042 para el proveedor MULTISERVICIOS LOS TRES." });
    expect(m.conn.commit).not.toHaveBeenCalled();
    expect(m.conn.rollback).toHaveBeenCalled();
  });
  it("28) cualquier estado del requerimiento existente cuenta (Pendiente / Autorizada / Rechazada)", async () => {
    for (const estado of ["Pendiente", "Autorizada", "Rechazada"]) {
      duplicadas = [fila({ requerimiento_estado: estado })];
      await expect(crear()).rejects.toMatchObject({ status: 409 });
    }
    expect(sqls().filter(s => s.includes("INNER JOIN compras_requerimientos r")).every(s => !/(r.estados*(=|<>|IN)|estados*(=|<>))/.test(s))).toBe(true);
  });
  it("29) duplicada dentro del propio payload → 409 ANTES de abrir conexión, transacción o locks", async () => {
    const l = { ...linea, numero_factura: "7", serie_factura: "A" };
    await expect(crear([l, { ...l, serie_factura: " a ", numero_factura: "7 " }])).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Hay facturas repetidas dentro del requerimiento. Corrige las líneas marcadas.") });
    expect(m.conn.beginTransaction).not.toHaveBeenCalled();
    expect(m.conn.query).not.toHaveBeenCalled();
  });
  it("30) distinto proveedor con mismo número no choca (el filtro incluye proveedor_id)", async () => {
    await crear();
    const dup = m.conn.query.mock.calls.find(c => String(c[0]).includes("INNER JOIN compras_requerimientos r"))!;
    expect(dup[1].slice(0, 2)).toEqual([1, 3]); // empresa de sesión + proveedor de la línea
  });
  it("sin número de factura no se consulta ni se bloquea", async () => {
    duplicadas = [fila()];
    await crear([{ ...linea, numero_factura: null }, { ...linea, numero_factura: "  " }]);
    expect(sqls().some(s => s.includes("INNER JOIN compras_requerimientos r"))).toBe(false);
    expect(sqls().some(s => s.includes("GET_LOCK"))).toBe(false);
  });
  it("editar sin cambiar la factura no se detecta a sí mismo (excluye el propio requerimiento en la BD)", async () => {
    await editar([{ ...linea, id: 21, numero_factura: "45872", serie_factura: "A123" }]);
    const dup = m.conn.query.mock.calls.find(c => String(c[0]).includes("INNER JOIN compras_requerimientos r"))!;
    expect(String(dup[0])).toContain("l.requerimiento_id <> ?");
    expect(dup[1]).toContain(12);
    expect(m.conn.commit).toHaveBeenCalledOnce();
  });
  it("editar hacia la factura de OTRO requerimiento → 409", async () => {
    duplicadas = [fila({ requerimiento_id: 99, requerimiento_codigo: "RC-2026-000099", numero_factura: "777" })];
    await expect(editar([{ ...linea, id: 21, numero_factura: "777", serie_factura: "A123" }])).rejects.toMatchObject({ status: 409, message: expect.stringContaining("RC-2026-000099") });
    expect(m.conn.commit).not.toHaveBeenCalled();
  });
  it("editar con dos líneas del mismo requerimiento iguales → 409 (payload)", async () => {
    const l = { ...linea, numero_factura: "5", serie_factura: "" };
    await expect(editar([{ ...l, id: 21 }, { ...l }])).rejects.toMatchObject({ status: 409 });
  });
});

describe("concurrencia — qué protege y qué NO (sin índice UNIQUE en BD)", () => {
  it("35) los locks son por empresa+proveedor, sin repetidos y en orden estable (sin deadlocks entre guardados)", () => {
    expect(clavesLockFacturas(1, [9, 3, 9, 5])).toEqual(["compras_facturas_1_3", "compras_facturas_1_5", "compras_facturas_1_9"]);
    expect(clavesLockFacturas(1, [3])).not.toEqual(clavesLockFacturas(2, [3])); // empresas distintas no se bloquean entre sí
  });
  const guardar = () => guardarRequerimiento(1, 8, "registrador", crearRequerimientoSchema.parse({ ...payload, lineas: [{ ...linea, numero_factura: "1", serie_factura: "" }] }), false);
  beforeEach(() => {
    vi.resetAllMocks();
    m.conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("GET_LOCK")) return [[{ l: 1 }]];
      if (sql.includes("RELEASE_LOCK")) return [[{ l: 1 }]];
      if (sql.includes("INNER JOIN compras_requerimientos r")) return [[]];
      if (sql.includes("FROM compras_linea_documentos")) return [[]];
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "E" }]];
      if (sql.includes("FROM usuarios")) return [[{ nombre: "U", rol_global: "Operaciones" }]];
      if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1, nombre_comercial: "P", razon_social: "S", nit: "1", banco: "B", numero_cuenta: "c", dias_credito: 0 }]];
      return [[]];
    });
    m.conn.execute.mockResolvedValue([{ insertId: 12, affectedRows: 1 }]); m.query.mockResolvedValue([]);
  });
  it("36) GET_LOCK se toma ANTES de beginTransaction y se libera al terminar (éxito)", async () => {
    await guardar();
    const orden = [...m.conn.query.mock.invocationCallOrder.map((o, i) => [o, String(m.conn.query.mock.calls[i][0])] as const)];
    const lockAt = orden.find(([, s]) => s.includes("GET_LOCK"))![0];
    const releaseAt = orden.find(([, s]) => s.includes("RELEASE_LOCK"))![0];
    expect(lockAt).toBeLessThan(m.conn.beginTransaction.mock.invocationCallOrder[0]);
    expect(releaseAt).toBeGreaterThan(m.conn.commit.mock.invocationCallOrder[0]);
  });
  it("37) el lock se libera también si el guardado falla, y luego se libera la conexión", async () => {
    m.conn.commit.mockRejectedValueOnce(new Error("fallo"));
    await expect(guardar()).rejects.toThrow();
    expect(m.conn.query.mock.calls.some(c => String(c[0]).includes("RELEASE_LOCK"))).toBe(true);
    expect(m.conn.release).toHaveBeenCalledOnce();
  });
  it("38) si no se obtiene el lock → 409 y no se abre transacción (no se inserta nada)", async () => {
    m.conn.query.mockImplementation(async (sql: string) => (sql.includes("GET_LOCK") ? [[{ l: 0 }]] : [[]]));
    await expect(guardar()).rejects.toMatchObject({ status: 409 });
    expect(m.conn.beginTransaction).not.toHaveBeenCalled();
    expect(m.conn.execute).not.toHaveBeenCalled();
  });
  it("39) LIMITACIÓN DOCUMENTADA: sin UNIQUE en BD, la protección es solo de esta aplicación (GET_LOCK + FOR UPDATE)", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/lib/compras/facturas-duplicadas.ts", "utf8");
    expect(fuente).toContain("NO protege contra inserciones manuales fuera de ella");
    expect(fuente).toContain("FOR UPDATE");
    // no existe (todavía) ninguna migración con el índice: se propone en el preflight y requiere autorización
    expect(readFileSync("sql/migrate-2026-09-compras-facturas-unicas.sql", "utf8")).toContain("uq_compras_factura_proveedor"); // el UNIQUE definitivo existe como migración (aplicarlo es manual)
  });
});
