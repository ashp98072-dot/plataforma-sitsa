import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  FORMATO_REGISTRO,
  RETENCION_MS_POR_DEFECTO,
  crearAlmacenDesactivado,
  crearAlmacenIndexedDB,
  crearNucleoBorradores,
  type AmbitoBorrador,
  type Borrador,
  type Resultado,
  type TipoBorrador,
} from "./index";
import { claveAmbitoUsuarioEmpresa, claveBorrador } from "./ambito";

const DIA = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);

// Datos ficticios: ninguna información real de la empresa.
const U1 = "owner-opaco-usuario-1";
const U2 = "owner-opaco-usuario-2";
const ambito = (ownerKey: string, empresaId: number, tipo: TipoBorrador): AmbitoBorrador => ({ ownerKey, empresaId, empresaSlug: `empresa-${empresaId}`, tipo });
const FONDO1 = ambito(U1, 1, "solicitud_fondo");

function entorno(opciones: { retencionMs?: number; maxPayloadChars?: number } = {}) {
  let reloj = T0;
  const almacen = crearAlmacenIndexedDB({ fabrica: new IDBFactory() });
  const nucleo = crearNucleoBorradores({ almacen, appBuild: "build-prueba", ahora: () => reloj, ...opciones });
  return { almacen, nucleo, avanzar: (ms: number) => { reloj += ms; }, fijar: (t: number) => { reloj = t; } };
}

function ok<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(`Se esperaba éxito y fue ${r.motivo}: ${r.mensaje}`);
  return r.valor;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("CRUD básico", () => {
  it("crea, lee, actualiza y elimina un borrador", async () => {
    const { nucleo } = entorno();
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).estado).toBe("vacio");
    expect(ok(await nucleo.existe(FONDO1))).toBe(false);

    const creado = ok(await nucleo.guardar(FONDO1, { payload: { lineas: [{ monto: "10.50" }] }, esquemaVersion: 1, revisionBase: null }));
    expect(creado).toMatchObject({ revision: 1, tipo: "solicitud_fondo", ownerKey: U1, empresaId: 1, empresaSlug: "empresa-1", appBuild: "build-prueba", claveEnvio: null, estadoEnvio: "ninguno" });
    expect(creado.actualizadoEn).toBe(T0);
    expect(creado.expiraEn).toBe(T0 + RETENCION_MS_POR_DEFECTO);
    expect(ok(await nucleo.existe(FONDO1))).toBe(true);

    const leido = ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }));
    expect(leido).toEqual({ estado: "vigente", borrador: creado });

    const actualizado = ok(await nucleo.guardar(FONDO1, { payload: { lineas: [{ monto: "99" }] }, esquemaVersion: 1, revisionBase: 1 }));
    expect(actualizado.revision).toBe(2);
    expect(actualizado.borradorId).toBe(creado.borradorId);
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: unknown } }).borrador.payload).toEqual({ lineas: [{ monto: "99" }] });

    expect(ok(await nucleo.eliminar(FONDO1))).toEqual({ existia: true });
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).estado).toBe("vacio");
    expect(ok(await nucleo.eliminar(FONDO1))).toEqual({ existia: false });
  });

  it("un borrador por usuario, empresa y tipo: guardar de nuevo no crea otro registro", async () => {
    const { nucleo } = entorno();
    const a = ok(await nucleo.guardar(FONDO1, { payload: { n: 1 }, esquemaVersion: 1, revisionBase: null }));
    const b = ok(await nucleo.guardar(FONDO1, { payload: { n: 2 }, esquemaVersion: 1, revisionBase: 1 }));
    expect(b.borradorId).toBe(a.borradorId);
    const lista = ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 }));
    expect(lista.borradores).toHaveLength(1);
    // Crear «de cero» sobre uno existente NO lo pisa.
    const otra = await nucleo.guardar(FONDO1, { payload: { n: 3 }, esquemaVersion: 1, revisionBase: null });
    expect(otra).toMatchObject({ ok: false, motivo: "revision_obsoleta", revisionActual: 2 });
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: unknown } }).borrador.payload).toEqual({ n: 2 });
  });
});

