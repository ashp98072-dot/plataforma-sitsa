// Matriz del motor ÚNICO de reconocimiento de empleados (Shell, HALEL, terceros directos y validación del servidor).
// Regla: empleados Activo y Baja de la empresa; ≥2 palabras completas coincidentes (sin importar posición, tildes ni mayúsculas); exactamente un empleado → propuesta;
// dos o más → ambiguo; ninguno → revisión manual. Los nombres reales de la regresión son solo datos de prueba: la lógica no contiene nombres ni IDs fijos.
import { describe, expect, it } from "vitest";
import { crearBuscadorEmpleados, identificarEmpleado, nombreEmpleadoComparable, palabraSignificativa, seleccionarEmpleado } from "./empleados-coincidencias";
import { proponerNombre } from "./pilotos-nombres";

type E = { id: number; nombre: string; estado: string; empresa: number };
const todos: E[] = [
  { id: 1, nombre: "Edgar Palala", estado: "Activo", empresa: 1 },
  { id: 110, nombre: "Andrés Norberto Taracena Mayén", estado: "Baja", empresa: 1 },
  { id: 3, nombre: "María de los Ángeles Pérez Gómez", estado: "Activo", empresa: 1 },
  { id: 4, nombre: "José Luis Escobar", estado: "Baja", empresa: 1 },
  { id: 5, nombre: "Juan Carlos Ramírez Soto", estado: "Activo", empresa: 1 },
  { id: 6, nombre: "Juan Pablo Ramírez López", estado: "Activo", empresa: 1 },
  { id: 7, nombre: "Ana López", estado: "Baja", empresa: 1 },
  { id: 8, nombre: "Ana López", estado: "Activo", empresa: 1 },                         // homónimo (una de baja y una activa)
  { id: 9, nombre: "Carlos Alberto De la Cruz Barrios", estado: "Baja", empresa: 1 },
  { id: 10, nombre: "Rosa Elena Martínez", estado: "Inactivo", empresa: 1 },           // estado no admitido
  { id: 11, nombre: "Luis Fernando Oxlaj Tzoc", estado: "Activo", empresa: 2 },        // otra empresa
  { id: 12, nombre: "Pedro Xol", estado: "Activo", empresa: 1 },                       // nombre corto
  { id: 13, nombre: "Hugo Alexander Sandoval Cifuentes de Paz", estado: "Activo", empresa: 1 },
];
const empresa1 = (estado?: boolean) => todos.filter(e => e.empresa === 1 && (!estado || ["Activo", "Baja"].includes(e.estado)));
const id = (nombre: string, cat: E[] = empresa1()) => identificarEmpleado(nombre, cat).propuesta?.id ?? null;
const estadoDe = (nombre: string, cat: E[] = empresa1()) => identificarEmpleado(nombre, cat).estado;

