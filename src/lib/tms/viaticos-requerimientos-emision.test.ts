import { beforeEach, describe, expect, it, vi } from "vitest";

// Comportamiento REAL de guardarRequerimientoViatico / transicionarRequerimientoViatico contra una BD simulada.
const h = vi.hoisted(() => ({
  fila: {} as Record<string, unknown>,
  ejecutados: [] as { sql: string; params: unknown[] }[],
  firmas: [] as Record<string, unknown>[],
  subidas: [] as string[],
  borradas: [] as string[],
  commits: 0,
  rollbacks: 0,
  firmaGuardada: null as { bytes: ArrayBuffer; original: string } | null,
}));

const conn = {
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => { h.commits++; }),
  rollback: vi.fn(async () => { h.rollbacks++; }),
  release: vi.fn(),
  query: vi.fn(async (sql: string) => {
    if (/FOR UPDATE/.test(sql)) return [[{ ...h.fila }]];
    if (/FROM tms_personal tp/.test(sql)) return [[{ id: 1, id_empleado: 9, nombre: "Piloto", cargo: "Piloto", cuenta_bancaria: "0100-1", banco: "Banrural", sugerido: "100" }]];
    if (/SELECT nombre FROM usuarios/.test(sql)) return [[{ nombre: "Sesión" }]];
    return [[]];
  }),
  execute: vi.fn(async (sql: string, params: unknown[]) => { h.ejecutados.push({ sql, params }); return [{ insertId: 77 }]; }),
};
vi.mock("@/lib/db", () => ({
  getPool: () => ({ getConnection: async () => conn }),
  query: vi.fn(async (sql: string) => {
    if (/SELECT requirente_usuario_id/.test(sql)) return [{ requirente_usuario_id: h.fila.requirente_usuario_id }];
    if (/FROM tms_viatico_requerimiento_lineas/.test(sql)) return [];
    if (/FROM tms_viatico_requerimientos/.test(sql)) return [{ ...h.fila, id: 5, codigo: "VR-1", total: "10.00", fecha_requerimiento: "2026-09-24" }];
    return [];
  }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn(async () => {}) }));
vi.mock("@/lib/tms/identidad-administrativa", () => ({ resolverUsuarioDeEmpresaTx: vi.fn(async (_c: unknown, _e: number, id: number) => ({ id, nombre: `Usuario ${id}` })) }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => h.firmaGuardada) }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(async (_c: unknown, d: Record<string, unknown>) => { h.firmas.push(d); }) }));
vi.mock("@/lib/uploads", () => ({
  guardarUpload: vi.fn(async (_e: number, _d: string, _n: string, f: { name: string; size: number }) => { const relative = `firmas/${h.subidas.length + 1}.png`; h.subidas.push(relative); return { relative, original: f.name, size: f.size }; }),
  borrarUpload: vi.fn((r: string) => { h.borradas.push(r); }),
}));
vi.mock("@/lib/rrhh/dates", () => ({ hoyLocal: () => "2026-09-24" }));

import { guardarRequerimientoViatico, transicionarRequerimientoViatico, ErrorRequerimientoViatico } from "./viaticos-requerimientos";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const SESION = 10;

beforeEach(() => {
  vi.clearAllMocks();
  h.ejecutados = []; h.firmas = []; h.subidas = []; h.borradas = []; h.commits = 0; h.rollbacks = 0;
  h.firmaGuardada = { bytes: ab(PNG), original: "mi-firma.png" };
  h.fila = { estado: "BORRADOR", version: 1, total: "10.00", requirente_usuario_id: SESION };
});

const enviar = (firmaRequirente?: unknown) =>
  transicionarRequerimientoViatico(3, 5, SESION, "Sesión", "Operaciones", { accion: "enviar", version: 1, ...(firmaRequirente ? { firmaRequirente } : {}) } as never);
const estadoNuevo = () => h.ejecutados.find(e => /UPDATE tms_viatico_requerimientos SET estado=\?/.test(e.sql))?.params[0];

