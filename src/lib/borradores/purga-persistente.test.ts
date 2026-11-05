import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  ControladorBorrador,
  crearAlmacenIndexedDB,
  crearAlmacenSegunPreferencia,
  crearNucleoBorradores,
  desactivarPersistencia,
  establecerFabricaCanal,
  fijarPersistencia,
  prepararCierreSesionExplicito,
  reanudarEscriturasDe,
  reiniciarCoordinacionParaPruebas,
  suspenderEscriturasDe,
  type AlmacenPreferencias,
  type AmbitoBorrador,
  type OpcionesControlador,
  type Resultado,
  type TipoBorrador,
} from "./index";
import { claveMarcaPurga } from "./nucleo";

/**
 * BORR-1c — MARCA DE PURGA PERSISTENTE. Una escritura tardía de la sesión anterior NO recrea lo que el usuario pidió eliminar al
 * cerrar sesión, aunque su pestaña no haya recibido ningún aviso (sin BroadcastChannel, pestaña suspendida o perdida).
 * La protección se verifica DENTRO de la transacción de escritura de IndexedDB; BroadcastChannel solo mejora la experiencia.
 * Datos ficticios.
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const ambito = (ownerKey = U1, empresaId = 1, tipo: TipoBorrador = "solicitud_fondo"): AmbitoBorrador => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}`, tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const hasta = (fn: () => void, ms = 2500) => vi.waitFor(fn, { timeout: ms, interval: 5 });
function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

function entorno(reloj?: () => number) {
  const fabrica = new IDBFactory();
  const real = crearAlmacenIndexedDB({ fabrica });
  const nucleo = crearNucleoBorradores({ almacen: real, appBuild: "prueba", ahora: reloj });
  const crear = (extra: Partial<OpcionesControlador> = {}) => new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, debounceMs: 25, maxEsperaMs: 200, fabricaCanal: null, ...extra });
  return { fabrica, real, nucleo, crear };
}
type Entorno = ReturnType<typeof entorno>;
const total = async (e: Entorno, u = U1) => ok(await e.nucleo.listarMetadatosUsuario(u)).borradores.length;
const borrar = async () => "borrar" as const;
const coordinado = (u = U1) => ({ antesDeBorrar: () => suspenderEscriturasDe(u), alNoSalir: () => reanudarEscriturasDe(u) });
/** «Pestaña antigua»: se crea y SE LA DEJA SIN COORDINACIÓN (no recibe avisos, no figura en el registro de la página que cierra sesión). */
async function pestanaAntigua(e: Entorno, base: unknown = { v: 0 }, extra: Partial<OpcionesControlador> = {}) {
  const c = e.crear(extra);
  c.actualizarPayload(base);
  await c.iniciar();
  reiniciarCoordinacionParaPruebas(); // el logout se hace desde otra página: esta pestaña no puede ser suspendida
  return c;
}

afterEach(() => {
  vi.restoreAllMocks();
  reiniciarCoordinacionParaPruebas();
  establecerFabricaCanal(undefined);
});

describe("REGRESIÓN: la carrera original", () => {
  it("una pestaña antigua con su PRIMER guardado pendiente recrea el borrador purgado — y con la marca de purga ya no", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: "otro borrador del usuario" }, esquemaVersion: 1, revisionBase: null }));
    const vieja = await pestanaAntigua(e, { v: 0 }, { debounceMs: 120 });
    vieja.actualizarPayload({ v: "trabajo de la sesión anterior" }); // el borrador aún no existe: se creará a los 120 ms
    // Otra página cierra sesión y elige «borrar» (sin avisar a la anterior):
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: borrar });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados" });
    expect(await total(e)).toBe(0);
    await esperar(350); // vence el temporizador de la pestaña antigua
    expect(await total(e)).toBe(0); // ← antes de la corrección esta línea fallaba: el borrador reaparecía
    expect(vieja.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" });
  });

  it("CONTRATO ANTERIOR (sin época): una escritura tardía SÍ recrea lo purgado; con la época de la sesión, no", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const epocaAntigua = ok(await e.nucleo.leerEpocaPurga(U1));
    ok(await e.nucleo.purgarUsuario(U1));
    // sin época: el núcleo no puede saber que la escritura es de una sesión anterior
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: "tardía" }, esquemaVersion: 1, revisionBase: null }));
    expect(await total(e)).toBe(1);
    ok(await e.nucleo.eliminar(ambito(U1, 1, "gasto_operativo")));
    // con la época que tenía la sesión anterior: rechazada dentro de la transacción
    const r = await e.nucleo.guardar(ambito(), { payload: { v: "tardía" }, esquemaVersion: 1, revisionBase: null, epocaPurga: epocaAntigua });
    expect(r).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(await total(e)).toBe(0);
  });
});

