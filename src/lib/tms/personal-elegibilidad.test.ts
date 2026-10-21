import { describe, expect, it } from "vitest";
import { elegibilidadRol, filtrarElegibles, type HabilitacionOp } from "./personal-elegibilidad";

describe("elegibilidadRol", () => {
  it("empleado legacy Piloto (categoriaOps exacto) sigue calificando SIN ninguna habilitación", () => {
    const r = elegibilidadRol({ categoriaOps: "Piloto", puesto: null }, undefined, "PILOTO");
    expect(r.elegible).toBe(true);
    expect(r.estado).toBeNull();
  });

  it("empleado legacy Auxiliar (puesto contiene 'auxiliar') sigue calificando SIN ninguna habilitación", () => {
    const r = elegibilidadRol({ categoriaOps: null, puesto: "Auxiliar de bodega" }, undefined, "AUXILIAR");
    expect(r.elegible).toBe(true);
    expect(r.estado).toBeNull();
  });

  it("empleado que NO era Piloto por legacy, aparece si tiene PILOTO/HABILITADO", () => {
    const habs: HabilitacionOp[] = [{ rol: "PILOTO", estado: "HABILITADO" }];
    const r = elegibilidadRol({ categoriaOps: "Bodega", puesto: "Bodeguero" }, habs, "PILOTO");
    expect(r.elegible).toBe(true);
    expect(r.estado).toBe("HABILITADO");
  });

  it("empleado que NO era Piloto por legacy, aparece si tiene PILOTO/CAPACITACION", () => {
    const habs: HabilitacionOp[] = [{ rol: "PILOTO", estado: "CAPACITACION" }];
    const r = elegibilidadRol({ categoriaOps: "Auxiliar", puesto: "Auxiliar" }, habs, "PILOTO");
    expect(r.elegible).toBe(true);
    expect(r.estado).toBe("CAPACITACION");
  });

  it("empleado SIN legacy y SIN habilitación no aparece", () => {
    const r = elegibilidadRol({ categoriaOps: "Administrativo", puesto: "Contador" }, [], "PILOTO");
    expect(r.elegible).toBe(false);
    expect(r.estado).toBeNull();
  });

  it("si califica por legacy Y además tiene habilitación explícita: no hay 'duplicado' (un solo resultado) y la habilitación aporta su estado/badge", () => {
    const habs: HabilitacionOp[] = [{ rol: "PILOTO", estado: "CAPACITACION" }];
    const r = elegibilidadRol({ categoriaOps: "Piloto", puesto: null }, habs, "PILOTO");
    expect(r.elegible).toBe(true);
    expect(r.estado).toBe("CAPACITACION"); // la habilitación explícita manda el badge, aunque ya calificara por legacy
  });

  it("una habilitación de AUXILIAR no aporta elegibilidad para PILOTO (y viceversa)", () => {
    const habs: HabilitacionOp[] = [{ rol: "AUXILIAR", estado: "HABILITADO" }];
    const r = elegibilidadRol({ categoriaOps: "Bodega", puesto: null }, habs, "PILOTO");
    expect(r.elegible).toBe(false);
    expect(r.estado).toBeNull();
  });

  it("habilitación HABILITADO no produce badge especial en el consumidor (estado se expone igual, la UI decide no mostrar advertencia para HABILITADO)", () => {
    const habs: HabilitacionOp[] = [{ rol: "AUXILIAR", estado: "HABILITADO" }];
    const r = elegibilidadRol({ categoriaOps: "Otro", puesto: null }, habs, "AUXILIAR");
    expect(r.estado).toBe("HABILITADO");
  });
});

describe("filtrarElegibles — sin fallback 'mostrar a todos'", () => {
  const idDe = (e: { id: number }) => e.id;

  it("si NINGÚN empleado es elegible, devuelve lista VACÍA (nunca cae a mostrar todos)", () => {
    const empleados = [
      { id: 1, categoriaOps: "Administrativo", puesto: "Contador" },
      { id: 2, categoriaOps: "Bodega", puesto: "Bodeguero" },
    ];
    const r = filtrarElegibles(empleados, undefined, "PILOTO", idDe);
    expect(r).toEqual([]);
  });

  it("filtra correctamente dejando solo los elegibles, con su habilitacionEstado anexado", () => {
    const empleados = [
      { id: 1, categoriaOps: "Piloto", puesto: null },
      { id: 2, categoriaOps: "Administrativo", puesto: null },
      { id: 3, categoriaOps: "Bodega", puesto: null },
    ];
    const habilitaciones = new Map<number, HabilitacionOp[]>([[3, [{ rol: "PILOTO", estado: "CAPACITACION" }]]]);
    const r = filtrarElegibles(empleados, habilitaciones, "PILOTO", idDe);
    expect(r.map((e) => e.id)).toEqual([1, 3]);
    expect(r.find((e) => e.id === 1)!.habilitacionEstado).toBeNull();
    expect(r.find((e) => e.id === 3)!.habilitacionEstado).toBe("CAPACITACION");
  });

  it("una habilitación desactivada (ausente del Map de activas) no aporta elegibilidad", () => {
    const empleados = [{ id: 5, categoriaOps: "Bodega", puesto: null }];
    // El Map solo debe contener ACTIVAS (responsabilidad del caller, ver listarHabilitacionesActivasDe) —
    // un empleado sin entrada en el Map se trata como "sin habilitación".
    const r = filtrarElegibles(empleados, new Map(), "PILOTO", idDe);
    expect(r).toEqual([]);
  });
});
