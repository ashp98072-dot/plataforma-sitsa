import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");

describe("PlanForm — disponibilidad de piloto/auxiliar/unidad en los buscadores (PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1)", () => {
  const page = leer("src/app/e/[slug]/programacion/plan-form.tsx");
  const pos = (texto: string) => {
    const i = page.indexOf(texto);
    expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1);
    return i;
  };

  it("consulta disponibilidad por fecha y la refresca cuando cambia el día, sin recargar la página", () => {
    expect(page).toContain("/api/empresas/${slug}/tms/planes/disponibilidad-recursos?${params.toString()}");
    const efecto = page.slice(pos("const excluirPlanId = plan?.id ?? null;"), pos("en EDICIÓN, si el"));
    expect(efecto).toContain("[slug, form.fechaPlan, excluirPlanId]");
    expect(page).toContain("ocupacionDia.fecha === form.fechaPlan ? ocupacionDia.personal : {}");
    expect(page).toContain("ocupacionDia.fecha === form.fechaPlan ? ocupacionDia.unidades : {}");
    expect(efecto).not.toContain('params.set("horaCarga"');
  });

  it("edición: excluye el propio plan (plan.id) de la comprobación — nunca choca contra sí mismo", () => {
    expect(page).toContain("const excluirPlanId = plan?.id ?? null;");
    expect(page).toContain('params.set("excluirPlanId", String(excluirPlanId));');
  });

  it("PilotoSelect y AuxiliaresSelect reciben el mismo mapa ocupacionPersonal (una persona es una persona, sea piloto o auxiliar)", () => {
    const piloto = page.slice(pos("<PilotoSelect"), pos("<PilotoSelect") + 400);
    expect(piloto).toContain("ocupados={ocupacionPersonal}");
    const auxiliares = page.slice(pos("<AuxiliaresSelect"), pos("<AuxiliaresSelect") + 500);
    expect(auxiliares).toContain("ocupados={ocupacionPersonal}");
  });

  it("PlacaSelect recibe TODAS las unidades (todosVehiculos sin los TC, no solo las puedeEnviar) más el mapa de ocupación por asignación", () => {
    const placa = page.slice(pos("<PlacaSelect"), pos("<PlacaSelect") + 300);
    // PROGRAMACION-TC-CAJA-REMOLQUE-1: Unidad ya no muestra los TC (selector propio), pero sigue
    // recibiendo TODAS las demás unidades (taller/en ruta/inactivas incluidas) — nunca solo puedeEnviar.
    expect(placa).toContain("options={unidadesOpciones}");
    expect(page).toContain('const unidadesOpciones = todosVehiculos.filter((v) => v.tipoUnidad !== "TC");');
    expect(placa).toContain("ocupadas={ocupacionUnidades}");
    expect(page).not.toContain("options={vehiculosDisponibles}");
  });

  it("todosVehiculos se arma desde estadoVehiculos (TODAS las unidades, incluidas taller/en ruta/inactivas) — nunca se filtra a puedeEnviar", () => {
    const carga = page.slice(pos("setTodosVehiculos("), pos("setTodosVehiculos(") + 500);
    expect(carga).toContain("data.estadoVehiculos");
    expect(carga).toContain("estadoDisponibilidad: v.estadoDisponibilidad");
    expect(carga).toContain("motivoNoDisponible: v.motivoNoDisponible");
  });

  it("no consulta disponibilidad-recursos si todavía no hay fecha (evita una consulta con fecha vacía)", () => {
    const efecto = page.slice(pos("const excluirPlanId = plan?.id ?? null;"), pos("en EDICIÓN, si el"));
    expect(efecto).toContain("if (!form.fechaPlan) return;");
  });
});
