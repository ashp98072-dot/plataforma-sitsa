import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ENDPOINTS DE ENTREGAS DE SOLICITUDES DE FONDO (PR 2) — con el servicio común mockeado: se prueba lo que es propio de los
 * endpoints (puerta de permisos, empresa y actor SIEMPRE de la sesión, lectura de la firma, contrato de respuesta, 404 sin
 * filtrar otras empresas/módulos). Las reglas de negocio (custodia, pares, idempotencia, concurrencia) las prueban los tests de
 * `src/lib/entregas` contra una base real desechable.
 */
const m = vi.hoisted(() => ({
  requireTenantEntregas: vi.fn(),
  leerBytesFirmaGuardada: vi.fn(),
  leerDocumento: vi.fn(),
  registrarEntrega: vi.fn(),
  confirmarRecepcion: vi.fn(),
  rechazarRecepcion: vi.fn(),
  anularEntrega: vi.fn(),
  registrarRecepcionPresencial: vi.fn(),
  listarEntregasDocumento: vi.fn(),
  listarEntregasPorRecibir: vi.fn(),
  obtenerEntrega: vi.fn(),
  resumen: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantEntregas: m.requireTenantEntregas }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: m.leerBytesFirmaGuardada }));
vi.mock("@/lib/entregas/adaptadores", () => ({ leerDocumento: m.leerDocumento }));
vi.mock("@/lib/entregas/resumen", () => ({ MAX_IDS_RESUMEN: 500, resumenEntregasDocumentos: m.resumen }));
vi.mock("@/lib/entregas/entregas", async () => {
  const real = await vi.importActual<typeof import("@/lib/entregas/entregas")>("@/lib/entregas/entregas");
  return {
    MENSAJES_ENTREGA: real.MENSAJES_ENTREGA,
    registrarEntrega: m.registrarEntrega,
    confirmarRecepcion: m.confirmarRecepcion,
    rechazarRecepcion: m.rechazarRecepcion,
    anularEntrega: m.anularEntrega,
    registrarRecepcionPresencial: m.registrarRecepcionPresencial,
    listarEntregasDocumento: m.listarEntregasDocumento,
    listarEntregasPorRecibir: m.listarEntregasPorRecibir,
    obtenerEntrega: m.obtenerEntrega,
  };
});

import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import type { ActorEntrega } from "@/lib/entregas/reglas";
import { GET as historialGET, POST as registrarPOST } from "../[id]/entregas/route";
import { GET as porRecibirGET } from "./por-recibir/route";
import { GET as resumenGET } from "./resumen/route";
import { POST as recibirPOST } from "./[entregaId]/recibir/route";
import { POST as rechazarPOST } from "./[entregaId]/rechazar/route";
import { POST as presencialPOST } from "./[entregaId]/presencial/route";
import { POST as anularPOST } from "./[entregaId]/anular/route";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const EMPRESA_SESION = 7;
const actor: ActorEntrega = {
  usuarioId: 9, username: "hsitan", nombre: "Heber Sitan", rol: "JefeOperaciones", esAdmin: false,
  permisos: [
    { modulo: "permisos_acciones_v2", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
    { modulo: "fondos_entrega_emitir", puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false },
  ],
};
const sesionOk = { empresa: { id: EMPRESA_SESION, nombre: "SITSA" }, session: { id: 9, username: "hsitan", nombre: "Heber Sitan", rol: "JefeOperaciones" }, actor };

const entregaBase = {
  id: 5, empresaId: EMPRESA_SESION, modulo: "FONDOS", entidadId: 10, documentoCodigo: "SF-1", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA",
  modo: "SISTEMA", estado: "EMITIDA", emitidoPorUsuarioId: 9, emitidoPorNombre: "Heber Sitan", emitidoPorRol: "JefeOperaciones",
  emitidoEn: new Date("2026-10-13T16:00:00Z"), firmaEmisionId: 100, observacionesEmision: null,
  recibidoPorUsuarioId: null, recibidoPorNombre: null, recibidoPorRol: null, recibidoEn: null, firmaRecepcionId: null,
  observacionesRecepcion: null, recepcionOperadaPorUsuarioId: null, recepcionOperadaPorNombre: null,
  cerradoPorUsuarioId: null, cerradoPorNombre: null, cerradoEn: null, motivoCierre: null,
};

const ctxId = (id = "10") => ({ params: Promise.resolve({ slug: "prueba", id }) });
const ctxEntrega = (entregaId = "5") => ({ params: Promise.resolve({ slug: "prueba", entregaId }) });
const ctxSlug = { params: Promise.resolve({ slug: "prueba" }) };

function multipart(campos: Record<string, string | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body: fd });
}
const firmaPng = () => new File([PNG], "firma.png", { type: "image/png" });
const jsonReq = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sinPermiso = () => ({ error: new Response(JSON.stringify({ error: "Sin permiso para el control de entrega de documentos." }), { status: 403 }) });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.requireTenantEntregas.mockResolvedValue(sesionOk);
  m.leerBytesFirmaGuardada.mockResolvedValue({ bytes: PNG.buffer, original: "firma.png" });
  m.obtenerEntrega.mockResolvedValue(entregaBase);
  m.registrarEntrega.mockResolvedValue({ entrega: entregaBase, repetida: false });
  m.confirmarRecepcion.mockResolvedValue({ ...entregaBase, estado: "RECIBIDA" });
  m.rechazarRecepcion.mockResolvedValue({ ...entregaBase, estado: "RECHAZADA", cerradoPorNombre: "Tere", cerradoEn: new Date(), motivoCierre: "x" });
  m.anularEntrega.mockResolvedValue({ ...entregaBase, estado: "ANULADA", cerradoPorNombre: "Heber", cerradoEn: new Date(), motivoCierre: "x" });
  m.registrarRecepcionPresencial.mockResolvedValue({ ...entregaBase, modo: "PRESENCIAL", estado: "RECIBIDA", recibidoPorNombre: "Juan" });
});

