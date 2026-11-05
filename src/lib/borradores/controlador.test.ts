import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  ControladorBorrador,
  crearAlmacenIndexedDB,
  crearAlmacenSegunPreferencia,
  crearNucleoBorradores,
  fijarPersistencia,
  type AlmacenPreferencias,
  type AmbitoBorrador,
  type FabricaCanal,
  type OpcionesControlador,
  type Resultado,
  type TipoBorrador,
} from "./index";
import { claveAmbitoUsuarioEmpresa, claveBorrador } from "./ambito";
import { reiniciarCoordinacionParaPruebas } from "./coordinacion";
import { establecerFabricaCanal } from "./canal";

/**
 * BORR-1c — pruebas del CONTROLADOR de autoguardado sobre IndexedDB simulado (fake-indexeddb). Datos ficticios; temporizadores
 * reales y cortos (debounce 20 ms). Los casos de coordinación con la salida de sesión están en coordinacion.test.ts.
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const ambito = (ownerKey = U1, empresaId = 1, tipo: TipoBorrador = "solicitud_fondo"): AmbitoBorrador => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}`, tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void, ms = 2000) => vi.waitFor(fn, { timeout: ms, interval: 5 });

function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

/** Bus de canales en memoria: entrega asíncrona a los demás canales del mismo nombre (como BroadcastChannel). */
function crearBus(): FabricaCanal {
  const canales = new Map<string, Set<{ onmessage: ((e: { data: unknown }) => void) | null }>>();
  return (nombre) => {
    const grupo = canales.get(nombre) ?? new Set();
    canales.set(nombre, grupo);
    const yo = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage(data: unknown) { for (const otro of [...grupo]) if (otro !== yo) setTimeout(() => otro.onmessage?.({ data: structuredClone(data) }), 0); },
      close() { grupo.delete(yo); },
    };
    grupo.add(yo);
    return yo;
  };
}

function entorno(opts: { reloj?: () => number } = {}) {
  const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
  const nucleo = crearNucleoBorradores({ almacen: real, appBuild: "prueba", ahora: opts.reloj });
  const creados: ControladorBorrador[] = [];
  const crear = (extra: Partial<OpcionesControlador> = {}) => {
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, debounceMs: 20, maxEsperaMs: 120, fabricaCanal: null, ...extra });
    creados.push(c);
    return c;
  };
  return { real, nucleo, crear, creados };
}
type Entorno = ReturnType<typeof entorno>;

/** Controlador ya iniciado, con la línea base fijada. */
async function activo(e: Entorno, base: unknown = { v: 0 }, extra: Partial<OpcionesControlador> = {}) {
  const c = e.crear(extra);
  c.actualizarPayload(base);
  await c.iniciar();
  return c;
}
const guardados = async (e: Entorno, a = ambito()) => {
  const l = ok(await e.nucleo.leer(a, { esquemaVersion: 9 }));
  return l.estado === "vacio" ? null : l.borrador;
};

afterEach(() => {
  vi.restoreAllMocks();
  reiniciarCoordinacionParaPruebas();
  establecerFabricaCanal(undefined);
});

