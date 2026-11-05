import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  CLAVE_PREFERENCIA_PERSISTENCIA,
  construirContextoBorradores,
  crearAlmacenIndexedDB,
  crearAlmacenSegunPreferencia,
  crearNucleoBorradores,
  decidirSalidaConDialogoNativo,
  desactivarPersistencia,
  fijarPersistencia,
  persistenciaActiva,
  prepararCierreSesionExplicito,
  textoConsentimientoSalida,
  type AlmacenBorradores,
  type AlmacenPreferencias,
  type AmbitoBorrador,
  type Resultado,
  type TipoBorrador,
} from "./index";
import { ownerKeyDeUsuario } from "./owner-key";

const ENV = { AUTH_SECRET: "auth-secreto-de-prueba-0123456789-abcdef" };
const U1 = ownerKeyDeUsuario(1, ENV)!;
const U2 = ownerKeyDeUsuario(2, ENV)!;
const TIPOS: TipoBorrador[] = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"];
const ambito = (ownerKey: string, empresaId: number, tipo: TipoBorrador): AmbitoBorrador => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}`, tipo });

function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

function entorno() {
  const almacen = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
  const nucleo = crearNucleoBorradores({ almacen, appBuild: "prueba" });
  return { almacen, nucleo };
}

async function sembrar(nucleo: ReturnType<typeof entorno>["nucleo"], ownerKey: string, empresas = [1], tipos = TIPOS) {
  for (const e of empresas) for (const t of tipos) ok(await nucleo.guardar(ambito(ownerKey, e, t), { payload: { dato: `${ownerKey.slice(0, 6)}-${e}-${t}` }, esquemaVersion: 1, revisionBase: null }));
}

function prefsEnMemoria(inicial: Record<string, string> = {}): AlmacenPreferencias & { datos: Map<string, string> } {
  const datos = new Map(Object.entries(inicial));
  return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("contexto autenticado y ámbito", () => {
  it("cambiar de empresa mantiene la identidad (ownerKey) pero cambia el ámbito: borradores separados por empresa", async () => {
    const { nucleo } = entorno();
    const c1 = construirContextoBorradores({ ownerKey: U1, empresaId: 1, empresaSlug: "kuiqtrans" })!;
    const c2 = construirContextoBorradores({ ownerKey: U1, empresaId: 2, empresaSlug: "frescofresh" })!;
    expect(c1.ownerKey).toBe(c2.ownerKey);
    expect(c1.empresaId).not.toBe(c2.empresaId);
    ok(await nucleo.guardar({ ...c1, tipo: "gasto_operativo" }, { payload: { en: "empresa1" }, esquemaVersion: 1, revisionBase: null }));
    expect(ok(await nucleo.leer({ ...c2, tipo: "gasto_operativo" }, { esquemaVersion: 1 })).estado).toBe("vacio");
    expect(ok(await nucleo.leer({ ...c1, tipo: "gasto_operativo" }, { esquemaVersion: 1 })).estado).toBe("vigente");
  });

  it("construirContextoBorradores rechaza valores no válidos (frontera de confianza) y devuelve solo tres campos", () => {
    expect(construirContextoBorradores({ ownerKey: null, empresaId: 1, empresaSlug: "x" })).toBeNull();
    expect(construirContextoBorradores({ ownerKey: "", empresaId: 1, empresaSlug: "x" })).toBeNull();
    expect(construirContextoBorradores({ ownerKey: U1, empresaId: 0, empresaSlug: "x" })).toBeNull();
    expect(construirContextoBorradores({ ownerKey: U1, empresaId: 1, empresaSlug: "" })).toBeNull();
    expect(construirContextoBorradores({ ownerKey: U1, empresaId: "1", empresaSlug: "x" })).toBeNull();
    const c = construirContextoBorradores({ ownerKey: U1, empresaId: 3, empresaSlug: "kuiqtrans", username: "admin", token: "jwt" } as never)!;
    expect(Object.keys(c).sort()).toEqual(["empresaId", "empresaSlug", "ownerKey"]);
  });

  it("compatible con los tres formularios futuros: cada tipo crea, lee y guarda con el mismo contexto", async () => {
    const { nucleo } = entorno();
    const ctx = construirContextoBorradores({ ownerKey: U1, empresaId: 1, empresaSlug: "kuiqtrans" })!;
    for (const tipo of TIPOS) {
      const a: AmbitoBorrador = { ...ctx, tipo };
      const b1 = ok(await nucleo.guardar(a, { payload: { lineas: [{ monto: "1.00" }] }, esquemaVersion: 1, revisionBase: null }));
      const b2 = ok(await nucleo.guardar(a, { payload: { lineas: [{ monto: "2.00" }] }, esquemaVersion: 1, revisionBase: b1.revision }));
      expect(b2.revision).toBe(2);
    }
    expect(ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 })).borradores).toHaveLength(3);
  });
});

describe("dos usuarios en el mismo navegador", () => {
  it("cada uno ve solo lo suyo; la expiración de sesión (sin limpieza) conserva el borrador sin mostrarlo al siguiente usuario", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    // «Expira la sesión de U1»: no se ejecuta ninguna limpieza. Entra U2 en el mismo navegador.
    expect(ok(await nucleo.listarMetadatosUsuario(U2)).borradores).toHaveLength(0);
    expect(ok(await nucleo.leer(ambito(U2, 1, "solicitud_fondo"), { esquemaVersion: 1 })).estado).toBe("vacio");
    // U1 vuelve a iniciar sesión → mismo ownerKey → recupera todo.
    const U1DeNuevo = ownerKeyDeUsuario(1, ENV)!;
    expect(U1DeNuevo).toBe(U1);
    expect(ok(await nucleo.listarMetadatosUsuario(U1DeNuevo)).borradores).toHaveLength(3);
  });

  it("listarMetadatosUsuario entrega metadatos de todas las empresas del usuario, sin payload", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1, [1, 2], ["gasto_operativo"]);
    await sembrar(nucleo, U2, [1]);
    const l = ok(await nucleo.listarMetadatosUsuario(U1));
    expect(l.borradores).toHaveLength(2);
    expect(JSON.stringify(l)).not.toContain("dato");
    expect(await nucleo.listarMetadatosUsuario("")).toMatchObject({ ok: false, motivo: "ambito_invalido" });
  });
});

describe("cierre de sesión EXPLÍCITO: política de limpieza", () => {
  it("con limpieza autorizada («borrar»): elimina SOLO los borradores del usuario y la salida continúa", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1, [1, 2]);
    await sembrar(nucleo, U2, [1]);
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => "borrar" });
    expect(r).toEqual({ continuar: true, limpieza: "borrados", detectados: 6, eliminados: 6 });
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
    expect(ok(await nucleo.listarMetadatosUsuario(U2)).borradores).toHaveLength(3); // el otro usuario, intacto
  });

  it("con borradores sin sincronizar y consentimiento PENDIENTE no se borra nada hasta que el usuario decide", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    let responder!: (d: "borrar" | "conservar" | "cancelar") => void;
    const decision = new Promise<"borrar" | "conservar" | "cancelar">((res) => { responder = res; });
    const espia = vi.fn((...args: unknown[]) => { void args; return decision; });
    const pendiente = prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: espia });
    await new Promise((r) => setTimeout(r, 30)); // la interfaz está esperando
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0]![0]).toMatchObject({ total: 3, ilegibles: 0 }); // se informa cuántos hay
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(3); // NADA borrado todavía
    responder("cancelar");
    expect(await pendiente).toMatchObject({ continuar: false, limpieza: "no_requerida", eliminados: 0 }); // cancelar detiene la salida
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(3);
  });

  it("«conservar» sale sin borrar; ante error de la interfaz o decisión desconocida también se conserva", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => "conservar" })).toMatchObject({ continuar: true, limpieza: "conservados", eliminados: 0 });
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => { throw new Error("interfaz caída"); } })).toMatchObject({ continuar: true, limpieza: "conservados" });
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => "quizas" as never })).toMatchObject({ continuar: true, limpieza: "conservados" });
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(3);
  });

  it("sin borradores o sin ownerKey no pregunta ni toca nada", async () => {
    const { nucleo } = entorno();
    const decidir = vi.fn(async () => "borrar" as const);
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir })).toMatchObject({ continuar: true, limpieza: "no_requerida", detectados: 0 });
    expect(await prepararCierreSesionExplicito({ ownerKey: null, nucleo, decidir })).toMatchObject({ continuar: true, limpieza: "no_requerida" });
    expect(decidir).not.toHaveBeenCalled();
  });

  it("falla de IndexedDB: la salida NO se bloquea, no se borra nada y se informa", async () => {
    const nucleoSinIdb = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica: null }), appBuild: "p" });
    const decidir = vi.fn(async () => "borrar" as const);
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: nucleoSinIdb, decidir })).toEqual({ continuar: true, limpieza: "fallida", detectados: 0, eliminados: 0 });
    expect(decidir).not.toHaveBeenCalled();
  });

  it("falla durante el borrado: continúa la salida, se informa «fallida» y los borradores permanecen", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado de borrado"); });
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => "borrar" });
    expect(r.continuar).toBe(true);
    expect(["fallida", "parcial"]).toContain(r.limpieza);
    expect(r.eliminados).toBe(0);
    vi.restoreAllMocks();
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(3);
  });

  it("IndexedDB que no responde: la salida continúa tras el tiempo máximo (no se bloquea indefinidamente)", async () => {
    const colgado: AlmacenBorradores = { obtener: () => new Promise(() => {}), modificar: () => new Promise(() => {}), listar: () => new Promise(() => {}) };
    const nucleo = crearNucleoBorradores({ almacen: colgado, appBuild: "p" });
    const t0 = Date.now();
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => "borrar", tiempoMaxMs: 40 });
    expect(r).toMatchObject({ continuar: true, limpieza: "tiempo_agotado" });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("los textos de consentimiento advierten que no hay respaldo en servidor y que borrar es irreversible", () => {
    const t = textoConsentimientoSalida({ total: 3, ilegibles: 0, porTipo: { solicitud_fondo: 1, gasto_operativo: 1, requerimiento_compra: 1 }, ultimaActualizacion: 1 });
    expect(t.conservar).toMatch(/3 borradores/);
    expect(t.conservar).toMatch(/sin respaldo/i);
    expect(t.borrar).toMatch(/NO se puede deshacer/);
  });

  it("el diálogo nativo ofrece conservar primero; solo un segundo «aceptar» borra, y rechazar ambos cancela la salida", async () => {
    const resumen = { total: 1, ilegibles: 0, porTipo: { solicitud_fondo: 1, gasto_operativo: 0, requerimiento_compra: 0 }, ultimaActualizacion: null };
    expect(await decidirSalidaConDialogoNativo(() => true)(resumen)).toBe("conservar");
    const respuestas = [false, true];
    expect(await decidirSalidaConDialogoNativo(() => respuestas.shift()!)(resumen)).toBe("borrar");
    expect(await decidirSalidaConDialogoNativo(() => false)(resumen)).toBe("cancelar");
  });
});

describe("«No guardar en este equipo»: persistencia desactivada", () => {
  it("con confirmación: desactiva la persistencia, elimina SOLO los borradores del usuario y el autoguardado deja de escribir", async () => {
    const { almacen, nucleo } = entorno();
    await sembrar(nucleo, U1);
    await sembrar(nucleo, U2);
    const prefs = prefsEnMemoria();
    const r = await desactivarPersistencia({ ownerKey: U1, nucleo, prefs, confirmar: async () => true });
    expect(r).toEqual({ estado: "desactivada", detectados: 3, eliminados: 3 });
    expect(persistenciaActiva(prefs)).toBe(false);
    expect(prefs.datos.get(CLAVE_PREFERENCIA_PERSISTENCIA)).toBe("desactivada"); // valor fijo, sin secretos ni identidades
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(0);
    expect(ok(await nucleo.listarMetadatosUsuario(U2)).borradores).toHaveLength(3);
    // El almacén de AUTOGUARDADO obedece la preferencia en cada operación.
    const autoguardado = crearNucleoBorradores({ almacen: crearAlmacenSegunPreferencia(almacen, prefs), appBuild: "p" });
    expect(await autoguardado.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "persistencia_desactivada" });
    expect(await autoguardado.leer(ambito(U2, 1, "gasto_operativo"), { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "persistencia_desactivada" });
    // Reactivar restablece el guardado.
    expect(fijarPersistencia(prefs, true)).toBe(true);
    expect(ok(await autoguardado.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null })).revision).toBe(1);
  });

  it("sin confirmación: no se desactiva ni se borra nada", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    const prefs = prefsEnMemoria();
    expect(await desactivarPersistencia({ ownerKey: U1, nucleo, prefs, confirmar: async () => false })).toEqual({ estado: "cancelada", detectados: 3, eliminados: 0 });
    expect(await desactivarPersistencia({ ownerKey: U1, nucleo, prefs, confirmar: async () => { throw new Error("x"); } })).toMatchObject({ estado: "cancelada" });
    expect(persistenciaActiva(prefs)).toBe(true);
    expect(ok(await nucleo.listarMetadatosUsuario(U1)).borradores).toHaveLength(3);
  });

  it("sin borradores no pide confirmación; si el navegador no puede guardar la preferencia, no se borra nada", async () => {
    const { nucleo } = entorno();
    const confirmar = vi.fn(async () => true);
    const prefs = prefsEnMemoria();
    expect(await desactivarPersistencia({ ownerKey: U1, nucleo, prefs, confirmar })).toMatchObject({ estado: "desactivada", detectados: 0 });
    expect(confirmar).not.toHaveBeenCalled();

    await sembrar(nucleo, U2);
    const prefsRotas: AlmacenPreferencias = { getItem: () => null, setItem: () => { throw new Error("cuota"); }, removeItem: () => {} };
    expect(await desactivarPersistencia({ ownerKey: U2, nucleo, prefs: prefsRotas, confirmar })).toMatchObject({ estado: "no_aplicada" });
    expect(await desactivarPersistencia({ ownerKey: U2, nucleo, prefs: null, confirmar })).toMatchObject({ estado: "no_aplicada" });
    expect(ok(await nucleo.listarMetadatosUsuario(U2)).borradores).toHaveLength(3); // intactos
  });

  it("si falla el borrado queda desactivada con residuos informados; si no se puede ni consultar, no se desactiva a ciegas", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado"); });
    const prefs = prefsEnMemoria();
    const r = await desactivarPersistencia({ ownerKey: U1, nucleo, prefs, confirmar: async () => true });
    expect(r.estado).toBe("desactivada_con_residuos");
    expect(persistenciaActiva(prefs)).toBe(false);
    vi.restoreAllMocks();

    const sinIdb = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica: null }), appBuild: "p" });
    const prefs2 = prefsEnMemoria();
    expect(await desactivarPersistencia({ ownerKey: U1, nucleo: sinIdb, prefs: prefs2, confirmar: async () => true })).toMatchObject({ estado: "no_aplicada" });
    expect(persistenciaActiva(prefs2)).toBe(true);
  });

  it("la preferencia ilegible o ausente se interpreta como persistencia activa y nunca lanza", () => {
    expect(persistenciaActiva(null)).toBe(true);
    expect(persistenciaActiva({ getItem: () => { throw new Error("bloqueado"); }, setItem: () => {}, removeItem: () => {} })).toBe(true);
    expect(fijarPersistencia(null, false)).toBe(false);
  });
});

describe("no se generan secretos en el navegador", () => {
  it("el contexto del cliente no contiene nada además de ownerKey/empresa y el ownerKey no cambia entre llamadas", () => {
    const ctx = construirContextoBorradores({ ownerKey: U1, empresaId: 1, empresaSlug: "k" })!;
    expect(JSON.stringify(ctx)).not.toMatch(/token|jwt|secret|password|cookie/i);
    expect(ctx.ownerKey).toBe(U1);
  });
});