describe("núcleo: marca de purga, época y CAS", () => {
  it("la época es 0 sin purgas, crece de forma estricta con cada purga y es por propietario", async () => {
    let t = 5_000;
    const e = entorno(() => t);
    expect(ok(await e.nucleo.leerEpocaPurga(U1))).toBe(0);
    ok(await e.nucleo.purgarUsuario(U1));
    const e1 = ok(await e.nucleo.leerEpocaPurga(U1));
    expect(e1).toBeGreaterThan(0);
    ok(await e.nucleo.purgarUsuario(U1)); // mismo instante: sigue creciendo
    const e2 = ok(await e.nucleo.leerEpocaPurga(U1));
    expect(e2).toBeGreaterThan(e1);
    t += 10_000;
    ok(await e.nucleo.purgarUsuario(U1));
    expect(ok(await e.nucleo.leerEpocaPurga(U1))).toBeGreaterThan(e2);
    expect(ok(await e.nucleo.leerEpocaPurga(U2))).toBe(0); // otro usuario: intacto
  });

  it("una escritura con la época VIGENTE (nueva autenticación) funciona; con una anterior es rechazada y no deja nada", async () => {
    const e = entorno();
    const antigua = ok(await e.nucleo.leerEpocaPurga(U1));
    ok(await e.nucleo.purgarUsuario(U1));
    const vigente = ok(await e.nucleo.leerEpocaPurga(U1));
    expect(await e.nucleo.guardar(ambito(), { payload: { v: "vieja" }, esquemaVersion: 1, revisionBase: null, epocaPurga: antigua })).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(await total(e)).toBe(0);
    expect(ok(await e.nucleo.guardar(ambito(), { payload: { v: "nueva sesión" }, esquemaVersion: 1, revisionBase: null, epocaPurga: vigente })).revision).toBe(1);
  });

  it("no rompe el CAS de BORR-1a: revisión obsoleta sigue siendo revision_obsoleta (con época vigente) y la época antigua no se «arregla» con la revisión", async () => {
    const e = entorno();
    const epoca = ok(await e.nucleo.leerEpocaPurga(U1));
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null, epocaPurga: epoca }));
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 2 }, esquemaVersion: 1, revisionBase: 1, epocaPurga: epoca }));
    expect(await e.nucleo.guardar(ambito(), { payload: { v: 3 }, esquemaVersion: 1, revisionBase: 1, epocaPurga: epoca })).toMatchObject({ ok: false, motivo: "revision_obsoleta", revisionActual: 2 });
    ok(await e.nucleo.purgarUsuario(U1));
    expect(await e.nucleo.guardar(ambito(), { payload: { v: 4 }, esquemaVersion: 1, revisionBase: 2, epocaPurga: epoca })).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(await total(e)).toBe(0);
  });

  it("la marca no es un borrador: no aparece en listados, no cuenta como ilegible y la purga no la borra", async () => {
    const e = entorno();
    ok(await e.nucleo.purgarUsuario(U1));
    expect(ok(await e.nucleo.listarMetadatosUsuario(U1))).toEqual({ borradores: [], ilegibles: 0 });
    expect(ok(await e.nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 }))).toEqual({ borradores: [], ilegibles: 0 });
    expect(ok(await e.nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, { solicitud_fondo: 1 }))).toEqual({ eliminados: 0, omitidos: 0 });
    expect(ok(await e.nucleo.purgarUsuario(U1))).toMatchObject({ total: 0 });
    expect(ok(await e.real.obtener(claveMarcaPurga(U1)))).toMatchObject({ tipo: "marca_purga", usuario: U1 });
  });

  it("si NO se puede escribir la marca, la purga NO elimina nada y falla de forma visible", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, valor: unknown, ...resto: unknown[]) {
      if ((valor as { tipo?: string })?.tipo === "marca_purga") throw new Error("fallo simulado al escribir la marca");
      return (original as (...a: unknown[]) => IDBRequest).call(this, valor, ...resto);
    });
    expect(await e.nucleo.purgarUsuario(U1)).toMatchObject({ ok: false });
    vi.restoreAllMocks();
    expect(await total(e)).toBe(1); // nada se eliminó sin la valla
    const informes: string[] = [];
    // …y por la salida de sesión se informa como fallo (no se sale en silencio)
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, valor: unknown, ...resto: unknown[]) {
      if ((valor as { tipo?: string })?.tipo === "marca_purga") throw new Error("fallo simulado al escribir la marca");
      return (original as (...a: unknown[]) => IDBRequest).call(this, valor, ...resto);
    });
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: borrar, decidirTrasFallo: async (i) => { informes.push(i.estado); return "cancelar"; } });
    expect(r).toMatchObject({ continuar: false, limpieza: "fallida" });
    expect(informes).toEqual(["fallida"]);
    vi.restoreAllMocks();
    expect(await total(e)).toBe(1);
  });

  it("una marca dañada impide escribir (falla cerrada) y la siguiente purga la repara", async () => {
    const e = entorno();
    const clave = claveMarcaPurga(U1);
    await e.real.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { clave, tipo: "marca_purga", formato: 1, usuario: U1, purgas: "mala" } as never }));
    expect(await e.nucleo.leerEpocaPurga(U1)).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await e.nucleo.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null, epocaPurga: 0 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await total(e)).toBe(0);
    ok(await e.nucleo.purgarUsuario(U1));
    const reparada = ok(await e.nucleo.leerEpocaPurga(U1));
    expect(reparada).toBeGreaterThan(0);
    expect(ok(await e.nucleo.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null, epocaPurga: reparada })).revision).toBe(1);
  });

  it("una época inválida es un argumento inválido; el almacén que no soporta la lectura adicional falla cerrado", async () => {
    const e = entorno();
    expect(await e.nucleo.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null, epocaPurga: -1 })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
    expect(await e.nucleo.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null, epocaPurga: 1.5 })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
    const sinSoporte = crearNucleoBorradores({ almacen: { ...e.real, modificar: (clave, decidir) => e.real.modificar(clave, (a) => decidir(a, undefined as never)) }, appBuild: "p" });
    expect(await sinSoporte.guardar(ambito(), { payload: {}, esquemaVersion: 1, revisionBase: null, epocaPurga: 0 })).toMatchObject({ ok: false });
    expect(await total(e)).toBe(0);
  });
});