describe("enviar (emitir): firma del requirente protegida en el backend", () => {
  it("1) requirente == sesión + SIN firma -> 400 y sigue BORRADOR (no se ejecuta UPDATE ni firma)", async () => {
    await expect(enviar()).rejects.toMatchObject({ status: 400, message: expect.stringContaining("debes firmar") });
    expect(estadoNuevo()).toBeUndefined();
    expect(h.firmas).toHaveLength(0);
    expect(h.commits).toBe(0);
  });

  it("2) requirente == sesión + firma válida (GUARDADA) -> PENDIENTE y firma inmutable del requirente", async () => {
    await enviar({ modo: "GUARDADA" });
    expect(estadoNuevo()).toBe("PENDIENTE");
    expect(h.firmas).toHaveLength(1);
    expect(h.firmas[0]).toMatchObject({ accion: "FIRMAR_REQUERIMIENTO_VIATICO", entidadTipo: "REQUERIMIENTO_VIATICO", usuarioId: SESION, origenFirma: "GUARDADA" });
    expect(h.subidas).toHaveLength(1);
  });

  it("2b) requirente == sesión + firma DIBUJADA válida -> PENDIENTE (origen DIBUJADA)", async () => {
    await enviar({ modo: "DIBUJADA", imagenBase64: PNG.toString("base64") });
    expect(estadoNuevo()).toBe("PENDIENTE");
    expect(h.firmas[0]).toMatchObject({ origenFirma: "DIBUJADA" });
  });

  it("firma inválida (no PNG) o sin Mi firma configurada -> 400, sigue BORRADOR", async () => {
    await expect(enviar({ modo: "DIBUJADA", imagenBase64: Buffer.from("no-es-png-xxxxxxxx").toString("base64") })).rejects.toMatchObject({ status: 400 });
    h.firmaGuardada = null;
    await expect(enviar({ modo: "GUARDADA" })).rejects.toBeInstanceOf(ErrorRequerimientoViatico);
    expect(estadoNuevo()).toBeUndefined();
    expect(h.firmas).toHaveLength(0);
  });

  it("3) requirente != sesión + sin firma -> PENDIENTE sin firma digital (línea física en blanco)", async () => {
    h.fila.requirente_usuario_id = 99;
    await enviar();
    expect(estadoNuevo()).toBe("PENDIENTE");
    expect(h.firmas).toHaveLength(0);
  });

  it("4) requirente != sesión + el cliente manda firma -> NO se firma por otro (no se guarda ni sube nada)", async () => {
    h.fila.requirente_usuario_id = 99;
    await enviar({ modo: "GUARDADA" });
    await enviar({ modo: "DIBUJADA", imagenBase64: PNG.toString("base64") });
    expect(h.firmas).toHaveLength(0);
    expect(h.subidas).toHaveLength(0);
    expect(estadoNuevo()).toBe("PENDIENTE");
  });

  it("5) el payload no puede falsificar al requirente: se decide con la fila de BD, no con datos del cliente", async () => {
    const { transicionRequerimientoViaticoSchema } = await import("./viaticos-requerimientos-schema");
    const p = transicionRequerimientoViaticoSchema.safeParse({ accion: "enviar", version: 1, requirenteUsuarioId: SESION, esRequirente: true, firmaRequirente: { modo: "GUARDADA", usuarioId: SESION } });
    expect(p.success).toBe(false); // .strict(): ni requirenteUsuarioId ni esRequirente ni usuarioId en la firma
    h.fila.requirente_usuario_id = 99; // BD dice que el requirente es otro, aunque el cliente afirme lo contrario
    await enviar({ modo: "GUARDADA" });
    expect(h.firmas).toHaveLength(0);
  });

  it("carrera: el requirente cambió a la sesión tras la pre-consulta (fila bloqueada) y no hay firma -> 400, sin cambio de estado", async () => {
    const { query } = await import("@/lib/db");
    vi.mocked(query).mockResolvedValueOnce([{ requirente_usuario_id: 99 }] as never); // pre-consulta: otro
    h.fila.requirente_usuario_id = SESION; // fila bloqueada: la sesión
    await expect(enviar({ modo: "GUARDADA" })).rejects.toMatchObject({ status: 400 });
    expect(estadoNuevo()).toBeUndefined();
  });
});

