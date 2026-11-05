import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  crearAlmacenIndexedDB,
  crearNucleoBorradores,
  desactivarPersistencia,
  prepararCierreSesionExplicito,
  resolverTrasExcepcionInesperada,
  textoAdvertenciaLimpieza,
  type AlmacenBorradores,
  type AlmacenPreferencias,
  type AmbitoBorrador,
  type DecisionTrasFallo,
  type InformeLimpieza,
  type OpcionesPurga,
  type Resultado,
  type ResumenPurga,
  type TipoBorrador,
} from "./index";

/**
 * BORR-1b — excepciones INESPERADAS durante el cierre de sesión. Reglas bajo prueba:
 *  - antes de autorizar el borrado (consulta de solo lectura): la salida puede continuar sin borrar;
 *  - durante o después de una eliminación autorizada: JAMÁS se continúa en silencio; se advierte (resultado incierto) y, sin
 *    interfaz de advertencia o si ésta falla, se cancela la salida;
 *  - el informe usa el PROGRESO confirmado (no «cero» ignorando lo ya eliminado). Datos ficticios.
 */
const U1 = "o1_usuario-ficticio-uno";
const TIPOS: TipoBorrador[] = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"];
const ambito = (ownerKey: string, tipo: TipoBorrador): AmbitoBorrador => ({ ownerKey, empresaId: 1, empresaSlug: "kuiqtrans", tipo });
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const borrar = async () => "borrar" as const;
const RAPIDO = { tiempoMaxMs: 25, graciaCancelacionMs: 25 };

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
type NucleoLimpieza = Parameters<typeof prepararCierreSesionExplicito>[0]["nucleo"];

async function sembrar(nucleo: Entorno["nucleo"]) {
  for (const t of TIPOS) ok(await nucleo.guardar(ambito(U1, t), { payload: { v: t }, esquemaVersion: 1, revisionBase: null }));
}
const contar = async (nucleo: Entorno["nucleo"]) => ok(await nucleo.listarMetadatosUsuario(U1)).borradores.length;

const resumenPurga = (p: Partial<ResumenPurga> = {}): ResumenPurga => ({ total: 3, eliminados: 0, fallidos: 0, cambiados: 0, pendientes: 0, indeterminados: 0, cancelado: false, ...p });
/** Núcleo con la consulta REAL y una purga simulada. */
const conPurga = (nucleo: Entorno["nucleo"], purgar: (k: string, o: OpcionesPurga) => Promise<Resultado<ResumenPurga>>): NucleoLimpieza =>
  ({ listarMetadatosUsuario: nucleo.listarMetadatosUsuario, purgarUsuario: (k: string, o: OpcionesPurga = {}) => purgar(k, o) }) as NucleoLimpieza;

function decisiones(...ds: DecisionTrasFallo[]) {
  const informes: InformeLimpieza[] = [];
  let i = 0;
  return { informes, fn: async (inf: InformeLimpieza) => { informes.push(inf); return ds[Math.min(i++, ds.length - 1)]!; } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("A. excepción ANTES del consentimiento (consulta de solo lectura): se puede salir sin borrar", () => {
  it("la consulta devuelve algo inesperado (TypeError al interpretarlo): continúa sin tocar nada ni pedir decisiones", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const purgar = vi.fn();
    const malformado = { listarMetadatosUsuario: async () => ({ ok: true, valor: null }), purgarUsuario: purgar } as unknown as NucleoLimpieza;
    const decidir = vi.fn(borrar);
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: malformado, decidir, decidirTrasFallo: decisiones("cancelar").fn });
    expect(r).toMatchObject({ continuar: true, limpieza: "consulta_fallida", eliminados: 0 });
    expect(decidir).not.toHaveBeenCalled();
    expect(purgar).not.toHaveBeenCalled();
    expect(await contar(nucleo)).toBe(3);
  });

  it("la consulta lanza o rechaza: continúa; la interfaz de consentimiento que falla equivale a conservar", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const purgar = vi.fn();
    for (const lista of [() => { throw new Error("síncrono"); }, async () => { throw new Error("rechazo"); }]) {
      const n = { listarMetadatosUsuario: lista, purgarUsuario: purgar } as unknown as NucleoLimpieza;
      expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar })).toMatchObject({ continuar: true, limpieza: "consulta_fallida" });
    }
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => { throw new Error("interfaz caída"); } });
    expect(r).toMatchObject({ continuar: true, limpieza: "conservados" });
    expect(purgar).not.toHaveBeenCalled();
    expect(await contar(nucleo)).toBe(3);
  });
});