describe("orden real de las transacciones de IndexedDB (escritura en cola frente a la purga)", () => {
  /** Mantiene la tienda ocupada con una transacción de escritura hasta que se llame a liberar(). */
  async function ocupar(e: Entorno) {
    const bd = await new Promise<IDBDatabase>((res, rej) => { const r = e.fabrica.open("novalvion-borradores", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    let liberar!: () => void;
    const fin = new Promise<void>((r) => { liberar = () => { activo = false; r(); }; });
    let activo = true;
    const tx = bd.transaction("borradores", "readwrite");
    const t = tx.objectStore("borradores");
    const paso = () => { if (!activo) return; t.get("__bloqueo__").onsuccess = paso; };
    tx.oncomplete = () => bd.close();
    paso();
    return { liberar, fin };
  }

  it("guardado EN COLA antes de la marca: se confirma primero y la purga lo elimina (no reaparece)", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null })); // crea la BD
    const bloqueo = await ocupar(e);
    const epoca = 0;
    const escritura = e.nucleo.guardar(ambito(), { payload: { v: "en cola" }, esquemaVersion: 1, revisionBase: null, epocaPurga: epoca }); // se encola…
    await esperar(30);
    const purga = e.nucleo.purgarUsuario(U1); // …y luego la marca de la purga
    await esperar(30);
    bloqueo.liberar();
    expect(ok(await escritura).revision).toBe(1);
    expect(ok(await purga)).toMatchObject({ total: 2, eliminados: 2 });
    await bloqueo.fin;
    expect(await total(e)).toBe(0);
  });

  it("guardado EN COLA después de la marca: se rechaza dentro de su transacción y no queda nada", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const bloqueo = await ocupar(e);
    const purga = e.nucleo.purgarUsuario(U1); // la marca se encola primero
    await esperar(30);
    const escritura = e.nucleo.guardar(ambito(), { payload: { v: "en cola" }, esquemaVersion: 1, revisionBase: null, epocaPurga: 0 });
    await esperar(30);
    bloqueo.liberar();
    expect(await escritura).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(ok(await purga)).toMatchObject({ eliminados: 1 });
    await bloqueo.fin;
    expect(await total(e)).toBe(0);
  });
});

