import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn(), requireTenantCotizacionesCosteo: vi.fn() }));
vi.mock("@/lib/tms/cotizaciones", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizaciones")>();
  return { ...actual, crearCotizacion: vi.fn(), actualizarCotizacion: vi.fn(), obtenerCotizacion: vi.fn(), listarCotizaciones: vi.fn() };
});
vi.mock("@/lib/tms/cotizacion-costeo-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizacion-costeo-db")>();
  return { ...actual, listarPerfilesCosteo: vi.fn(), obtenerParametrosCosteoVigentes: vi.fn(), obtenerSnapshotCosteo: vi.fn() };
});
vi.mock("@/lib/tms/cotizacion-costeo-servicio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizacion-costeo-servicio")>();
  return { ...actual, prepararCosteo: vi.fn() };
});
vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { requireTenantCotizaciones, requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { actualizarCotizacion, crearCotizacion, listarCotizaciones, obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { ErrorCosteoConfig, ErrorCosteoYaRegistrado, listarPerfilesCosteo, obtenerParametrosCosteoVigentes, obtenerSnapshotCosteo } from "@/lib/tms/cotizacion-costeo-db";
import { prepararCosteo } from "@/lib/tms/cotizacion-costeo-servicio";
import { GET as configGET } from "./config/route";
import { POST as calcularPOST } from "./calcular/route";
import { GET as snapshotGET } from "../[id]/costeo/route";
import { GET as listadoGET, POST as crearPOST } from "../route";
import { GET as detalleGET, PATCH as editarPATCH } from "../[id]/route";

const ctx = (id = "10") => ({ params: Promise.resolve({ slug: "kt", id }) });
const post = (body: unknown, method = "POST") => new Request("http://x/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ok = (empresaId = 1, rol = "Admin") => ({ session: { id: 8, username: "admin", nombre: "Admin", rol }, empresa: { id: empresaId, modulos: ["tms"] } }) as never;
const denegado = () => ({ error: NextResponse.json({ error: "Sin permiso para el costeo interno de cotizaciones." }, { status: 403 }) }) as never;

const PAYLOAD = { perfilId: 4, distanciaKm: 600, diasServicio: 1, cantidadPilotos: 2, cantidadAuxiliares: 2, incluirGps: true, incluirSeguroVehiculo: true };
const CALCULAR = { ...PAYLOAD, fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false };
const PREPARADO = { perfil: { id: 4, codigo: "CABEZAL", nombre: "Cabezal" }, input: {}, resultado: { costoOperativo: 3907.2 }, parametrosVigenteDesde: "2026-09-21" };
const COTIZACION = { fechaEmision: "2026-09-21", clienteId: 3, tarifaCotizada: 5000, incluyeIva: false, mensajeComercial: "Mensaje de prueba.", cierreComercial: "Cierre de prueba." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue(ok(1, "Operaciones"));
  vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(ok());
  vi.mocked(prepararCosteo).mockResolvedValue(PREPARADO as never);
});

describe("GET costeo/config", () => {
  it("sin cotizaciones_costeo:ver => 403 con no-store y NO toca la base (un usuario con tms/cotizaciones no ve costos)", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await configGET(new Request("http://x/api"), ctx());
    expect(res.status).toBe(403); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(requireTenantCotizacionesCosteo).toHaveBeenCalledWith("kt", "ver");
    expect(requireTenantCotizaciones).not.toHaveBeenCalled();
    expect(listarPerfilesCosteo).not.toHaveBeenCalled(); expect(obtenerParametrosCosteoVigentes).not.toHaveBeenCalled();
  });
  it("Admin: 200 con perfiles y parámetros vigentes (forma pedida), no-store, filtrado por la empresa del guard", async () => {
    vi.mocked(listarPerfilesCosteo).mockResolvedValue([{ id: 4, nombre: "Cabezal" }] as never);
    vi.mocked(obtenerParametrosCosteoVigentes).mockResolvedValue({ vigenteDesde: "2026-09-21", parametros: { precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 } });
    const res = await configGET(new Request("http://x/api?fecha=2026-09-21"), ctx());
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const data = await res.json();
    expect(data.perfiles).toHaveLength(1);
    expect(data.parametros).toEqual({ vigenteDesde: "2026-09-21", precioCombustibleGalon: 29.89, ivaTasa: 0.12, costoPilotoDia: 207.74, costoAuxiliarDia: 148.04, viaticoPilotoDia: 200, viaticoAuxiliarDia: 200, viaticoGuiaDia: 125, margenObjetivo: 0.2 });
    expect(listarPerfilesCosteo).toHaveBeenCalledWith(1); expect(obtenerParametrosCosteoVigentes).toHaveBeenCalledWith(1, "2026-09-21");
  });
  it("sin parámetros vigentes => 409 con el mensaje claro (la UI lo muestra dentro de la sección, no como 403)", async () => {
    vi.mocked(listarPerfilesCosteo).mockResolvedValue([]);
    vi.mocked(obtenerParametrosCosteoVigentes).mockRejectedValue(new ErrorCosteoConfig("No hay parámetros de costeo vigentes para la fecha indicada."));
    const res = await configGET(new Request("http://x/api"), ctx());
    expect(res.status).toBe(409); expect((await res.json()).error).toBe("No hay parámetros de costeo vigentes para la fecha indicada.");
  });
});

describe("POST costeo/calcular", () => {
  it("sin permiso (ni crear ni editar) => 403, sin calcular", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await calcularPOST(post(CALCULAR), ctx());
    expect(res.status).toBe(403);
    expect(vi.mocked(requireTenantCotizacionesCosteo).mock.calls.map((c) => c[1])).toEqual(["crear", "editar"]);
    expect(prepararCosteo).not.toHaveBeenCalled();
  });
  it("crear O editar: con solo cotizaciones_costeo:editar también calcula", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockImplementation((async (_s: string, accion: string) => (accion === "editar" ? ok(1, "JefeOperaciones") : denegado())) as never);
    expect((await calcularPOST(post(CALCULAR), ctx())).status).toBe(200);
  });
  it("Admin: 200; el servidor calcula con la empresa del guard y devuelve resultado + perfil + vigencia (no-store)", async () => {
    const res = await calcularPOST(post(CALCULAR), ctx());
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ resultado: { costoOperativo: 3907.2 }, perfil: { id: 4, codigo: "CABEZAL", nombre: "Cabezal" }, parametrosVigenteDesde: "2026-09-21" });
    expect(prepararCosteo).toHaveBeenCalledWith(1, PAYLOAD, { fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false });
  });
  it.each(["gpsMensual", "seguroVehiculoMensual", "precioCombustibleGalon", "costoPilotoDia", "costoAuxiliarDia", "ivaTasa", "costoJuegoLlantas", "costoAceiteServicio", "depreciacion", "rendimientoKmGalon", "perfil", "parametros", "precioVenta"])(
    "rechaza %s enviado por el cliente con 400 sin calcular", async (campo) => {
      const res = await calcularPOST(post({ ...CALCULAR, [campo]: 1 }), ctx());
      expect(res.status).toBe(400); expect(prepararCosteo).not.toHaveBeenCalled();
    });
  it("perfil de otra empresa => 400 con mensaje seguro", async () => {
    vi.mocked(prepararCosteo).mockRejectedValue(new ErrorCosteoConfig("El perfil de unidad indicado no existe en esta empresa."));
    const res = await calcularPOST(post({ ...CALCULAR, perfilId: 99 }), ctx());
    expect(res.status).toBe(400); expect((await res.json()).error).toBe("El perfil de unidad indicado no existe en esta empresa.");
    expect(prepararCosteo).toHaveBeenCalledWith(1, expect.objectContaining({ perfilId: 99 }), expect.anything());
  });
  it("un error inesperado no filtra detalles internos (500 genérico)", async () => {
    vi.mocked(prepararCosteo).mockRejectedValue(new Error("SELECT secreto FROM ..."));
    const res = await calcularPOST(post(CALCULAR), ctx());
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain("secreto");
  });
});