describe("guardado básico, debounce y estados", () => {
  it("la línea base no se guarda; un cambio pasa por pendiente → guardando → guardado SOLO tras confirmar la transacción", async () => {
    const e = entorno();
    const c = await activo(e, { lineas: [] });
    expect(c.getSnapshot().fase).toBe("activo");
    await esperar(60);
    expect(await guardados(e)).toBeNull(); // sin cambios: nada que guardar

    // Se retrasa la confirmación para observar «Guardando» antes de «Guardado».
    const original = e.nucleo.guardar.bind(e.nucleo);
    let liberar!: () => void;
    const puerta = new Promise<void>((r) => { liberar = r; });
    vi.spyOn(e.nucleo, "guardar").mockImplementation(async (...a) => { const r = await original(...a); await puerta; return r; });

    c.actualizarPayload({ lineas: [{ monto: "10" }] });
    expect(c.getSnapshot().guardado.estado).toBe("pendiente");
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    expect(c.getSnapshot().guardado.estado).not.toBe("guardado"); // la transacción ya terminó, pero la confirmación aún no llegó al controlador
    liberar();
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(c.getSnapshot()).toMatchObject({ revision: 1, guardadoEn: expect.any(Number) });
    expect((await guardados(e))!.payload).toEqual({ lineas: [{ monto: "10" }] });
  });

  it("debounce: muchos cambios seguidos producen UNA escritura con el contenido más reciente", async () => {
    const e = entorno();
    const c = await activo(e);
    const guardar = vi.spyOn(e.nucleo, "guardar");
    for (let i = 1; i <= 8; i++) { c.actualizarPayload({ v: i }); await esperar(5); }
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect((await guardados(e))!.payload).toEqual({ v: 8 });
  });

  it("escritura continua: el tope máximo de espera fuerza guardados periódicos (acota la ventana de pérdida)", async () => {
    const e = entorno();
    const c = await activo(e, { v: 0 }, { debounceMs: 60, maxEsperaMs: 120 });
    const guardar = vi.spyOn(e.nucleo, "guardar");
    const fin = Date.now() + 420;
    let i = 0;
    while (Date.now() < fin) { c.actualizarPayload({ v: ++i }); await esperar(15); } // nunca hay 60 ms de calma
    expect(guardar.mock.calls.length).toBeGreaterThanOrEqual(2);
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect((await guardados(e))!.payload).toEqual({ v: i });
  });

  it("cambios DURANTE una escritura: se guarda después la versión más reciente, encadenando revisiones (nada antiguo pisa a lo nuevo)", async () => {
    const e = entorno();
    const c = await activo(e);
    const original = e.nucleo.guardar.bind(e.nucleo);
    const orden: unknown[] = [];
    vi.spyOn(e.nucleo, "guardar").mockImplementation(async (a, entrada) => { orden.push([(entrada.payload as { v: number }).v, entrada.revisionBase]); await esperar(60); return original(a, entrada); });
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(orden).toHaveLength(1));
    c.actualizarPayload({ v: 2 }); c.actualizarPayload({ v: 3 }); // llegan mientras v1 se escribe
    expect(c.getSnapshot().guardado.estado).toBe("guardando");
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"), 3000);
    expect(orden).toEqual([[1, null], [3, 1]]); // v2 jamás se escribe: se saltó a lo más reciente
    expect((await guardados(e))).toMatchObject({ revision: 2, payload: { v: 3 } });
  });

  it("sin escrituras innecesarias: el mismo contenido, o volver a lo ya guardado, no escribe", async () => {
    const e = entorno();
    const c = await activo(e);
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    const guardar = vi.spyOn(e.nucleo, "guardar");
    c.actualizarPayload({ v: 1 }); c.actualizarPayload({ v: 1 });
    c.actualizarPayload({ v: 2 }); // cambia…
    c.actualizarPayload({ v: 1 }); // …y vuelve a lo guardado antes de que venza el debounce
    await esperar(80);
    expect(guardar).not.toHaveBeenCalled();
    expect(c.getSnapshot().guardado.estado).toBe("guardado");
  });

  it("un payload no serializable o inválido no se guarda y se muestra «Error al guardar»", async () => {
    const e = entorno();
    const c = await activo(e);
    const ciclo: Record<string, unknown> = {}; ciclo.yo = ciclo;
    c.actualizarPayload(ciclo);
    expect(c.getSnapshot().guardado).toMatchObject({ estado: "error_almacenamiento", motivoError: "payload_invalido" });
    c.actualizarPayload({ adjunto: new File(["x"], "factura.pdf") }); // archivos: nunca se guardan
    await hasta(() => expect(c.getSnapshot().guardado).toMatchObject({ estado: "error_almacenamiento", motivoError: "payload_invalido" }));
    expect(await guardados(e)).toBeNull();
  });

  it("error de IndexedDB: «Error al guardar» (no «Guardado»), el cambio sigue pendiente y se reintenta; la cuota tiene motivo propio", async () => {
    const e = entorno();
    const c = await activo(e);
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("fallo simulado"); });
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("error_almacenamiento"));
    expect(c.getSnapshot().guardado.motivoError).toBe("escritura_fallida");
    expect(await guardados(e)).toBeNull();
    espia.mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    c.actualizarPayload({ v: 2 });
    await hasta(() => expect(c.getSnapshot().guardado.motivoError).toBe("cuota_excedida"));
    espia.mockRestore();
    await c.reintentar();
    expect(c.getSnapshot().guardado.estado).toBe("guardado");
    expect((await guardados(e))!.payload).toEqual({ v: 2 });
  });

  it("falla de APERTURA de IndexedDB: se informa y, al volver a estar disponible, se guarda", async () => {
    const real = new IDBFactory();
    let abre = false;
    const fabrica = { open: (...a: Parameters<IDBFactory["open"]>) => { if (!abre) throw new DOMException("bloqueado", "SecurityError"); return real.open(...a); } } as unknown as IDBFactory;
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica }), appBuild: "p" });
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, debounceMs: 20, fabricaCanal: null });
    c.actualizarPayload({ v: 0 });
    await c.iniciar();
    expect(c.getSnapshot()).toMatchObject({ fase: "activo", errorLectura: "no_disponible" });
    expect(c.getSnapshot().guardado.estado).toBe("error_almacenamiento");
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado).toMatchObject({ estado: "error_almacenamiento", motivoError: "no_disponible" }));
    abre = true;
    await c.reintentar(); // vuelve a establecer la época y a consultar; recién entonces se reanuda el guardado
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(ok(await nucleo.leer(ambito(), { esquemaVersion: 1 })).estado).toBe("vigente");
  });

  it("lo escrito mientras se consultaba el borrador previo se guarda al activarse", async () => {
    const e = entorno();
    const c = e.crear();
    c.actualizarPayload({ v: 0 });
    const inicio = c.iniciar();
    c.actualizarPayload({ v: 1 }); // el usuario escribe mientras IndexedDB responde
    await inicio;
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect((await guardados(e))!.payload).toEqual({ v: 1 });
  });

  it("payload grande (800 líneas) se guarda y se recupera exacto", async () => {
    const e = entorno();
    const lineas = Array.from({ length: 800 }, (_, i) => ({ categoria: "Combustible", descripcion: `Línea ${i} ${"x".repeat(80)}`, cantidad: "1", monto: `${i}.25`, fechaViaje: "2026-11-04" }));
    const c = await activo(e, { lineas: [] });
    c.actualizarPayload({ lineas });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    const c2 = e.crear();
    await c2.iniciar();
    const r = c2.recuperar();
    expect(r.ok && r.payload).toEqual({ lineas });
  });
});