describe("pestañas antiguas y sesiones nuevas (controlador)", () => {
  it("sin BroadcastChannel ni suspensión: la pestaña antigua queda bloqueada y su contenido permanece en pantalla (no se pierde ni se redirige)", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const vieja = await pestanaAntigua(e);
    expect(vieja.getSnapshot().sinCanal).toBe(true);
    vieja.actualizarPayload({ v: "pendiente" });
    ok(await e.nucleo.purgarUsuario(U1));
    await hasta(() => expect(vieja.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" }));
    expect(await total(e)).toBe(0);
    vieja.actualizarPayload({ v: "más cambios" }); // sigue sin escribir
    await esperar(100);
    expect(await total(e)).toBe(0);
  });

  it("reintentos tras un error: cada reintento usa la época de su sesión, así que tampoco recrean tras la purga", async () => {
    const e = entorno();
    const vieja = await pestanaAntigua(e, { v: 0 });
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("fallo simulado"); });
    vieja.actualizarPayload({ v: 1 });
    await hasta(() => expect(vieja.getSnapshot().guardado.estado).toBe("error_almacenamiento"));
    vi.restoreAllMocks();
    void original;
    ok(await e.nucleo.purgarUsuario(U1)); // la sesión termina mientras la pestaña tiene un error pendiente
    await vieja.reintentar();
    await hasta(() => expect(vieja.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" }));
    expect(await total(e)).toBe(0);
  });

  it("escritura YA INICIADA cuando empieza la purga: se confirma antes de la marca y la purga la elimina", async () => {
    const e = entorno();
    const c = await pestanaAntigua(e, { v: 0 });
    const original = e.nucleo.guardar.bind(e.nucleo);
    vi.spyOn(e.nucleo, "guardar").mockImplementation(async (a, x) => { const r = await original(a, x); await esperar(80); return r; }); // confirmada en IndexedDB, respuesta tardía
    c.actualizarPayload({ v: "en vuelo" });
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardando"));
    ok(await e.nucleo.purgarUsuario(U1));
    await esperar(150);
    expect(await total(e)).toBe(0);
  });

  it("NUEVA AUTENTICACIÓN: un controlador nuevo toma la época vigente y guarda con normalidad; la pestaña antigua sigue bloqueada y no pisa nada", async () => {
    const e = entorno();
    const vieja = await pestanaAntigua(e);
    vieja.actualizarPayload({ v: "vieja" });
    ok(await e.nucleo.purgarUsuario(U1));
    const nueva = e.crear(); // la sesión nueva abre el formulario
    nueva.actualizarPayload({ v: "" });
    await nueva.iniciar();
    nueva.actualizarPayload({ v: "borrador legítimo de la sesión nueva" });
    await hasta(() => expect(nueva.getSnapshot().guardado.estado).toBe("guardado"));
    await esperar(150);
    const l = ok(await e.nucleo.leer(ambito(), { esquemaVersion: 1 }));
    expect(l).toMatchObject({ estado: "vigente", borrador: { revision: 1, payload: { v: "borrador legítimo de la sesión nueva" } } });
    expect(vieja.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" });
    vieja.actualizarPayload({ v: "la vieja insiste" });
    await esperar(100);
    expect(ok(await e.nucleo.leer(ambito(), { esquemaVersion: 1 }))).toMatchObject({ borrador: { revision: 1, payload: { v: "borrador legítimo de la sesión nueva" } } });
  });

  it("RECARGAR la pestaña antigua: el controlador nuevo (sesión vigente) no reescribe el contenido de la sesión anterior; lo suyo se guarda normal", async () => {
    const e = entorno();
    const vieja = await pestanaAntigua(e, { v: "contenido de la sesión anterior" }, { debounceMs: 5000, maxEsperaMs: 9000 });
    vieja.actualizarPayload({ v: "cambios pendientes que se perderán al recargar" });
    ok(await e.nucleo.purgarUsuario(U1));
    vieja.dispose(); // «recargar»: se descarta la página
    await esperar(80);
    expect(await total(e)).toBe(0); // el flush de mejor esfuerzo al desmontar también fue rechazado
    const recargada = e.crear();
    recargada.actualizarPayload({ v: "" }); // el formulario recargado nace vacío (la sesión anterior ya no existe)
    await recargada.iniciar();
    await esperar(100);
    expect(await total(e)).toBe(0);
    recargada.actualizarPayload({ v: "trabajo nuevo" });
    await hasta(() => expect(recargada.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await total(e)).toBe(1);
  });

  it("fallo de IndexedDB al leer la época: falla cerrada (no escribe) hasta reintentar; nunca hay sobrescrituras destructivas", async () => {
    const real = new IDBFactory();
    let abre = false;
    const fabrica = { open: (...a: Parameters<IDBFactory["open"]>) => { if (!abre) throw new DOMException("bloqueado", "SecurityError"); return real.open(...a); } } as unknown as IDBFactory;
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica }), appBuild: "p" });
    const sano = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica: real }), appBuild: "p" });
    ok(await sano.guardar(ambito(), { payload: { v: "existente" }, esquemaVersion: 1, revisionBase: null }));
    const c = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo, debounceMs: 20, fabricaCanal: null });
    c.actualizarPayload({ v: 0 });
    await c.iniciar();
    expect(c.getSnapshot()).toMatchObject({ fase: "activo", errorLectura: "no_disponible" });
    abre = true; // el almacenamiento vuelve… pero este controlador nunca pudo establecer su época
    c.actualizarPayload({ v: "no debe pisar" });
    await esperar(120);
    expect(c.getSnapshot().guardado.estado).toBe("error_almacenamiento");
    expect(ok(await sano.leer(ambito(), { esquemaVersion: 1 }))).toMatchObject({ borrador: { revision: 1, payload: { v: "existente" } } });
    await c.reintentar(); // vuelve a consultar: ahora ve el borrador existente y exige decidir (no lo pisa)
    expect(c.getSnapshot().fase).toBe("decision_pendiente");
  });
});