describe("matriz de reconocimiento automático de empleados (Activo y Baja por igual)", () => {
  it.each([
    ["Edgar Palala", 1], ["EDGAR   PALALA", 1], ["palala edgar", 1],                               // exacta, mayúsculas, espacios, orden
    ["Andres Taracena", 110], ["Taracena Andres", 110], ["Andrés Norberto Taracena Mayén", 110],   // baja: igual que activo; tildes; orden
    ["Norberto Mayen", 110], ["Andres Norberto", 110],                                           // cualquier par de palabras completas (nombre/apellido, sin importar posición)
    ["Maria Perez", 3], ["Gomez Angeles", 3], ["Maria de los Angeles Perez", 3],                   // varios apellidos / nombre compuesto con partículas
    ["Jose Escobar", 4], ["Luis Escobar", 4], ["Escobar Luis", 4],                                 // baja con nombres cortos
    ["Carlos Barrios", 9], ["Alberto Cruz", 9],                                                  // partículas (de, la) no cuentan, pero Cruz sí
    ["Pedro Xol", 12], ["Xol Pedro", 12],                                                        // nombre corto completo
    ["Hugo Sandoval", 13], ["Cifuentes Paz", 13], ["Alexander Cifuentes", 13],                    // nombre largo
    ["Andres Taracena Perez", 110],                                                              // dos palabras coinciden aunque haya una palabra extra del archivo
  ])("«%s» → empleado #%s", (nombre, esperado) => { expect(id(nombre)).toBe(esperado); });

  it("coincidencia exacta vs parcial: método registrado", () => {
    expect(identificarEmpleado("Edgar Palala", empresa1()).metodo).toBe("EXACTA_NORMALIZADA");
    expect(identificarEmpleado("Andres Taracena", empresa1()).metodo).toBe("TOKENS_COMPLETOS_UNICOS");
  });
  it.each([["Edgar"], ["Andres"], ["Taracena"], ["Pedro"], [""], ["   "], ["NO TIENE NOMBRE"], ["Alvaro 123"], ["Andr Tarac"], ["Edga Palal"], ["Andrees Taracenna"], ["de la"], ["De Los"]])(
    "sin dos palabras completas coincidentes → revisión manual (sin propuesta): «%s»", (nombre) => { expect(id(nombre)).toBeNull(); });
  it("coincidencias por fragmentos NO cuentan (Palal ≠ Palala)", () => {
    expect(id("Edgar Palal")).toBeNull(); expect(id("Edg Palala")).toBeNull(); expect(id("Taracena Mayenn")).toBeNull();
  });
  it.each([
    ["Ana Lopez", [7, 8]],                       // homónimo baja + activo
    ["Juan Ramirez", [5, 6]],                    // varios candidatos con dos palabras
    ["Juan Carlos Ramirez", [5, 6]],             // Juan Carlos Ramírez Soto cumple 3, Juan Pablo Ramírez López cumple 2 → los dos cumplen el mínimo → ambiguo
    ["Juan Carlos Ramirez Soto", [5, 6]],        // aunque sea el nombre completo exacto de #5, #6 también cumple el mínimo → ambiguo
  ])("«%s» → ambiguo, sin propuesta: candidatos %j", (nombre, ids) => {
    const m = identificarEmpleado(nombre, empresa1()); expect(m.estado).toBe("AMBIGUA"); expect(m.propuesta).toBeNull(); expect(m.candidatos.map(c => c.id)).toEqual(ids);
    expect(seleccionarEmpleado(nombre, empresa1(), undefined)).toEqual({ empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" });
  });
  it("estado no admitido (Inactivo) y empleados de otra empresa nunca se reconocen", () => {
    expect(id("Rosa Martinez")).toBeNull(); expect(estadoDe("Rosa Martinez")).toBe("INEXISTENTE");
    expect(id("Luis Oxlaj")).toBeNull();                                     // solo existe en la empresa 2
    expect(id("Luis Oxlaj", todos.filter(e => e.empresa === 2))).toBe(11);   // el catálogo autorizado lo aporta el servidor por empresa
  });
  it("baja con consumos anteriores o posteriores: el reconocimiento no depende de las fechas (solo advertencias en la revisión)", () => {
    const r = proponerNombre("Andres Taracena", empresa1(true), undefined, { min: "2026-01-01", max: "2099-01-01", sinFecha: true });
    expect(r.propuesta).toEqual({ tipo: "EMPLEADO", empleadoId: 110, confirmado: false });
  });
  it("Shell y HALEL comparten el mismo resultado para toda la matriz", () => {
    const cat = empresa1(true), buscar = crearBuscadorEmpleados(cat);
    for (const e of cat) for (const variante of [e.nombre, e.nombre.toUpperCase(), e.nombre.split(" ").reverse().join(" ")]) {
      const hal = buscar(variante).propuesta?.id ?? null, shell = proponerNombre(variante, cat).propuesta;
      expect(shell?.tipo === "EMPLEADO" ? shell.empleadoId : null).toBe(hal);
    }
  });
  it("oráculo por fuerza bruta: cada nombre completo se reconoce a sí mismo SOLO si ningún otro empleado comparte dos palabras significativas; si no, es ambiguo (sin excepciones)", () => {
    const cat = empresa1(true), buscar = crearBuscadorEmpleados(cat);
    const sig = (n: string) => new Set(nombreEmpleadoComparable(n).split(" ").filter(palabraSignificativa));
    const compartidas = (a: string, b: string) => [...sig(a)].filter(t => sig(b).has(t)).length;
    for (const e of cat) {
      const rivales = cat.filter(o => o.id !== e.id && compartidas(e.nombre, o.nombre) >= 2);
      const m = buscar(e.nombre);
      if (rivales.length) { expect(m.estado, e.nombre).toBe("AMBIGUA"); expect(m.propuesta).toBeNull(); expect(m.candidatos.map(c => c.id).sort((a, b) => a - b)).toEqual([e.id, ...rivales.map(r => r.id)].sort((a, b) => a - b)); }
      else expect(m.propuesta?.id, e.nombre).toBe(e.id);
    }
  });
  it("nombres completos de 3 o más palabras con competidores parciales → ambiguo (sin excepción de nombre exacto)", () => {
    const cat = [{ id: 1, nombre: "Juan Carlos Ramírez Soto", estado: "Activo" }, { id: 2, nombre: "Juan Pablo Ramírez López", estado: "Baja" }];
    for (const nombre of ["Juan Carlos Ramírez Soto", "JUAN CARLOS RAMIREZ SOTO", "Soto Ramirez Carlos Juan"]) {
      const m = identificarEmpleado(nombre, cat); expect(m.estado, nombre).toBe("AMBIGUA"); expect(m.propuesta).toBeNull(); expect(m.candidatos.map(c => c.id)).toEqual([1, 2]);
    }
    expect(identificarEmpleado("Carlos Soto", cat).propuesta?.id).toBe(1);   // sin competidor con dos palabras: único
  });
  it("un nombre de empleado ya registrado nunca queda como piloto reportado sin candidatos", () => {
    const r = proponerNombre("Andres Taracena", empresa1(true));
    expect(r.candidatos.map(c => c.id)).toContain(110); expect(r.propuesta).not.toBeNull();
  });
});