describe("aislamiento lógico (usuario, empresa, tipo)", () => {
  it("dos usuarios × dos empresas × tres tipos no se mezclan", async () => {
    const { nucleo } = entorno();
    const tipos: TipoBorrador[] = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"];
    for (const u of [U1, U2]) for (const e of [1, 2]) for (const t of tipos) {
      ok(await nucleo.guardar(ambito(u, e, t), { payload: { marca: `${u}|${e}|${t}` }, esquemaVersion: 1, revisionBase: null }));
    }
    for (const u of [U1, U2]) for (const e of [1, 2]) for (const t of tipos) {
      const l = ok(await nucleo.leer(ambito(u, e, t), { esquemaVersion: 1 })) as { borrador: { payload: { marca: string } } };
      expect(l.borrador.payload.marca).toBe(`${u}|${e}|${t}`);
    }
    for (const u of [U1, U2]) for (const e of [1, 2]) {
      const { borradores } = ok(await nucleo.listarMetadatos({ ownerKey: u, empresaId: e }));
      expect(borradores).toHaveLength(3);
      expect(borradores.every((m) => m.ownerKey === u && m.empresaId === e)).toBe(true);
      expect(new Set(borradores.map((m) => m.tipo)).size).toBe(3);
    }
    // Eliminar uno no toca a los demás.
    ok(await nucleo.eliminar(ambito(U1, 1, "gasto_operativo")));
    expect(ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 })).borradores).toHaveLength(2);
    expect(ok(await nucleo.listarMetadatos({ ownerKey: U2, empresaId: 1 })).borradores).toHaveLength(3);
  });

  it("un ownerKey con separadores no colisiona con otro ámbito", () => {
    expect(claveBorrador({ ownerKey: 'a","1', empresaId: 2, tipo: "gasto_operativo" })).not.toBe(claveBorrador({ ownerKey: "a", empresaId: 1, tipo: "gasto_operativo" }));
    expect(claveAmbitoUsuarioEmpresa({ ownerKey: "a|1", empresaId: 2 })).not.toBe(claveAmbitoUsuarioEmpresa({ ownerKey: "a", empresaId: 12 }));
  });

  it("rechaza ámbitos incompletos o inventados y no toca el almacén", async () => {
    const { nucleo, almacen } = entorno();
    const espia = vi.spyOn(almacen, "obtener");
    const malos = [
      { ...FONDO1, ownerKey: "" }, { ...FONDO1, ownerKey: "   " }, { ...FONDO1, empresaId: 0 }, { ...FONDO1, empresaId: 1.5 },
      { ...FONDO1, empresaSlug: "" }, { ...FONDO1, tipo: "otro" as TipoBorrador }, { ...FONDO1, ownerKey: "a\u0000b" },
    ];
    for (const m of malos) {
      expect(await nucleo.leer(m, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "ambito_invalido" });
      expect(await nucleo.guardar(m, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "ambito_invalido" });
    }
    expect(await nucleo.listarMetadatos({ ownerKey: "", empresaId: 1 })).toMatchObject({ ok: false, motivo: "ambito_invalido" });
    expect(await nucleo.purgarUsuario("")).toMatchObject({ ok: false, motivo: "ambito_invalido" });
    expect(espia).not.toHaveBeenCalled();
  });

  it("purgarUsuario borra todo lo del usuario (todas sus empresas) y nada del resto", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(ambito(U1, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    ok(await nucleo.guardar(ambito(U1, 2, "gasto_operativo"), { payload: {}, esquemaVersion: 9, revisionBase: null })); // incluso de esquema futuro
    ok(await nucleo.guardar(ambito(U2, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    expect(ok(await nucleo.purgarUsuario(U1))).toEqual({ total: 2, eliminados: 2, fallidos: 0, cambiados: 0, pendientes: 0, indeterminados: 0, cancelado: false });
    expect(ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 })).borradores).toHaveLength(0);
    expect(ok(await nucleo.listarMetadatos({ ownerKey: U2, empresaId: 1 })).borradores).toHaveLength(1);
  });
});

describe("revisión y concurrencia", () => {
  it("la revisión crece de uno en uno", async () => {
    const { nucleo } = entorno();
    let base: number | null = null;
    for (let i = 1; i <= 5; i++) {
      const b: Borrador = ok(await nucleo.guardar(FONDO1, { payload: { i }, esquemaVersion: 1, revisionBase: base }));
      expect(b.revision).toBe(i);
      base = b.revision;
    }
  });

  it("una revisión antigua no pisa a una nueva", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: "uno" }, esquemaVersion: 1, revisionBase: null }));
    ok(await nucleo.guardar(FONDO1, { payload: { v: "dos" }, esquemaVersion: 1, revisionBase: 1 }));
    const r = await nucleo.guardar(FONDO1, { payload: { v: "viejo" }, esquemaVersion: 1, revisionBase: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "revision_obsoleta", revisionActual: 2 });
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: unknown; revision: number } }).borrador).toMatchObject({ payload: { v: "dos" }, revision: 2 });
    // Actualizar sobre un borrador que ya no existe tampoco lo «resucita» en silencio.
    ok(await nucleo.eliminar(FONDO1));
    expect(await nucleo.guardar(FONDO1, { payload: { v: "x" }, esquemaVersion: 1, revisionBase: 2 })).toMatchObject({ ok: false, motivo: "revision_obsoleta" });
    expect(ok(await nucleo.existe(FONDO1))).toBe(false);
  });

  it("dos guardados simultáneos con la misma base: exactamente uno gana", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const [a, b] = await Promise.all([
      nucleo.guardar(FONDO1, { payload: { v: "A" }, esquemaVersion: 1, revisionBase: 1 }),
      nucleo.guardar(FONDO1, { payload: { v: "B" }, esquemaVersion: 1, revisionBase: 1 }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const perdedor = a.ok ? b : a;
    expect(perdedor).toMatchObject({ ok: false, motivo: "revision_obsoleta" });
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { revision: number } }).borrador.revision).toBe(2);
  });
});