describe("B. excepción DURANTE la purga, tras un borrado confirmado", () => {
  it("la purga rechaza después de confirmar 1 de 3: el informe usa el progreso (1, no 0), es incierto y exige decisión", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, async (_k, o) => { o.alProgresar?.(resumenPurga({ eliminados: 1, pendientes: 2 })); throw new Error("fallo inesperado"); });
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", total: 3, eliminados: 1, restantes: 2, incierto: true });
    expect(r).toMatchObject({ continuar: false, limpieza: "error_inesperado", eliminados: 1 });
    expect(textoAdvertenciaLimpieza(d.informes[0]!).detalle).toMatch(/se confirmó la eliminación de 1 de 3/i);
  });

  it("con borrados REALES: una excepción tras confirmar uno lo refleja y la salida informada es explícita", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, async (k, o) => {
      const c = new AbortController();
      await nucleo.purgarUsuario(k, { ...o, signal: c.signal, alProgresar: (x) => { o.alProgresar?.(x); if (x.eliminados === 1) c.abort(); } });
      throw new Error("fallo inesperado tras un borrado real");
    });
    const d = decisiones("salir");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", eliminados: 1, incierto: true });
    expect(r).toMatchObject({ continuar: true, salidaInformada: true, limpieza: "error_inesperado" });
    expect(await contar(nucleo)).toBe(2); // coherente con el progreso informado
  });

  it("un resultado malformado DESPUÉS de registrar progreso (excepción al interpretarlo): el informe conserva el progreso confirmado", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, async (_k, o) => { o.alProgresar?.(resumenPurga({ eliminados: 2, pendientes: 1 })); return { ok: true, valor: undefined } as unknown as Resultado<ResumenPurga>; });
    const d = decisiones("cancelar");
    await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", total: 3, eliminados: 2, restantes: 1, incierto: true });
  });

  it("la purga lanza de forma síncrona o devuelve algo malformado: resultado incierto, nunca «0 eliminados» silencioso", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    for (const purgar of [
      () => { throw new Error("síncrono"); },
      async () => ({ ok: true, valor: undefined }) as unknown as Resultado<ResumenPurga>, // TypeError al interpretarlo
    ]) {
      const d = decisiones("cancelar");
      const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: conPurga(nucleo, purgar as never), decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
      expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", incierto: true });
      expect(r.continuar).toBe(false);
    }
  });
});

describe("B2. excepción FUERA de la purga, justo después del consentimiento (capa externa)", () => {
  it("aunque falle algo ajeno a la purga tras autorizar el borrado, la salida no continúa en silencio y se advierte con el total detectado", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const ahora = Date.now.bind(Date);
    let armado = false;
    vi.spyOn(Date, "now").mockImplementation(() => { if (armado) throw new Error("reloj no disponible"); return ahora(); }); // falla la primera lectura TRAS el consentimiento
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => { armado = true; return "borrar"; }, decidirTrasFallo: d.fn, ...RAPIDO });
    vi.restoreAllMocks();
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", total: 3, eliminados: 0, incierto: true });
    expect(r).toMatchObject({ continuar: false, limpieza: "error_inesperado" });
    expect(await contar(nucleo)).toBe(3); // no se llegó a emitir ningún borrado
  });

  it("sin interfaz de advertencia en esa misma situación: se cancela la salida", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const ahora = Date.now.bind(Date);
    let armado = false;
    vi.spyOn(Date, "now").mockImplementation(() => { if (armado) throw new Error("reloj no disponible"); return ahora(); });
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: async () => { armado = true; return "borrar"; }, ...RAPIDO });
    vi.restoreAllMocks();
    expect(r).toMatchObject({ continuar: false, limpieza: "error_inesperado" });
  });
});

