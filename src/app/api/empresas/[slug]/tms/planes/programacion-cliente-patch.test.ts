import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUGFIX-PROGRAMACION-CLIENTE-1 — cambiar el cliente de un plan en edición.
 *
 * Antes: PlanForm dejaba elegir un cliente nuevo en el selector, pero el PATCH nunca mandaba `clienteId` (no existía
 * en el schema) y el UPDATE nunca tocaba `cliente_id` — el cambio se veía en pantalla pero nunca se guardaba.
 *
 * Estas pruebas cubren: (1) GET expone el `clienteId` REAL persistido; (2) el PATCH acepta `clienteId` validado
 * contra la empresa de la SESIÓN (nunca la del cliente); (3) el backend es la autoridad de la consistencia
 * cliente↔ruta — rechaza con 400 y SIN modificar nada cualquier combinación donde la ruta efectiva no pertenezca al
 * cliente efectivo, sin depender de que el frontend haya limpiado el selector; (4) `rutaId: null` quita la ruta y
 * limpia SIEMPRE sus snapshots dependientes (código/destino/contacto); (5) las puertas de estado existentes
 * (Cerrado/Cancelado) siguen bloqueando cualquier edición, incluida la de cliente.
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn(), placasDisponiblesParaPlan: vi.fn(() => []) }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn() }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-programacion-intervalos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/disponibilidad-programacion-intervalos")>();
  return { ...actual, primerConflictoProgramacionIntervalo: vi.fn(() => Promise.resolve(null)) };
});

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { guardarParadasPlan } from "@/lib/tms/paradas";
import { validarPersonalId } from "@/lib/tms/personal-resolucion";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { primerConflictoProgramacionIntervalo } from "@/lib/tms/disponibilidad-programacion-intervalos";
import { hoyLocal } from "@/lib/rrhh/dates";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const get = (qs = "fechaDesde=2026-09-23&fechaHasta=2026-09-23") => GET(new Request(`http://x/api?${qs}`), ctx);
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOY = hoyLocal();
const MANANA = sumarDias(HOY, 1);

// EMPRESA 7 = "KT". ABASA (cliente 1) tiene la ruta 100; SAUZALITO (cliente 2) tiene la ruta 200.
const CLIENTES = [{ id: 1, nombre: "ABASA", empresa_id: 7 }, { id: 2, nombre: "SAUZALITO", empresa_id: 7 }];
const CLIENTE_RUTAS = [{ id: 100, cliente_id: 1, empresa_id: 7 }, { id: 200, cliente_id: 2, empresa_id: 7 }];

let conexion: ReturnType<typeof crearConexion>;
let filaPlan: Record<string, unknown>;

const plan = (over: Record<string, unknown> = {}) => ({
  id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: MANANA, hora_carga: "08:00:00", notas: null,
  piloto_id: 10, unidad_id: 3, regreso_estimado: null, ruta_id: 100, tipo_viaje: "Propio", tc_vehiculo_id: null,
  cliente_id: 1, cliente_nombre: "ABASA", tarifa_comercial: null, tarifa_id: null,
  costo_operativo_referencia: null, referencia_cliente: null, ...over,
});

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn(async (sql: string) => (String(sql).includes("UPDATE tms_planes_viaje") ? [{ insertId: 91, affectedRows: 1 }] : [{ insertId: 91, affectedRows: 1 }])),
  };
}

const update = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
// cliente_id, ruta_id_tocado, ruta_id (los 2 parámetros justo después de referencia_cliente en el UPDATE).
const paramsCliente = () => {
  const p = update()![1];
  return { clienteId: p[23], rutaTocado: p[24], rutaId: p[25], rutaSeQuita: p[26] };
};

