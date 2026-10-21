import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CONSTANCIAS Y EVIDENCIA ESCANEADA contra una BASE REAL DESECHABLE (follow-up de #446).
 *
 * Se OMITE por defecto. Solo corre con `ENTREGAS_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1) con el esquema
 * `u611730801_Plataforma`, las tablas de Fondos/Gastos/Compras, firmas_electronicas y sql/migrate-2026-10-documento-entregas.sql.
 * Nunca lee .env ni usa credenciales reales (root sin contraseña, fijo a 127.0.0.1). El almacenamiento de archivos se simula en una
 * carpeta temporal con la misma regla de ruta por empresa (`empresas/<id>/...`). Ejecutar con `--no-file-parallelism`.
 *
 * Ejecuta los handlers REALES + el servicio común REAL + el generador de constancias REAL; solo se sustituye la puerta de sesión.
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
const almacen = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  return { fs, path, raiz: fs.mkdtempSync(path.join(os.tmpdir(), "entregas-db-")), guardados: [] as string[], borrados: [] as string[], n: 0 };
});
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(async (empresaId: number, subdir: string, prefijo: string, f: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }) => {
    const ext = f.name.slice(f.name.lastIndexOf("."));
    const relative = `empresas/${empresaId}/${subdir}/${prefijo}_${++almacen.n}${ext}`;
    const abs = almacen.path.join(almacen.raiz, relative);
    almacen.fs.mkdirSync(almacen.path.dirname(abs), { recursive: true });
    almacen.fs.writeFileSync(abs, Buffer.from(await f.arrayBuffer()));
    almacen.guardados.push(relative);
    return { relative, original: f.name, size: f.size };
  }),
  borrarUpload: vi.fn((r: string) => {
    almacen.borrados.push(r);
    try { almacen.fs.unlinkSync(almacen.path.join(almacen.raiz, r)); } catch { /* ya no existe */ }
  }),
  // Misma regla que la real: solo rutas dentro de `empresas/<empresaId>/` y sin traversal.
  validarRutaArchivoEmpresa: vi.fn((empresaId: number, ruta: unknown) => {
    if (typeof ruta !== "string" || ruta.includes("..") || !ruta.startsWith(`empresas/${empresaId}/`)) return null;
    return almacen.path.join(almacen.raiz, ruta);
  }),
}));
const sesion = vi.hoisted(() => ({ actual: null as unknown }));
vi.mock("@/lib/tenant", () => ({ requireTenantEntregas: vi.fn(async () => sesion.actual) }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({
  leerBytesFirmaGuardada: vi.fn(async () => ({ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).buffer, original: "guardada.png" })),
}));

import { getPool } from "@/lib/db";
import type { PermisoModulo } from "@/lib/permisos-shared";
import { VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import type { ActorEntrega } from "@/lib/entregas/reglas";
import { GET as historialGET, POST as registrarPOST } from "../[id]/entregas/route";
import { POST as recibirPOST } from "./[entregaId]/recibir/route";
import { POST as rechazarPOST } from "./[entregaId]/rechazar/route";
import { POST as presencialPOST } from "./[entregaId]/presencial/route";
import { POST as anularPOST } from "./[entregaId]/anular/route";
import { GET as constanciaGET } from "./[entregaId]/constancia/route";
import { GET as evidenciaGET } from "./[entregaId]/evidencia/route";

const EMPRESA_A = 9851;
const EMPRESA_B = 9852;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const rellenar = (cabecera: number[], total = 400) => { const u = new Uint8Array(total); u.set(cabecera); return u; };
const PDF = rellenar([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const JPEG = rellenar([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false });
const matriz = (...m: string[]): PermisoModulo[] => [
  { modulo: VERSION_PERMISOS, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false }, ...m.map(fila),
];
const U = { pres: 9861, ops: 9862, tes: 9863, adminB: 9864, sinPerm: 9865 };
const actores: Record<keyof typeof U, ActorEntrega> = {
  pres: { usuarioId: U.pres, username: "k_pres", nombre: "Pedro Presencial", rol: "JefeOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir", "entregas_presencial") },
  ops: { usuarioId: U.ops, username: "k_ops", nombre: "Olga Operaciones", rol: "JefeOperaciones", esAdmin: false, permisos: matriz("fondos_entrega_emitir") },
  tes: { usuarioId: U.tes, username: "k_tes", nombre: "Tere Tesorería", rol: "Contabilidad", esAdmin: false, permisos: matriz("entregas_area_tesoreria") },
  adminB: { usuarioId: U.adminB, username: "k_adminb", nombre: "Alba Admin B", rol: "Admin", esAdmin: true, permisos: [] },
  sinPerm: { usuarioId: U.sinPerm, username: "k_nada", nombre: "Nadia Nada", rol: "Operaciones", esAdmin: false, permisos: matriz("gastos") },
};
function como(actor: ActorEntrega, empresaId = EMPRESA_A) {
  sesion.actual = {
    session: { id: actor.usuarioId, username: actor.username, nombre: actor.nombre, rol: actor.rol },
    empresa: { id: empresaId, nombre: `Empresa ${empresaId}` },
    actor,
  };
}

let n = 0;
const clave = () => `clave_k_${process.pid}_${++n}`.padEnd(20, "x").slice(0, 64);
const ctxId = (id: number) => ({ params: Promise.resolve({ slug: "prueba", id: String(id) }) });
const ctxEntrega = (id: number) => ({ params: Promise.resolve({ slug: "prueba", entregaId: String(id) }) });
const formulario = (campos: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body: fd });
};
const archivo = (bytes: Uint8Array, nombre: string) => new File([bytes as BlobPart], nombre);
const vacia = () => new Request("http://localhost/x");

type Cuerpo = Record<string, unknown> & { error?: string; entrega?: { id: number; estado: string; tieneEvidencia: boolean; constancia: string | null }; entregas?: { id: number; estado: string; tieneEvidencia: boolean; constancia: string | null }[] };
async function json(p: Promise<Response>): Promise<{ status: number; cuerpo: Cuerpo }> {
  const r = await p;
  return { status: r.status, cuerpo: (await r.json()) as Cuerpo };
}
const registrar = (fondoId: number, modo: "SISTEMA" | "PRESENCIAL" = "SISTEMA") => json(registrarPOST(
  formulario({ destino: "TESORERIA", modo, claveIdempotencia: clave(), firmaImagen: archivo(PNG, "firma.png") }), ctxId(fondoId)));
const recibir = (id: number) => json(recibirPOST(formulario({ firmaImagen: archivo(PNG, "firma.png") }), ctxEntrega(id)));
const presencialConArchivo = (id: number, bytes: Uint8Array, nombre: string, extra: Record<string, string | File> = {}) =>
  json(presencialPOST(formulario({ nombreReceptor: "Juan Pérez", observaciones: "Ventanilla", evidencia: archivo(bytes, nombre), ...extra }), ctxEntrega(id)));
const constancia = (id: number) => constanciaGET(vacia(), ctxEntrega(id));
const evidencia = (id: number) => evidenciaGET(vacia(), ctxEntrega(id));
const historial = (fondoId: number) => json(historialGET(vacia(), ctxId(fondoId)));

async function filas<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await getPool().query(sql, params as never);
  return r as T[];
}
async function limpiar() {
  const pool = getPool();
  await pool.query("DELETE FROM documento_entregas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  await pool.query("DELETE FROM auditoria WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
}
let seq = 0;
async function nuevoFondo(empresa: number, estado = "Autorizada") {
  const [r] = await getPool().query(
    "INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total, requirente_nombre) VALUES (?, ?, '2026-10-01', ?, 1250.50, 'Mario Caal')",
    [empresa, `K-${process.pid}-${++seq}`, estado]);
  return Number((r as { insertId: number }).insertId);
}

describe.skipIf(!PUERTO)(`Constancias y evidencia escaneada contra BD real desechable (${ESQUEMA})`, () => {
  beforeAll(async () => {
    const pool = getPool();
    for (const e of [EMPRESA_A, EMPRESA_B]) await pool.query("INSERT IGNORE INTO empresas (id, codigo, nombre, slug) VALUES (?, ?, ?, ?)", [e, `E${e}`, `Prueba ${e}`, `prueba-k-${e}`]);
    for (const [k, id] of Object.entries(U)) {
      const a = actores[k as keyof typeof U];
      await pool.query("INSERT IGNORE INTO usuarios (id, username, password_hash, salt, nombre, rol_global) VALUES (?, ?, 'x', 'x', ?, ?)", [id, a.username, a.nombre, a.rol]);
    }
    await limpiar();
    await pool.query("DELETE FROM tms_solicitudes_fondo WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B]);
  });
  beforeEach(async () => {
    await limpiar();
    almacen.guardados.length = 0; almacen.borrados.length = 0;
  });
  afterAll(async () => {
    await limpiar();
    await getPool().end();
    almacen.fs.rmSync(almacen.raiz, { recursive: true, force: true });
  });

  /** Cada archivo escrito está referenciado por exactamente una firma o fue compensado (borrado). */
  async function archivosConsistentes() {
    const rutas = (await filas<{ imagen_ruta: string }>("SELECT imagen_ruta FROM firmas_electronicas WHERE empresa_id IN (?, ?)", [EMPRESA_A, EMPRESA_B])).map((f) => f.imagen_ruta).sort();
    expect(almacen.guardados.filter((r) => !almacen.borrados.includes(r)).sort()).toEqual(rutas);
    for (const r of rutas) expect(almacen.fs.existsSync(almacen.path.join(almacen.raiz, r))).toBe(true);
  }

  it("PRESENCIAL: emitir → pendiente → constancia previa (receptor en blanco) → recepción con PDF → RECIBIDA con evidencia vinculada", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.pres);
    const emitida = await registrar(fondo, "PRESENCIAL");
    expect(emitida.status).toBe(201);
    expect(emitida.cuerpo.entrega).toMatchObject({ estado: "EMITIDA", constancia: "PREVIA", tieneEvidencia: false });
    const id = emitida.cuerpo.entrega!.id;

    // Constancia previa: PDF descargable, deja el estado EMITIDA (no recibe nada).
    const previa = await constancia(id);
    expect(previa.status).toBe(200);
    expect(previa.headers.get("content-type")).toBe("application/pdf");
    expect(previa.headers.get("content-disposition")).toContain("para-firma");
    expect(Buffer.from(await previa.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await filas<{ estado: string }>("SELECT estado FROM documento_entregas WHERE id = ?", [id]))[0].estado).toBe("EMITIDA");
    expect((await evidencia(id)).status).toBe(404); // aún no hay evidencia

    // Registrar la recepción con el PDF escaneado.
    const recibida = await presencialConArchivo(id, PDF, "escaneo.pdf");
    expect(recibida.status).toBe(200);
    expect(recibida.cuerpo.entrega).toMatchObject({ estado: "RECIBIDA", constancia: "FINAL", tieneEvidencia: true, recibidoPor: "Juan Pérez", recepcionOperadaPor: "Pedro Presencial" });

    // Vínculo: entrega → firma_recepcion_id → fila ESCANEADA del mismo documento y empresa, sin usuario receptor.
    const [e] = await filas<{ firma_recepcion_id: number; recibido_por_usuario_id: number | null; recepcion_operada_por_usuario_id: number }>(
      "SELECT firma_recepcion_id, recibido_por_usuario_id, recepcion_operada_por_usuario_id FROM documento_entregas WHERE id = ?", [id]);
    expect(e.recibido_por_usuario_id).toBeNull();
    expect(e.recepcion_operada_por_usuario_id).toBe(U.pres);
    const [f] = await filas<{ empresa_id: number; usuario_id: number | null; modulo: string; entidad_tipo: string; entidad_id: number; accion: string;
      imagen_ruta: string; imagen_mime: string; payload_canonico: string }>("SELECT * FROM firmas_electronicas WHERE id = ?", [e.firma_recepcion_id]);
    expect(f).toMatchObject({ empresa_id: EMPRESA_A, usuario_id: null, modulo: "FONDOS", entidad_tipo: "SOLICITUD_FONDO", entidad_id: fondo, accion: "RECIBIR_DOCUMENTO", imagen_mime: "application/pdf" });
    expect(f.imagen_ruta).toMatch(new RegExp(`^empresas/${EMPRESA_A}/evidencias/constancia_firmada_${id}_`));
    expect(JSON.parse(f.payload_canonico)).toMatchObject({
      origenFirma: "ESCANEADA", nombreFirmante: "Juan Pérez",
      valoresRelevantes: { entregaId: id, operadorUsuarioId: U.pres, evidencia: { tipo: "CONSTANCIA_FIRMADA_ESCANEADA", mime: "application/pdf" } },
    });

    // La evidencia se descarga íntegra y con cabeceras seguras; el historial marca tieneEvidencia.
    const ev = await evidencia(id);
    expect(ev.status).toBe(200);
    expect(ev.headers.get("content-type")).toBe("application/pdf");
    expect(ev.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await ev.arrayBuffer())).toEqual(PDF);
    const h = await historial(fondo);
    expect(h.cuerpo.entregas![0]).toMatchObject({ estado: "RECIBIDA", tieneEvidencia: true, constancia: "FINAL" });

    // Constancia final disponible; no se puede registrar otra recepción.
    expect((await constancia(id)).status).toBe(200);
    expect((await presencialConArchivo(id, PDF, "otra.pdf", { nombreReceptor: "Otra Persona" })).status).toBe(409);
    await archivosConsistentes();
  });

  it("PNG y JPEG escaneados también se aceptan; la extensión la decide el formato real", async () => {
    como(actores.pres);
    for (const [bytes, nombre, mime, ext] of [[PNG, "escaneo.png", "image/png", ".png"], [JPEG, "foto.jpeg", "image/jpeg", ".jpg"]] as const) {
      const fondo = await nuevoFondo(EMPRESA_A);
      const id = (await registrar(fondo, "PRESENCIAL")).cuerpo.entrega!.id;
      expect((await presencialConArchivo(id, bytes, nombre)).status).toBe(200);
      const ev = await evidencia(id);
      expect(ev.headers.get("content-type")).toBe(mime);
      const [f] = await filas<{ imagen_ruta: string }>("SELECT fe.imagen_ruta FROM documento_entregas de JOIN firmas_electronicas fe ON fe.id = de.firma_recepcion_id WHERE de.id = ?", [id]);
      expect(f.imagen_ruta.endsWith(ext)).toBe(true);
    }
    await archivosConsistentes();
  });

  it("firma dibujada como alternativa: RECIBIDA sin evidencia (el historial muestra «Sin evidencia adjunta») y constancia final", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.pres);
    const id = (await registrar(fondo, "PRESENCIAL")).cuerpo.entrega!.id;
    const r = await json(presencialPOST(formulario({ nombreReceptor: "Juan Pérez", firmaImagen: archivo(PNG, "firma.png") }), ctxEntrega(id)));
    expect(r.status).toBe(200);
    expect(r.cuerpo.entrega).toMatchObject({ estado: "RECIBIDA", tieneEvidencia: false, constancia: "FINAL" });
    expect((await evidencia(id)).status).toBe(404);
    expect((await historial(fondo)).cuerpo.entregas![0].tieneEvidencia).toBe(false);
    expect((await constancia(id)).status).toBe(200);
    const [f] = await filas<{ payload_canonico: string }>("SELECT fe.payload_canonico FROM documento_entregas de JOIN firmas_electronicas fe ON fe.id = de.firma_recepcion_id WHERE de.id = ?", [id]);
    expect(JSON.parse(f.payload_canonico).origenFirma).toBe("DIBUJADA");
    await archivosConsistentes();
  });

  it("archivo inválido, > 10 MB, o evidencia + firma a la vez => rechazo; la entrega sigue EMITIDA y no queda ningún archivo", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.pres);
    const id = (await registrar(fondo, "PRESENCIAL")).cuerpo.entrega!.id;
    const antes = almacen.guardados.length;
    const texto = new TextEncoder().encode("no soy un pdf");
    expect((await presencialConArchivo(id, texto, "constancia.pdf")).status).toBe(400);
    expect((await presencialConArchivo(id, new TextEncoder().encode("<html></html>"), "constancia.png")).status).toBe(400);
    const enorme = new Uint8Array(10 * 1024 * 1024 + 1); enorme.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect((await presencialConArchivo(id, enorme, "grande.pdf")).status).toBe(400);
    expect((await presencialConArchivo(id, PDF, "e.pdf", { firmaImagen: archivo(PNG, "firma.png") })).status).toBe(400);
    expect((await json(presencialPOST(formulario({ nombreReceptor: "Juan", usarFirmaGuardada: "true" }), ctxEntrega(id)))).status).toBe(400);
    expect((await json(presencialPOST(formulario({ nombreReceptor: "Juan" }), ctxEntrega(id)))).status).toBe(400);
    expect((await filas<{ estado: string }>("SELECT estado FROM documento_entregas WHERE id = ?", [id]))[0].estado).toBe("EMITIDA");
    expect(almacen.guardados.length).toBe(antes); // ninguna copia a disco
    await archivosConsistentes();
  });

  it("sin entregas_presencial => 403 y sin archivos; el emisor sin ese permiso no puede registrar la recepción", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.pres);
    const id = (await registrar(fondo, "PRESENCIAL")).cuerpo.entrega!.id;
    for (const quien of [actores.ops, actores.tes, actores.sinPerm]) {
      como(quien);
      const r = await presencialConArchivo(id, PDF, "e.pdf");
      expect([403]).toContain(r.status);
    }
    expect(almacen.guardados.filter((r) => r.includes("evidencias"))).toEqual([]);
    expect((await filas<{ estado: string }>("SELECT estado FROM documento_entregas WHERE id = ?", [id]))[0].estado).toBe("EMITIDA");
  });

  it("TENANT: otra empresa (aun Admin) no puede ver constancia ni evidencia ni registrar la recepción; y su ruta no sirve archivos ajenos", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.pres);
    const id = (await registrar(fondo, "PRESENCIAL")).cuerpo.entrega!.id;
    expect((await presencialConArchivo(id, PDF, "e.pdf")).status).toBe(200);

    como(actores.adminB, EMPRESA_B);
    expect((await constancia(id)).status).toBe(404);
    expect((await evidencia(id)).status).toBe(404);
    expect((await presencialConArchivo(id, PDF, "e.pdf")).status).toBe(404);
    // Aun conociendo la ruta física, el servidor solo sirve archivos de la carpeta de la empresa de la SESIÓN.
    const { validarRutaArchivoEmpresa } = await import("@/lib/uploads");
    const [f] = await filas<{ imagen_ruta: string }>("SELECT fe.imagen_ruta FROM documento_entregas de JOIN firmas_electronicas fe ON fe.id = de.firma_recepcion_id WHERE de.id = ?", [id]);
    expect(validarRutaArchivoEmpresa(EMPRESA_B, f.imagen_ruta)).toBeNull();
    expect(validarRutaArchivoEmpresa(EMPRESA_A, `empresas/${EMPRESA_A}/../${EMPRESA_B}/x.pdf`)).toBeNull();
  });

  it("SISTEMA: sin constancia previa; tras recibir digitalmente hay constancia final con emitido y recibido", async () => {
    const fondo = await nuevoFondo(EMPRESA_A);
    como(actores.ops);
    const e = (await registrar(fondo, "SISTEMA")).cuerpo.entrega!;
    expect(e).toMatchObject({ estado: "EMITIDA", constancia: null });
    const previa = await constancia(e.id);
    expect(previa.status).toBe(409);
    expect((await previa.json()).error).toMatch(/confirme la recepción/);

    como(actores.tes);
    const rec = await recibir(e.id);
    expect(rec.cuerpo.entrega).toMatchObject({ estado: "RECIBIDA", constancia: "FINAL", tieneEvidencia: false });
    const final = await constancia(e.id);
    expect(final.status).toBe(200);
    expect(Buffer.from(await final.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // Una entrega en el sistema no tiene evidencia escaneada.
    expect((await evidencia(e.id)).status).toBe(404);
    await archivosConsistentes();
  });

  it("RECHAZADA y ANULADA: nunca generan constancia final", async () => {
    como(actores.ops);
    const rechazada = (await registrar(await nuevoFondo(EMPRESA_A), "SISTEMA")).cuerpo.entrega!;
    como(actores.tes);
    expect((await json(rechazarPOST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: "No corresponde" }) }), ctxEntrega(rechazada.id)))).status).toBe(200);
    expect((await constancia(rechazada.id)).status).toBe(409);

    como(actores.pres);
    const anulada = (await registrar(await nuevoFondo(EMPRESA_A), "PRESENCIAL")).cuerpo.entrega!;
    expect((await constancia(anulada.id)).status).toBe(200); // pendiente presencial: previa
    expect((await json(anularPOST(new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo: "Error" }) }), ctxEntrega(anulada.id)))).status).toBe(200);
    const tras = await constancia(anulada.id);
    expect(tras.status).toBe(409);
    expect((await tras.json()).error).toMatch(/rechazada o anulada/);
  });
});
