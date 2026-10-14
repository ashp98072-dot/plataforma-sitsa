import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accionesLiquidacionFila,
  badgeLiquidacion,
  claseFilaLiquidacion,
} from "./liquidacion-viaje-shared";
import {
  PERMISOS_LIQUIDACION_VIAJE,
  catalogoGlobalPermisos,
  esPlataformaPermisible,
  labelPermiso,
  moduloEmpresaDelPermiso,
  permisosDefaultPorRol,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { CATALOGO_PERMISOS } from "@/lib/permisos-catalogo";

const leer = (p: string) => readFileSync(p, "utf8").replaceAll("\r\n", "\n");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ───────────────────────────── permisos ─────────────────────────────
describe("Liquidación Fase 3 · permisos (patrón real, sin escalamiento)", () => {
  const FILAS = ["viajes_liquidar", "viajes_reabrir_liquidacion"] as const;

  it("las dos filas siguen el patrón de viajes_cerrar: catálogo, etiqueta, módulo TMS, ≤ 40 caracteres, flag editar", () => {
    const prog = CATALOGO_PERMISOS.find((m) => m.id === "programacion")!;
    for (const fila of FILAS) {
      expect([...PERMISOS_LIQUIDACION_VIAJE]).toContain(fila);
      expect(esPlataformaPermisible(fila)).toBe(true);
      expect(moduloEmpresaDelPermiso(fila)).toBe("tms");
      expect(fila.length).toBeLessThanOrEqual(40);
      expect(catalogoGlobalPermisos()).toContain(fila);
      const a = prog.acciones.find((x) => x.modulo === fila)!;
      expect(a.flag).toBe("puedeEditar");
    }
    expect(labelPermiso("viajes_liquidar")).toBe("Viajes: liquidar");
    expect(labelPermiso("viajes_reabrir_liquidacion")).toBe("Viajes: reabrir liquidación");
    expect(prog.acciones.find((x) => x.modulo === "viajes_liquidar")!.id).toBe("liquidar");
    expect(prog.acciones.find((x) => x.modulo === "viajes_reabrir_liquidacion")!.id).toBe("reabrir_liquidacion");
  });

  it("ningún rol operativo los recibe por defecto (Admin los recibe como todo el catálogo)", () => {
    const roles = [
      "RRHH", "Marcaje", "Contabilidad", "Operaciones", "GerenteOperaciones", "JefeOperaciones",
      "AuxiliarOperaciones", "Facturador", "CoordinadorPredios", "CoordinadorCompras", "Piloto", "Visualizador",
    ];
    for (const rol of roles) {
      const perms: PermisoModulo[] = permisosDefaultPorRol(rol as never);
      for (const fila of FILAS) expect(perms.find((p) => p.modulo === fila)?.puedeEditar ?? false, `${rol}/${fila}`).toBe(false);
    }
    const admin = permisosDefaultPorRol("Admin" as never);
    for (const fila of FILAS) {
      expect(admin.find((p) => p.modulo === fila)?.puedeEditar).toBe(admin.find((p) => p.modulo === "viajes_cerrar")?.puedeEditar);
    }
  });

  it("no hay escalamiento entre filas: confirmar ≠ liquidar ≠ reabrir ≠ cerrar", () => {
    const fila = (modulo: string): PermisoModulo => ({ modulo, puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true });
    const todas = ["viajes_confirmar_reporte", "viajes_liquidar", "viajes_reabrir_liquidacion", "viajes_cerrar", "programacion"];
    for (const tiene of todas) {
      for (const necesita of ["viajes_confirmar_reporte", "viajes_liquidar", "viajes_reabrir_liquidacion"]) {
        expect(tienePermiso([fila(tiene)], necesita, "editar"), `${tiene} → ${necesita}`).toBe(tiene === necesita);
      }
    }
    // Tener liquidar NO concede cerrar.
    expect(tienePermiso([fila("viajes_liquidar")], "viajes_cerrar", "editar")).toBe(false);
  });

  it("cada guard exige SU fila (nunca el rol ni otra fila)", () => {
    const t = leer("src/lib/tenant.ts");
    const i = t.indexOf("async function requireTenantFilaLiquidacionViaje");
    const cuerpo = t.slice(i, t.indexOf("\n}\n", i));
    expect(cuerpo).toMatch(/tienePermiso\(perms, fila, accion\)/);
    expect(cuerpo).toMatch(/session\.rol === "Admin"/);
    expect(t).toMatch(/requireTenantFilaLiquidacionViaje\(slug, "viajes_liquidar", accion,/);
    expect(t).toMatch(/requireTenantFilaLiquidacionViaje\(slug, "viajes_reabrir_liquidacion", accion,/);
  });
});

// ───────────────────────────── UI: acciones por estado ─────────────────────────────
describe("Liquidación Fase 3 · acciones de la fila", () => {
  const todos = { puedeConfirmarReporte: true, puedeLiquidar: true, puedeReabrir: true, soloConsulta: false };

  it("sin liquidación: solo confirmar reporte (nunca liquidar)", () => {
    const a = accionesLiquidacionFila({ ...todos, estadoPlan: "En ruta", liquidacion: null });
    expect(a).toEqual({ confirmarReporte: true, liquidar: false, etiquetaLiquidar: null, reabrir: false });
  });

  it("REPORTE_RECIBIDO → «Liquidar viaje»; EN_AJUSTE → «Liquidar nuevamente»; LIQUIDADO → «Reabrir liquidación»", () => {
    expect(accionesLiquidacionFila({ ...todos, estadoPlan: "En ruta", liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } }))
      .toEqual({ confirmarReporte: false, liquidar: true, etiquetaLiquidar: "Liquidar viaje", reabrir: false });
    expect(accionesLiquidacionFila({ ...todos, estadoPlan: "En ruta", liquidacion: { estado: "EN_AJUSTE", version: 3 } }))
      .toEqual({ confirmarReporte: false, liquidar: true, etiquetaLiquidar: "Liquidar nuevamente", reabrir: false });
    expect(accionesLiquidacionFila({ ...todos, estadoPlan: "Descargado", liquidacion: { estado: "LIQUIDADO", version: 2 } }))
      .toEqual({ confirmarReporte: false, liquidar: false, etiquetaLiquidar: null, reabrir: true });
  });

  it("sin permiso no hay acción; Cerrado/Cancelado y la vista de consulta no admiten ninguna", () => {
    const sin = { puedeConfirmarReporte: false, puedeLiquidar: false, puedeReabrir: false, soloConsulta: false };
    for (const liq of [null, { estado: "REPORTE_RECIBIDO" as const, version: 1 }, { estado: "LIQUIDADO" as const, version: 2 }, { estado: "EN_AJUSTE" as const, version: 3 }]) {
      expect(accionesLiquidacionFila({ ...sin, estadoPlan: "En ruta", liquidacion: liq })).toEqual({ confirmarReporte: false, liquidar: false, etiquetaLiquidar: null, reabrir: false });
      for (const estadoPlan of ["Cerrado", "Cancelado"]) {
        expect(accionesLiquidacionFila({ ...todos, estadoPlan, liquidacion: liq })).toEqual({ confirmarReporte: false, liquidar: false, etiquetaLiquidar: null, reabrir: false });
      }
      expect(accionesLiquidacionFila({ ...todos, soloConsulta: true, estadoPlan: "En ruta", liquidacion: liq }).liquidar).toBe(false);
    }
    // Con solo liquidar: no ve reabrir; con solo reabrir: no ve liquidar.
    const soloLiquidar = { ...sin, puedeLiquidar: true };
    expect(accionesLiquidacionFila({ ...soloLiquidar, estadoPlan: "En ruta", liquidacion: { estado: "LIQUIDADO", version: 2 } }).reabrir).toBe(false);
    const soloReabrir = { ...sin, puedeReabrir: true };
    expect(accionesLiquidacionFila({ ...soloReabrir, estadoPlan: "En ruta", liquidacion: { estado: "REPORTE_RECIBIDO", version: 1 } }).liquidar).toBe(false);
  });

  it("la semántica visual aprobada no cambia", () => {
    expect(claseFilaLiquidacion(null, "En ruta")).toBe("pendiente");
    expect(claseFilaLiquidacion({ estado: "REPORTE_RECIBIDO", version: 1 }, "En ruta")).toBe("pendiente");
    expect(claseFilaLiquidacion({ estado: "EN_AJUSTE", version: 3 }, "En ruta")).toBe("pendiente");
    expect(claseFilaLiquidacion({ estado: "LIQUIDADO", version: 2 }, "En ruta")).toBe("normal");
    expect(claseFilaLiquidacion(null, "Cerrado")).toBe("normal");
    expect(badgeLiquidacion(null, "Cancelado")).toBeNull();
    expect(badgeLiquidacion({ estado: "LIQUIDADO", version: 2 }, "En ruta")?.texto).toBe("Liquidado");
  });

  it("el cliente usa las acciones, los permisos propios y los modales; el cierre queda intacto", () => {
    const c = leer("src/app/e/[slug]/planes/planes-viajes-client.tsx");
    expect(c).toMatch(/tienePermiso\(permisos, "viajes_liquidar", "editar"\)/);
    expect(c).toMatch(/tienePermiso\(permisos, "viajes_reabrir_liquidacion", "editar"\)/);
    expect(c).toContain("accLiq.etiquetaLiquidar");
    expect(c).toContain("Reabrir liquidación");
    expect(c).toContain("<ModalLiquidarViaje");
    expect(c).toContain("<ModalReabrirLiquidacion");
    expect(c).toContain("<HistorialLiquidacion");
    // accionesViaje (cierre) no menciona liquidación.
    const i = c.indexOf("export function accionesViaje");
    expect(c.slice(i, c.indexOf("\n}\n", i))).not.toMatch(/liquidaci/i);
  });

  it("modales: resumen de lo que se congela, avisos de alcance y motivo obligatorio", () => {
    const m = leer("src/components/tms/liquidacion-viaje-modales.tsx");
    expect(m).toContain("Esto es lo que quedará congelado en el historial de la liquidación");
    expect(m).toMatch(/<strong>no<\/strong> cierra el viaje, <strong>no<\/strong> factura, <strong>no<\/strong> crea cargos y <strong>no<\/strong> mueve/);
    expect(m).toContain("Motivo de reapertura (obligatorio, mínimo 5 caracteres)");
    expect(m).toMatch(/const motivoValido = motivo\.trim\(\)\.length >= 5/);
    expect(m).toMatch(/disabled=\{!puede \|\| !motivoValido \|\| enviando\}/); // sin motivo no se puede reabrir
    expect(m).toMatch(/if \(!l \|\| enviando\) return;/); // doble clic: un solo envío en vuelo
    expect(m).toContain("permanece en el historial");
    expect(m).toContain("En ajuste");
    expect(m).toMatch(/expectedVersion: l\.version/);
  });
});

// ───────────────────────────── snapshot: solo lectura y tenant-safe ─────────────────────────────
describe("Liquidación Fase 3 · módulo de snapshot", () => {
  const src = sinComentarios(leer("src/lib/tms/liquidacion-viaje-snapshot.ts"));

  it("solo SELECT: ninguna escritura ni DDL", () => {
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|\w+\s+SET)/i);
    expect(src).not.toMatch(/\.execute\(/);
  });

  it("toda lectura está acotada por empresa y no toma datos de costos, fondos, gastos, facturación, FEL ni contabilidad", () => {
    expect(src).not.toMatch(/tms_gastos|tms_solicitud|tms_viaticos|fact_|fel_|cont_|costo_operativo|costo_tercerizado/);
    const consultas = src.match(/`SELECT[\s\S]*?`/g) ?? [];
    expect(consultas.length).toBeGreaterThanOrEqual(5);
    for (const q of consultas) expect(q, q.slice(0, 60)).toMatch(/empresa_id/);
    // Joins de catálogos por empresa (excepto el vehículo de flota, compartido entre empresas como en el listado).
    for (const t of ["tms_clientes c", "tms_lugares lc", "tms_lugares ld", "tms_unidades u", "tms_personal pil", "tms_personal aux"]) {
      expect(src).toMatch(new RegExp(`${t} ON [^\\n]*empresa_id = p\\.empresa_id`));
    }
  });

  it("no incluye datos sensibles de la cuadrilla (identificación/teléfono) ni conceptos inexistentes", () => {
    const sel = src.match(/FROM tms_plan_cuadrilla/)![0];
    expect(sel).toBeTruthy();
    const q = src.match(/`SELECT tipo, id_empleado, nombre FROM tms_plan_cuadrilla[^`]*`/);
    expect(q).not.toBeNull();
    expect(src).not.toMatch(/identificacion|telefono/);
  });
});

// ───────────────────────────── endpoints ─────────────────────────────
const holder = vi.hoisted(() => ({
  guardLiquidar: null as unknown,
  guardReabrir: null as unknown,
  guardLeer: null as unknown,
  liquidar: vi.fn(),
  reabrir: vi.fn(),
  leer: vi.fn(),
  eventos: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  requireTenantViajesLiquidar: async () => holder.guardLiquidar,
  requireTenantViajesReabrirLiquidacion: async () => holder.guardReabrir,
  requireTenantProgramacionOTms: async () => holder.guardLeer,
}));
vi.mock("@/lib/db", () => ({ getPool: () => ({ query: vi.fn() }) }));
vi.mock("@/lib/tms/liquidacion-viaje-snapshot", () => ({ construirSnapshotOperativo: (...a: unknown[]) => holder.snapshot(...a) }));
vi.mock("@/lib/tms/liquidacion-viaje", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./liquidacion-viaje")>();
  return {
    ...actual,
    liquidarViaje: (...a: unknown[]) => holder.liquidar(...a),
    reabrirLiquidacion: (...a: unknown[]) => holder.reabrir(...a),
    leerLiquidacionPlan: (...a: unknown[]) => holder.leer(...a),
    listarEventosLiquidacion: (...a: unknown[]) => holder.eventos(...a),
  };
});

const sesion = { session: { id: 4, username: "ana", rol: "JefeOperaciones" }, empresa: { id: 7 } };
const ctx = (id: string) => ({ params: Promise.resolve({ slug: "e", id }) });

describe("Liquidación Fase 3 · POST /liquidar", () => {
  const post = async (id: string, body: unknown) => {
    const { POST } = await import("../../app/api/empresas/[slug]/tms/planes/[id]/liquidar/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx(id));
  };
  beforeEach(() => {
    holder.liquidar.mockReset();
    holder.guardLiquidar = sesion;
  });

  it("sin permiso: respuesta del guard y no ejecuta nada", async () => {
    const { NextResponse } = await import("next/server");
    holder.guardLiquidar = { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
    expect((await post("5", { expectedVersion: 1 })).status).toBe(403);
    expect(holder.liquidar).not.toHaveBeenCalled();
  });

  it("body estricto: expectedVersion obligatorio y entero ≥ 1; sin empresaId/usuario del cliente; ID inválido = 400", async () => {
    for (const body of [{}, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: "2" }, { expectedVersion: 1, empresaId: 9 }, { expectedVersion: 1, usuarioId: 1 }, null]) {
      expect((await post("5", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await post("abc", { expectedVersion: 1 })).status).toBe(400);
    expect((await post("0", { expectedVersion: 1 })).status).toBe(400);
    expect(holder.liquidar).not.toHaveBeenCalled();
  });

  it("empresa y usuario salen de la sesión; responde estado, versión y evento", async () => {
    holder.liquidar.mockResolvedValue({ idempotente: false, evento: "LIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 2 } });
    const r = await post("5", { expectedVersion: 1, observacion: "ok" });
    expect(r.status).toBe(200);
    expect(holder.liquidar).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 4, usuario: "ana" },
      { planId: 5, versionEsperada: 1, observacion: "ok" },
    );
    expect(await r.json()).toMatchObject({ idempotente: false, evento: "LIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 2 } });
    holder.liquidar.mockResolvedValue({ idempotente: false, evento: "RELIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 4 } });
    expect((await (await post("5", { expectedVersion: 3 })).json()).mensaje).toBe("Viaje liquidado nuevamente.");
  });

  it("réplica idempotente → 200 idempotente; conflicto de versión → 409; transición inválida → 409; otro tenant → 404", async () => {
    const { ErrorLiquidacionViaje } = await import("./liquidacion-viaje");
    holder.liquidar.mockResolvedValueOnce({ idempotente: true, evento: null, liquidacion: { estado: "LIQUIDADO", version: 2 } });
    expect(await (await post("5", { expectedVersion: 1 })).json()).toMatchObject({ idempotente: true });
    holder.liquidar.mockRejectedValueOnce(new ErrorLiquidacionViaje("CONFLICTO_VERSION", "La liquidación cambió mientras la revisabas."));
    const c = await post("5", { expectedVersion: 1 });
    expect(c.status).toBe(409);
    expect((await c.json()).error).toContain("cambió");
    holder.liquidar.mockRejectedValueOnce(new ErrorLiquidacionViaje("ESTADO_NO_PERMITE", "El viaje ya está liquidado."));
    expect((await post("5", { expectedVersion: 2 })).status).toBe(409);
    holder.liquidar.mockRejectedValueOnce(new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404));
    expect((await post("5", { expectedVersion: 1 })).status).toBe(404);
    holder.liquidar.mockRejectedValueOnce(new Error("SELECT secreto FROM x"));
    const e = await post("5", { expectedVersion: 1 });
    expect(e.status).toBe(500);
    expect(JSON.stringify(await e.json())).not.toContain("secreto");
  });
});

describe("Liquidación Fase 3 · POST /reabrir-liquidacion", () => {
  const post = async (id: string, body: unknown) => {
    const { POST } = await import("../../app/api/empresas/[slug]/tms/planes/[id]/reabrir-liquidacion/route");
    return POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx(id));
  };
  beforeEach(() => {
    holder.reabrir.mockReset();
    holder.guardReabrir = sesion;
  });

  it("sin permiso 403; el permiso de liquidar NO basta (guard propio)", async () => {
    const { NextResponse } = await import("next/server");
    holder.guardReabrir = { error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
    holder.guardLiquidar = sesion; // tiene viajes_liquidar, pero no reabrir
    expect((await post("5", { expectedVersion: 2, motivo: "Ajuste" })).status).toBe(403);
    expect(holder.reabrir).not.toHaveBeenCalled();
  });

  it("body estricto: expectedVersion y motivo obligatorios; el dominio rechaza motivos cortos con 400", async () => {
    for (const body of [{}, { expectedVersion: 2 }, { motivo: "Ajuste de tarifa" }, { expectedVersion: 2, motivo: "Ajuste", empresaId: 1 }, { expectedVersion: 2, motivo: "x".repeat(501) }]) {
      expect((await post("5", body)).status, JSON.stringify(body)).toBe(400);
    }
    const { ErrorLiquidacionViaje } = await import("./liquidacion-viaje");
    holder.reabrir.mockRejectedValueOnce(new ErrorLiquidacionViaje("SOLICITUD_INVALIDA", "El motivo debe tener al menos 5 caracteres.", 400));
    expect((await post("5", { expectedVersion: 2, motivo: "abc" })).status).toBe(400);
  });

  it("sesión → actor; respuesta con estado EN_AJUSTE; conflicto/404/409", async () => {
    holder.reabrir.mockResolvedValue({ idempotente: false, evento: "REABIERTO", liquidacion: { estado: "EN_AJUSTE", version: 3 } });
    const r = await post("5", { expectedVersion: 2, motivo: "  Corregir tarifa  " });
    expect(r.status).toBe(200);
    expect(holder.reabrir).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 4, usuario: "ana" },
      { planId: 5, versionEsperada: 2, motivo: "  Corregir tarifa  " },
    );
    expect(await r.json()).toMatchObject({ evento: "REABIERTO", liquidacion: { estado: "EN_AJUSTE", version: 3 } });
    const { ErrorLiquidacionViaje } = await import("./liquidacion-viaje");
    holder.reabrir.mockRejectedValueOnce(new ErrorLiquidacionViaje("CONFLICTO_VERSION", "cambió"));
    expect((await post("5", { expectedVersion: 1, motivo: "Ajuste valido" })).status).toBe(409);
    holder.reabrir.mockRejectedValueOnce(new ErrorLiquidacionViaje("NO_ENCONTRADO", "Viaje no encontrado.", 404));
    expect((await post("5", { expectedVersion: 1, motivo: "Ajuste valido" })).status).toBe(404);
    holder.reabrir.mockRejectedValueOnce(new ErrorLiquidacionViaje("PLAN_NO_ADMITE", "Un viaje Cerrado ya no admite cambios de liquidación."));
    expect((await post("5", { expectedVersion: 1, motivo: "Ajuste valido" })).status).toBe(409);
  });
});

describe("Liquidación Fase 3 · GET /liquidacion (historial y vista previa)", () => {
  const get = async (id: string) => {
    const { GET } = await import("../../app/api/empresas/[slug]/tms/planes/[id]/liquidacion/route");
    return GET(new Request("http://x"), ctx(id));
  };
  const snap = { version: 1, plan: { id: 5, codigo: "PLAN-5" } };
  beforeEach(() => {
    holder.leer.mockReset();
    holder.eventos.mockReset();
    holder.snapshot.mockReset();
    holder.guardLeer = sesion;
    holder.eventos.mockResolvedValue([]);
  });

  it("vista previa solo mientras está pendiente de liquidar; liquidado no la expone", async () => {
    holder.snapshot.mockResolvedValue(snap);
    holder.leer.mockResolvedValue({ estado: "REPORTE_RECIBIDO", version: 1 });
    expect((await (await get("5")).json()).vistaPrevia).toEqual(snap);
    holder.leer.mockResolvedValue({ estado: "EN_AJUSTE", version: 3 });
    expect((await (await get("5")).json()).vistaPrevia).toEqual(snap);
    holder.leer.mockResolvedValue({ estado: "LIQUIDADO", version: 2 });
    expect((await (await get("5")).json()).vistaPrevia).toBeNull();
    holder.leer.mockResolvedValue(null);
    expect((await (await get("5")).json()).vistaPrevia).toBeNull();
  });

  it("empresa de la sesión en las tres lecturas; viaje de otra empresa/inexistente = 404; id inválido = 400", async () => {
    holder.snapshot.mockResolvedValue(null);
    holder.leer.mockResolvedValue(null);
    expect((await get("9")).status).toBe(404);
    expect(holder.leer).toHaveBeenCalledWith(7, 9);
    expect(holder.eventos).toHaveBeenCalledWith(7, 9);
    expect(holder.snapshot.mock.calls[0].slice(1)).toEqual([7, 9]);
    expect((await get("x")).status).toBe(400);
  });
});
