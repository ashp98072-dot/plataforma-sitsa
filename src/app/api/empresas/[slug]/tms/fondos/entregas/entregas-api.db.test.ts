import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INTEGRACIÓN DE LOS ENDPOINTS DE ENTREGAS DE FONDOS CONTRA UNA BASE REAL DESECHABLE (PR 2).
 *
 * Se OMITE por defecto. Solo corre con `ENTREGAS_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1) con el esquema
 * `u611730801_Plataforma`, las tablas de Fondos/Gastos/Compras, firmas_electronicas y sql/migrate-2026-10-documento-entregas.sql.
 * Nunca lee .env ni usa credenciales reales (root sin contraseña, fijo a 127.0.0.1). Los archivos de firma se simulan.
 *
 * Ejecuta los handlers REALES + el servicio común REAL; solo se sustituye la puerta de sesión (`requireTenantEntregas`) para
 * elegir quién opera y en qué empresa. Peticiones concurrentes verdaderas.
 *
 * EJECUTAR CON `--no-file-parallelism` junto a los demás archivos `*.db.test.ts`: comparten la misma base desechable y sus datos de
 * prueba no deben mezclarse. (El deadlock entre emisiones de documentos distintos que antes aparecía al correrlos en paralelo ya
 * está corregido en el servicio: ver docs/FONDOS-CONTROL-ENTREGA.md y src/lib/entregas/entregas-concurrencia.db.test.ts.)
 */
const PUERTO = process.env.ENTREGAS_DB_PORT;
const ESQUEMA = process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) {
      pool = mysql.createPool({
        host: "127.0.0.1", port: Number(process.env.ENTREGAS_DB_PORT), user: "root", password: "",
        database: process.env.ENTREGAS_DB_SCHEMA ?? "u611730801_Plataforma", connectionLimit: 20, timezone: "local",
      });
    }
    return pool;
  };
  return {
    getPool: obtener,
    query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0],
    execute: async (sql: string, params: unknown[] = []) => (await obtener().execute(sql, params as never))[0],
  };
});
const archivos = vi.hoisted(() => ({ guardados: [] as string[], borrados: [] as string[], n: 0 }));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(async (empresaId: number, _s: string, prefijo: string, f: { name: string; size: number }) => {
    const relative = `empresas/${empresaId}/firmas/${prefijo}_${++archivos.n}.png`;
    archivos.guardados.push(relative);
    return { relative, original: f.name, size: f.size };
  }),
  borrarUpload: vi.fn((r: string) => { archivos.borrados.push(r); }),
}));
// Sesión por defecto + sesión por contexto asíncrono (AsyncLocalStorage): permite que peticiones CONCURRENTES operen con actores distintos.
const sesion = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { actual: null as unknown, als: new AsyncLocalStorage<unknown>() };
});
vi.mock("@/lib/tenant", () => ({ requireTenantEntregas: vi.fn(async () => sesion.als.getStore() ?? sesion.actual) }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({
  leerBytesFirmaGuardada: vi.fn(async () => ({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer, original: "guardada.png" })),
}));

import { getPool } from "@/lib/db";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import type { ActorEntrega } from "@/lib/entregas/reglas";
import { GET as historialGET, POST as registrarPOST } from "../[id]/entregas/route";
import { GET as porRecibirGET } from "./por-recibir/route";
import { GET as resumenGET } from "./resumen/route";
import { POST as recibirPOST } from "./[entregaId]/recibir/route";
import { POST as rechazarPOST } from "./[entregaId]/rechazar/route";
import { POST as presencialPOST } from "./[entregaId]/presencial/route";
import { POST as anularPOST } from "./[entregaId]/anular/route";

const EMPRESA_A = 9801;
const EMPRESA_B = 9802;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false });
const matriz = (...m: string[]): PermisoModulo[] => [
  { modulo: VERSION_PERMISOS, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }, ...m.map(fila),
];

const U = { ops: 9811, ops2: 9812, tes: 9813, tes2: 9814, cont: 9815, pres: 9816, anula: 9817, adminB: 9818, tesB: 9819 };
const actores: Record<keyof typeof U, ActorEntrega> = {
  ops: { usuarioId: U.ops, username: "api_ops", nombre: "Olga Operaciones", rol: "JefeOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir") },
  ops2: { usuarioId: U.ops2, username: "api_ops2", nombre: "Oscar Operaciones", rol: "AuxiliarOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir") },
  tes: { usuarioId: U.tes, username: "api_tes", nombre: "Tere Tesorería", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
  tes2: { usuarioId: U.tes2, username: "api_tes2", nombre: "Tomás Tesorería", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
  cont: { usuarioId: U.cont, username: "api_cont", nombre: "Carla Contabilidad", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_contabilidad") },
  pres: { usuarioId: U.pres, username: "api_pres", nombre: "Pedro Presencial", rol: "JefeOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir", "entregas_presencial") },
  anula: { usuarioId: U.anula, username: "api_anula", nombre: "Ana Anula", rol: "GerenteOperaciones", esAdmin: false, permisos: matriz("entregas_anular") },
  // Una Admin y una usuaria de Tesorería de OTRA empresa: nada de lo de la empresa A debe ser visible ni operable para ellas.
  adminB: { usuarioId: U.adminB, username: "api_adminb", nombre: "Alba Admin B", rol: "Admin", esAdmin: true, permisos: [] },
  tesB: { usuarioId: U.tesB, username: "api_tesb", nombre: "Tina Tesorería B", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
};
function sesionDe(actor: ActorEntrega, empresaId = EMPRESA_A) {
  return {
    session: { id: actor.usuarioId, username: actor.username, nombre: actor.nombre, rol: actor.rol },
    empresa: { id: empresaId, nombre: `Empresa ${empresaId}` },
    actor,
  };
}
function como(actor: ActorEntrega, empresaId = EMPRESA_A) {
  sesion.actual = sesionDe(actor, empresaId);
}
/** Ejecuta `fn` con la sesión de `actor` fijada para ESA petición (segura ante concurrencia). */
const conSesion = <T,>(actor: ActorEntrega, fn: () => Promise<T>, empresaId = EMPRESA_A): Promise<T> =>
  sesion.als.run(sesionDe(actor, empresaId), fn);

const doc = { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, pendiente: 0, b1: 0 };
let n = 0;
const clave = () => `clave_api_${process.pid}_${++n}`.padEnd(20, "x").slice(0, 64);

const ctxId = (id: number) => ({ params: Promise.resolve({ slug: "prueba", id: String(id) }) });
const ctxEntrega = (id: number) => ({ params: Promise.resolve({ slug: "prueba", entregaId: String(id) }) });
const ctxSlug = { params: Promise.resolve({ slug: "prueba" }) };
function formulario(campos: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body: fd });
}
const firma = () => new File([PNG], "firma.png", { type: "image/png" });
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const vacia = () => new Request("http://localhost/x");

type Cuerpo = Record<string, unknown> & { error?: string; entrega?: { id: number; estado: string }; entregas?: { id: number; estado: string }[]; repetida?: boolean };
async function resp(p: Promise<Response>): Promise<{ status: number; cuerpo: Cuerpo }> {
  const r = await p;
  return { status: r.status, cuerpo: (await r.json()) as Cuerpo };
}

const registrar = (fondoId: number, destino: string, extra: Record<string, string> = {}) =>
  resp(registrarPOST(formulario({ destino, modo: "SISTEMA", claveIdempotencia: clave(), firmaImagen: firma(), ...extra }), ctxId(fondoId)));
const recibir = (entregaId: number) => resp(recibirPOST(formulario({ firmaImagen: firma() }), ctxEntrega(entregaId)));
const rechazar = (entregaId: number, motivo = "Falta documentación") => resp(rechazarPOST(json({ motivo }), ctxEntrega(entregaId)));
const anular = (entregaId: number, motivo = "Error de destino") => resp(anularPOST(json({ motivo }), ctxEntrega(entregaId)));
const presencial = (entregaId: number, nombre = "Juan Pérez") => resp(presencialPOST(formulario({ nombreReceptor: nombre, firmaImagen: firma() }), ctxEntrega(entregaId)));
const historial = (fondoId: number) => resp(historialGET(vacia(), ctxId(fondoId)));
const bandeja = () => resp(porRecibirGET(vacia(), ctxSlug));

async function contar(sql: string, params: unknown[] = []) {
  const [r] = await getPool().query(sql, params as never);
  return Number((r as { n: number }[])[0].n);
}
async function limpiar() {
  const pool = getPool();
  await pool.query("DELETE FROM documento_entregas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM auditoria WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
}
async function crearFondo(empresa: number, codigo: string, estado: string) {
  const [r] = await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado) VALUES (?, ?, '2026-10-01', ?)", [empresa, codigo, estado]);
  return Number((r as { insertId: number }).insertId);
}

describe.skipIf(!PUERTO)(`API de entregas de Fondos contra BD real desechable (${ESQUEMA})`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const e of [EMPRESA_A, EMPRESA_B]) await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [e, `E${e}`, `Prueba ${e}`, `prueba-api-${e}`]);
    for (const [k, id] of Object.entries(U)) {
      const a = actores[k as keyof typeof U];
      await pool.query("INSERT IGNORE INTO usuarios (id, username, password_hash, salt, nombre, rol_global) VALUES (?, ?, 'x', 'x', ?, ?)", [id, a.username, a.nombre, a.rol]);
    }
    await limpiar();
    await pool.query("DELETE FROM tms_solicitudes_fondo WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
    doc.a1 = await crearFondo(EMPRESA_A, "API-A-1", "Autorizada");
    doc.a2 = await crearFondo(EMPRESA_A, "API-A-2", "Autorizada");
    doc.a3 = await crearFondo(EMPRESA_A, "API-A-3", "Liquidada");
    doc.a4 = await crearFondo(EMPRESA_A, "API-A-4", "Autorizada");
    doc.a5 = await crearFondo(EMPRESA_A, "API-A-5", "Autorizada");
    doc.pendiente = await crearFondo(EMPRESA_A, "API-A-PEND", "Pendiente");
    doc.b1 = await crearFondo(EMPRESA_B, "API-B-1", "Autorizada");
  });
  beforeEach(async () => {
    await limpiar();
    archivos.guardados.length = 0; archivos.borrados.length = 0;
  });
  afterAll(async () => {
    await limpiar();
    await getPool().end();
  });

  async function imagenesConsistentes() {
    const [filas] = await getPool().query("SELECT imagen_ruta FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
    const rutas = (filas as { imagen_ruta: string }[]).map((f) => f.imagen_ruta).sort();
    expect(archivos.guardados.filter((r) => !archivos.borrados.includes(r)).sort()).toEqual(rutas);
  }

  it("flujo SISTEMA completo por los endpoints: registrar → bandeja → recibir → siguiente etapa → rechazar; historial y resumen", async () => {
    como(actores.ops);
    const r1 = await registrar(doc.a1, "TESORERIA", { observaciones: "Expediente completo" });
    expect(r1.status).toBe(201);
    expect(r1.cuerpo.entrega).toMatchObject({ estado: "EMITIDA", estadoEtiqueta: "Pendiente", origenEtiqueta: "Operaciones", destinoEtiqueta: "Tesorería" });
    const idE1 = r1.cuerpo.entrega!.id;

    // El emisor no ve su propia entrega en la bandeja; Tesorería sí; Contabilidad no.
    expect((await bandeja()).cuerpo.entregas).toEqual([]);
    como(actores.cont);
    expect((await bandeja()).cuerpo.entregas).toEqual([]);
    como(actores.tes);
    const b = await bandeja();
    expect(b.cuerpo.entregas!.map((e) => e.id)).toEqual([idE1]);

    // Resumen del listado (una consulta): custodia Operaciones + pendiente hacia Tesorería.
    como(actores.ops);
    const resumen = (await resp(resumenGET(new Request(`http://localhost/x?ids=${doc.a1},${doc.a2}`), ctxSlug))).cuerpo.resumen as Record<string, { custodia: string; pendiente: { texto: string } | null }>;
    expect(resumen[doc.a1]).toMatchObject({ custodia: "OPERACIONES", pendiente: { texto: "Entrega pendiente → Tesorería" } });
    expect(resumen[doc.a2]).toMatchObject({ custodia: "OPERACIONES", pendiente: null });

    // El emisor tampoco puede registrar OTRA mientras hay una pendiente.
    const dup = await registrar(doc.a1, "CONTABILIDAD");
    expect(dup.status).toBe(409);

    como(actores.tes);
    const rec = await recibir(idE1);
    expect(rec.status).toBe(200);
    expect(rec.cuerpo.entrega).toMatchObject({ estado: "RECIBIDA", recibidoPor: "Tere Tesorería" });

    // Ahora la custodia es de Tesorería: Operaciones ya no puede entregar; Tesorería sí, hacia Contabilidad.
    como(actores.ops);
    expect((await historial(doc.a1)).cuerpo.registrar).toMatchObject({ permitido: false });
    como(actores.tes);
    const h = (await historial(doc.a1)).cuerpo as { custodia: { area: string }; registrar: { permitido: boolean; destinos: { destino: string }[] } };
    expect(h.custodia.area).toBe("TESORERIA");
    expect(h.registrar.destinos.map((d) => d.destino)).toEqual(["CONTABILIDAD"]);
    const r2 = await registrar(doc.a1, "CONTABILIDAD");
    expect(r2.status).toBe(201);

    // Contabilidad rechaza con motivo: la custodia sigue en Tesorería.
    como(actores.cont);
    expect((await rechazar(r2.cuerpo.entrega!.id, "")).status).toBe(400);
    const rech = await rechazar(r2.cuerpo.entrega!.id, "Falta la factura");
    expect(rech.cuerpo.entrega).toMatchObject({ estado: "RECHAZADA", motivoCierre: "Falta la factura", estadoEtiqueta: "Rechazada" });
    como(actores.tes);
    const hf = (await historial(doc.a1)).cuerpo as unknown as { custodia: { area: string }; pendiente: unknown; entregas: { estado: string }[] };
    expect(hf.custodia.area).toBe("TESORERIA");
    expect(hf.pendiente).toBeNull();
    expect(hf.entregas.map((e) => e.estado)).toEqual(["RECIBIDA", "RECHAZADA"]);

    // El estado del documento NO cambió con ninguna entrega.
    const [estado] = await getPool().query("SELECT estado FROM tms_solicitudes_fondo WHERE id = ?", [doc.a1]);
    expect((estado as { estado: string }[])[0].estado).toBe("Autorizada");
    await imagenesConsistentes();
  });

  it("doble clic: 8 envíos simultáneos con la MISMA clave crean UNA entrega y una firma", async () => {
    como(actores.ops);
    const k = clave();
    const rs = await Promise.all(Array.from({ length: 8 }, () => resp(registrarPOST(
      formulario({ destino: "TESORERIA", modo: "SISTEMA", claveIdempotencia: k, firmaImagen: firma() }), ctxId(doc.a2)))));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(rs.map((r) => r.cuerpo.entrega!.id)).size).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'ENTREGAR_DOCUMENTO'", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("intentos concurrentes con claves distintas (dos usuarios) no crean dos pendientes", async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      conSesion(i % 2 ? actores.ops : actores.ops2, () => resp(registrarPOST(
        formulario({ destino: i % 3 ? "TESORERIA" : "CONTABILIDAD", modo: "SISTEMA", claveIdempotencia: clave(), firmaImagen: firma() }), ctxId(doc.a3))))));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND estado = 'EMITIDA'", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("recibir dos veces a la vez (dos receptores): una sola recepción y una sola firma de recibo", async () => {
    como(actores.ops);
    const e = (await registrar(doc.a4, "TESORERIA")).cuerpo.entrega!;
    const intento = (actor: ActorEntrega) => conSesion(actor, () => recibir(e.id));
    const rs = await Promise.all([intento(actores.tes), intento(actores.tes2), intento(actores.tes), intento(actores.tes2)]);
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(await contar("SELECT COUNT(*) AS n FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'RECIBIR_DOCUMENTO'", [EMPRESA_A])).toBe(1);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ? AND estado = 'RECIBIDA'", [EMPRESA_A])).toBe(1);
    await imagenesConsistentes();
  });

  it("rechazar y recibir a la vez: gana uno solo y el estado final es coherente", async () => {
    como(actores.ops);
    const e = (await registrar(doc.a5, "TESORERIA")).cuerpo.entrega!;
    const [a, b] = await Promise.all([
      conSesion(actores.tes, () => recibir(e.id)),
      conSesion(actores.tes2, () => rechazar(e.id, "No la necesito")),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const [filas] = await getPool().query("SELECT estado, firma_recepcion_id, cerrado_por_usuario_id FROM documento_entregas WHERE id = ?", [e.id]);
    const f = (filas as { estado: string; firma_recepcion_id: number | null; cerrado_por_usuario_id: number | null }[])[0];
    expect(["RECIBIDA", "RECHAZADA"]).toContain(f.estado);
    if (f.estado === "RECIBIDA") expect(f.cerrado_por_usuario_id).toBeNull();
    else expect(f.firma_recepcion_id).toBeNull();
    await imagenesConsistentes();
  });

  it("PRESENCIAL: exige entregas_presencial al registrar, no aparece en la bandeja y se recibe con firma dibujada sin usuario", async () => {
    como(actores.ops); // tiene el área de origen pero NO entregas_presencial
    expect((await registrar(doc.a1, "TESORERIA", { modo: "PRESENCIAL" })).status).toBe(403);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    expect(archivos.guardados).toEqual([]);

    como(actores.pres);
    const r = await registrar(doc.a1, "TESORERIA", { modo: "PRESENCIAL" });
    expect(r.status).toBe(201);
    const id = r.cuerpo.entrega!.id;

    como(actores.tes);
    expect((await bandeja()).cuerpo.entregas).toEqual([]); // las presenciales no van en la bandeja normal
    expect((await recibir(id)).status).toBe(409);
    expect((await rechazar(id)).status).toBe(409);
    expect((await presencial(id)).status).toBe(403); // Tesorería sin entregas_presencial no puede registrarla

    como(actores.pres);
    expect((await resp(presencialPOST(formulario({ nombreReceptor: "Juan Pérez", usarFirmaGuardada: "true" }), ctxEntrega(id)))).status).toBe(400);
    expect((await presencial(id, "   ")).status).toBe(400);
    const ok = await presencial(id, "Juan Pérez");
    expect(ok.status).toBe(200);
    expect(ok.cuerpo.entrega).toMatchObject({ estado: "RECIBIDA", recibidoPor: "Juan Pérez", recepcionOperadaPor: "Pedro Presencial", modo: "PRESENCIAL" });
    const [f] = await getPool().query(
      "SELECT usuario_id FROM firmas_electronicas WHERE empresa_id = ? AND accion = 'RECIBIR_DOCUMENTO'", [EMPRESA_A]);
    expect((f as { usuario_id: number | null }[])[0].usuario_id).toBeNull();
    await imagenesConsistentes();
  });

  it("anular: el emisor o entregas_anular; nunca una RECIBIDA; el motivo es obligatorio", async () => {
    como(actores.ops);
    const e = (await registrar(doc.a1, "TESORERIA")).cuerpo.entrega!;
    como(actores.ops2);
    expect((await anular(e.id)).status).toBe(403);
    como(actores.ops);
    expect((await anular(e.id, "  ")).status).toBe(400);
    expect((await anular(e.id)).cuerpo.entrega).toMatchObject({ estado: "ANULADA", estadoEtiqueta: "Anulada" });

    const e2 = (await registrar(doc.a1, "TESORERIA")).cuerpo.entrega!;
    como(actores.anula);
    expect((await anular(e2.id, "Emisor ausente")).status).toBe(200);

    como(actores.ops);
    const e3 = (await registrar(doc.a1, "TESORERIA")).cuerpo.entrega!;
    como(actores.tes);
    expect((await recibir(e3.id)).status).toBe(200);
    como(actores.ops);
    expect((await anular(e3.id)).status).toBe(409);
    como(actores.anula);
    expect((await anular(e3.id)).status).toBe(409);
  });

  it("TENANT: otra empresa (aun siendo Admin) no puede ver historial, listar, recibir, rechazar, anular ni registrar presencial", async () => {
    como(actores.ops);
    const e = (await registrar(doc.a1, "TESORERIA")).cuerpo.entrega!;
    const ep = (await (async () => { como(actores.pres); return registrar(doc.a2, "TESORERIA", { modo: "PRESENCIAL" }); })()).cuerpo.entrega!;

    for (const otra of [actores.adminB, actores.tesB]) {
      como(otra, EMPRESA_B);
      // Historial de una solicitud de A visto desde B: 404 (igual que inexistente).
      const h = await historial(doc.a1);
      expect(h.status).toBe(404);
      expect(JSON.stringify(h.cuerpo)).not.toMatch(/Olga|SF|API-A|TESORERIA/);
      // Bandeja de B: no contiene nada de A.
      expect((await bandeja()).cuerpo.entregas).toEqual([]);
      // Acciones sobre entregas de A: 404, sin tocar nada.
      expect((await recibir(e.id)).status).toBe(404);
      expect((await rechazar(e.id)).status).toBe(404);
      expect((await anular(e.id)).status).toBe(404);
      expect((await presencial(ep.id)).status).toBe(404);
      // Registrar sobre un documento de A desde B: 404.
      expect((await registrar(doc.a1, "CONTABILIDAD")).status).toBe(404);
      // El resumen no revela nada: custodia inicial y sin pendiente.
      const res = (await resp(resumenGET(new Request(`http://localhost/x?ids=${doc.a1}`), ctxSlug))).cuerpo.resumen as Record<string, { pendiente: unknown; total: number }>;
      expect(res[doc.a1]).toMatchObject({ pendiente: null, total: 0 });
    }
    // Todo sigue intacto en A.
    const [filas] = await getPool().query("SELECT id, estado FROM documento_entregas WHERE empresa_id = ? ORDER BY id", [EMPRESA_A]);
    expect((filas as { estado: string }[]).map((f) => f.estado)).toEqual(["EMITIDA", "EMITIDA"]);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_B])).toBe(0);
    await imagenesConsistentes();
  });

  it("documento no admitido (Pendiente) => 409 y sin entrega; id inexistente => 404", async () => {
    como(actores.ops);
    expect((await registrar(doc.pendiente, "TESORERIA")).status).toBe(409);
    expect((await registrar(99999999, "TESORERIA")).status).toBe(404);
    expect(await contar("SELECT COUNT(*) AS n FROM documento_entregas WHERE empresa_id = ?", [EMPRESA_A])).toBe(0);
    await imagenesConsistentes();
  });
});