beforeEach(() => {
  vi.resetAllMocks();
  filaPlan = plan();
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 7, nombre: "KT" }, session: { id: 3, username: "ops" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 500, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje p") && s.includes("WHERE p.id = ?") && s.includes("p.hora_carga")) return [filaPlan];
    if (s.includes("FROM tms_plan_auxiliares a")) return [];
    if (s.includes("FROM tms_viaticos")) return [];
    if (s.includes("SELECT p.fecha_plan, u.placa, pil.nombre")) return [{ fecha_plan: filaPlan.fecha_plan, placa: "C-100", piloto: "Piloto Actual" }];
    if (s.includes("FROM tms_clientes")) {
      const [empresaId, clienteId] = params as [number, number];
      return CLIENTES.filter((c) => c.empresa_id === empresaId && c.id === clienteId);
    }
    if (s.includes("FROM tms_cliente_rutas")) {
      const [empresaId, rutaId, clienteId] = params as [number, number, number];
      return CLIENTE_RUTAS.filter((r) => r.empresa_id === empresaId && r.id === rutaId && r.cliente_id === clienteId);
    }
    if (s.includes("FROM tms_ruta_tarifas")) return []; // sin tarifas activas para estas pruebas
    if (s.includes("FROM tms_planes_viaje p") && s.includes("cliente")) return [{ id: 1, codigo: "PLAN-1", cliente: "ABASA", clienteId: 1 }];
    return [];
  }) as never);
  vi.mocked(registrarAuditoria).mockResolvedValue(undefined as never);
  vi.mocked(primerConflictoProgramacionIntervalo).mockResolvedValue(null as never);
  vi.mocked(validarPersonalId).mockResolvedValue({ id: 10, nombre: "Piloto Actual" } as never);
  vi.mocked(listarDisponibilidadPersonal).mockResolvedValue([{
    personalId: 10, nombre: "Piloto Actual", incidenciasBloqueantes: [], viajeActual: null,
    estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
  }] as never);
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [{ id: 3, placa: "C-100", estadoDisponibilidad: "disponible", viajeAbierto: null, tipoUnidad: "Camion" }], resumen: {} } as never);
});

describe("BUGFIX-PROGRAMACION-CLIENTE-1 — GET expone clienteId real", () => {
  it("1) el SELECT trae p.cliente_id AS clienteId (junto al nombre en `cliente`, no en su reemplazo)", async () => {
    await get();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("c.nombre AS cliente, p.cliente_id AS clienteId");
  });

  it("2) el plan en la respuesta trae clienteId numérico real (no null solo por tener nombre)", async () => {
    vi.mocked(query).mockImplementationOnce((async () => [{ id: 1, codigo: "PLAN-1", cliente: "ABASA", clienteId: 1, piloto_id: null, auxiliar_id: null }]) as never);
    const data = await (await get()).json();
    expect(data.planes[0].clienteId).toBe(1);
  });
});

describe("BUGFIX-PROGRAMACION-CLIENTE-1 — PATCH clienteId: validación de tenant", () => {
  it("3) sin clienteId en el PATCH: no consulta tms_clientes ni toca cliente_id", async () => {
    const res = await patch({ id: 40, notas: "solo notas" });
    expect(res.status).toBe(200);
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("FROM tms_clientes"))).toBe(false);
    expect(paramsCliente().clienteId).toBeNull();
  });

  it("4) clienteId inexistente en ESTA empresa -> 400, sin abrir conexión ni escribir nada", async () => {
    const res = await patch({ id: 40, clienteId: 999 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("El cliente seleccionado no existe o no pertenece a esta empresa.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("5) la validación siempre usa la empresa de la SESIÓN (guard.empresa.id), nunca una que mandara el cliente", async () => {
    await patch({ id: 40, clienteId: 2 });
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("FROM tms_clientes"))!;
    expect(llamada[1]).toEqual([7, 2]);
  });
});