const TODOS_LOS_SERVICIOS = [m.registrarEntrega, m.confirmarRecepcion, m.rechazarRecepcion, m.anularEntrega, m.registrarRecepcionPresencial];

describe("puerta de permisos: sin permiso => 403 y NUNCA se llama al servicio", () => {
  it.each([
    ["registrar", () => registrarPOST(multipart({ destino: "TESORERIA", firmaImagen: firmaPng() }), ctxId())],
    ["recibir", () => recibirPOST(multipart({ firmaImagen: firmaPng() }), ctxEntrega())],
    ["rechazar", () => rechazarPOST(jsonReq({ motivo: "x" }), ctxEntrega())],
    ["anular", () => anularPOST(jsonReq({ motivo: "x" }), ctxEntrega())],
    ["presencial", () => presencialPOST(multipart({ nombreReceptor: "Juan", firmaImagen: firmaPng() }), ctxEntrega())],
    ["historial", () => historialGET(new Request("http://localhost/x"), ctxId())],
    ["bandeja", () => porRecibirGET(new Request("http://localhost/x"), ctxSlug)],
    ["resumen", () => resumenGET(new Request("http://localhost/x?ids=1,2"), ctxSlug)],
  ])("%s", async (_n, ejecutar) => {
    m.requireTenantEntregas.mockResolvedValue(sinPermiso());
    const res = await ejecutar();
    expect(res.status).toBe(403);
    for (const f of [...TODOS_LOS_SERVICIOS, m.listarEntregasDocumento, m.listarEntregasPorRecibir, m.leerDocumento, m.resumen, m.obtenerEntrega]) {
      expect(f).not.toHaveBeenCalled();
    }
  });

  it("registrar usa la puerta SIN el atajo de «ver Solicitudes de fondo»; el historial y el resumen sí lo aceptan", async () => {
    m.leerDocumento.mockResolvedValue({ id: 10, codigo: "SF-1", estado: "Autorizada", admiteEntrega: true });
    m.listarEntregasDocumento.mockResolvedValue([]);
    m.resumen.mockResolvedValue({});
    await registrarPOST(multipart({ destino: "TESORERIA", modo: "SISTEMA", claveIdempotencia: "k".repeat(20), firmaImagen: firmaPng() }), ctxId());
    expect(m.requireTenantEntregas).toHaveBeenLastCalledWith("prueba");
    await historialGET(new Request("http://localhost/x"), ctxId());
    expect(m.requireTenantEntregas).toHaveBeenLastCalledWith("prueba", { aceptaGastosVer: true });
    await resumenGET(new Request("http://localhost/x?ids=1"), ctxSlug);
    expect(m.requireTenantEntregas).toHaveBeenLastCalledWith("prueba", { aceptaGastosVer: true });
  });
});

