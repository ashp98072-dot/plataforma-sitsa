import { describe, expect, it } from "vitest";
import { opcionesVehiculo } from "@/lib/flota/combustible-estaciones-ui";
import type { CatalogosCB2 } from "./client";
import type { CandidatoRevision } from "./preview-model";
import { advertenciaPlacaRepetida, fichasMismaPlaca, filasAmbiguasMismaPlaca } from "./unidad-preferida";

type V = CatalogosCB2["vehiculos"][number];
const ficha = (id: number, placa: string, extra: Partial<V> = {}): V => ({ id, placa, tipo_unidad: "VEHICULO", estado: "Activo", ...extra });
const catalogo = (vehiculos: V[]) => ({ vehiculos } as unknown as CatalogosCB2);
/** Parejas reales conocidas: [ficha de otra empresa (compartida), ficha propia de Mónaco]. */
const PAREJAS: [string, V, V][] = [
  ["C-558BSJ", ficha(684, "C-558BSJ", { propia: false, empresa_duena_nombre: "Kuiqtrans", marca: "International", modelo: "1998", descripcion: "Camion Furgon de 10 Tn" }), ficha(1301, "C-558BSJ", { propia: true })],
  ["C-092BXF", ficha(651, "C-092BXF", { propia: false, empresa_duena_nombre: "Frescofresh" }), ficha(1300, "C-092BXF", { propia: true })],
  ["C-034BXR", ficha(602, "C-034BXR", { propia: false, empresa_duena_nombre: "Frescofresh" }), ficha(1296, "C-034BXR", { propia: true })],
  ["C-035BXR", ficha(603, "C-035BXR", { propia: false, empresa_duena_nombre: "Frescofresh" }), ficha(1297, "C-035BXR", { propia: true })],
  ["C-845BXG", ficha(638, "C-845BXG", { propia: false, empresa_duena_nombre: "Otra empresa" }), ficha(1299, "C-845BXG", { propia: true })],
];
const fila = (clave: string, placa: string, extra: Record<string, unknown> = {}) =>
  ({ clave, vehiculoId: "", estado: "PENDIENTE", fila: { placa, placaNormalizada: placa.replace(/-/g, ""), vale: clave, hoja: "H", fila: 1 }, ...extra }) as unknown as CandidatoRevision;

describe.each(PAREJAS)("placa repetida %s", (placa, a, b) => {
  const cat = catalogo([a, b, ficha(9000, "P-000AAA")]);
  it("NO oculta ninguna ficha: el selector ofrece ambas, identificadas por registro y procedencia, sin asumir que son la misma unidad", () => {
    const opciones = opcionesVehiculo(cat.vehiculos).filter(o => ["" + a.id, "" + b.id].includes(o.value));
    expect(opciones.map(o => o.value)).toEqual([String(a.id), String(b.id)]);
    for (const o of opciones) expect(o.detail).toContain("placa repetida, verificar unidad");
    expect(opciones[0].detail).toContain(`Registro #${a.id}`);
    expect(opciones[0].detail).toContain(`Ficha compartida de ${a.empresa_duena_nombre}`);
    expect(opciones[1].detail).toContain("Ficha propia");
    expect(opcionesVehiculo(cat.vehiculos).find(o => o.value === "9000")?.detail).not.toContain("placa repetida");
  });
  it("sin identidad aprobada advierte que pueden ser unidades distintas y remite a Identidades físicas", () => {
    const aviso = advertenciaPlacaRepetida(cat, placa)!;
    expect(aviso).toContain(`#${a.id}`); expect(aviso).toContain(`#${b.id}`);
    expect(aviso).toMatch(/unidades distintas/); expect(aviso).toContain("Identidades físicas");
    expect(advertenciaPlacaRepetida(cat, "P-000AAA")).toBeNull(); // placa única: sin advertencia
  });
  it("con identidad física aprobada común no hay advertencia (el catálogo ya colapsa a una ficha)", () => {
    expect(advertenciaPlacaRepetida(catalogo([{ ...a, identidadFisicaId: 5 }, { ...b, identidadFisicaId: 5 }]), placa)).toBeNull();
    expect(advertenciaPlacaRepetida(catalogo([{ ...b, identidadFisicaId: 5 }]), placa)).toBeNull(); // una sola ficha canónica
  });
  it("identidades aprobadas distintas (o solo una de las dos) SIGUEN advirtiendo", () => {
    expect(advertenciaPlacaRepetida(catalogo([{ ...a, identidadFisicaId: 5 }, { ...b, identidadFisicaId: 6 }]), placa)).not.toBeNull();
    expect(advertenciaPlacaRepetida(catalogo([{ ...a, identidadFisicaId: 5 }, b]), placa)).not.toBeNull();
  });
  it("la ficha elegida se ofrece solo para las demás filas AMBIGUAS de la misma placa, sin tocar otras placas ni filas ya asignadas", () => {
    const g = fila("v1", placa);
    const revision = [
      g, fila("v2", placa), fila("v3", placa.toLowerCase()), fila("v4", placa, { vehiculoId: String(a.id) }), fila("v5", placa, { estado: "BLOQUEADO" }),
      fila("v6", placa, { estado: "RESUELTO" }), fila("v7", "P-000AAA"),
    ];
    expect(filasAmbiguasMismaPlaca(revision, cat, g, String(b.id))).toEqual(["v2", "v3"]);
    expect(filasAmbiguasMismaPlaca(revision, cat, g, "424242")).toEqual([]); // ficha que no está en el catálogo
    expect(filasAmbiguasMismaPlaca(revision, cat, g, "")).toEqual([]);
  });
  it("no aplica a filas cuya placa ya identifica una única ficha", () => {
    const g = fila("v1", placa), solo = catalogo([b]);
    expect(filasAmbiguasMismaPlaca([g, fila("v2", placa)], solo, g, String(b.id))).toEqual([]);
  });
});

describe("fichasMismaPlaca", () => {
  it("compara por placa comparable (guiones, espacios y mayúsculas) y excluye unidades externas", () => {
    const cat = catalogo([ficha(684, "C-558BSJ"), ficha(1301, "c 558 bsj"), ficha(-3, "C558BSJ")]);
    expect(fichasMismaPlaca(cat, "C558BSJ").map(f => f.id)).toEqual([684, 1301]);
    expect(fichasMismaPlaca(cat, "")).toEqual([]);
  });
});