describe("C. excepción durante una operación con resultado INCIERTO (rama «error» de la purga acotada)", () => {
  it("rechaza al cancelarse por plazo después de confirmar 1: el informe conserva el progreso registrado", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, (_k, o) => new Promise((_res, rej) => {
      o.alProgresar?.(resumenPurga({ eliminados: 1, pendientes: 2 }));
      o.signal?.addEventListener("abort", () => rej(new Error("fallo al cancelar")), { once: true });
    }));
    const d = decisiones("salir");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", total: 3, eliminados: 1, restantes: 2, incierto: true });
    expect(r).toMatchObject({ continuar: true, salidaInformada: true, eliminados: 1 });
  });

  it("resultado de fallo con progreso inconsistente (ya había borrados): incierto, no «fallida con 0»", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, async (_k, o) => {
      o.alProgresar?.(resumenPurga({ eliminados: 2, pendientes: 1 }));
      return { ok: false, motivo: "lectura_fallida", mensaje: "x" };
    });
    const d = decisiones("cancelar");
    await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "error_inesperado", eliminados: 2, incierto: true });
  });

  it("sin progreso y sin respuesta ni tras cancelar: incierto con el total detectado", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const d = decisiones("cancelar");
    await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: conPurga(nucleo, () => new Promise(() => undefined)), decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
    expect(d.informes[0]).toMatchObject({ estado: "tiempo_agotado", total: 3, eliminados: 0, incierto: true });
  });
});

describe("D. fallo o ausencia de la interfaz de advertencia: la salida se cancela", () => {
  const casos: [string, (n: Entorno["nucleo"]) => NucleoLimpieza][] = [
    ["purga que rechaza", (n) => conPurga(n, async () => { throw new Error("x"); })],
    ["purga síncrona que lanza", (n) => conPurga(n, (() => { throw new Error("x"); }) as never)],
    ["purga malformada", (n) => conPurga(n, (async () => ({ ok: true, valor: undefined })) as never)],
  ];
  for (const [nombre, fabricar] of casos) {
    it(`${nombre}: sin interfaz / interfaz que lanza / decisión inválida → continuar:false`, async () => {
      const { nucleo } = entorno();
      await sembrar(nucleo);
      const n = fabricar(nucleo);
      expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, ...RAPIDO })).toMatchObject({ continuar: false });
      expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: async () => { throw new Error("interfaz caída"); }, ...RAPIDO })).toMatchObject({ continuar: false });
      expect(await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: n, decidir: borrar, decidirTrasFallo: async () => "quizás" as never, ...RAPIDO })).toMatchObject({ continuar: false });
    });
  }

  it("la vía de último recurso (resolverTrasExcepcionInesperada) advierte; sin interfaz, con fallo o con «reintentar» cancela; solo «salir» continúa", async () => {
    expect(await resolverTrasExcepcionInesperada(undefined, 3)).toMatchObject({ continuar: false, limpieza: "error_inesperado" });
    expect(await resolverTrasExcepcionInesperada(async () => { throw new Error("x"); }, 3)).toMatchObject({ continuar: false });
    expect(await resolverTrasExcepcionInesperada(async () => "reintentar", 3)).toMatchObject({ continuar: false });
    expect(await resolverTrasExcepcionInesperada(async () => "cancelar", 3)).toMatchObject({ continuar: false });
    const r = await resolverTrasExcepcionInesperada(async () => "salir", 3);
    expect(r).toMatchObject({ continuar: true, salidaInformada: true, informe: { estado: "error_inesperado", incierto: true } });
  });
});