describe("guardar: fecha del requerimiento la fija el servidor", () => {
  const datos = (extra: Record<string, unknown> = {}) => ({
    fechaRequerimiento: "2020-01-01", empresaRequirente: "KUIQTRANS", requirenteUsuarioId: SESION, observaciones: null,
    lineas: [{ fechaSolicitud: "2026-09-22", fechaViaje: "2026-09-24", personalId: 1, vehiculoId: null, clienteId: null, cantidad: "1", destino: "X", montoUnitario: "100", motivoCambio: null, observaciones: null }],
    ...extra,
  }) as never;
  const insertCab = () => h.ejecutados.find(e => /INSERT INTO tms_viatico_requerimientos /.test(e.sql));

  it("el cliente manda 2020-01-01 -> el requerimiento nuevo guarda hoyLocal() (2026-09-24)", async () => {
    await guardarRequerimientoViatico(3, SESION, "u", datos());
    const ins = insertCab()!;
    expect(ins.params).toContain("2026-09-24");
    expect(ins.params).not.toContain("2020-01-01");
  });

  it("al editar un BORRADOR NO se reescribe la fecha original", async () => {
    h.fila = { estado: "BORRADOR", version: 2 };
    await guardarRequerimientoViatico(3, SESION, "u", datos({ version: 2 }), 5);
    const upd = h.ejecutados.find(e => /UPDATE tms_viatico_requerimientos SET periodo_tipo/.test(e.sql))!;
    expect(upd.sql).not.toContain("fecha_requerimiento");
    expect(JSON.stringify(upd.params)).not.toContain("2020-01-01");
  });

  it("snapshot de cuenta y banco del empleado en la línea", async () => {
    await guardarRequerimientoViatico(3, SESION, "u", datos());
    const lin = h.ejecutados.find(e => /INSERT INTO tms_viatico_requerimiento_lineas/.test(e.sql))!;
    expect(lin.params).toEqual(expect.arrayContaining(["0100-1", "Banrural"]));
  });
});

describe("guardar: el periodo debe contener TODAS las fechas de viaje", () => {
  const lin = (fechaViaje: string) => ({ fechaSolicitud: fechaViaje, fechaViaje, personalId: 1, vehiculoId: null, clienteId: null, cantidad: "1", destino: "X", montoUnitario: "100", motivoCambio: null, observaciones: null });
  const guardar = (periodoTipo: string, fechas: string[], periodoReferencia?: string) =>
    guardarRequerimientoViatico(3, SESION, "u", { empresaRequirente: "KUIQTRANS", requirenteUsuarioId: SESION, observaciones: null, periodoTipo, ...(periodoReferencia ? { periodoReferencia } : {}), lineas: fechas.map(lin) } as never);
  const cabecera = () => h.ejecutados.find(e => /INSERT INTO tms_viatico_requerimientos /.test(e.sql));

  it("DIA con dos días distintos -> rechazo con mensaje claro", async () => {
    await expect(guardar("DIA", ["2026-09-24", "2026-09-25"])).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Todas las fechas de viaje deben pertenecer al periodo (Día 24/09/2026)") });
    expect(cabecera()).toBeUndefined();
  });

  it("SEMANA con una fecha fuera de la semana lunes–domingo -> rechazo", async () => {
    await expect(guardar("SEMANA", ["2026-09-21", "2026-09-30"])).rejects.toMatchObject({ message: expect.stringContaining("Semana 21/09/2026 – 27/09/2026") });
    await expect(guardar("SEMANA", ["2026-09-24", "2026-09-28"], "2026-09-24")).rejects.toMatchObject({ message: expect.stringContaining("28/09/2026") });
  });

  it("MES con una fecha de otro mes -> rechazo", async () => {
    await expect(guardar("MES", ["2026-09-30", "2026-10-01"])).rejects.toMatchObject({ message: expect.stringContaining("Mes septiembre 2026") });
  });

  it("semana válida lunes–domingo -> OK y persiste desde/hasta", async () => {
    await guardar("SEMANA", ["2026-09-21", "2026-09-24", "2026-09-27"]);
    expect(cabecera()!.params).toEqual(expect.arrayContaining(["SEMANA", "2026-09-21", "2026-09-27"]));
  });

  it("día y mes válidos -> OK", async () => {
    await guardar("DIA", ["2026-09-24", "2026-09-24"]);
    await guardar("MES", ["2026-09-01", "2026-09-30"]);
    expect(h.commits).toBe(2);
  });

  it("cruce de mes dentro de una semana válida (28 sep – 4 oct) -> OK", async () => {
    await guardar("SEMANA", ["2026-09-30", "2026-10-02"]);
    expect(cabecera()!.params).toEqual(expect.arrayContaining(["2026-09-28", "2026-10-04"]));
  });
});