describe("retención de 14 días", () => {
  it("vigente hasta el instante exacto de expiración, expirado después; leer no borra", async () => {
    const { nucleo, fijar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { a: 1 }, esquemaVersion: 1, revisionBase: null }));
    fijar(T0 + 14 * DIA - 1);
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).estado).toBe("vigente");
    fijar(T0 + 14 * DIA);
    const l = ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }));
    expect(l.estado).toBe("expirado");
    expect(ok(await nucleo.existe(FONDO1))).toBe(true); // leer nunca elimina
  });

  it("cada guardado renueva la expiración (14 días desde el último)", async () => {
    const { nucleo, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    avanzar(10 * DIA);
    const b = ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: 1 }));
    expect(b.expiraEn).toBe(T0 + 24 * DIA);
  });

  it("la retención es configurable", async () => {
    const { nucleo } = entorno({ retencionMs: 1000 });
    const b = ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    expect(b.expiraEn - b.actualizadoEn).toBe(1000);
  });

  it("limpiarExpirados borra solo los expirados del ámbito indicado", async () => {
    const { nucleo, avanzar } = entorno();
    const versiones = { solicitud_fondo: 1, gasto_operativo: 1, requerimiento_compra: 1 } as const;
    ok(await nucleo.guardar(ambito(U1, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // viejo
    ok(await nucleo.guardar(ambito(U2, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // viejo, otro usuario
    ok(await nucleo.guardar(ambito(U1, 2, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // viejo, otra empresa
    avanzar(13 * DIA);
    ok(await nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // reciente
    avanzar(2 * DIA); // los tres primeros llevan 15 días
    const r = ok(await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, versiones));
    expect(r).toEqual({ eliminados: 1, omitidos: 0 });
    expect(ok(await nucleo.existe(ambito(U1, 1, "solicitud_fondo")))).toBe(false);
    expect(ok(await nucleo.existe(ambito(U1, 1, "gasto_operativo")))).toBe(true); // vigente
    expect(ok(await nucleo.existe(ambito(U2, 1, "solicitud_fondo")))).toBe(true); // otro usuario
    expect(ok(await nucleo.existe(ambito(U1, 2, "solicitud_fondo")))).toBe(true); // otra empresa
  });

  it("limpiarExpirados conserva esquemas futuros, tipos sin versión declarada y registros dañados", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(ambito(U1, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 5, revisionBase: null })); // futuro
    ok(await nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null })); // sin versión declarada
    const corrupto = ambito(U1, 1, "requerimiento_compra");
    await almacen.modificar(claveBorrador(corrupto), () => ({
      accion: "escribir", resultado: null,
      registro: { clave: claveBorrador(corrupto), ambitoClave: claveAmbitoUsuarioEmpresa(corrupto), ownerKey: U1, formato: FORMATO_REGISTRO, basura: true } as never,
    }));
    avanzar(30 * DIA);
    const r = ok(await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, { solicitud_fondo: 1 }));
    expect(r.eliminados).toBe(0);
    expect(r.omitidos).toBe(3);
    expect(ok(await nucleo.existe(ambito(U1, 1, "solicitud_fondo")))).toBe(true);
    expect(ok(await nucleo.existe(ambito(U1, 1, "gasto_operativo")))).toBe(true);
    expect(ok(await nucleo.existe(corrupto))).toBe(true);
  });

  it("un fallo de lectura durante la limpieza no borra nada", async () => {
    const { nucleo, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    avanzar(30 * DIA);
    const espia = vi.spyOn(IDBObjectStore.prototype, "index").mockImplementation(() => { throw new Error("fallo simulado"); });
    const r = await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, { solicitud_fondo: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "lectura_fallida" });
    espia.mockRestore();
    expect(ok(await nucleo.existe(FONDO1))).toBe(true);
  });
});

describe("versionado de esquema", () => {
  it("un borrador de esquema futuro se conserva intacto, se señala incompatible y no se sobrescribe", async () => {
    const { nucleo, almacen } = entorno();
    const futuro = ok(await nucleo.guardar(FONDO1, { payload: { campoNuevo: [1, 2, 3] }, esquemaVersion: 4, revisionBase: null }));
    const antes = ok(await almacen.obtener(claveBorrador(FONDO1)));

    const l = ok(await nucleo.leer(FONDO1, { esquemaVersion: 3 }));
    expect(l.estado).toBe("incompatible");
    expect((l as { borrador: unknown }).borrador).toEqual(futuro);

    const intento = await nucleo.guardar(FONDO1, { payload: { viejo: true }, esquemaVersion: 3, revisionBase: 1 });
    expect(intento).toMatchObject({ ok: false, motivo: "version_incompatible" });
    expect(ok(await almacen.obtener(claveBorrador(FONDO1)))).toEqual(antes); // byte a byte lo mismo
  });

  it("un esquema anterior se reporta para que el adaptador migre y guarde con la revisión base", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    const l = ok(await nucleo.leer(FONDO1, { esquemaVersion: 2 }));
    expect(l.estado).toBe("esquema_anterior");
    const migrado = ok(await nucleo.guardar(FONDO1, { payload: { v: 2 }, esquemaVersion: 2, revisionBase: 1 }));
    expect(migrado).toMatchObject({ esquemaVersion: 2, revision: 2 });
  });

  it("un registro de formato contenedor futuro no se interpreta ni se pisa", async () => {
    const { nucleo, almacen } = entorno();
    const clave = claveBorrador(FONDO1);
    await almacen.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { clave, ambitoClave: claveAmbitoUsuarioEmpresa(FONDO1), ownerKey: U1, formato: FORMATO_REGISTRO + 1, cosa: "x" } as never }));
    const antes = ok(await almacen.obtener(clave));
    expect(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "version_incompatible" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: 1 })).toMatchObject({ ok: false, motivo: "version_incompatible" });
    expect(ok(await almacen.obtener(clave))).toEqual(antes);
  });
});