describe("GET cotizaciones/[id]/costeo", () => {
  it("sin permiso => 403 (cotizaciones:ver y tms:ver NO alcanzan)", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await snapshotGET(new Request("http://x"), ctx());
    expect(res.status).toBe(403); expect(requireTenantCotizaciones).not.toHaveBeenCalled(); expect(obtenerSnapshotCosteo).not.toHaveBeenCalled();
  });
  it("cotización inexistente => 404; cotización sin costeo => 404", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue(null);
    expect((await snapshotGET(new Request("http://x"), ctx())).status).toBe(404);
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10 } as never); vi.mocked(obtenerSnapshotCosteo).mockResolvedValue(null);
    const res = await snapshotGET(new Request("http://x"), ctx());
    expect(res.status).toBe(404); expect((await res.json()).error).toBe("Esta cotización no tiene costeo registrado.");
  });
  it("no cruza empresa: ambas lecturas usan la empresa del guard", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(ok(3));
    vi.mocked(obtenerCotizacion).mockResolvedValue(null);
    await snapshotGET(new Request("http://x"), ctx("10"));
    expect(obtenerCotizacion).toHaveBeenCalledWith(3, 10); expect(obtenerSnapshotCosteo).not.toHaveBeenCalled();
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10 } as never); vi.mocked(obtenerSnapshotCosteo).mockResolvedValue({ id: 1 } as never);
    const res = await snapshotGET(new Request("http://x"), ctx("10"));
    expect(obtenerSnapshotCosteo).toHaveBeenCalledWith(3, 10);
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store"); expect(await res.json()).toEqual({ costeo: { id: 1 } });
  });
  it("id no numérico o fuera de rango => 404 sin consultar", async () => {
    for (const id of ["abc", "0", "-1", "99999999999"]) expect((await snapshotGET(new Request("http://x"), ctx(id))).status).toBe(404);
    expect(obtenerCotizacion).not.toHaveBeenCalled();
  });
});

