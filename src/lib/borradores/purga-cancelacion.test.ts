import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  crearAlmacenIndexedDB,
  crearNucleoBorradores,
  desactivarPersistencia,
  prepararCierreSesionExplicito,
  textoAdvertenciaLimpieza,
  type AlmacenBorradores,
  type AlmacenPreferencias,
  type AmbitoBorrador,
  type DecisionTrasFallo,
  type InformeLimpieza,
  type Resultado,
  type ResumenPurga,
  type TipoBorrador,
} from "./index";

/**
 * BORR-1b — cancelación cooperativa de la purga y resultado visible del borrado. Pruebas de COMPORTAMIENTO sobre IndexedDB
 * real simulado (fake-indexeddb); los retrasos se inyectan en `modificar` para reproducir plazos vencidos. Datos ficticios.
 */
const U1 = "o1_usuario-ficticio-uno";
const U2 = "o1_usuario-ficticio-dos";
const TIPOS: TipoBorrador[] = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"];
const ambito = (ownerKey: string, tipo: TipoBorrador): AmbitoBorrador => ({ ownerKey, empresaId: 1, empresaSlug: "kuiqtrans", tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}`);
  return r.valor;
}

function entorno() {
  const real = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
  const nucleo = crearNucleoBorradores({ almacen: real, appBuild: "prueba" });
  return { real, nucleo };
}
type Entorno = ReturnType<typeof entorno>;

async function sembrar(nucleo: Entorno["nucleo"], ownerKey: string, tipos = TIPOS) {
  for (const t of tipos) ok(await nucleo.guardar(ambito(ownerKey, t), { payload: { v: `${ownerKey}-${t}` }, esquemaVersion: 1, revisionBase: null }));
}
const contar = async (nucleo: Entorno["nucleo"], ownerKey: string) => ok(await nucleo.listarMetadatosUsuario(ownerKey)).borradores.length;

type Comportamiento = { antesMs?: number; resolverTardeMs?: number };
/** Almacén que retrasa `modificar` según el número de llamada (1, 2, 3…): antes de INICIAR la transacción, o solo al RESOLVER. */
function conRetrasos(real: AlmacenBorradores, comportamiento: (n: number) => Comportamiento = () => ({})) {
  const estado = { llamadas: 0 };
  const almacen: AlmacenBorradores = {
    obtener: real.obtener,
    listar: real.listar,
    modificar: ((clave: string, decidir: never, opciones?: never) => {
      // La marca de purga (BORR-1c) no es una «eliminación»: no cuenta ni se retrasa; las pruebas numeran solo las operaciones sobre borradores.
      if (clave.startsWith('["__purga__"')) return real.modificar(clave, decidir, opciones);
      const c = comportamiento(++estado.llamadas);
      const ejecutar = (): Promise<Resultado<unknown>> => real.modificar(clave, decidir, opciones);
      if (c.resolverTardeMs) { const p = ejecutar(); return new Promise<Resultado<unknown>>((res) => setTimeout(() => res(p), c.resolverTardeMs)); }
      if (c.antesMs) return new Promise<Resultado<unknown>>((res) => setTimeout(() => res(ejecutar()), c.antesMs));
      return ejecutar();
    }) as AlmacenBorradores["modificar"],
  };
  return { almacen, estado };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("purgarUsuario: cancelación cooperativa", () => {
  it("con la señal ya cancelada no lista ni elimina nada", async () => {
    const { real, nucleo } = entorno();
    await sembrar(nucleo, U1);
    const listar = vi.spyOn(real, "listar");
    const c = new AbortController(); c.abort();
    const r = ok(await nucleo.purgarUsuario(U1, { signal: c.signal }));
    expect(r).toMatchObject({ cancelado: true, total: 0, eliminados: 0 });
    expect(listar).not.toHaveBeenCalled();
    expect(await contar(nucleo, U1)).toBe(3);
  });

  it("cancelada entre eliminaciones: no se inicia ninguna más y el resumen es exacto", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen, estado } = conRetrasos(real);
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "p" });
    const c = new AbortController();
    const r = ok(await nucleo.purgarUsuario(U1, { signal: c.signal, alProgresar: (x) => { if (x.eliminados === 1) c.abort(); } }));
    expect(r).toEqual({ total: 3, eliminados: 1, fallidos: 0, cambiados: 0, pendientes: 2, indeterminados: 0, cancelado: true });
    expect(estado.llamadas).toBe(1); // ninguna operación nueva después de cancelar
    expect(await contar(base, U1)).toBe(2);
  });

  it("plazo vencido ANTES de iniciar la transacción: cero eliminaciones posteriores (la decisión ya no borra)", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen } = conRetrasos(real, () => ({ antesMs: 150 })); // la transacción empezaría a los 150 ms
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "p" });
    const c = new AbortController();
    setTimeout(() => c.abort(), 20);
    const r = ok(await nucleo.purgarUsuario(U1, { signal: c.signal }));
    expect(r).toMatchObject({ cancelado: true, eliminados: 0, indeterminados: 1 }); // en vuelo, resultado desconocido
    await esperar(500); // la operación retrasada corre ahora…
    expect(await contar(base, U1)).toBe(3); // …y NO borra: su decisión transaccional ve la cancelación
  });

  it("plazo vencido DURANTE una transacción que ya emitió su borrado: resultado real = incierto (se documenta)", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen, estado } = conRetrasos(real, (n) => (n === 1 ? { resolverTardeMs: 150 } : {}));
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "p" });
    const c = new AbortController();
    setTimeout(() => c.abort(), 20);
    const r = ok(await nucleo.purgarUsuario(U1, { signal: c.signal }));
    // Lo CONFIRMADO al cancelar es 0, pero la transacción ya había emitido su borrado y se confirmó: no es reversible.
    expect(r).toMatchObject({ cancelado: true, eliminados: 0, indeterminados: 1, pendientes: 2 });
    await esperar(400);
    expect(estado.llamadas).toBe(1); // no se inició ninguna otra
    expect(await contar(base, U1)).toBe(2); // el borrado en vuelo SÍ se confirmó: por eso el informe es «incierto»
  });

  it("una versión nueva creada tras el listado no se elimina (cambió de borradorId/revisión)", async () => {
    const { real, nucleo } = entorno();
    await sembrar(nucleo, U1);
    // Entre el listado y el borrado, otra pestaña: edita uno (revisión 2) y recrea otro (nuevo borradorId, revisión 1).
    const almacen: AlmacenBorradores = {
      ...real,
      listar: async (...a) => {
        const lista = await real.listar(...a);
        ok(await nucleo.guardar(ambito(U1, "solicitud_fondo"), { payload: { v: "EDITADO" }, esquemaVersion: 1, revisionBase: 1 }));
        ok(await nucleo.eliminar(ambito(U1, "gasto_operativo")));
        ok(await nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: { v: "RECREADO" }, esquemaVersion: 1, revisionBase: null }));
        return lista;
      },
    };
    const r = ok(await crearNucleoBorradores({ almacen, appBuild: "p" }).purgarUsuario(U1));
    expect(r).toMatchObject({ total: 3, eliminados: 1, cambiados: 2, fallidos: 0 });
    const vistos = Object.fromEntries(await Promise.all(TIPOS.map(async (t) => [t, ok(await nucleo.leer(ambito(U1, t), { esquemaVersion: 1 })).estado])));
    expect(vistos).toEqual({ solicitud_fondo: "vigente", gasto_operativo: "vigente", requerimiento_compra: "vacio" });
  });

  it("`consentidoEn` deja intacto lo guardado después del consentimiento", async () => {
    let reloj = 1_000;
    const almacen = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "p", ahora: () => reloj });
    ok(await nucleo.guardar(ambito(U1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // antes
    reloj = 3_000;
    ok(await nucleo.guardar(ambito(U1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // después
    const r = ok(await nucleo.purgarUsuario(U1, { consentidoEn: 2_000 }));
    expect(r).toMatchObject({ total: 1, eliminados: 1 });
    expect(ok(await nucleo.existe(ambito(U1, "solicitud_fondo")))).toBe(false);
    expect(ok(await nucleo.existe(ambito(U1, "gasto_operativo")))).toBe(true);
  });

  it("el usuario vuelve a iniciar sesión mientras una purga cancelada sigue en cola: su borrador nuevo sobrevive", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen } = conRetrasos(real, (n) => (n === 1 ? { antesMs: 200 } : {}));
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "p" });
    const c = new AbortController();
    setTimeout(() => c.abort(), 20);
    await nucleo.purgarUsuario(U1, { signal: c.signal });
    // «Re-login» con el mismo ownerKey: se descarta y se recrea un borrador nuevo en la misma clave.
    const clave = ambito(U1, "solicitud_fondo");
    ok(await base.eliminar(clave));
    const nuevo = ok(await base.guardar(clave, { payload: { v: "NUEVO-TRAS-RELOGIN" }, esquemaVersion: 1, revisionBase: null }));
    await esperar(450); // la operación vieja se ejecuta ahora
    const leido = ok(await base.leer(clave, { esquemaVersion: 1 })) as { estado: string; borrador: { borradorId: string; payload: unknown } };
    expect(leido.estado).toBe("vigente");
    expect(leido.borrador.borradorId).toBe(nuevo.borradorId);
    expect(leido.borrador.payload).toEqual({ v: "NUEVO-TRAS-RELOGIN" });
  });

  it("aislamiento: cancelar o completar una purga no toca a otro usuario", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1); await sembrar(nucleo, U2);
    ok(await nucleo.purgarUsuario(U1));
    expect(await contar(nucleo, U1)).toBe(0);
    expect(await contar(nucleo, U2)).toBe(3);
  });

  it("un resultado inesperado del almacén NO se cuenta como eliminado, y un observador defectuoso no rompe la purga", async () => {
    const { real, nucleo } = entorno();
    await sembrar(nucleo, U1);
    const raro: AlmacenBorradores = { ...real, modificar: (async () => ({ ok: true, valor: undefined })) as AlmacenBorradores["modificar"] };
    const r = ok(await crearNucleoBorradores({ almacen: raro, appBuild: "p" }).purgarUsuario(U1, { alProgresar: () => { throw new Error("observador roto"); } }));
    expect(r).toMatchObject({ total: 3, eliminados: 0, fallidos: 3 });
  });

  it("invariante: total = eliminados + fallidos + cambiados + pendientes + indeterminados", async () => {
    for (const antes of [0, 120]) {
      const { real, nucleo: base } = entorno();
      await sembrar(base, U1);
      const { almacen } = conRetrasos(real, (n) => (n === 2 && antes ? { antesMs: antes } : {}));
      const c = new AbortController(); setTimeout(() => c.abort(), 30);
      const r: ResumenPurga = ok(await crearNucleoBorradores({ almacen, appBuild: "p" }).purgarUsuario(U1, { signal: c.signal }));
      expect(r.total).toBe(r.eliminados + r.fallidos + r.cambiados + r.pendientes + r.indeterminados);
      await esperar(300);
    }
  });
});

describe("salida explícita: resultado visible del borrado y decisión informada", () => {
  const borrar = async () => "borrar" as const;

  /** Registra los informes recibidos y responde con las decisiones dadas, en orden (la última se repite). */
  function decisiones(...ds: DecisionTrasFallo[]) {
    const informes: InformeLimpieza[] = [];
    let i = 0;
    const fn = async (inf: InformeLimpieza) => { informes.push(inf); return ds[Math.min(i++, ds.length - 1)]!; };
    return { fn, informes };
  }
  const fallarBorrado = () => vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("fallo simulado de borrado"); });

  it("1. borrado exitoso: la salida continúa sin advertencia", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: d.fn });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados", eliminados: 3, intentos: 1 });
    expect(r.informe).toBeUndefined();
    expect(d.informes).toHaveLength(0);
    expect(await contar(nucleo, U1)).toBe(0);
  });

  it("2. borrado fallido: advertencia con el informe real; cancelar no sale ni toca nada", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    fallarBorrado();
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: d.fn });
    expect(d.informes).toEqual([{ estado: "fallida", total: 3, eliminados: 0, restantes: 3, cambiados: 0, incierto: false, intento: 1 }]);
    expect(r).toMatchObject({ continuar: false, limpieza: "fallida", salidaInformada: false });
    vi.restoreAllMocks();
    expect(await contar(nucleo, U1)).toBe(3);
  });

  it("3. borrado parcial: advertencia con lo eliminado y lo que queda; salir informado conserva el resto", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    const original = IDBObjectStore.prototype.delete;
    let n = 0;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["delete"]>) {
      if (++n === 1) return original.apply(this, a);
      throw new Error("fallo simulado");
    });
    const d = decisiones("salir");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: d.fn });
    expect(d.informes[0]).toMatchObject({ estado: "parcial", total: 3, eliminados: 1, restantes: 2, incierto: false });
    expect(r).toMatchObject({ continuar: true, limpieza: "parcial", salidaInformada: true, eliminados: 1 });
    vi.restoreAllMocks();
    expect(await contar(nucleo, U1)).toBe(2);
  });

  it("8. reintentar eliminación: tras corregir la causa, completa y la salida continúa", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    const espia = fallarBorrado();
    const informes: InformeLimpieza[] = [];
    const r = await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo, decidir: borrar,
      decidirTrasFallo: async (inf) => { informes.push(inf); espia.mockRestore(); return "reintentar"; },
    });
    expect(informes).toHaveLength(1);
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados", intentos: 2, eliminados: 3 });
    expect(await contar(nucleo, U1)).toBe(0);
  });

  it("8b. el reintento NO elimina lo guardado después del consentimiento", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1, ["solicitud_fondo", "gasto_operativo"]);
    const espia = fallarBorrado();
    const r = await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo, decidir: borrar,
      decidirTrasFallo: async () => {
        espia.mockRestore();
        await esperar(10); // el reloj avanza: lo que se guarde ahora es POSTERIOR al consentimiento
        ok(await nucleo.guardar(ambito(U1, "requerimiento_compra"), { payload: { v: "POSTERIOR" }, esquemaVersion: 1, revisionBase: null }));
        return "reintentar";
      },
    });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados", intentos: 2, eliminados: 2 });
    expect(ok(await nucleo.existe(ambito(U1, "requerimiento_compra")))).toBe(true);
    expect(await contar(nucleo, U1)).toBe(1);
  });

  it("10. salir conservando los residuos conocidos queda registrado como salida informada", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    fallarBorrado();
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: decisiones("salir").fn });
    expect(r).toMatchObject({ continuar: true, salidaInformada: true, limpieza: "fallida" });
    expect(r.informe?.restantes).toBe(3);
  });

  it("sin interfaz de advertencia, si ésta lanza, o tras demasiados reintentos: la salida se CANCELA (nunca continúa en silencio)", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo, U1);
    fallarBorrado();
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar })).toMatchObject({ continuar: false });
    expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: async () => { throw new Error("interfaz caída"); } })).toMatchObject({ continuar: false });
    const siempre = decisiones("reintentar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: siempre.fn });
    expect(r).toMatchObject({ continuar: false });
    expect(siempre.informes.length).toBeGreaterThanOrEqual(10);
    vi.restoreAllMocks();
    expect(await contar(nucleo, U1)).toBe(3);
  });

  it("4. plazo vencido ANTES de iniciar: informe incierto, sin eliminaciones posteriores aunque la operación se ejecute tarde", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen } = conRetrasos(real, () => ({ antesMs: 250 }));
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo: crearNucleoBorradores({ almacen, appBuild: "p" }), decidir: borrar, decidirTrasFallo: d.fn, tiempoMaxMs: 40, graciaCancelacionMs: 40,
    });
    expect(d.informes[0]).toMatchObject({ estado: "tiempo_agotado", eliminados: 0, incierto: true });
    expect(r).toMatchObject({ continuar: false, limpieza: "tiempo_agotado" });
    await esperar(600);
    expect(await contar(base, U1)).toBe(3); // sin borrados tardíos
  });

  it("4b. plazo vencido durante el LISTADO (solo lectura): nada se eliminó, el informe es exacto (no incierto) y no hay borrados tardíos", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const lento: AlmacenBorradores = { ...real, listar: ((...a: Parameters<typeof real.listar>) => new Promise((res) => setTimeout(() => res(real.listar(...a)), 250))) as AlmacenBorradores["listar"] };
    let consultas = 0; // la PRIMERA consulta (resumen previo) es rápida; la de la purga es la lenta
    const almacen: AlmacenBorradores = { ...real, listar: (...a) => (++consultas === 1 ? real.listar(...a) : lento.listar(...a)) };
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo: crearNucleoBorradores({ almacen, appBuild: "p" }), decidir: borrar, decidirTrasFallo: d.fn, tiempoMaxMs: 40, graciaCancelacionMs: 40,
    });
    expect(d.informes[0]).toEqual({ estado: "tiempo_agotado", total: 3, eliminados: 0, restantes: 3, cambiados: 0, incierto: false, intento: 1 });
    expect(r.continuar).toBe(false);
    await esperar(600);
    expect(await contar(base, U1)).toBe(3);
  });

  it("5. plazo vencido ENTRE varias eliminaciones: no se inician más y el informe lo refleja", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen, estado } = conRetrasos(real, (n) => (n === 2 ? { antesMs: 250 } : {}));
    const d = decisiones("salir");
    const r = await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo: crearNucleoBorradores({ almacen, appBuild: "p" }), decidir: borrar, decidirTrasFallo: d.fn, tiempoMaxMs: 60, graciaCancelacionMs: 40,
    });
    expect(estado.llamadas).toBe(2); // la tercera nunca se inició
    expect(d.informes[0]).toMatchObject({ estado: "tiempo_agotado", total: 3, eliminados: 1, restantes: 2, incierto: true });
    expect(r).toMatchObject({ continuar: true, salidaInformada: true });
    await esperar(600);
    expect(await contar(base, U1)).toBe(2);
  });

  it("6. plazo vencido DURANTE una transacción ya emitida: se declara incierto (el borrado en vuelo pudo confirmarse)", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen } = conRetrasos(real, (n) => (n === 1 ? { resolverTardeMs: 250 } : {}));
    const d = decisiones("salir");
    await prepararCierreSesionExplicito({
      ownerKey: U1, nucleo: crearNucleoBorradores({ almacen, appBuild: "p" }), decidir: borrar, decidirTrasFallo: d.fn, tiempoMaxMs: 40, graciaCancelacionMs: 40,
    });
    expect(d.informes[0]).toMatchObject({ estado: "tiempo_agotado", eliminados: 0, incierto: true }); // lo confirmado: 0
    await esperar(500);
    expect(await contar(base, U1)).toBe(2); // el borrado en vuelo sí se confirmó: por eso NUNCA se afirma conservación
  });

  it("desactivar «No guardar en este equipo»: borrado parcial o fuera de plazo → desactivada con residuos informados, sin borrados tardíos", async () => {
    const { real, nucleo: base } = entorno();
    await sembrar(base, U1);
    const { almacen } = conRetrasos(real, () => ({ antesMs: 250 }));
    const datos = new Map<string, string>();
    const prefs: AlmacenPreferencias = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
    const r = await desactivarPersistencia({
      ownerKey: U1, nucleo: crearNucleoBorradores({ almacen, appBuild: "p" }), prefs, confirmar: async () => true, tiempoMaxMs: 40, graciaCancelacionMs: 40,
    });
    expect(r).toMatchObject({ estado: "desactivada_con_residuos", eliminados: 0 });
    expect(r.informe).toMatchObject({ estado: "tiempo_agotado", incierto: true });
    await esperar(600);
    expect(await contar(base, U1)).toBe(3);
  });
});

describe("textos de la advertencia", () => {
  const base: InformeLimpieza = { estado: "parcial", total: 5, eliminados: 2, restantes: 3, cambiados: 0, incierto: false, intento: 1 };
  const informes: InformeLimpieza[] = [
    base,
    { ...base, estado: "fallida", eliminados: 0, restantes: 5 },
    { ...base, estado: "tiempo_agotado" },
    { ...base, estado: "tiempo_agotado", incierto: true },
    { ...base, cambiados: 1 },
  ];

  it("nunca afirman «borrado correctamente» y muestran los números reales", () => {
    for (const inf of informes) {
      const t = textoAdvertenciaLimpieza(inf);
      expect(`${t.titulo} ${t.detalle} ${t.salir}`).not.toMatch(/correctamente|con éxito|se borr[óo] todo/i);
    }
    expect(textoAdvertenciaLimpieza(base).detalle).toMatch(/2 de 5/);
    expect(textoAdvertenciaLimpieza(informes[4]!).detalle).toMatch(/1 cambiaron durante la limpieza/);
  });

  it("con una operación de borrado todavía en curso (incierto) NO garantizan conservación", () => {
    const t = textoAdvertenciaLimpieza({ ...base, estado: "tiempo_agotado", incierto: true });
    expect(t.detalle).toMatch(/no se puede confirmar/i);
    expect(t.detalle).toMatch(/podría terminar/i);
    expect(t.salir).toMatch(/sin confirmar/i);
    expect(`${t.detalle} ${t.salir}`).not.toMatch(/siguen guardados|conservar los/i);
  });

  it("cuando el estado es conocido, sí informan lo que sigue guardado", () => {
    expect(textoAdvertenciaLimpieza(base).detalle).toMatch(/3 siguen guardados/);
    expect(textoAdvertenciaLimpieza(informes[1]!).detalle).toMatch(/los 5 siguen guardados/);
    expect(textoAdvertenciaLimpieza(informes[2]!).salir).toMatch(/conservar los borradores restantes/);
  });
});