describe("fallos de almacenamiento", () => {
  it("datos corruptos: se informa, no se borra ni se sobrescribe", async () => {
    const { nucleo, almacen } = entorno();
    const clave = claveBorrador(FONDO1);
    await almacen.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { clave, ambitoClave: claveAmbitoUsuarioEmpresa(FONDO1), ownerKey: U1, formato: FORMATO_REGISTRO, revision: "no-es-numero" } as never }));
    const antes = ok(await almacen.obtener(clave));
    expect(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(ok(await almacen.obtener(clave))).toEqual(antes);
    // La única salida es el descarte explícito.
    ok(await nucleo.eliminar(FONDO1));
    expect(ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).revision).toBe(1);
  });

  it("un registro cuya clave no coincide con su contenido (otro usuario) se trata como dañado", async () => {
    const { nucleo, almacen } = entorno();
    const otro = ok(await (async () => { const e = entorno(); return e.nucleo.guardar(ambito(U2, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null }); })());
    const clave = claveBorrador(FONDO1);
    await almacen.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { ...otro, clave, ambitoClave: claveAmbitoUsuarioEmpresa(FONDO1), formato: FORMATO_REGISTRO } as never }));
    expect(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
  });

  it("error de lectura: falla sin éxito falso y el registro sigue intacto y legible después", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { dato: "x" }, esquemaVersion: 1, revisionBase: null }));
    const espia = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => { throw new Error("fallo simulado de lectura"); });
    const r = await nucleo.leer(FONDO1, { esquemaVersion: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "lectura_fallida" });
    espia.mockRestore();
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).estado).toBe("vigente"); // no quedó inutilizado
  });

  it("error de escritura: no informa éxito, no deja nada a medias y se puede reintentar", async () => {
    const { nucleo } = entorno();
    const base = ok(await nucleo.guardar(FONDO1, { payload: { v: "estable" }, esquemaVersion: 1, revisionBase: null }));
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("fallo simulado de escritura"); });
    const r = await nucleo.guardar(FONDO1, { payload: { v: "nuevo" }, esquemaVersion: 1, revisionBase: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "escritura_fallida" });
    espia.mockRestore();
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }))).toEqual({ estado: "vigente", borrador: base }); // intacto, misma revisión
    expect(ok(await nucleo.guardar(FONDO1, { payload: { v: "nuevo" }, esquemaVersion: 1, revisionBase: 1 })).revision).toBe(2);
  });

  it("cuota excedida: motivo propio y el borrador previo se conserva", async () => {
    const { nucleo } = entorno();
    const base = ok(await nucleo.guardar(FONDO1, { payload: { v: "estable" }, esquemaVersion: 1, revisionBase: null }));
    const espia = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new DOMException("cuota", "QuotaExceededError"); });
    const r = await nucleo.guardar(FONDO1, { payload: { v: "enorme" }, esquemaVersion: 1, revisionBase: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "cuota_excedida" });
    espia.mockRestore();
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }))).toEqual({ estado: "vigente", borrador: base });
  });

  it("IndexedDB no disponible: todas las operaciones fallan de forma explícita y sin excepciones", async () => {
    const almacen = crearAlmacenIndexedDB({ fabrica: null });
    const nucleo = crearNucleoBorradores({ almacen, appBuild: "b" });
    const e = { ok: false, motivo: "no_disponible" };
    expect(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).toMatchObject(e);
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject(e);
    expect(await nucleo.existe(FONDO1)).toMatchObject(e);
    expect(await nucleo.eliminar(FONDO1)).toMatchObject(e);
    expect(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 })).toMatchObject(e);
    expect(await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, {})).toMatchObject(e);
    expect(await nucleo.purgarUsuario(U1)).toMatchObject(e);
  });

  it("sin IndexedDB global (entorno sin soporte) tampoco lanza", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "b" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "no_disponible" });
  });

  it("si open() falla una vez, la siguiente operación vuelve a intentar (no queda inutilizado)", async () => {
    const real = new IDBFactory();
    let intentos = 0;
    const fabrica = { open: (...args: Parameters<IDBFactory["open"]>) => { if (intentos++ === 0) throw new DOMException("bloqueado", "SecurityError"); return real.open(...args); } } as unknown as IDBFactory;
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenIndexedDB({ fabrica }), appBuild: "b" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "no_disponible" });
    expect(ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).revision).toBe(1);
  });

  it("persistencia desactivada: nada se guarda y el fallo es explícito", async () => {
    const nucleo = crearNucleoBorradores({ almacen: crearAlmacenDesactivado(), appBuild: "b" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "persistencia_desactivada" });
    expect(await nucleo.leer(FONDO1, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "persistencia_desactivada" });
  });

  it("jamás escribe contenido de borradores en consola, ni en éxito ni en fallo", async () => {
    const { nucleo } = entorno();
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    ok(await nucleo.guardar(FONDO1, { payload: { secretoDeNegocio: "CONTENIDO-CONFIDENCIAL" }, esquemaVersion: 1, revisionBase: null }));
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("x"); });
    await nucleo.guardar(FONDO1, { payload: { secretoDeNegocio: "CONTENIDO-CONFIDENCIAL" }, esquemaVersion: 1, revisionBase: 1 });
    for (const c of consola) expect(c).not.toHaveBeenCalled();
  });
});

describe("transacciones IndexedDB (abortos reales)", () => {
  it("aborto ASÍNCRONO real (ConstraintError del motor): no hay éxito, no queda nada a medias y se puede reintentar", async () => {
    const { nucleo } = entorno();
    const base = ok(await nucleo.guardar(FONDO1, { payload: { v: "estable" }, esquemaVersion: 1, revisionBase: null }));
    const add = IDBObjectStore.prototype.add;
    // `add` sobre una clave existente no lanza al llamarse: la petición falla DESPUÉS y el motor aborta la transacción.
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation((function (this: IDBObjectStore, valor: unknown) { return add.call(this, valor); }) as never);
    const r = await nucleo.guardar(FONDO1, { payload: { v: "no-debe-quedar" }, esquemaVersion: 1, revisionBase: 1 });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ motivo: "escritura_fallida" });
    vi.restoreAllMocks();
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }))).toEqual({ estado: "vigente", borrador: base });
    expect(ok(await nucleo.guardar(FONDO1, { payload: { v: "reintento" }, esquemaVersion: 1, revisionBase: 1 })).revision).toBe(2);
  });

  it("si la decisión lanza dentro de la transacción, se aborta y no se escribe nada", async () => {
    const { nucleo, almacen } = entorno();
    const base = ok(await nucleo.guardar(FONDO1, { payload: { v: "estable" }, esquemaVersion: 1, revisionBase: null }));
    const r = await almacen.modificar(claveBorrador(FONDO1), () => { throw new Error("decisión fallida"); });
    expect(r).toMatchObject({ ok: false, motivo: "escritura_fallida" });
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }))).toEqual({ estado: "vigente", borrador: base });
  });

  it("el éxito de guardar solo se informa tras confirmarse la transacción (oncomplete)", async () => {
    const { nucleo, almacen } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    // Una lectura concurrente iniciada DESPUÉS del guardado ya ve el dato: la promesa se resolvió con la transacción confirmada.
    const r = await nucleo.guardar(FONDO1, { payload: { visible: true }, esquemaVersion: 1, revisionBase: 1 });
    expect(r.ok).toBe(true);
    const crudo = ok(await almacen.obtener(claveBorrador(FONDO1))) as { revision: number; payload: unknown };
    expect(crudo).toMatchObject({ revision: 2, payload: { visible: true } });
  });

  it("el motor serializa transacciones de escritura: 10 guardados concurrentes con la misma base → un solo ganador", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: 0 }, esquemaVersion: 1, revisionBase: null }));
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => nucleo.guardar(FONDO1, { payload: { v: i + 1 }, esquemaVersion: 1, revisionBase: 1 })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.motivo === "revision_obsoleta" && r.revisionActual === 2)).toBe(true);
  });
});

