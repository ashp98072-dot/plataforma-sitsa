// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/image", () => ({ default: () => null }));

import ViajeForm from "./viaje-form";
import type { AsignacionOperativaPortal, ViajeAbiertoPiloto } from "@/lib/flota/viajes-piloto";
import type { PlanParada } from "@/lib/tms/paradas";
import type { EntregaVista } from "@/lib/tms/parada-confirmacion-ui";

// TMS-ENTREGA-PILOTO-2 — INTEGRACIÓN focal: la confirmación vive DENTRO de la pantalla de viajes existente y reutiliza su formulario de evidencia (sin segunda cámara).
const asignacion = (over: Partial<AsignacionOperativaPortal> = {}): AsignacionOperativaPortal => ({ planId: 55, codigo: "PL-55", fecha: "2026-11-11", horaSalida: "08:00:00", regresoEstimado: null, estado: "En ruta", cliente: "PriceSmart",
  origen: "CD", destino: "Club 12", placa: "C-001ABC", piloto: "Piloto Uno", auxiliares: [], viajeId: 900, viajeEstado: "abierto", kmSalida: 100, odometroFuncional: true, ...over });
const viajeAbierto: ViajeAbiertoPiloto = { id: 900, placa: "C-001ABC", kmSalida: 100, odometroFuncional: true, horaSalida: "2026-11-11 08:00:00", destino: "Club 12", planId: 55, evidenciaTableroSalida: true, evidenciaTableroLlegada: false };
const paradaPlan = (id: number, orden: number, tipo = "Entrega", evidencias = 0): PlanParada => ({ id, plan_id: 55, orden, lugar_id: null, lugar_nombre: `Club ${id}`, tipo, requiere_evidencia: true, evidencias });
const entrega = (paradaId: number, over: Partial<EntregaVista> = {}): EntregaVista => ({ paradaId, orden: paradaId - 10, lugarNombre: `Club ${paradaId}`, tipo: "Entrega", evidencias: 0, confirmacion: null, ...over });

let host: HTMLElement; let root: Root; let llamadas: { url: string; init?: RequestInit }[];
type Props = Parameters<typeof ViajeForm>[0];
async function montar(props: Partial<Props> = {}) {
  const a = asignacion();
  await act(async () => { root.render(createElement(ViajeForm, { tipo: "Piloto", viajeAbierto, asignaciones: [a], asignacionEnCurso: a, viajeEnCursoId: 900, viajeDestacadoId: null,
    paradas: [paradaPlan(11, 1), paradaPlan(12, 2, "Descarga")], entregas: [entrega(11, { evidencias: 1 }), entrega(12)], ...props })); });
}
const botones = (n: RegExp) => [...host.querySelectorAll("button")].filter((b) => n.test(b.textContent ?? ""));
const clic = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
const select = (i: number) => host.querySelectorAll("#adjuntar-evidencia select")[i] as HTMLSelectElement;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; refresh.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); llamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { llamadas.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ confirmacion: { id: 5, planId: 55, paradaId: 11, resultado: "ENTREGADA_POR_PILOTO", revision: "NO_REQUERIDA", pilotoUsuario: "portal:P01", confirmadoEn: "2026-11-11 10:05:00", evidenciaId: 77, nota: null, recepcionOficial: "NO_ACEPTADA_POR_PRICESMART", estadoExternoPublicado: false }, replayed: false }) }; }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals(); });

describe("la confirmación dentro de la pantalla de viajes", () => {
  it("aparece para el viaje en ruta, con las paradas de entrega, junto a (no en lugar de) el avance y el formulario de evidencia existentes", async () => {
    await montar();
    expect(host.textContent).toContain("Confirmación de entregas"); expect(host.textContent).toContain("Avance del viaje"); expect(host.querySelector("#adjuntar-evidencia")).not.toBeNull();
    expect(host.querySelectorAll("[data-parada]")).toHaveLength(2);
  });
  it("«Subir evidencia» preselecciona la parada en el formulario de evidencia EXISTENTE (tipo «Parada», esa parada) y lo muestra; sigue habiendo UNA sola cámara", async () => {
    await montar(); expect(botones(/Abrir cámara/)).toHaveLength(1);
    await clic(botones(/Subir evidencia/)[0]);   // la parada 12 (sin evidencia; la 11 ya tiene y dice «Subir otra evidencia»)
    expect(select(0).value).toBe("producto"); expect(select(1).value).toBe("12");
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>)).toHaveBeenCalled(); expect(botones(/Abrir cámara/)).toHaveLength(1); expect(host.querySelectorAll("video")).toHaveLength(1);
  });
  it("confirmar usa el id del viaje en curso, refresca los datos de la pantalla y muestra la confirmación", async () => {
    await montar(); await clic(botones(/Confirmar entrega/)[0]);
    expect(llamadas).toHaveLength(1); expect(llamadas[0].url).toBe("/api/portal/viajes/900/paradas/11/confirmar"); expect(JSON.parse(String(llamadas[0].init?.body))).toEqual({ resultado: "ENTREGADA_POR_PILOTO" });
    expect(refresh).toHaveBeenCalled(); expect(host.textContent).toContain("ENTREGADA POR PILOTO");
  });
  it("un auxiliar ve las paradas pero no puede confirmar; tampoco si el viaje aún no está «En ruta»", async () => {
    await montar({ tipo: "Auxiliar" }); expect(host.querySelectorAll("[data-parada]")).toHaveLength(2); expect(botones(/Confirmar entrega|Registrar incidencia/)).toHaveLength(0);
    await act(async () => { root.unmount(); }); root = createRoot(host);
    const cargado = asignacion({ estado: "Cargado" }); await montar({ asignaciones: [cargado], asignacionEnCurso: cargado }); expect(botones(/Confirmar entrega|Registrar incidencia/)).toHaveLength(0);
  });
  it("sin paradas de entrega o sin viaje en curso no se muestra la sección", async () => {
    await montar({ entregas: [] }); expect(host.textContent).not.toContain("Confirmación de entregas");
    await act(async () => { root.unmount(); }); root = createRoot(host);
    await montar({ viajeEnCursoId: null, viajeAbierto: null, asignacionEnCurso: null }); expect(host.textContent).not.toContain("Confirmación de entregas");
  });
});