describe("Crear cotización — el costeo es opcional y tiene su propio permiso", () => {
  it("SIN costeo: funciona como siempre, no exige ni consulta cotizaciones_costeo", async () => {
    vi.mocked(crearCotizacion).mockResolvedValue({ id: 1, codigo: "COT-000001" } as never);
    const res = await crearPOST(post(COTIZACION), ctx());
    expect(res.status).toBe(200); expect((await res.json()).mensaje).toBe("Cotización creada.");
    expect(requireTenantCotizacionesCosteo).not.toHaveBeenCalled(); expect(prepararCosteo).not.toHaveBeenCalled();
    expect(crearCotizacion).toHaveBeenCalledWith(1, COTIZACION, "admin", null);
  });
  it("CON costeo y con permiso: recalcula en servidor con la fecha/tarifa/IVA de la cotización y guarda ambos", async () => {
    vi.mocked(crearCotizacion).mockResolvedValue({ id: 1, codigo: "COT-000001" } as never);
    const res = await crearPOST(post({ ...COTIZACION, costeo: PAYLOAD }), ctx());
    expect(res.status).toBe(200); expect((await res.json()).mensaje).toBe("Cotización y costeo creados.");
    expect(requireTenantCotizacionesCosteo).toHaveBeenCalledWith("kt", "crear");
    expect(prepararCosteo).toHaveBeenCalledWith(1, PAYLOAD, { fechaEmision: "2026-09-21", tarifaCotizada: 5000, incluyeIva: false });
    expect(crearCotizacion).toHaveBeenCalledWith(1, COTIZACION, "admin", PREPARADO);
  });
  it("CON costeo pero SIN permiso: 403 y NO se crea la cotización (no se ignora en silencio)", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await crearPOST(post({ ...COTIZACION, costeo: PAYLOAD }), ctx());
    expect(res.status).toBe(403); expect(crearCotizacion).not.toHaveBeenCalled(); expect(prepararCosteo).not.toHaveBeenCalled();
  });
  it("el costeo del cuerpo no acepta parámetros económicos (400 antes de guardar nada)", async () => {
    const res = await crearPOST(post({ ...COTIZACION, costeo: { ...PAYLOAD, precioCombustibleGalon: 1 } }), ctx());
    expect(res.status).toBe(400); expect(crearCotizacion).not.toHaveBeenCalled();
  });
  it("error de costeo (perfil ajeno / sin parámetros) => 400 y no se crea la cotización", async () => {
    vi.mocked(prepararCosteo).mockRejectedValue(new ErrorCosteoConfig("No hay parámetros de costeo vigentes para la fecha indicada."));
    const res = await crearPOST(post({ ...COTIZACION, costeo: PAYLOAD }), ctx());
    expect(res.status).toBe(400); expect(crearCotizacion).not.toHaveBeenCalled();
  });
});