/** Escribe directamente en el almacén un registro válido «dañado» por `mutar` (simula corrupción fuera del núcleo). */
async function corromper(almacen: ReturnType<typeof crearAlmacenIndexedDB>, a: AmbitoBorrador, mutar: (r: Record<string, unknown>) => void) {
  const clave = claveBorrador(a);
  const actual = ok(await almacen.obtener(clave)) as Record<string, unknown>;
  const copia = structuredClone(actual);
  mutar(copia);
  ok(await almacen.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: copia as never })));
}

describe("registros recuperados: validación estructural completa (corrección 1)", () => {
  const A = FONDO1;
  const casos: [string, (r: Record<string, unknown>) => void][] = [
    ["payload ausente", (r) => { delete r.payload; }],
    ["payload con NaN", (r) => { r.payload = { monto: NaN }; }],
    ["payload con Infinity", (r) => { r.payload = { lineas: [Infinity] }; }],
    ["payload con Date", (r) => { r.payload = { fecha: new Date() }; }],
    ["payload con Map", (r) => { r.payload = { m: new Map() }; }],
    ["payload con undefined", (r) => { r.payload = { u: undefined }; }],
    ["payload con arreglo con huecos", (r) => { r.payload = { l: [1, , 3] }; }],
    ["payload con clave de credencial", (r) => { r.payload = { anidado: { Password: "x" } }; }],
    ["payload demasiado anidado", (r) => { let o: unknown = 1; for (let i = 0; i < 40; i++) o = { o }; r.payload = o; }],
    ["revision 0", (r) => { r.revision = 0; }],
    ["revision negativa", (r) => { r.revision = -2; }],
    ["revision fraccionaria", (r) => { r.revision = 1.5; }],
    ["revision como texto", (r) => { r.revision = "1"; }],
    ["esquemaVersion 0", (r) => { r.esquemaVersion = 0; }],
    ["empresaId 0", (r) => { r.empresaId = 0; }],
    ["ownerKey vacío", (r) => { r.ownerKey = ""; }],
    ["ownerKey con caracteres de control", (r) => { r.ownerKey = "a\nb"; }],
    ["empresaSlug vacío", (r) => { r.empresaSlug = ""; }],
    ["tipo desconocido", (r) => { r.tipo = "otro"; }],
    ["borradorId vacío", (r) => { r.borradorId = ""; }],
    ["appBuild no es texto", (r) => { r.appBuild = 7; }],
    ["actualizadoEn NaN", (r) => { r.actualizadoEn = NaN; }],
    ["expiraEn anterior a actualizadoEn", (r) => { r.expiraEn = (r.actualizadoEn as number) - 1; }],
    ["claveEnvio con formato inválido", (r) => { r.claveEnvio = "corta"; }],
    ["claveEnvio numérica", (r) => { r.claveEnvio = 123; }],
    ["estadoEnvio desconocido", (r) => { r.estadoEnvio = "raro"; }],
    ["clave primaria que no corresponde al contenido", (r) => { r.ownerKey = U2; }],
    ["clave de índice (ámbito) alterada", (r) => { r.ambitoClave = claveAmbitoUsuarioEmpresa({ ownerKey: U2, empresaId: 1 }); }],
  ];

  it.each(casos)("%s → datos_corruptos, sin entregarse como vigente y sin tocar el registro", async (_nombre, mutar) => {
    const { nucleo, almacen } = entorno();
    ok(await nucleo.guardar(A, { payload: { lineas: [{ monto: "1" }] }, esquemaVersion: 1, revisionBase: null }));
    await corromper(almacen, A, mutar);
    const antes = ok(await almacen.obtener(claveBorrador(A)));

    expect(await nucleo.leer(A, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await nucleo.guardar(A, { payload: { x: 1 }, esquemaVersion: 1, revisionBase: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await nucleo.guardar(A, { payload: { x: 1 }, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false });
    expect(ok(await almacen.obtener(claveBorrador(A)))).toEqual(antes); // intacto
  });

  it("un payload corrupto con esquema FUTURO no es «corrupto»: se conserva intacto como incompatible", async () => {
    const { nucleo, almacen } = entorno();
    ok(await nucleo.guardar(A, { payload: {}, esquemaVersion: 3, revisionBase: null }));
    await corromper(almacen, A, (r) => { r.payload = { formatoNuevo: new Date(0) }; }); // algo que esta versión no sabe juzgar
    const antes = ok(await almacen.obtener(claveBorrador(A)));
    expect(ok(await nucleo.leer(A, { esquemaVersion: 2 })).estado).toBe("incompatible");
    expect(await nucleo.guardar(A, { payload: {}, esquemaVersion: 2, revisionBase: 1 })).toMatchObject({ ok: false, motivo: "version_incompatible" });
    expect(ok(await almacen.obtener(claveBorrador(A)))).toEqual(antes);
  });

  it("un payload corrupto y expirado tampoco se entrega como «expirado» ni «esquema anterior»", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(A, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    await corromper(almacen, A, (r) => { r.payload = { n: NaN }; });
    avanzar(30 * DIA);
    expect(await nucleo.leer(A, { esquemaVersion: 1 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
    expect(await nucleo.leer(A, { esquemaVersion: 2 })).toMatchObject({ ok: false, motivo: "datos_corruptos" });
  });

  it("un registro dañado se cuenta como ilegible en el listado y su descarte explícito sí lo elimina", async () => {
    const { nucleo, almacen } = entorno();
    ok(await nucleo.guardar(A, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    ok(await nucleo.guardar(ambito(U1, 1, "gasto_operativo"), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    await corromper(almacen, A, (r) => { r.revision = 0; });
    const l = ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 }));
    expect(l.borradores).toHaveLength(1);
    expect(l.ilegibles).toBe(1);
    ok(await nucleo.eliminar(A));
    expect(ok(await nucleo.existe(A))).toBe(false);
  });

  it("un payload corrupto no se borra por retención", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(A, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    await corromper(almacen, A, (r) => { r.payload = { n: Infinity }; });
    avanzar(30 * DIA);
    expect(ok(await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, { solicitud_fondo: 1 }))).toEqual({ eliminados: 0, omitidos: 1 });
    expect(ok(await nucleo.existe(A))).toBe(true);
  });
});

describe("limpiarExpirados: revalidación atómica (corrección 2)", () => {
  const VERS = { solicitud_fondo: 1, gasto_operativo: 1, requerimiento_compra: 1 } as const;

  /** Almacén que ejecuta `entreListadoYBorrado` justo DESPUÉS de listar y ANTES de las decisiones de borrado. */
  function conCarrera(almacen: ReturnType<typeof crearAlmacenIndexedDB>, entreListadoYBorrado: () => Promise<void>) {
    return { ...almacen, listar: async (...args: Parameters<typeof almacen.listar>) => { const r = await almacen.listar(...args); await entreListadoYBorrado(); return r; } } as typeof almacen;
  }

  it("un guardado concurrente tras el listado renueva el borrador: no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, async () => { ok(await nucleo.guardar(FONDO1, { payload: { v: 2 }, esquemaVersion: 1, revisionBase: 1 })); }), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { revision: number } }).borrador.revision).toBe(2);
  });

  it("un guardado concurrente que NO renueva la expiración (reloj atrasado) cambia la revisión: no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: 1 }, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const otraPestana = crearNucleoBorradores({ almacen, appBuild: "b", ahora: () => T0 }); // reloj atrasado: expiraEn sigue en el pasado
    const carrera = async () => { ok(await otraPestana.guardar(FONDO1, { payload: { v: 2 }, esquemaVersion: 1, revisionBase: 1 })); };
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, carrera), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    const l = ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { revision: number; payload: unknown } };
    expect(l.borrador).toMatchObject({ revision: 2, payload: { v: 2 } }); // el contenido nuevo sobrevive
  });

  it("si tras el listado el borrador es eliminado y recreado (otro borradorId, también expirado), no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { v: "viejo" }, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const otraPestana = crearNucleoBorradores({ almacen, appBuild: "b", ahora: () => T0 });
    const carrera = async () => {
      ok(await otraPestana.eliminar(FONDO1));
      ok(await otraPestana.guardar(FONDO1, { payload: { v: "nuevo" }, esquemaVersion: 1, revisionBase: null })); // revisión 1 otra vez
    };
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, carrera), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: unknown } }).borrador.payload).toEqual({ v: "nuevo" });
  });

  it("si tras el listado el registro es reemplazado por uno de otra identidad, no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const otro = ok(await entorno().nucleo.guardar(ambito(U2, 7, "gasto_operativo"), { payload: { ajeno: true }, esquemaVersion: 1, revisionBase: null }));
    const clave = claveBorrador(FONDO1);
    const carrera = async () => { // mismo lugar (clave primaria), contenido de OTRO usuario/empresa/tipo, ya expirado
      ok(await almacen.modificar(clave, () => ({ accion: "escribir", resultado: null, registro: { ...otro, expiraEn: T0, actualizadoEn: T0 - 1, clave, ambitoClave: claveAmbitoUsuarioEmpresa(FONDO1), formato: FORMATO_REGISTRO } as never })));
    };
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, carrera), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    expect((ok(await almacen.obtener(clave)) as { ownerKey: string }).ownerKey).toBe(U2); // el registro ajeno sigue ahí
  });

  it("si tras el listado el registro pasa a un esquema futuro (aún expirado), no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const carrera = async () => { await corromper(almacen, FONDO1, (r) => { r.esquemaVersion = 9; r.revision = 2; }); };
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, carrera), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    expect(ok(await nucleo.existe(FONDO1))).toBe(true);
  });

  it("si tras el listado el registro queda dañado (clave que no corresponde), no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null }));
    avanzar(20 * DIA);
    const carrera = async () => { await corromper(almacen, FONDO1, (r) => { r.tipo = "gasto_operativo"; }); };
    const n2 = crearNucleoBorradores({ almacen: conCarrera(almacen, carrera), appBuild: "b", ahora: () => T0 + 20 * DIA });
    expect(ok(await n2.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS))).toEqual({ eliminados: 0, omitidos: 1 });
    expect(ok(await nucleo.existe(FONDO1))).toBe(true);
  });

  it("un registro listado con identidad inconsistente (indexado en el ámbito de otro) no se elimina", async () => {
    const { nucleo, almacen, avanzar } = entorno();
    ok(await nucleo.guardar(ambito(U2, 1, "solicitud_fondo"), { payload: {}, esquemaVersion: 1, revisionBase: null }));
    // Registro de U2 con la clave de índice del ámbito de U1: aparece al listar a U1 pero NO es de U1.
    await corromper(almacen, ambito(U2, 1, "solicitud_fondo"), (r) => { r.ambitoClave = claveAmbitoUsuarioEmpresa({ ownerKey: U1, empresaId: 1 }); });
    avanzar(30 * DIA);
    const r = ok(await nucleo.limpiarExpirados({ ownerKey: U1, empresaId: 1 }, VERS));
    expect(r.eliminados).toBe(0);
    expect(ok(await nucleo.existe(ambito(U2, 1, "solicitud_fondo")))).toBe(true);
  });
});

