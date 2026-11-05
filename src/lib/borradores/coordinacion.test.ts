import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  ControladorBorrador,
  crearAlmacenIndexedDB,
  crearNucleoBorradores,
  establecerFabricaCanal,
  prepararCierreSesionExplicito,
  reanudarEscriturasDe,
  reiniciarCoordinacionParaPruebas,
  suspenderEscriturasDe,
  type AmbitoBorrador,
  type FabricaCanal,
  type OpcionesControlador,
  type Resultado,
  type TipoBorrador,
} from "./index";

/**
 * BORR-1c — carreras entre guardados pendientes/en vuelo, cierre de sesión y purga por usuario. Datos ficticios.
 * Garantía bajo prueba: lo que el usuario pidió eliminar al salir NO lo recrea un autoguardado (pendiente, en vuelo o tardío).
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const ambito = (ownerKey = U1, tipo: TipoBorrador = "solicitud_fondo"): AmbitoBorrador => ({ ownerKey, empresaId: 1, empresaSlug: "kuiqtrans", tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void, ms = 2000) => vi.waitFor(fn, { timeout: ms, interval: 5 });
function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

function entorno() {
  const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
  const nucleo = crearNucleoBorradores({ almacen: real, appBuild: "prueba" });
  const crear = (extra: Partial<OpcionesControlador> = {}) => new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, debounceMs: 30, maxEsperaMs: 200, fabricaCanal: null, ...extra });
  return { real, nucleo, crear };
}
type Entorno = ReturnType<typeof entorno>;
const total = async (e: Entorno, u = U1) => ok(await e.nucleo.listarMetadatosUsuario(u)).borradores.length;
const decidirBorrar = async () => "borrar" as const;
const coordinado = (ownerKey = U1) => ({ antesDeBorrar: () => suspenderEscriturasDe(ownerKey), alNoSalir: () => reanudarEscriturasDe(ownerKey) });

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

afterEach(() => {
  vi.restoreAllMocks();
  reiniciarCoordinacionParaPruebas();
  establecerFabricaCanal(undefined);
});

describe("suspensión de escrituras por propietario", () => {
  it("suspende a los controladores del propietario (cancela lo pendiente) y no toca a los de otro usuario", async () => {
    const e = entorno();
    const a = e.crear({ debounceMs: 5000, maxEsperaMs: 10000 });
    const otro = e.crear({ ambito: ambito(U2), debounceMs: 5000, maxEsperaMs: 10000 });
    for (const c of [a, otro]) { c.actualizarPayload({ v: 0 }); await c.iniciar(); c.actualizarPayload({ v: 1 }); }
    const r = await suspenderEscriturasDe(U1);
    expect(r).toEqual({ suspendidos: 1, completo: true });
    expect(a.getSnapshot()).toMatchObject({ fase: "suspendido", suspension: "salida_de_sesion" });
    expect(otro.getSnapshot().fase).toBe("activo");
    a.dispose(); otro.dispose();
  });

  it("un controlador cerrado se retira del registro: ya no se suspende ni se reanuda", async () => {
    const e = entorno();
    const a = e.crear();
    a.actualizarPayload({ v: 0 }); await a.iniciar();
    a.dispose();
    expect(await suspenderEscriturasDe(U1)).toEqual({ suspendidos: 0, completo: true });
  });

  it("espera, con tope, a la escritura en vuelo; si no responde, informa completo:false sin colgarse", async () => {
    const e = entorno();
    const c = e.crear({ debounceMs: 5 });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    vi.spyOn(e.nucleo, "guardar").mockImplementation(() => new Promise(() => undefined));
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    const t0 = Date.now();
    expect(await suspenderEscriturasDe(U1, { esperaMaxMs: 60 })).toEqual({ suspendidos: 1, completo: false });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("guardado pendiente / en vuelo + cierre de sesión + purga", () => {
  it("PENDIENTE (aún no escrito): el logout con «borrar» lo cancela y NO se recrea cuando vence el temporizador", async () => {
    const e = entorno();
    const c = e.crear({ debounceMs: 40 });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    c.actualizarPayload({ v: "primer contenido" }); // el borrador aún no existe: se crearía a los 40 ms
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, ...coordinado() });
    expect(r).toMatchObject({ continuar: true, limpieza: "no_requerida" }); // nada que purgar todavía
    // …pero si ya hubiera algo que purgar:
    ok(await e.nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const r2 = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, ...coordinado() });
    expect(r2).toMatchObject({ continuar: true, limpieza: "borrados" });
    await esperar(200);
    expect(await total(e)).toBe(0); // el autoguardado pendiente no recreó nada
    c.dispose();
  });

  it("EN VUELO: la purga espera a la escritura en curso, así que la elimina (no queda un borrador «fantasma»)", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null })); // algo que purgar
    const c = e.crear({ debounceMs: 5 });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    // Si la purga ignorara la escritura en vuelo, listaría antes de que se confirme y el borrador sobreviviría.
    const original = e.nucleo.guardar.bind(e.nucleo);
    vi.spyOn(e.nucleo, "guardar").mockImplementation(async (a, x) => { await esperar(120); return original(a, x); });
    c.actualizarPayload({ v: "en vuelo" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, ...coordinado() });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados" });
    expect(await total(e)).toBe(0);
    await esperar(150);
    expect(await total(e)).toBe(0);
    c.dispose();
  });

  it("SIN la coordinación de la página, la marca de purga persistente igualmente impide que el guardado pendiente recree lo eliminado", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const c = e.crear({ debounceMs: 60 });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    c.actualizarPayload({ v: "nuevo" });
    await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar }); // sin antesDeBorrar
    await esperar(200);
    expect(await total(e)).toBe(0); // el temporizador tardío fue rechazado DENTRO de su transacción (antes de la marca recreaba el borrador)
    expect(c.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" });
    c.dispose();
  });

  it("tras la purga, un guardado TARDÍO de una pestaña no coordinada no recrea un borrador que existía (la revisión base ya no coincide)", async () => {
    const e = entorno();
    const tardia = e.crear({ debounceMs: 80 });
    tardia.actualizarPayload({ v: 0 }); await tardia.iniciar();
    tardia.actualizarPayload({ v: 1 });
    await hasta(() => expect(tardia.getSnapshot().guardado.estado).toBe("guardado")); // el borrador existe: revisión 1
    tardia.actualizarPayload({ v: 2 }); // pendiente
    reiniciarCoordinacionParaPruebas(); // esta pestaña no se entera de la salida (sin canal, registro vacío)
    ok(await e.nucleo.purgarUsuario(U1));
    expect(await total(e)).toBe(0);
    await hasta(() => expect(tardia.getSnapshot().fase).toBe("bloqueado"));
    expect(tardia.getSnapshot().bloqueo).toBe("sesion_anterior");
    expect(await total(e)).toBe(0); // NO se recreó
    tardia.dispose();
  });

  it("si la salida se CANCELA tras una eliminación fallida, los controladores se reanudan y siguen guardando", async () => {
    const e = entorno();
    const c = e.crear({ debounceMs: 30 });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    c.actualizarPayload({ v: 1 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    const espia = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado"); });
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, decidirTrasFallo: async () => "cancelar", ...coordinado() });
    expect(r).toMatchObject({ continuar: false });
    espia.mockRestore();
    await hasta(() => expect(c.getSnapshot().fase).toBe("activo")); // reanudado
    c.actualizarPayload({ v: 2 });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(ok(await e.nucleo.leer(ambito(), { esquemaVersion: 1 }))).toMatchObject({ estado: "vigente", borrador: { revision: 2, payload: { v: 2 } } });
    c.dispose();
  });

  it("«conservar» al salir no suspende nada; el autoguardado sigue intacto", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const c = e.crear();
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: async () => "conservar", ...coordinado() });
    expect(r).toMatchObject({ limpieza: "conservados" });
    expect(c.getSnapshot().fase).toBe("activo");
    c.dispose();
  });

  it("si `antesDeBorrar` falla, la purga autorizada sigue adelante (mejor esfuerzo) y `alNoSalir` se invoca solo si la salida no ocurre", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const alNoSalir = vi.fn();
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, antesDeBorrar: async () => { throw new Error("x"); }, alNoSalir });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados" });
    expect(alNoSalir).not.toHaveBeenCalled();
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("x"); });
    const r2 = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: decidirBorrar, alNoSalir });
    expect(r2.continuar).toBe(false);
    expect(alNoSalir).toHaveBeenCalledTimes(1);
  });
});

describe("otras pestañas (aviso por canal; degradación segura)", () => {
  it("un aviso de purga de OTRA página suspende los controladores locales del propietario; «cancelada» los reanuda", async () => {
    const bus = crearBus();
    establecerFabricaCanal(bus);
    const e = entorno();
    const c = e.crear({ fabricaCanal: bus });
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    const otraPagina = bus(`novalvion-borradores-sesion:${U1}`);
    otraPagina.postMessage({ t: "purga_iniciada", de: "otra-pagina" });
    await hasta(() => expect(c.getSnapshot()).toMatchObject({ fase: "suspendido", suspension: "otra_pestana_salio" }));
    otraPagina.postMessage({ t: "purga_cancelada", de: "otra-pagina" });
    await hasta(() => expect(c.getSnapshot().fase).toBe("activo"));
    otraPagina.close();
    c.dispose();
  });

  it("la suspensión local AVISA a las demás pestañas aunque esta página no tenga controladores", async () => {
    const bus = crearBus();
    establecerFabricaCanal(bus);
    const recibidos: unknown[] = [];
    const otra = bus(`novalvion-borradores-sesion:${U1}`);
    otra.onmessage = (m) => recibidos.push((m.data as { t: string }).t);
    await suspenderEscriturasDe(U1);
    reanudarEscriturasDe(U1);
    await hasta(() => expect(recibidos).toEqual(["purga_iniciada", "purga_cancelada"]));
    otra.close();
  });

  it("sin BroadcastChannel todo sigue funcionando en la página local", async () => {
    establecerFabricaCanal(null);
    const e = entorno();
    const c = e.crear();
    c.actualizarPayload({ v: 0 }); await c.iniciar();
    expect(await suspenderEscriturasDe(U1)).toEqual({ suspendidos: 1, completo: true });
    reanudarEscriturasDe(U1);
    await hasta(() => expect(c.getSnapshot().fase).toBe("activo"));
    c.dispose();
  });

  it("un controlador suspendido ignora los cambios y reanudar no desbloquea lo que ya estaba bloqueado (p. ej. conflicto)", async () => {
    const e = entorno();
    const a = e.crear({ debounceMs: 20 });
    const b = e.crear({ debounceMs: 20 });
    for (const c of [a, b]) { c.actualizarPayload({ v: 0 }); await c.iniciar(); }
    a.actualizarPayload({ de: "A" });
    await hasta(() => expect(a.getSnapshot().guardado.estado).toBe("guardado"));
    b.actualizarPayload({ de: "B" });
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto"));
    await suspenderEscriturasDe(U1);
    expect(b.getSnapshot().fase).toBe("suspendido");
    b.actualizarPayload({ de: "C" });
    await esperar(80);
    reanudarEscriturasDe(U1);
    await hasta(() => expect(b.getSnapshot().fase).toBe("conflicto")); // sigue exigiendo una decisión
    a.dispose(); b.dispose();
  });
});