describe("aislamiento, cancelación y persistencia desactivada", () => {
  it("la purga de un usuario no afecta a otro usuario; sí a todas las empresas del propio usuario", async () => {
    const e = entorno();
    const otroUsuario = await pestanaAntigua(e, { v: 0 }, { ambito: ambito(U2, 1) });
    const otraEmpresa = await pestanaAntigua(e, { v: 0 }, { ambito: ambito(U1, 2) });
    const propia = await pestanaAntigua(e, { v: 0 }, { ambito: ambito(U1, 1) });
    for (const c of [otroUsuario, otraEmpresa, propia]) c.actualizarPayload({ v: 1 });
    ok(await e.nucleo.purgarUsuario(U1));
    await hasta(() => {
      expect(otraEmpresa.getSnapshot().bloqueo).toBe("sesion_anterior");
      expect(propia.getSnapshot().bloqueo).toBe("sesion_anterior");
    });
    await hasta(() => expect(otroUsuario.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await total(e, U2)).toBe(1);
    expect(await total(e, U1)).toBe(0);
  });

  it("CANCELAR el logout (coordinado): el trabajo válido se conserva y el autoguardado se reanuda con la época vigente; una pestaña no avisada queda bloqueada", async () => {
    const e = entorno();
    const coordinada = e.crear();
    coordinada.actualizarPayload({ v: 0 });
    await coordinada.iniciar();
    coordinada.actualizarPayload({ v: 1 });
    await hasta(() => expect(coordinada.getSnapshot().guardado.estado).toBe("guardado"));
    const sinAviso = await pestanaAntigua(e, { v: 0 }, { ambito: ambito(U1, 2) });
    sinAviso.actualizarPayload({ v: "x" });
    // reiniciarCoordinacion dejó «coordinada» fuera del registro: se vuelve a registrar creando otra pestaña coordinada
    const viva = e.crear({ ambito: ambito(U1, 1, "gasto_operativo") });
    viva.actualizarPayload({ v: 0 });
    await viva.iniciar();
    viva.actualizarPayload({ v: "trabajo válido" });
    await hasta(() => expect(viva.getSnapshot().guardado.estado).toBe("guardado"));
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado"); });
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: borrar, decidirTrasFallo: async () => "cancelar", ...coordinado() });
    expect(r).toMatchObject({ continuar: false });
    vi.restoreAllMocks();
    await hasta(() => expect(viva.getSnapshot().fase).toBe("activo")); // reanudada
    viva.actualizarPayload({ v: "sigo trabajando" });
    await hasta(() => expect(viva.getSnapshot().guardado.estado).toBe("guardado"));
    expect(ok(await e.nucleo.leer(ambito(U1, 1, "gasto_operativo"), { esquemaVersion: 1 }))).toMatchObject({ borrador: { payload: { v: "sigo trabajando" } } });
    sinAviso.actualizarPayload({ v: "cambio posterior a la marca" }); // la pestaña que no recibió el aviso queda protegida en su próxima escritura…
    await hasta(() => expect(sinAviso.getSnapshot().bloqueo).toBe("sesion_anterior")); // …y debe recargarse para continuar
  });

  it("«No guardar en este equipo»: la purga que desactiva la persistencia también cierra el paso a las pestañas antiguas, y reactivarla no las desbloquea", async () => {
    const datos = new Map<string, string>();
    const prefs: AlmacenPreferencias = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
    const e = entorno();
    const nucleoPref = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(e.real, prefs), appBuild: "p" });
    const vieja = new ControladorBorrador({ ambito: ambito(), esquemaVersion: 1, nucleo: nucleoPref, prefs, debounceMs: 40, fabricaCanal: null });
    vieja.actualizarPayload({ v: 0 });
    await vieja.iniciar();
    reiniciarCoordinacionParaPruebas();
    ok(await e.nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const r = await desactivarPersistencia({ ownerKey: U1, nucleo: e.nucleo, prefs, confirmar: async () => true });
    expect(r).toMatchObject({ estado: "desactivada" });
    vieja.alCambiarPreferencia();
    fijarPersistencia(prefs, true); // se vuelve a activar el guardado
    vieja.actualizarPayload({ v: "de la sesión antigua" });
    vieja.alCambiarPreferencia(); // la pestaña vuelve a «activo»… pero su época es anterior a la purga
    await hasta(() => expect(vieja.getSnapshot().fase).not.toBe("consultando"));
    vieja.actualizarPayload({ v: "otra vez" });
    await esperar(150);
    expect(await total(e)).toBe(0);
    expect(vieja.getSnapshot().bloqueo).toBe("sesion_anterior");
  });
});