describe("validación defensiva del payload (corrección 3)", () => {
  async function esperarPayloadInvalido(payload: unknown) {
    const { nucleo } = entorno();
    let r: Resultado<unknown> | undefined;
    await expect((async () => { r = await nucleo.guardar(FONDO1, { payload, esquemaVersion: 1, revisionBase: null }); })()).resolves.toBeUndefined(); // jamás rechaza
    expect(r).toMatchObject({ ok: false, motivo: "payload_invalido" });
    expect(ok(await nucleo.existe(FONDO1))).toBe(false);
    return (r as { mensaje: string }).mensaje;
  }

  it("un getter que lanza → payload_invalido, sin rechazo no manejado ni filtrar su texto", async () => {
    const consola = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    const malo = Object.defineProperty({ ok: 1 }, "x", { enumerable: true, get() { throw new Error("TEXTO-SECRETO-DEL-GETTER"); } });
    const msg = await esperarPayloadInvalido({ lineas: [malo] });
    expect(msg).not.toContain("TEXTO-SECRETO-DEL-GETTER");
    for (const c of consola) expect(c).not.toHaveBeenCalled();
  });

  it("un getter benigno también se rechaza (no se ejecutan propiedades calculadas)", async () => {
    let llamadas = 0;
    const calculado = Object.defineProperty({}, "x", { enumerable: true, get() { llamadas++; return 1; } });
    await esperarPayloadInvalido({ calculado });
    expect(llamadas).toBe(0);
  });

  it("un setter sin getter se rechaza", async () => {
    await esperarPayloadInvalido(Object.defineProperty({}, "x", { enumerable: true, set() { /* nada */ } }));
  });

  it.each<[string, () => unknown]>([
    ["proxy que lanza en ownKeys", () => new Proxy({}, { ownKeys() { throw new Error("boom"); } })],
    ["proxy que lanza en getPrototypeOf", () => new Proxy({}, { getPrototypeOf() { throw new Error("boom"); } })],
    ["proxy que lanza en getOwnPropertyDescriptor", () => new Proxy({ a: 1 }, { getOwnPropertyDescriptor() { throw new Error("boom"); } })],
    ["proxy revocado", () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; }],
    ["proxy de arreglo que lanza al leer", () => new Proxy([1, 2, 3], { getOwnPropertyDescriptor() { throw new Error("boom"); } })],
    ["proxy anidado en un payload válido", () => ({ lineas: [{ ok: 1 }, new Proxy({}, { ownKeys() { throw new Error("boom"); } })] })],
  ])("%s → payload_invalido", async (_n, fabricar) => {
    await esperarPayloadInvalido(fabricar());
  });

  it("arreglos con huecos o con elementos calculados se rechazan", async () => {
    await esperarPayloadInvalido({ l: [1, , 3] });
    const a: unknown[] = [1];
    Object.defineProperty(a, 1, { enumerable: true, get() { return 2; } });
    await esperarPayloadInvalido({ l: a });
  });

  it("validarPayload y validarEstructuraPayload nunca lanzan, con cualquier entrada exótica", async () => {
    const { validarPayload, validarEstructuraPayload } = await import("./payload");
    const entradas: unknown[] = [
      Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("x"); } }), new Proxy({}, { ownKeys() { throw new Error("x"); } }),
      (() => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; })(), Symbol("s"), BigInt(5), () => 1, new Error("e"),
      Object.create(null), { [Symbol("k")]: 1 }, new Proxy([], { get() { throw new Error("x"); } }),
    ];
    for (const e of entradas) {
      expect(() => validarPayload(e, 1000)).not.toThrow();
      expect(() => validarEstructuraPayload(e)).not.toThrow();
    }
    expect(validarEstructuraPayload(Object.create(null))).toBeNull(); // objeto sin prototipo: válido
    expect(validarEstructuraPayload({ [Symbol("k")]: 1 })).toBeNull(); // símbolos: ignorados por el clonado
  });

  it("no toca el almacén cuando el payload es inválido", async () => {
    const { nucleo, almacen } = entorno();
    const espia = vi.spyOn(almacen, "modificar");
    expect(await nucleo.guardar(FONDO1, { payload: new Proxy({}, { ownKeys() { throw new Error("boom"); } }), esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "payload_invalido" });
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("payload y privacidad", () => {
  it("conserva números y cadenas EXACTOS (flotantes, -0, enormes, ceros a la izquierda, espacios, unicode)", async () => {
    const { nucleo } = entorno();
    const payload = {
      suma: 0.1 + 0.2, negativoCero: -0, enorme: 1e21, seguro: Number.MAX_SAFE_INTEGER, maximo: Number.MAX_VALUE, minimo: Number.MIN_VALUE,
      cadenas: ["007", " con espacios ", "", "ñandú 😀", "<script>alert(1)</script>", "1e3", "0.10", "línea1\nlínea2"],
      anidado: { bool: false, nulo: null, lista: [[1, [2, [3]]]] },
    };
    ok(await nucleo.guardar(FONDO1, { payload, esquemaVersion: 1, revisionBase: null }));
    const leido = (ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: typeof payload } }).borrador.payload;
    expect(leido).toEqual(payload);
    expect(Object.is(leido.negativoCero, -0)).toBe(true);
    expect(leido.suma).toBe(0.30000000000000004);
    expect(leido.cadenas[1]).toBe(" con espacios ");
  });

  it("soporta un payload grande (800 líneas × 13 campos) sin pérdida", async () => {
    const { nucleo } = entorno();
    const lineas = Array.from({ length: 800 }, (_, i) => ({
      categoria: "Combustible", descripcion: `Línea ${i} — ${"x".repeat(120)}`, cantidad: "1", monto: String(i + 0.25), fechaViaje: "2026-11-04",
      empleadoId: String(i), vehiculoId: "", clienteId: "", planId: "", empleadoNombre: `Persona ${i}`, cuenta: "", cargo: "", metodoPago: "Efectivo",
    }));
    const payload = { entidadRequirenteId: "1", lineas };
    ok(await nucleo.guardar(FONDO1, { payload, esquemaVersion: 1, revisionBase: null }));
    const leido = (ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { payload: typeof payload } }).borrador.payload;
    expect(leido.lineas).toHaveLength(800);
    expect(leido).toEqual(payload);
  });

  it("rechaza un payload por encima del tope configurado sin tocar lo ya guardado", async () => {
    const { nucleo } = entorno({ maxPayloadChars: 1000 });
    const base = ok(await nucleo.guardar(FONDO1, { payload: { ok: true }, esquemaVersion: 1, revisionBase: null }));
    const r = await nucleo.guardar(FONDO1, { payload: { grande: "x".repeat(2000) }, esquemaVersion: 1, revisionBase: 1 });
    expect(r).toMatchObject({ ok: false, motivo: "payload_demasiado_grande" });
    expect(ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 }))).toEqual({ estado: "vigente", borrador: base });
  });

  it("no acepta archivos, funciones, no-finitos, undefined, instancias ni claves de credenciales", async () => {
    const { nucleo } = entorno();
    const malos: unknown[] = [
      { adjunto: new File(["abc"], "factura.pdf") }, { blob: new Blob(["x"]) }, { f: () => 1 }, { n: NaN }, { n: Infinity }, { u: undefined },
      { fecha: new Date() }, { m: new Map() }, { big: BigInt(1) }, { password: "x" }, { anidado: { Token: "x" } }, { lista: [{ cookie: "x" }] },
    ];
    for (const payload of malos) {
      expect(await nucleo.guardar(FONDO1, { payload, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "payload_invalido" });
    }
    expect(ok(await nucleo.existe(FONDO1))).toBe(false);
  });

  it("rechaza un payload demasiado anidado o cíclico", async () => {
    const { nucleo } = entorno();
    const ciclo: Record<string, unknown> = {};
    ciclo.yo = ciclo;
    expect(await nucleo.guardar(FONDO1, { payload: ciclo, esquemaVersion: 1, revisionBase: null })).toMatchObject({ ok: false, motivo: "payload_invalido" });
  });

  it("los metadatos no exponen payload ni la clave de envío", async () => {
    const { nucleo } = entorno();
    ok(await nucleo.guardar(FONDO1, { payload: { privado: "x" }, esquemaVersion: 1, revisionBase: null, claveEnvio: "a".repeat(36) }));
    const m = ok(await nucleo.metadatos(FONDO1))!;
    expect(m).not.toHaveProperty("payload");
    expect(m).not.toHaveProperty("claveEnvio");
    expect(m.tieneClaveEnvio).toBe(true);
    const { borradores } = ok(await nucleo.listarMetadatos({ ownerKey: U1, empresaId: 1 }));
    expect(JSON.stringify(borradores)).not.toContain("privado");
  });
});

