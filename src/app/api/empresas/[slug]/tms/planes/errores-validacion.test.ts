import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ERRORES DE VALIDACIÓN CLAROS Y POR LÍNEA — Programación (POST/PATCH /tms/planes). Handler y schemas REALES; solo se sustituye la
 * E/S (mismo arnés que persistencia-edicion.test.ts). Los mensajes de negocio que ya eran claros se conservan.
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({
  listarDisponibilidadVehiculos: vi.fn(() => Promise.resolve({ vehiculos: [], resumen: {} })),
  placasDisponiblesParaPlan: vi.fn(() => []),
}));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-1")), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => Promise.resolve([])),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(() => Promise.resolve(1)), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { MENSAJE_VALIDACION, textoError, type ErrorFormulario } from "@/lib/validacion-formulario";
import { PATCH, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt" }) };
const enviar = (metodo: "POST" | "PATCH", body: unknown) => (metodo === "POST" ? POST : PATCH)(new Request("http://x/api", { method: metodo, body: JSON.stringify(body) }), ctx);
const FECHA = "2026-12-15";
const leer = async (metodo: "POST" | "PATCH", body: unknown) => {
  const res = await enviar(metodo, body);
  const json = await res.json();
  return { status: res.status, json, textos: ((json.errores ?? []) as ErrorFormulario[]).map(textoError) };
};

beforeEach(() => {
  vi.resetAllMocks();
  const conexion = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn(async () => [{ insertId: 55, affectedRows: 1 }]),
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 91, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async () => []) as never);
});

describe("POST /tms/planes — errores de schema legibles", () => {
  it("21) fecha y hora inválidas", async () => {
    const r = await leer("POST", { fechaPlan: "15/12/2026", horaCarga: "9am" });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual(["Fecha: usa una fecha válida.", "Hora de salida: usa una hora válida (HH:MM)."]);
    expect(r.json.error).toBe(MENSAJE_VALIDACION);
  });
  it("fecha ausente", async () => {
    expect((await leer("POST", { horaCarga: "08:00" })).textos).toEqual(["Fecha: la fecha es obligatoria."]);
  });
  it("22) parada 2 inválida: lugar vacío y tipo fuera de catálogo", async () => {
    const r = await leer("POST", { fechaPlan: FECHA, paradas: [{ lugarNombre: "Bodega", tipo: "Carga" }, { lugarNombre: "", tipo: "Quizá" }] });
    expect(r.textos).toEqual(["Parada 2 — Lugar: es obligatorio.", "Parada 2 — Tipo de parada: selecciona Carga, Descarga o Entrega."]);
    expect(r.json.errores[0]).toMatchObject({ campo: "paradas.1.lugarNombre", linea: 2, coleccion: "Parada" });
  });
  it("auxiliar 3 con empleado inválido y cuadrilla 2 con integrante inválido", async () => {
    const r = await leer("POST", { fechaPlan: FECHA, auxiliarEmpleadoIds: [1, 2, "x"], cuadrilla: [{ tipo: "INTERNO", empleadoId: 4 }, { tipo: "INTERNO", empleadoId: 0 }] });
    expect(r.textos).toEqual(expect.arrayContaining(["Auxiliar 3: empleado inválido.", "Cuadrilla 2 — Integrante: integrante inválido."]));
  });
  it("vehículo solicitado y tarifa: nombres de la pantalla y dinero con Q", async () => {
    const r = await leer("POST", { fechaPlan: FECHA, vehiculoSolicitadoPerfilId: 0, tarifaComercial: -5 });
    expect(r.textos).toEqual(expect.arrayContaining(["Vehículo solicitado: selecciona un vehículo válido.", "Monto del viaje: no puede ser menor que Q0."]));
    expect(r.textos).toHaveLength(2);
  });
  it("tipo de viaje fuera de catálogo", async () => {
    expect((await leer("POST", { fechaPlan: FECHA, tipoViaje: "Mixto" })).textos).toEqual(["Tipo de viaje: selecciona Propio o Tercerizado."]);
  });
  it("cuerpo no JSON: validación clara, no 500", async () => {
    const res = await POST(new Request("http://x/api", { method: "POST", body: "{roto" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).errores.length).toBeGreaterThan(0);
  });
  it("nunca expone mensajes técnicos ni nombres de propiedades", async () => {
    const r = await leer("POST", { fechaPlan: 3, horaCarga: 7, paradas: [{ lugarNombre: 5, tipo: 1 }], auxiliarNombres: ["a"], tarifaComercial: "x" });
    expect(JSON.stringify(r.json)).not.toMatch(/Invalid|Too small|Too big|expected|received|undefined/);
    expect(r.textos.join(" ")).not.toMatch(/fechaPlan|horaCarga|lugarNombre|auxiliarNombres|tarifaComercial/);
  });
});

describe("PATCH /tms/planes — errores de schema legibles", () => {
  it("viaje sin identificar y fecha inválida", async () => {
    const r = await leer("PATCH", { fechaPlan: "15/12/2026" });
    expect(r.status).toBe(400);
    expect(r.textos).toEqual(expect.arrayContaining(["Viaje: es obligatorio.", "Fecha: usa una fecha válida."]));
    expect(r.textos).toHaveLength(2);
  });
  it("parada 3 inválida al editar", async () => {
    const r = await leer("PATCH", { id: 5, paradas: [{ lugarNombre: "A", tipo: "Carga" }, { lugarNombre: "B", tipo: "Descarga" }, { lugarNombre: "C", tipo: "Zzz" }] });
    expect(r.textos).toEqual(["Parada 3 — Tipo de parada: selecciona Carga, Descarga o Entrega."]);
  });
});

describe("errores INESPERADOS no se exponen", () => {
  it("un Error de programación durante el alta responde 500 con mensaje seguro, sin el interno", async () => {
    vi.mocked(sincronizarViaticosPlan).mockRejectedValueOnce(new Error("Cannot read properties of undefined (reading 'x')"));
    const res = await enviar("POST", { fechaPlan: FECHA, horaCarga: "08:00" });
    expect(res.status).toBe(500);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toMatch(/undefined|reading|Cannot/);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("23) mensajes de negocio específicos se conservan", () => {
  it("regreso estimado anterior a la salida: texto original, sin `errores`", async () => {
    const res = await enviar("POST", { fechaPlan: FECHA, horaCarga: "10:00", regresoEstimado: `${FECHA}T08:00` });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "El regreso estimado debe ser posterior a la salida programada." });
  });
});