describe("E. ninguna ruta posterior al consentimiento realiza logout silencioso", () => {
  type Inyector = { nombre: string; preparar: (e: Entorno) => { nucleo: NucleoLimpieza; espera?: number } };
  const original = IDBObjectStore.prototype.delete;
  const retrasar = (e: Entorno, cual: (n: number) => { antesMs?: number; resolverTardeMs?: number }): NucleoLimpieza => {
    let n = 0;
    const almacen: AlmacenBorradores = {
      ...e.real,
      modificar: ((clave: string, decidir: never) => {
        const c = cual(++n);
        const ejecutar = (): Promise<Resultado<unknown>> => e.real.modificar(clave, decidir);
        if (c.resolverTardeMs) { const p = ejecutar(); return new Promise<Resultado<unknown>>((res) => setTimeout(() => res(p), c.resolverTardeMs)); }
        if (c.antesMs) return new Promise<Resultado<unknown>>((res) => setTimeout(() => res(ejecutar()), c.antesMs));
        return ejecutar();
      }) as AlmacenBorradores["modificar"],
    };
    return crearNucleoBorradores({ almacen, appBuild: "p" });
  };
  const inyectores: Inyector[] = [
    { nombre: "todos los borrados fallan", preparar: (e) => { vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => { throw new Error("x"); }); return { nucleo: e.nucleo }; } },
    { nombre: "borrado parcial", preparar: (e) => { let n = 0; vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore["delete"]>) { if (++n === 1) return original.apply(this, a); throw new Error("x"); }); return { nucleo: e.nucleo }; } },
    { nombre: "la purga rechaza tras progreso", preparar: (e) => ({ nucleo: conPurga(e.nucleo, async (_k, o) => { o.alProgresar?.(resumenPurga({ eliminados: 1, pendientes: 2 })); throw new Error("x"); }) }) },
    { nombre: "la purga lanza síncronamente", preparar: (e) => ({ nucleo: conPurga(e.nucleo, (() => { throw new Error("x"); }) as never) }) },
    { nombre: "la purga devuelve algo malformado", preparar: (e) => ({ nucleo: conPurga(e.nucleo, (async () => ({ ok: true, valor: undefined })) as never) }) },
    { nombre: "la purga nunca responde", preparar: (e) => ({ nucleo: conPurga(e.nucleo, () => new Promise(() => undefined)) }) },
    { nombre: "plazo vencido antes de iniciar", preparar: (e) => ({ nucleo: retrasar(e, () => ({ antesMs: 200 })), espera: 400 }) },
    { nombre: "plazo vencido entre eliminaciones", preparar: (e) => ({ nucleo: retrasar(e, (n) => (n === 2 ? { antesMs: 200 } : {})), espera: 400 }) },
    { nombre: "plazo vencido con transacción en vuelo", preparar: (e) => ({ nucleo: retrasar(e, (n) => (n === 1 ? { resolverTardeMs: 200 } : {})), espera: 400 }) },
  ];
  const interfaces: [string, (() => ((i: InformeLimpieza) => Promise<DecisionTrasFallo>) | undefined)][] = [
    ["sin interfaz", () => undefined],
    ["interfaz que lanza", () => async () => { throw new Error("interfaz caída"); }],
    ["Cancelar salida", () => async () => "cancelar"],
    ["«reintentar» sin fin", () => async () => "reintentar"],
  ];

  for (const inyector of inyectores) {
    it(`${inyector.nombre}: con cualquier interfaz que no sea «salir» la salida NO continúa; con «salir» es explícita (salidaInformada)`, async () => {
      for (const [interfaz, fabricarInterfaz] of interfaces) {
        const e = entorno();
        await sembrar(e.nucleo);
        const { nucleo, espera } = inyector.preparar(e);
        const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: fabricarInterfaz(), ...RAPIDO });
        if (interfaz === "«reintentar» sin fin" && r.continuar) {
          // Un fallo TRANSITORIO (solo afecta a una operación) puede resolverse en un reintento: entonces la salida es legítima,
          // pero únicamente si quedó confirmado como «borrados» y no queda nada en el almacén.
          expect(r.limpieza, `${inyector.nombre}`).toBe("borrados");
          if (espera) await esperar(espera);
          expect(await contar(e.nucleo)).toBe(0);
        } else {
          expect(r.continuar, `${inyector.nombre} / ${interfaz}`).toBe(false);
          expect(r.limpieza).not.toBe("borrados");
          if (espera) await esperar(espera);
        }
        vi.restoreAllMocks();
      }
      const e = entorno();
      await sembrar(e.nucleo);
      const { nucleo, espera } = inyector.preparar(e);
      const d = decisiones("salir");
      const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo, decidir: borrar, decidirTrasFallo: d.fn, ...RAPIDO });
      expect(r).toMatchObject({ continuar: true, salidaInformada: true });
      expect(r.limpieza).not.toBe("borrados");
      expect(d.informes.length).toBeGreaterThanOrEqual(1); // el usuario fue advertido antes de salir
      if (espera) await esperar(espera);
    }, 20000);
  }

  it("«borrados» (salida sin advertencia) solo ocurre cuando TODO está realmente eliminado", async () => {
    const e = entorno();
    await sembrar(e.nucleo);
    const d = decisiones("cancelar");
    const r = await prepararCierreSesionExplicito({ ownerKey: U1, nucleo: e.nucleo, decidir: borrar, decidirTrasFallo: d.fn });
    expect(r).toMatchObject({ continuar: true, limpieza: "borrados", eliminados: 3 });
    expect(d.informes).toHaveLength(0);
    expect(await contar(e.nucleo)).toBe(0);
  });
});