describe("BUGFIX-PROGRAMACION-CLIENTE-1 — consistencia cliente <-> ruta (autoridad del backend)", () => {
  it("6) cambiar de cliente SIN tocar rutaId, dejando la ruta del cliente ANTERIOR -> 400 y NO modifica nada", async () => {
    const res = await patch({ id: 40, clienteId: 2 }); // plan sigue con ruta_id=100 (de ABASA=1)
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La ruta seleccionada no pertenece al cliente de este viaje en esta empresa.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("7) cambiar de cliente + rutaId: null (quitar la ruta) -> 200; cliente_id y ruta_id se actualizan, snapshots dependientes se limpian SIEMPRE", async () => {
    const res = await patch({ id: 40, clienteId: 2, rutaId: null });
    expect(res.status).toBe(200);
    const { clienteId, rutaTocado, rutaId, rutaSeQuita } = paramsCliente();
    expect(clienteId).toBe(2);
    expect(rutaTocado).toBe(true);
    expect(rutaId).toBeNull();
    expect(rutaSeQuita).toBe(true);
    const p = update()![1];
    // ruta_codigo_historico: CASE WHEN rutaSeQuita THEN NULL ELSE COALESCE(?, ...) END — el flag (26) fuerza NULL;
    // el valor (27) queda null porque el PATCH no envió rutaCodigo.
    expect(p[26]).toBe(true);
    expect(p[27]).toBeNull();
  });

  it("8) cambiar de cliente + rutaId de la ruta del cliente NUEVO -> 200; ambos se actualizan juntos", async () => {
    const res = await patch({ id: 40, clienteId: 2, rutaId: 200 });
    expect(res.status).toBe(200);
    const { clienteId, rutaTocado, rutaId } = paramsCliente();
    expect(clienteId).toBe(2);
    expect(rutaTocado).toBe(true);
    expect(rutaId).toBe(200);
  });

  it("9) mandar una rutaId que pertenece a OTRO cliente (sin cambiar el cliente del viaje) -> 400, nada se escribe", async () => {
    const res = await patch({ id: 40, rutaId: 200 }); // el plan sigue siendo de ABASA=1; la ruta 200 es de SAUZALITO=2
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La ruta seleccionada no pertenece al cliente de este viaje en esta empresa.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("10) la ruta de siempre + el cliente de siempre (ninguno cambia) no dispara la validación cliente<->ruta", async () => {
    const res = await patch({ id: 40, notas: "x" });
    expect(res.status).toBe(200);
    expect(vi.mocked(query).mock.calls.some(([sql]) => String(sql).includes("FROM tms_cliente_rutas"))).toBe(false);
  });
});

describe("BUGFIX-PROGRAMACION-CLIENTE-1 — efectos colaterales correctos", () => {
  it("11) la tarifa anterior NO sobrevive incorrectamente cuando la ruta cambia por el cambio de cliente", async () => {
    filaPlan = plan({ tarifa_id: 55 }); // el viaje ya tenía una tarifa de la ruta 100 (ABASA)
    const res = await patch({ id: 40, clienteId: 2, rutaId: 200 }); // nueva ruta de SAUZALITO, tarifaId NO se envía
    expect(res.status).toBe(200);
    const p = update()![1];
    // bloque tarifa_id: CASE WHEN tarifaSnapshotTocado THEN ? — debe tocarse (limpiar) porque la tarifa 55 no pertenece a la ruta 200.
    expect(p[11]).toBe(true); // tarifaSnapshotTocado
    expect(p[12]).toBeNull(); // snapshotTarifaPatch?.id ?? null
  });

  it("12) editar solo el cliente NO toca piloto/unidad/auxiliares (COALESCE con null = conserva el valor guardado)", async () => {
    const res = await patch({ id: 40, clienteId: 2, rutaId: null });
    expect(res.status).toBe(200);
    const p = update()![1];
    expect(p[1]).toBeNull(); // piloto_id: COALESCE(null, piloto_id) -> conserva
    expect(p[3]).toBeNull(); // unidad_id: COALESCE(null, unidad_id) -> conserva
    expect(vi.mocked(sincronizarViaticosPlan)).not.toHaveBeenCalled();
  });

  it("13) editar el cliente NO borra paradas (dato operativo manual, no se toca sin `paradas` explícito en el PATCH)", async () => {
    const res = await patch({ id: 40, clienteId: 2, rutaId: null });
    expect(res.status).toBe(200);
    expect(guardarParadasPlan).not.toHaveBeenCalled();
  });

  it("14) la bitácora registra 'cliente ABASA -> SAUZALITO'", async () => {
    await patch({ id: 40, clienteId: 2, rutaId: null });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      detalle: expect.stringContaining("cliente ABASA → SAUZALITO"),
    }));
  });
});

describe("BUGFIX-PROGRAMACION-CLIENTE-1 — estados bloqueados siguen bloqueados", () => {
  it.each(["Cerrado", "Cancelado"])("15) plan %s: cambiar clienteId sigue devolviendo 409 y no escribe nada", async (estado) => {
    filaPlan = plan({ estado });
    const res = await patch({ id: 40, clienteId: 2, rutaId: 200 });
    expect(res.status).toBe(409);
    expect(getPool).not.toHaveBeenCalled();
  });
});