describe("claveEnvio / estadoEnvio (sin enviar documentos)", () => {
  it("persiste la clave, la conserva en guardados posteriores y no realiza ninguna petición de red", async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal("fetch", fetchEspia);
    const { nucleo } = entorno();
    const clave = "7f3c2a9e-1b4d-4e8a-9c6f-0a1b2c3d4e5f";
    const a = ok(await nucleo.guardar(FONDO1, { payload: { n: 1 }, esquemaVersion: 1, revisionBase: null, claveEnvio: clave }));
    expect(a.claveEnvio).toBe(clave);
    const b = ok(await nucleo.guardar(FONDO1, { payload: { n: 2 }, esquemaVersion: 1, revisionBase: 1, estadoEnvio: "enviando" }));
    expect(b).toMatchObject({ claveEnvio: clave, estadoEnvio: "enviando" }); // el payload cambió pero la clave NO se renueva sola
    const c = ok(await nucleo.guardar(FONDO1, { payload: { n: 3 }, esquemaVersion: 1, revisionBase: 2 }));
    expect(c).toMatchObject({ claveEnvio: clave, estadoEnvio: "enviando" }); // estadoEnvio también se conserva
    const d = ok(await nucleo.guardar(FONDO1, { payload: { n: 4 }, esquemaVersion: 1, revisionBase: 3, claveEnvio: null, estadoEnvio: "ninguno" }));
    expect(d).toMatchObject({ claveEnvio: null, estadoEnvio: "ninguno" }); // renovar/limpiar es explícito
    expect((ok(await nucleo.leer(FONDO1, { esquemaVersion: 1 })) as { borrador: { claveEnvio: null } }).borrador.claveEnvio).toBeNull();
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("valida el formato de la clave y del estado", async () => {
    const { nucleo } = entorno();
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null, claveEnvio: "corta" })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: null, estadoEnvio: "raro" as never })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 0, revisionBase: null })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
    expect(await nucleo.guardar(FONDO1, { payload: {}, esquemaVersion: 1, revisionBase: 0 })).toMatchObject({ ok: false, motivo: "argumento_invalido" });
  });
});