describe("descartar, ámbito inmutable y textos", () => {
  it("una sesión ANTERIOR no puede descartar el borrador de la sesión nueva (ni en el núcleo ni en el controlador)", async () => {
    const e = entorno();
    ok(await e.nucleo.guardar(ambito(), { payload: { v: "de la sesión anterior" }, esquemaVersion: 1, revisionBase: null }));
    const vieja = await pestanaAntigua(e, { v: 0 }); // carga el borrador: decisión pendiente
    expect(vieja.getSnapshot().fase).toBe("decision_pendiente");
    const epocaVieja = ok(await e.nucleo.leerEpocaPurga(U1));
    ok(await e.nucleo.purgarUsuario(U1));
    const nueva = e.crear();
    nueva.actualizarPayload({ v: "" });
    await nueva.iniciar();
    nueva.actualizarPayload({ v: "borrador de la sesión nueva" });
    await hasta(() => expect(nueva.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await e.nucleo.eliminar(ambito(), { epocaPurga: epocaVieja })).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(await vieja.descartar({ confirmado: true })).toMatchObject({ ok: false, motivo: "purga_posterior" });
    expect(vieja.getSnapshot()).toMatchObject({ fase: "bloqueado", bloqueo: "sesion_anterior" });
    expect(await vieja.descartar({ confirmado: true })).toMatchObject({ ok: false, motivo: "sesion_anterior" }); // y ya ni lo intenta
    expect(ok(await e.nucleo.leer(ambito(), { esquemaVersion: 1 }))).toMatchObject({ borrador: { payload: { v: "borrador de la sesión nueva" } } });
  });

  it("el ámbito de un controlador es inmutable: mutar el objeto original no redirige una escritura pendiente a otro usuario/empresa", async () => {
    const e = entorno();
    const original = ambito(U1, 1);
    const c = e.crear({ ambito: original, debounceMs: 60 });
    c.actualizarPayload({ v: 0 });
    await c.iniciar();
    c.actualizarPayload({ v: "pendiente" });
    (original as { ownerKey: string }).ownerKey = U2;
    (original as { empresaId: number }).empresaId = 99;
    await hasta(() => expect(c.getSnapshot().guardado.estado).toBe("guardado"));
    expect(await total(e, U1)).toBe(1);
    expect(await total(e, U2)).toBe(0);
    expect(Object.isFrozen(c.ambito)).toBe(true);
  });
});