describe("recuperación", () => {
  async function sembrar(e: Entorno, payload: unknown = { lineas: [{ monto: "5" }] }, extra: Record<string, unknown> = {}) {
    return ok(await e.nucleo.guardar(ambito(), { payload, esquemaVersion: 1, revisionBase: null, ...extra }));
  }

  it("un borrador existente exige decisión; mientras no se decide NO se escribe (no se sobrescribe lo recuperable)", async () => {
    const e = entorno();
    await sembrar(e);
    const c = await activo(e, { lineas: [] });
    const s = c.getSnapshot();
    expect(s.fase).toBe("decision_pendiente");
    expect(s.recuperacion).toMatchObject({ situacion: "disponible", tipo: "solicitud_fondo", puedeRecuperar: true, puedeDescartar: true, revision: 1 });
    const guardar = vi.spyOn(e.nucleo, "guardar");
    c.actualizarPayload({ lineas: [{ monto: "999" }] }); // el usuario escribe sobre un formulario nuevo
    await esperar(100);
    expect(guardar).not.toHaveBeenCalled();
    expect((await guardados(e))!.payload).toEqual({ lineas: [{ monto: "5" }] });
  });

  it("recuperar: entrega el payload, sigue sobre la revisión existente y conserva borradorId y claveEnvio (identidad e idempotencia)", async () => {
    const e = entorno();
    const sembrado = await sembrar(e, { v: "a" }, { claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f" });
    const c = await activo(e, { v: "" });
    const r = c.recuperar();
    expect(r).toMatchObject({ ok: true, payload: { v: "a" }, revision: 1 });
    expect(c.getSnapshot()).toMatchObject({ fase: "activo", revision: 1, claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", estadoEnvio: "ninguno" });
    const guardar = vi.spyOn(e.nucleo, "guardar");
    c.actualizarPayload({ v: "a" }); // el formulario adopta lo recuperado: no hay nada que escribir
    await esperar(80);
    expect(guardar).not.toHaveBeenCalled();
    c.actualizarPayload({ v: "b" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await guardados(e)).toMatchObject({ revision: 2, borradorId: sembrado.borradorId, claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", payload: { v: "b" } });
  });

  it("tras recuperar, el contenido ANTERIOR del formulario no pisa al borrador aunque el formulario tarde en adoptar lo recuperado", async () => {
    const e = entorno();
    await sembrar(e, { v: "recuperado" });
    const c = await activo(e, { v: "contenido viejo del formulario" });
    expect(c.recuperar()).toMatchObject({ ok: true });
    await esperar(120); // el formulario todavía no volvió a llamar a actualizarPayload
    expect(await guardados(e)).toMatchObject({ revision: 1, payload: { v: "recuperado" } });
    expect(c.getSnapshot().guardado.estado).toBe("guardado");
  });

  it("la línea base se respeta aunque llegue DESPUÉS de activarse el autoguardado", async () => {
    const e = entorno();
    const c = e.crear();
    await c.iniciar(); // primero se activa…
    c.actualizarPayload({ v: "contenido inicial" }); // …y recién entonces llega el contenido inicial del formulario
    await esperar(100);
    expect(await guardados(e)).toBeNull();
    expect(c.getSnapshot().guardado.estado).toBe("inicial");
  });

  it("nunca restaura sola: sin llamar a recuperar() el payload no aparece ni cambia nada", async () => {
    const e = entorno();
    await sembrar(e, { v: "a" });
    const c = await activo(e, { v: "" });
    expect(c.getSnapshot().revision).toBeNull();
    expect(c.getSnapshot().guardadoEn).toBeNull();
  });

  it("descartar exige confirmación explícita; confirmado elimina, no vuelve a guardar el contenido visible y deja guardar lo nuevo", async () => {
    const e = entorno();
    await sembrar(e);
    const c = await activo(e, { v: "x" });
    expect(await c.descartar({ confirmado: false })).toMatchObject({ ok: false, motivo: "confirmacion_requerida" });
    expect(await c.descartar(undefined as never)).toMatchObject({ ok: false });
    expect(await guardados(e)).not.toBeNull();
    expect(await c.descartar({ confirmado: true })).toEqual({ ok: true });
    expect(await guardados(e)).toBeNull();
    expect(c.getSnapshot().fase).toBe("activo");
    await esperar(80);
    expect(await guardados(e)).toBeNull(); // el contenido del formulario no se vuelve a guardar por sí solo
    c.actualizarPayload({ v: "nuevo" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await guardados(e)).toMatchObject({ revision: 1, payload: { v: "nuevo" } });
  });

  it("descartar desde la decisión pendiente conserva lo escrito mientras tanto y lo guarda como borrador nuevo", async () => {
    const e = entorno();
    await sembrar(e);
    const c = await activo(e, { v: "" });
    c.actualizarPayload({ v: "escrito durante la decisión" });
    await c.descartar({ confirmado: true });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await guardados(e)).toMatchObject({ revision: 1, payload: { v: "escrito durante la decisión" } });
  });

  it("«decidir después» (mantener) no escribe ni elimina; luego se puede recuperar", async () => {
    const e = entorno();
    await sembrar(e, { v: "a" });
    const c = await activo(e, { v: "" });
    c.mantener();
    expect(c.getSnapshot().fase).toBe("en_espera");
    c.actualizarPayload({ v: "otra cosa" });
    await esperar(80);
    expect((await guardados(e))!.payload).toEqual({ v: "a" });
    expect(c.recuperar()).toMatchObject({ ok: true, payload: { v: "a" } });
    expect(c.getSnapshot().fase).toBe("activo");
  });

  it("esquema FUTURO: incompatible, no recuperable, jamás se sobrescribe; solo se descarta con confirmación", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(), { payload: { formato: "nuevo" }, esquemaVersion: 3, revisionBase: null }));
    const c = await activo(e);
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "incompatible", puedeRecuperar: false, puedeDescartar: true, esquemaVersion: 3 });
    expect(c.recuperar()).toMatchObject({ ok: false });
    c.actualizarPayload({ v: 1 });
    await esperar(80);
    expect((await guardados(e))).toMatchObject({ esquemaVersion: 3, payload: { formato: "nuevo" } });
    expect(await c.descartar({ confirmado: true })).toEqual({ ok: true });
  });

  it("esquema ANTERIOR: sin migración no es recuperable; con migración se adapta y se persiste con la versión actual", async () => {
    const e = entorno();
    await sembrar(e, { total: "10" });
    const sinMigrar = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 2, nucleo: e.nucleo, fabricaCanal: null, debounceMs: 20 });
    await sinMigrar.iniciar();
    expect(sinMigrar.getSnapshot().recuperacion).toMatchObject({ situacion: "esquema_anterior", puedeRecuperar: false });
    sinMigrar.dispose();

    const migra = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 2, nucleo: e.nucleo, fabricaCanal: null, debounceMs: 20, migrar: (p, v) => (v === 1 ? { ...(p as object), moneda: "GTQ" } : null) });
    migra.actualizarPayload({ total: "" });
    await migra.iniciar();
    expect(migra.getSnapshot().recuperacion).toMatchObject({ situacion: "esquema_anterior", puedeRecuperar: true });
    expect(migra.recuperar()).toMatchObject({ ok: true, payload: { total: "10", moneda: "GTQ" } });
    await hasta(() => expect(migra.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await guardados(e)).toMatchObject({ esquemaVersion: 2, revision: 2, payload: { total: "10", moneda: "GTQ" } });
    migra.dispose();
  });

  it("una migración que falla no recupera nada", async () => {
    const e = entorno();
    await sembrar(e, { total: "10" });
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 2, nucleo: e.nucleo, fabricaCanal: null, migrar: () => { throw new Error("x"); } });
    await c.iniciar();
    expect(c.recuperar()).toMatchObject({ ok: false, motivo: "migracion_fallida" });
    expect(c.getSnapshot().fase).toBe("decision_pendiente");
    c.dispose();
  });

  it("borrador EXPIRADO: se advierte y, aun así, el usuario puede recuperarlo o descartarlo", async () => {
    let t = 1_000;
    const e = entorno({ reloj: () => t });
    await sembrar(e, { v: "viejo" });
    t += 15 * 24 * 60 * 60 * 1000;
    const c = await activo(e, { v: "" });
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "expirado", puedeRecuperar: true, puedeDescartar: true });
    expect(c.recuperar()).toMatchObject({ ok: true, payload: { v: "viejo" } });
  });

  it("datos CORRUPTOS: jamás se interpretan como borrador válido ni se sobrescriben; solo se pueden descartar", async () => {
    const e = entorno();
    const clave = claveBorrador(ambito());
    await e.real.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { clave, ambitoClave: claveAmbitoUsuarioEmpresa(ambito()), ownerKey: U1, formato: 1, revision: "mala" } as never }));
    const c = await activo(e);
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "corrupto", puedeRecuperar: false, puedeDescartar: true });
    expect(c.recuperar()).toMatchObject({ ok: false });
    c.actualizarPayload({ v: 1 });
    await esperar(80);
    expect(ok(await e.real.obtener(clave))).toMatchObject({ revision: "mala" }); // intacto
    expect(await c.descartar({ confirmado: true })).toEqual({ ok: true });
    expect(ok(await e.real.obtener(clave))).toBeUndefined();
  });

  it("un borrador ya ENVIADO oficialmente no se restaura; solo se puede descartar", async () => {
    const e = entorno();
    await sembrar(e, { v: "a" }, { claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", estadoEnvio: "completado" });
    const c = await activo(e);
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "enviado", puedeRecuperar: false, puedeDescartar: true });
    expect(c.recuperar()).toMatchObject({ ok: false });
    expect(await c.descartar({ confirmado: true })).toEqual({ ok: true });
  });

  it("envío oficial SIN RESOLVER: no se recupera ni se edita ni se descarta (evita duplicar el documento) y la clave no se renueva", async () => {
    const e = entorno();
    await sembrar(e, { v: "a" }, { claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", estadoEnvio: "enviando" });
    const c = await activo(e);
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "envio_incierto", puedeRecuperar: false, puedeDescartar: false, estadoEnvio: "enviando" });
    expect(c.recuperar()).toMatchObject({ ok: false });
    expect(await c.descartar({ confirmado: true })).toMatchObject({ ok: false, motivo: "envio_pendiente" });
    c.actualizarPayload({ v: "otra" });
    await esperar(80);
    expect(await guardados(e)).toMatchObject({ estadoEnvio: "enviando", claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", payload: { v: "a" }, revision: 1 });
  });

  it("registrarEnvio / resolverEnvio: bloquean la edición durante el intento y conservan la clave hasta que el adaptador resuelve", async () => {
    const e = entorno();
    const c = await activo(e);
    c.actualizarPayload({ v: 1 });
    expect(await c.registrarEnvio("7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f")).toEqual({ ok: true });
    expect(c.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "envio_en_curso", estadoEnvio: "enviando" });
    expect(await guardados(e)).toMatchObject({ estadoEnvio: "enviando", claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f", payload: { v: 1 } });
    c.actualizarPayload({ v: 2 });
    await esperar(80);
    expect((await guardados(e))!.payload).toEqual({ v: 1 }); // editar durante el envío no escribe
    expect(await c.resolverEnvio({ estadoEnvio: "completado" })).toEqual({ ok: true });
    expect(c.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "enviado", estadoEnvio: "completado" });
    expect(await guardados(e)).toMatchObject({ estadoEnvio: "completado", claveEnvio: "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f" });
  });
});