describe("empresa y actor SIEMPRE de la sesión (nunca del cliente)", () => {
  it("registrar ignora empresaId/usuarioId/rol/nombre enviados por el cliente", async () => {
    const res = await registrarPOST(multipart({
      destino: "TESORERIA", modo: "SISTEMA", observaciones: "Expediente completo", claveIdempotencia: "k".repeat(20), firmaImagen: firmaPng(),
      empresaId: "999", empresa_id: "999", usuarioId: "1", usuario_id: "1", rol: "Admin", nombre: "Otra Persona", username: "root", esAdmin: "true",
    }), ctxId("10"));
    expect(res.status).toBe(201);
    const llamada = m.registrarEntrega.mock.calls[0][0];
    expect(llamada.empresaId).toBe(EMPRESA_SESION);
    expect(llamada.actor).toBe(actor); // exactamente el actor resuelto por el guard
    expect(llamada).toMatchObject({ modulo: "FONDOS", entidadId: 10, destino: "TESORERIA", modo: "SISTEMA", observaciones: "Expediente completo" });
    expect(llamada.actor.usuarioId).toBe(9);
    expect(JSON.stringify(llamada)).not.toContain("Otra Persona");
  });

  it.each([
    ["recibir", () => recibirPOST(multipart({ firmaImagen: firmaPng(), empresaId: "999", usuarioId: "1" }), ctxEntrega()), m.confirmarRecepcion],
    ["rechazar", () => rechazarPOST(jsonReq({ motivo: "No corresponde", empresaId: 999, usuarioId: 1, rol: "Admin" }), ctxEntrega()), m.rechazarRecepcion],
    ["anular", () => anularPOST(jsonReq({ motivo: "Error", empresaId: 999, usuarioId: 1 }), ctxEntrega()), m.anularEntrega],
    ["presencial", () => presencialPOST(multipart({ nombreReceptor: "Juan Pérez", firmaImagen: firmaPng(), empresaId: "999", usuarioId: "1" }), ctxEntrega()), m.registrarRecepcionPresencial],
  ])("%s usa la empresa y el actor de la sesión", async (_n, ejecutar, servicio) => {
    const res = await ejecutar();
    expect(res.status).toBe(200);
    const llamada = servicio.mock.calls[0][0];
    expect(llamada.empresaId).toBe(EMPRESA_SESION);
    expect(llamada.actor).toBe(actor);
    expect(llamada.entregaId).toBe(5);
  });
});