describe("desactivar «No guardar en este equipo» ante excepciones inesperadas", () => {
  const prefs = (): AlmacenPreferencias & { datos: Map<string, string> } => {
    const datos = new Map<string, string>();
    return { datos, getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => { datos.set(k, v); }, removeItem: (k) => { datos.delete(k); } };
  };

  it("antes de fijar la preferencia: no se aplica y no se borra nada", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const malformado = { listarMetadatosUsuario: async () => ({ ok: true, valor: null }), purgarUsuario: vi.fn() } as unknown as NucleoLimpieza;
    const p = prefs();
    expect(await desactivarPersistencia({ ownerKey: U1, nucleo: malformado, prefs: p, confirmar: async () => true })).toMatchObject({ estado: "no_aplicada" });
    expect(p.datos.size).toBe(0);
    expect(await contar(nucleo)).toBe(3);
  });

  it("después de fijarla, una excepción en la purga deja la persistencia desactivada con residuos INCIERTOS informados (con su progreso)", async () => {
    const { nucleo } = entorno();
    await sembrar(nucleo);
    const n = conPurga(nucleo, async (_k, o) => { o.alProgresar?.(resumenPurga({ eliminados: 1, pendientes: 2 })); throw new Error("x"); });
    const p = prefs();
    const r = await desactivarPersistencia({ ownerKey: U1, nucleo: n, prefs: p, confirmar: async () => true, ...RAPIDO });
    expect(r).toMatchObject({ estado: "desactivada_con_residuos", eliminados: 1 });
    expect(r.informe).toMatchObject({ estado: "error_inesperado", incierto: true });
    expect(p.datos.size).toBe(1);
  });
});

describe("textos del informe por excepción inesperada", () => {
  const base: InformeLimpieza = { estado: "error_inesperado", total: 4, eliminados: 0, restantes: 4, cambiados: 0, incierto: true, intento: 1 };

  it("no afirman que los borradores sigan intactos ni «borrado correctamente»; informan el progreso confirmado cuando existe", () => {
    for (const inf of [base, { ...base, eliminados: 2, restantes: 2 }, { ...base, estado: "tiempo_agotado" as const, eliminados: 1, restantes: 3 }]) {
      const t = textoAdvertenciaLimpieza(inf);
      expect(`${t.titulo} ${t.detalle} ${t.salir}`).not.toMatch(/correctamente|con éxito|siguen guardados|intactos|conservar/i);
      expect(t.detalle).toMatch(/no se puede confirmar/i);
      expect(t.salir).toMatch(/sin confirmar/i);
    }
    expect(textoAdvertenciaLimpieza(base).detalle).not.toMatch(/se confirmó/i);
    expect(textoAdvertenciaLimpieza({ ...base, eliminados: 2, restantes: 2 }).detalle).toMatch(/se confirmó la eliminación de 2 de 4/i);
    expect(textoAdvertenciaLimpieza(base).detalle).toMatch(/error inesperado/i);
  });
});