describe("dos pestañas y conflictos (revisión atómica; el canal solo avisa)", () => {
  it("cambios simultáneos SIN canal: gana una; la otra detecta el conflicto por la revisión y NO sobrescribe", async () => {
    const e = entorno();
    const a = await activo(e);
    const b = await activo(e);
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    b.actualizarPayload({ de: "B" });
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto"));
    expect(b.getSnapshot().conflicto).toMatchObject({ motivo: "revision_obsoleta", revisionLocal: null, revisionRemota: 1 });
    expect((await guardados(e))).toMatchObject({ revision: 1, payload: { de: "A" } });
    await esperar(80);
    expect((await guardados(e))!.payload).toEqual({ de: "A" }); // sin reintentos automáticos
  });

  it("con canal y cambios casi simultáneos: exactamente una pestaña guarda; la otra queda en conflicto y NO sobrescribe", async () => {
    const e = entorno();
    const bus = crearBus();
    const a = await activo(e, { v: 0 }, { fabricaCanal: bus });
    const b = await activo(e, { v: 0 }, { fabricaCanal: bus });
    a.actualizarPayload({ de: "A" });
    b.actualizarPayload({ de: "B" });
    await hasta(() => {
      const fases = [a, b].map((x) => x.getSnapshot());
      expect(fases.filter((f) => f.fase === "conflicto")).toHaveLength(1);
      expect(fases.filter((f) => f.fase === "activo" && f.guardado.estado === "guardado")).toHaveLength(1);
    }, 3000);
    await esperar(100);
    const ganador = [a, b].find((x) => x.getSnapshot().fase === "activo")!;
    const vigente = (await guardados(e))!;
    expect(vigente.revision).toBe(1);
    expect(vigente.payload).toEqual(ganador === a ? { de: "A" } : { de: "B" });
  });

  it("con canal y SIN cambios locales: solo se avisa «otra pestaña actualizó»; el siguiente cambio local exige decidir (no se pisa)", async () => {
    const e = entorno();
    const bus = crearBus();
    const a = await activo(e, { v: 0 }, { fabricaCanal: bus });
    const b = await activo(e, { v: 0 }, { fabricaCanal: bus });
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(b.getSnapshot().otraPestana).toBe(true));
    expect(b.getSnapshot().fase).toBe("activo");
    b.actualizarPayload({ de: "B" });
    expect(b.getSnapshot().fase).toBe("conflicto");
    await esperar(80);
    expect((await guardados(e))!.payload).toEqual({ de: "A" });
  });

  it("resolver: releer muestra la versión de la otra pestaña; adoptarla actualiza revisión y payload", async () => {
    const e = entorno();
    const a = await activo(e);
    const b = await activo(e);
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    b.actualizarPayload({ de: "B" });
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto"));
    const l = await b.releer();
    expect(l).toMatchObject({ ok: true, remoto: { revision: 1, payload: { de: "A" } } });
    expect(b.getSnapshot().conflicto?.revisionRemota).toBe(1);
    expect(await b.adoptarRemoto()).toMatchObject({ ok: true, payload: { de: "A" } });
    expect(b.getSnapshot()).toMatchObject({ fase: "activo", revision: 1, conflicto: null });
    const guardar = vi.spyOn(e.nucleo, "guardar");
    b.actualizarPayload({ de: "A" });
    await esperar(60);
    expect(guardar).not.toHaveBeenCalled();
  });

  it("resolver: conservar lo local sobrescribe SOLO por decisión explícita, sobre la revisión releída (sigue protegido por CAS)", async () => {
    const e = entorno();
    const a = await activo(e);
    const b = await activo(e);
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    b.actualizarPayload({ de: "B" });
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto"));
    expect(await b.conservarLocal()).toEqual({ ok: true });
    expect(b.getSnapshot()).toMatchObject({ fase: "activo", revision: 2 });
    expect(await guardados(e)).toMatchObject({ revision: 2, payload: { de: "B" } });
  });

  it("el borrador fue ELIMINADO por otra pestaña: se detecta; adoptar no es posible y recrear exige decidir", async () => {
    const e = entorno();
    const a = await activo(e);
    a.actualizarPayload({ v: 1 });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    const b = e.crear();
    b.actualizarPayload({ v: 0 });
    await b.iniciar();
    b.recuperar();
    expect(ok(await e.nucleo.eliminar(ambito()))).toEqual({ existia: true });
    b.actualizarPayload({ v: 2 });
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto"));
    expect(b.getSnapshot().conflicto?.motivo).toBe("ya_no_existe");
    expect(await b.adoptarRemoto()).toMatchObject({ ok: false });
    expect(await guardados(e)).toBeNull();
    expect(await b.conservarLocal()).toEqual({ ok: true });
    expect((await guardados(e))!.payload).toEqual({ v: 2 });
  });

  it("pestaña CERRADA inesperadamente: no deja cerrojos; la otra sigue y detecta el avance al volver a primer plano (sin BroadcastChannel)", async () => {
    const e = entorno();
    const b = await activo(e, { v: 0 }, { fabricaCanal: null });
    const a = await activo(e, { v: 0 }, { fabricaCanal: null });
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    // «a» se pierde sin dispose ni avisos (apagón del navegador): no hay nada que liberar
    expect(b.getSnapshot()).toMatchObject({ fase: "activo", otraPestana: false, sinCanal: true });
    b.alVolverAPrimerPlano();
    await hasta(() => expect(b.getSnapshot().otraPestana).toBe(true));
    const c = e.crear();
    await c.iniciar();
    expect(c.getSnapshot().recuperacion).toMatchObject({ situacion: "disponible", revision: 1 }); // el trabajo de «a» es recuperable
  });

  it("sin BroadcastChannel la ausencia se refleja (`sinCanal`) y todo funciona; con canal disponible, no", async () => {
    const e = entorno();
    expect((await activo(e, { v: 0 }, { fabricaCanal: null })).getSnapshot().sinCanal).toBe(true);
    expect((await activo(e, { v: 0 }, { fabricaCanal: crearBus() })).getSnapshot().sinCanal).toBe(false);
  });

  it("el BroadcastChannel NATIVO también funciona entre dos controladores (aviso real, no solo el simulado)", async () => {
    expect(typeof BroadcastChannel).toBe("function");
    const e = entorno();
    const a = await activo(e, { v: 0 }, { fabricaCanal: undefined });
    const b = await activo(e, { v: 0 }, { fabricaCanal: undefined });
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(b.getSnapshot().otraPestana).toBe(true), 3000);
  });
});