describe("registrar", () => {
  const valido = () => ({ destino: "CONTABILIDAD", modo: "SISTEMA", claveIdempotencia: "clave_registrar_123456", firmaImagen: firmaPng() });

  it("201, DTO sin ids internos y con la clave de idempotencia enviada al servicio", async () => {
    const res = await registrarPOST(multipart(valido()), ctxId());
    expect(res.status).toBe(201);
    const cuerpo = await res.json();
    expect(cuerpo).toMatchObject({ repetida: false, entrega: { estado: "EMITIDA", estadoEtiqueta: "Pendiente", origenEtiqueta: "Operaciones" } });
    const json = JSON.stringify(cuerpo);
    for (const prohibido of ["emitidoPorUsuarioId", "firmaEmisionId", "empresaId"]) expect(json).not.toContain(prohibido);
    expect(m.registrarEntrega.mock.calls[0][0].claveIdempotencia).toBe("clave_registrar_123456");
  });

  it("reintento idempotente: el servicio responde la original => 200 (no 201)", async () => {
    m.registrarEntrega.mockResolvedValue({ entrega: entregaBase, repetida: true });
    const res = await registrarPOST(multipart(valido()), ctxId());
    expect(res.status).toBe(200);
    expect((await res.json()).repetida).toBe(true);
  });

  it("firma guardada: se lee de la sesión (nunca un usuario enviado por el cliente) y el origen es GUARDADA", async () => {
    const { firmaImagen: _omitida, ...resto } = valido();
    void _omitida;
    const res = await registrarPOST(multipart({ ...resto, usarFirmaGuardada: "true", usuarioId: "1234" }), ctxId());
    expect(res.status).toBe(201);
    expect(m.leerBytesFirmaGuardada).toHaveBeenCalledWith(9);
    expect(m.registrarEntrega.mock.calls[0][0].firma.origen).toBe("GUARDADA");
  });

  it("firma dibujada: origen DIBUJADA", async () => {
    await registrarPOST(multipart(valido()), ctxId());
    expect(m.registrarEntrega.mock.calls[0][0].firma.origen).toBe("DIBUJADA");
  });

  it.each([
    ["sin firma", () => { const { firmaImagen: _f, ...r } = valido(); void _f; return r; }],
    ["archivo que no es PNG", () => ({ ...valido(), firmaImagen: new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])], "x.png") })],
    ["archivo vacío", () => ({ ...valido(), firmaImagen: new File([], "x.png") })],
  ])("%s => 400 y NO se llama al servicio", async (_n, campos) => {
    const res = await registrarPOST(multipart(campos()), ctxId());
    expect(res.status).toBe(400);
    expect(m.registrarEntrega).not.toHaveBeenCalled();
  });

  it("firma guardada que ya no existe => 400", async () => {
    m.leerBytesFirmaGuardada.mockResolvedValue(null);
    const { firmaImagen: _f, ...resto } = valido();
    void _f;
    const res = await registrarPOST(multipart({ ...resto, usarFirmaGuardada: "true" }), ctxId());
    expect(res.status).toBe(400);
    expect(m.registrarEntrega).not.toHaveBeenCalled();
  });

  it.each([
    [403, "No tiene permiso para actuar por esa área."],
    [404, "Documento no encontrado."],
    [409, "Este documento ya tiene una entrega pendiente de recibir."],
  ])("errores de dominio del servicio conservan su estado (%s) y mensaje", async (status, mensaje) => {
    m.registrarEntrega.mockRejectedValue(new ErrorDominioFormulario(mensaje, status as 403 | 404 | 409));
    const res = await registrarPOST(multipart(valido()), ctxId());
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(mensaje);
  });

  it("error técnico => 500 genérico (no filtra el detalle interno)", async () => {
    const espia = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.registrarEntrega.mockRejectedValue(new Error("ER_DUP_ENTRY otra_empresa secreto"));
    const res = await registrarPOST(multipart(valido()), ctxId());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
    espia.mockRestore();
  });

  it("id de la ruta inválido => 404 sin llamar al servicio", async () => {
    const res = await registrarPOST(multipart(valido()), ctxId("abc"));
    expect(res.status).toBe(404);
    expect(m.registrarEntrega).not.toHaveBeenCalled();
  });
});

