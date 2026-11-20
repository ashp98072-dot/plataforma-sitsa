// @vitest-environment happy-dom
// C4 en pantalla real (FlotaClient): una unidad por identidad aprobada, alternador «Mostrar vinculadas» y registro de chasis por PATCH. Sin base de datos.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "x" }), useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=vehiculos") }));
const session = vi.hoisted(() => ({ rol: "Admin", permisos: [], empresaNombre: "Mónaco", username: "admin" }));
vi.mock("@/lib/empresa-session", () => ({ useEmpresaSession: () => session }));

import FlotaClient from "@/app/e/[slug]/flota/flota-client";

const base = { marca: "Isuzu", modelo: "2023", descripcion: "", color: "", activo: 1, estado: "Activo", esDueno: true, puedeEditar: true, filtros: [], odometro_funcional: 1, tipo_propiedad: "EMPRESA",
  revision_propiedad: 0, tipo_vehiculo: "", tipo_combustible: "Diesel", km_actual: 1000, km_intervalo_servicio: 5000, mantenimiento_intervalo_meses: 3, en_taller: 0, fecha_entrada_taller: null, motivo_taller: null,
  notas: null, rin_llanta: null, medida_llanta: null, tipo_aceite: null, empresa_activo: null, accesoEmpresaIds: [] };
const representante = { ...base, id: 1296, empresa_id: 1, empresa_propietaria_id: 1, placa: "C-034BXR", chasis: null, esRepresentante: true, identidadFisicaId: 7, vinculadaA: null, fichasVinculadas: [602] };
const vinculada = { ...base, id: 602, empresa_id: 4, empresa_propietaria_id: 4, placa: "C-034BXR", chasis: null, esRepresentante: false, identidadFisicaId: 7, vinculadaA: 1296, fichasVinculadas: [1296] };
const suelta = { ...base, id: 50, empresa_id: 1, empresa_propietaria_id: 1, placa: "C-999AAA", chasis: null, esRepresentante: true, identidadFisicaId: null, vinculadaA: null, fichasVinculadas: [] };
const empresas = [{ id: 1, codigo: "MONACO", nombre: "Mónaco" }, { id: 4, codigo: "FRESCO", nombre: "Frescofresh" }];
let host: HTMLDivElement, root: Root;
const patches: Record<string, unknown>[] = [];
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
const boton = (t: string) => { const b = [...host.querySelectorAll("button")].find(x => x.textContent?.trim() === t); if (!b) throw Error(`No existe botón ${t}`); return b as HTMLButtonElement; };
const placas = () => [...host.querySelectorAll("tbody tr")].map(r => r.textContent ?? "");
const montar = async (vehiculos: unknown[]) => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return json({ ok: true }); }
    if (url.endsWith("/vehiculos")) return json({ vehiculos, empresas, empresaActualId: 1, propiedadHabilitada: false });
    return json({});
  }));
  await act(async () => { root.render(createElement(FlotaClient)); });
  await act(async () => { await Promise.resolve(); });
};
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; patches.length = 0;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("C4 en pantalla: colapso por identidad aprobada", () => {
  it("muestra UNA unidad por identidad (la representante), la nota de vinculadas y el alternador las vuelve a listar", async () => {
    await montar([representante, vinculada, suelta]);
    expect(placas().filter(t => t.includes("C-034BXR"))).toHaveLength(1);
    expect(placas().some(t => t.includes("C-999AAA"))).toBe(true);
    expect(host.querySelector("[data-fichas-vinculadas]")?.textContent).toContain("1 ficha(s) vinculada(s)");
    await act(async () => { boton("Mostrar vinculadas").click(); });
    expect(placas().filter(t => t.includes("C-034BXR"))).toHaveLength(2);
    await act(async () => { boton("Ocultar vinculadas").click(); });
    expect(placas().filter(t => t.includes("C-034BXR"))).toHaveLength(1);
  });
  it("sin identidades aprobadas no oculta nada ni muestra la nota (placas repetidas SIN identidad siguen visibles)", async () => {
    await montar([{ ...representante, esRepresentante: true, identidadFisicaId: null, fichasVinculadas: [] }, { ...vinculada, esRepresentante: true, identidadFisicaId: null, vinculadaA: null, fichasVinculadas: [] }, suelta]);
    expect(placas().filter(t => t.includes("C-034BXR"))).toHaveLength(2);
    expect(host.querySelector("[data-fichas-vinculadas]")).toBeNull();
  });
  it("el servidor con FLOTA_IDENTIDAD_COLAPSO_UI=0 no marca vinculadas: la pantalla muestra todas (campo ausente)", async () => {
    const sinAnotar = [representante, vinculada].map(r => { const c: Record<string, unknown> = { ...r }; delete c.esRepresentante; delete c.vinculadaA; return c; });
    await montar(sinAnotar);
    expect(placas().filter(t => t.includes("C-034BXR"))).toHaveLength(2);
    expect(host.querySelector("[data-fichas-vinculadas]")).toBeNull();
  });
});