describe("Editar cotización — snapshot inmutable", () => {
  it("con costeo: exige cotizaciones_costeo:editar y usa el contexto de la cotización tal como quedará", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10, fechaEmision: "2026-09-01", tarifaCotizada: 4000, incluyeIva: true } as never);
    vi.mocked(actualizarCotizacion).mockResolvedValue({ id: 10 } as never);
    const res = await editarPATCH(post({ tarifaCotizada: 4500, costeo: PAYLOAD }, "PATCH"), ctx());
    expect(res.status).toBe(200);
    expect(requireTenantCotizacionesCosteo).toHaveBeenCalledWith("kt", "editar");
    expect(prepararCosteo).toHaveBeenCalledWith(1, PAYLOAD, { fechaEmision: "2026-09-01", tarifaCotizada: 4500, incluyeIva: true });
    expect(actualizarCotizacion).toHaveBeenCalledWith(1, 10, { tarifaCotizada: 4500 }, PREPARADO, "admin");
  });
  it("si ya existe el snapshot => 409 con el mensaje exacto (no se reemplaza)", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10, fechaEmision: "2026-09-01", tarifaCotizada: 4000, incluyeIva: true } as never);
    vi.mocked(actualizarCotizacion).mockRejectedValue(new ErrorCosteoYaRegistrado());
    const res = await editarPATCH(post({ costeo: PAYLOAD }, "PATCH"), ctx());
    expect(res.status).toBe(409); expect((await res.json()).error).toBe("Esta cotización ya tiene un costeo registrado.");
  });
  it("con costeo y sin permiso: 403 y no se edita nada", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await editarPATCH(post({ observaciones: "x", costeo: PAYLOAD }, "PATCH"), ctx());
    expect(res.status).toBe(403); expect(actualizarCotizacion).not.toHaveBeenCalled();
  });
  it("sin costeo: PATCH normal, no consulta el permiso de costeo", async () => {
    vi.mocked(actualizarCotizacion).mockResolvedValue({ id: 10 } as never);
    expect((await editarPATCH(post({ observaciones: "x" }, "PATCH"), ctx())).status).toBe(200);
    expect(requireTenantCotizacionesCosteo).not.toHaveBeenCalled(); expect(actualizarCotizacion).toHaveBeenCalledWith(1, 10, { observaciones: "x" }, null, "admin");
  });
});

describe("Los GET normales (listado y detalle) nunca llevan costeo", () => {
  it("listado y detalle: solo requireTenantCotizaciones, sin campos de costeo ni consultas de costeo", async () => {
    const fila = { id: 10, codigo: "COT-000010", tarifaCotizada: 5000, estado: "Borrador" };
    vi.mocked(listarCotizaciones).mockResolvedValue([fila] as never); vi.mocked(obtenerCotizacion).mockResolvedValue(fila as never);
    const lista = await (await listadoGET(new Request("http://x/api"), ctx())).json();
    const detalle = await (await detalleGET(new Request("http://x/api"), ctx())).json();
    for (const cuerpo of [lista, detalle]) for (const clave of ["costeo", "costoOperativo", "precioSugerido", "utilidad", "margen"]) expect(JSON.stringify(cuerpo).toLowerCase()).not.toContain(clave.toLowerCase());
    expect(requireTenantCotizacionesCosteo).not.toHaveBeenCalled(); expect(obtenerSnapshotCosteo).not.toHaveBeenCalled();
  });
});