describe("recibir / rechazar / anular / presencial", () => {
  it("entrega inexistente, de otra empresa o de OTRO módulo => el mismo 404 y no se llama al servicio", async () => {
    for (const hallada of [null, { ...entregaBase, modulo: "GASTOS" }, { ...entregaBase, modulo: "COMPRAS" }]) {
      m.obtenerEntrega.mockResolvedValue(hallada);
      for (const res of [
        await recibirPOST(multipart({ firmaImagen: firmaPng() }), ctxEntrega()),
        await rechazarPOST(jsonReq({ motivo: "x" }), ctxEntrega()),
        await anularPOST(jsonReq({ motivo: "x" }), ctxEntrega()),
        await presencialPOST(multipart({ nombreReceptor: "Juan", firmaImagen: firmaPng() }), ctxEntrega()),
      ]) {
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe("Entrega no encontrada.");
      }
    }
    for (const f of TODOS_LOS_SERVICIOS) expect(f).not.toHaveBeenCalled();
    // La búsqueda de la entrega va acotada a la empresa de la sesión.
    expect(m.obtenerEntrega).toHaveBeenCalledWith(EMPRESA_SESION, 5);
  });

  it("recibir sin firma => 400 y no se llama al servicio", async () => {
    const res = await recibirPOST(multipart({ observaciones: "ok" }), ctxEntrega());
    expect(res.status).toBe(400);
    expect(m.confirmarRecepcion).not.toHaveBeenCalled();
  });

  it("recibir pasa observaciones y firma; devuelve la entrega recibida", async () => {
    const res = await recibirPOST(multipart({ firmaImagen: firmaPng(), observaciones: "Completo" }), ctxEntrega());
    expect(res.status).toBe(200);
    expect(m.confirmarRecepcion.mock.calls[0][0]).toMatchObject({ observaciones: "Completo", firma: { origen: "DIBUJADA" } });
    expect((await res.json()).entrega.estado).toBe("RECIBIDA");
  });

  it("rechazar/anular exigen motivo (lo valida el servicio: se le pasa vacío si falta) y propagan su error", async () => {
    m.rechazarRecepcion.mockRejectedValue(new ErrorDominioFormulario("Indique el motivo.", 400));
    const res = await rechazarPOST(jsonReq({}), ctxEntrega());
    expect(res.status).toBe(400);
    expect(m.rechazarRecepcion.mock.calls[0][0].motivo).toBe("");
    m.anularEntrega.mockRejectedValue(new ErrorDominioFormulario("La entrega ya no está pendiente.", 409));
    const res2 = await anularPOST(jsonReq({ motivo: "x" }), ctxEntrega());
    expect(res2.status).toBe(409);
  });

  it("anular no acepta una firma ni un cuerpo no JSON: motivo no string => vacío", async () => {
    await anularPOST(jsonReq({ motivo: { $ne: "" } }), ctxEntrega());
    expect(m.anularEntrega.mock.calls[0][0].motivo).toBe("");
  });

  it("presencial: la firma DEBE ser dibujada (usarFirmaGuardada se rechaza) y el nombre viene del formulario", async () => {
    const guardada = await presencialPOST(multipart({ nombreReceptor: "Juan", usarFirmaGuardada: "true" }), ctxEntrega());
    expect(guardada.status).toBe(400);
    expect(m.registrarRecepcionPresencial).not.toHaveBeenCalled();
    expect(m.leerBytesFirmaGuardada).not.toHaveBeenCalled();

    const ok = await presencialPOST(multipart({ nombreReceptor: "Juan Pérez", observaciones: "Ventanilla", firmaImagen: firmaPng() }), ctxEntrega());
    expect(ok.status).toBe(200);
    expect(m.registrarRecepcionPresencial.mock.calls[0][0]).toMatchObject({
      nombreReceptor: "Juan Pérez", observaciones: "Ventanilla", firma: { origen: "DIBUJADA" },
    });
    // No existe ningún campo de documento de identidad en el contrato.
    expect(JSON.stringify(m.registrarRecepcionPresencial.mock.calls[0][0])).not.toMatch(/dpi|identidad|documento/i);
  });
});

describe("historial, bandeja y resumen", () => {
  it("historial: documento de otra empresa o inexistente => 404 (acotado a la empresa de la sesión)", async () => {
    m.leerDocumento.mockResolvedValue(null);
    const res = await historialGET(new Request("http://localhost/x"), ctxId("10"));
    expect(res.status).toBe(404);
    expect(m.leerDocumento).toHaveBeenCalledWith(EMPRESA_SESION, "FONDOS", 10);
    expect(m.listarEntregasDocumento).not.toHaveBeenCalled();
  });

  it("historial: custodia, pendiente, entregas y opciones de registro para el actor", async () => {
    m.leerDocumento.mockResolvedValue({ id: 10, codigo: "SF-1", estado: "Autorizada", admiteEntrega: true });
    m.listarEntregasDocumento.mockResolvedValue([{ ...entregaBase, estado: "RECIBIDA", recibidoPorNombre: "Tere", recibidoEn: new Date(), recibidoPorUsuarioId: 8, firmaRecepcionId: 101 }]);
    const res = await historialGET(new Request("http://localhost/x"), ctxId("10"));
    const cuerpo = await res.json();
    expect(res.status).toBe(200);
    expect(m.listarEntregasDocumento).toHaveBeenCalledWith(EMPRESA_SESION, "FONDOS", 10);
    // Quedó RECIBIDA en Tesorería: el actor (solo Operaciones) no puede entregar desde ahí.
    expect(cuerpo.custodia).toEqual({ area: "TESORERIA", etiqueta: "Tesorería" });
    expect(cuerpo.pendiente).toBeNull();
    expect(cuerpo.registrar.permitido).toBe(false);
    expect(cuerpo.entregas).toHaveLength(1);
    expect(JSON.stringify(cuerpo)).not.toContain("firmaEmisionId");
  });

  it("historial: con la custodia en Operaciones y permiso, ofrece los destinos del catálogo", async () => {
    m.leerDocumento.mockResolvedValue({ id: 10, codigo: "SF-1", estado: "Autorizada", admiteEntrega: true });
    m.listarEntregasDocumento.mockResolvedValue([]);
    const cuerpo = await (await historialGET(new Request("http://localhost/x"), ctxId("10"))).json();
    expect(cuerpo.registrar.permitido).toBe(true);
    expect(cuerpo.registrar.destinos.map((d: { destino: string }) => d.destino)).toEqual(["TESORERIA", "CONTABILIDAD"]);
    expect(cuerpo.registrar.modos).toEqual(["SISTEMA"]);
  });

  it("bandeja: solo entregas de Fondos y con las acciones del actor", async () => {
    m.listarEntregasPorRecibir.mockResolvedValue([
      { ...entregaBase, id: 1, emitidoPorUsuarioId: 4 },
      { ...entregaBase, id: 2, modulo: "GASTOS", entidadId: 11 },
    ]);
    const cuerpo = await (await porRecibirGET(new Request("http://localhost/x"), ctxSlug)).json();
    expect(m.listarEntregasPorRecibir).toHaveBeenCalledWith(EMPRESA_SESION, actor);
    expect(cuerpo.entregas.map((e: { id: number }) => e.id)).toEqual([1]);
  });

  it("resumen: ids saneados, acotados a la empresa de la sesión y módulo FONDOS", async () => {
    m.resumen.mockResolvedValue({ 1: { custodia: "OPERACIONES" } });
    const res = await resumenGET(new Request("http://localhost/x?ids=1,abc,-3,2,2.5,"), ctxSlug);
    expect(res.status).toBe(200);
    expect(m.resumen).toHaveBeenCalledWith(EMPRESA_SESION, "FONDOS", [1, 2]);
  });
});