describe("identidad, sesión, preferencia y desmontaje", () => {
  it("usuario A no ve el borrador del usuario B, ni la empresa A el de la empresa B", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U2, 1), { payload: { de: "usuario 2" }, esquemaVersion: 1, revisionBase: null }));
    ok(await e.nucleo.guardar(ambito(U1, 2), { payload: { de: "empresa 2" }, esquemaVersion: 1, revisionBase: null }));
    const c = await activo(e, { v: 0 }, { ambito: ambito(U1, 1) });
    expect(c.getSnapshot()).toMatchObject({ fase: "activo", recuperacion: null });
    c.actualizarPayload({ de: "mio" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect((await guardados(e, ambito(U2, 1)))!.payload).toEqual({ de: "usuario 2" });
    expect((await guardados(e, ambito(U1, 2)))!.payload).toEqual({ de: "empresa 2" });
  });

  it("sin identidad válida el autoguardado queda inactivo (nada se inventa ni se escribe)", async () => {
    const e = entorno();
    const c = e.crear({ ambito: { ...ambito(), ownerKey: "" } });
    c.actualizarPayload({ v: 0 }); await c.iniciar(); c.actualizarPayload({ v: 1 });
    await esperar(80);
    expect(c.getSnapshot().fase).toBe("sin_contexto");
    expect(ok(await e.nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("expiración de sesión: no se borra nada; al volver a autenticarse el mismo usuario recupera su borrador", async () => {
    const e = entorno();
    const c = await activo(e);
    c.actualizarPayload({ v: "trabajo" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    c.dispose(); // la sesión expira: la página se descarta sin ninguna limpieza
    const despues = e.crear();
    await despues.iniciar();
    expect(despues.getSnapshot().recuperacion).toMatchObject({ situacion: "disponible" });
    expect(despues.recuperar()).toMatchObject({ ok: true, payload: { v: "trabajo" } });
  });

  function prefsMem(): AlmacenPreferencias {
    const d = new Map<string, string>();
    return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); }, removeItem: (k) => { d.delete(k); } };
  }

  it("persistencia desactivada: no se lee ni se escribe", async () => {
    const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
    const prefs = prefsMem();
    expect(fijarPersistencia(prefs, false)).toBe(true);
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(real, prefs), appBuild: "p" });
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, prefs, debounceMs: 20, fabricaCanal: null });
    c.actualizarPayload({ v: 0 }); await c.iniciar(); c.actualizarPayload({ v: 1 });
    await esperar(80);
    expect(c.getSnapshot().fase).toBe("desactivado");
    expect(ok(await crearNucleoBorradores({ almacen: real, appBuild: "p" }).listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("preferencia desactivada DESDE OTRA PESTAÑA a mitad de sesión: se pausa, lo pendiente no se escribe, y reactivarla reanuda", async () => {
    const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
    const prefs = prefsMem();
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(real, prefs), appBuild: "p" });
    const bruto = crearNucleoBorradores({ almacen: real, appBuild: "p" });
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, prefs, debounceMs: 40, fabricaCanal: null });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    c.actualizarPayload({ v: 1 }); // pendiente (debounce 40 ms)
    fijarPersistencia(prefs, false); // otra pestaña desactiva la persistencia
    c.alCambiarPreferencia();
    expect(c.getSnapshot().fase).toBe("desactivado");
    await esperar(120);
    expect(ok(await bruto.listarMetadatosUsuario(U1)).borradores).toHaveLength(0); // nada escrito
    fijarPersistencia(prefs, true);
    c.alCambiarPreferencia();
    await hasta(() => expect(c.getSnapshot().fase).toBe("activo"));
    c.actualizarPayload({ v: 2 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(ok(await bruto.listarMetadatosUsuario(U1)).borradores).toHaveLength(1);
  });

  it("incluso si la preferencia cambia SIN avisar, la escritura la respeta (el almacén la consulta en cada operación)", async () => {
    const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
    const prefs = prefsMem();
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(real, prefs), appBuild: "p" });
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, prefs: null, debounceMs: 20, fabricaCanal: null });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    fijarPersistencia(prefs, false);
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().fase).toBe("desactivado"));
    expect(ok(await crearNucleoBorradores({ almacen: real, appBuild: "p" }).listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
  });

  it("desmontar DURANTE un guardado: no hay avisos tardíos, el controlador queda cerrado y es seguro llamarlo de nuevo", async () => {
    const e = entorno();
    const c = await activo(e);
    const original = e.nucleo.guardar.bind(e.nucleo);
    vi.spyOn(e.nucleo, "guardar").mockImplementation(async (a, x) => { await esperar(50); return original(a, x); });
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    const avisos = vi.fn();
    c.subscribe(avisos);
    c.dispose();
    c.dispose();
    await esperar(150);
    expect(avisos).not.toHaveBeenCalled();
    c.actualizarPayload({ v: 9 });
    await c.flush();
    expect(await c.descartar({ confirmado: true })).toMatchObject({ ok: false });
  });

  it("desmontar con cambios pendientes: guardado de MEJOR ESFUERZO dirigido a su propio ámbito, sin prometerlo (puede completarse o no)", async () => {
    const e = entorno();
    const c = await activo(e, { v: 0 }, { debounceMs: 5000, maxEsperaMs: 10000 });
    c.actualizarPayload({ v: 1 });
    expect(c.getSnapshot().guardado.estado).toBe("pendiente");
    c.dispose();
    await esperar(150);
    // el intento de mejor esfuerzo escribe en el ámbito ORIGINAL (nunca en otro). En este entorno simulado se completa; en un
    // navegador real podría no completarse si la página se cierra antes: por eso la interfaz nunca lo da por garantizado.
    expect((await guardados(e))?.payload).toEqual({ v: 1 });
    expect(ok(await e.nucleo.listarMetadatosUsuario(U2)).borradores).toHaveLength(0);
  });

  it("CIERRE del navegador antes de confirmar: lo no confirmado NO figura como guardado ni existe en el almacén; al reabrir no hay nada que recuperar", async () => {
    const e = entorno();
    const c = await activo(e);
    vi.spyOn(e.nucleo, "guardar").mockImplementation(() => new Promise(() => undefined)); // la transacción nunca llega a confirmarse
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    await esperar(60);
    expect(c.getSnapshot().guardado.estado).toBe("guardando"); // jamás «Guardado»
    expect(c.getSnapshot().guardadoEn).toBeNull();
    vi.restoreAllMocks();
    expect(await guardados(e)).toBeNull(); // el navegador se cierra aquí: no se promete nada
    const reabierto = e.crear();
    await reabierto.iniciar();
    expect(reabierto.getSnapshot()).toMatchObject({ fase: "activo", recuperacion: null });
  });

  it("estado «Cambios pendientes» honesto: tras el cambio y antes de la confirmación nunca figura «Guardado»", async () => {
    const e = entorno();
    const c = await activo(e, { v: 0 }, { debounceMs: 200 });
    c.actualizarPayload({ v: 1 });
    expect(c.getSnapshot().guardado.estado).toBe("pendiente");
    expect(c.getSnapshot().guardadoEn).toBeNull();
    expect(await guardados(e)).toBeNull();
  });
});