describe("reintento ante deadlock de InnoDB (mitigación HTTP; la causa de raíz es del servicio común)", () => {
  const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
  const valido = () => multipart({ destino: "TESORERIA", modo: "SISTEMA", claveIdempotencia: "clave_reintento_12345", firmaImagen: firmaPng() });

  it("un deadlock transitorio se reintenta con la MISMA clave y la operación termina bien", async () => {
    m.registrarEntrega.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ entrega: entregaBase, repetida: false });
    const res = await registrarPOST(valido(), ctxId());
    expect(res.status).toBe(201);
    expect(m.registrarEntrega).toHaveBeenCalledTimes(2);
    expect(m.registrarEntrega.mock.calls[1][0].claveIdempotencia).toBe("clave_reintento_12345");
  });

  it("recibir, rechazar, anular y presencial también reintentan", async () => {
    m.confirmarRecepcion.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ ...entregaBase, estado: "RECIBIDA" });
    expect((await recibirPOST(multipart({ firmaImagen: firmaPng() }), ctxEntrega())).status).toBe(200);
    m.rechazarRecepcion.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ ...entregaBase, estado: "RECHAZADA" });
    expect((await rechazarPOST(jsonReq({ motivo: "x" }), ctxEntrega())).status).toBe(200);
    m.anularEntrega.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ ...entregaBase, estado: "ANULADA" });
    expect((await anularPOST(jsonReq({ motivo: "x" }), ctxEntrega())).status).toBe(200);
    m.registrarRecepcionPresencial.mockRejectedValueOnce(deadlock()).mockResolvedValueOnce({ ...entregaBase, estado: "RECIBIDA", modo: "PRESENCIAL" });
    expect((await presencialPOST(multipart({ nombreReceptor: "Juan", firmaImagen: firmaPng() }), ctxEntrega())).status).toBe(200);
  });

  it("si el deadlock persiste se rinde tras 3 intentos con un 500 genérico (sin filtrar el detalle)", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.registrarEntrega.mockRejectedValue(deadlock());
    const res = await registrarPOST(valido(), ctxId());
    expect(res.status).toBe(500);
    expect(m.registrarEntrega).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(await res.json())).not.toMatch(/Deadlock/i);
    consola.mockRestore();
  });

  it("los errores de negocio NO se reintentan", async () => {
    m.registrarEntrega.mockRejectedValue(new ErrorDominioFormulario("Este documento ya tiene una entrega pendiente de recibir.", 409));
    const res = await registrarPOST(valido(), ctxId());
    expect(res.status).toBe(409);
    expect(m.registrarEntrega).toHaveBeenCalledTimes(1);
  });
});
