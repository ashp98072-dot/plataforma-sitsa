import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coincideBusquedaPersona, etiquetaPersona, filtrarPersonas, normalizarTextoBusqueda, rangoCoincidenciaPersona, tokensBusqueda,
} from "./busqueda-personas";
import { etiquetaOpcion, filtrarOpcionesBusqueda, type CatalogoSearchOption } from "@/components/tms/catalogo-search-select";

const src = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

describe("normalización (solo para comparar)", () => {
  it.each([["José", "jose"], ["josé", "jose"], ["JOSE", "jose"], ["MUÑOZ", "munoz"], ["Pérez", "perez"], ["Álvarez", "alvarez"], ["  José   Antonio  ", "jose antonio"], ["Jose\t\nLópez", "jose lopez"]])(
    "%s → %s", (entrada, esperado) => expect(normalizarTextoBusqueda(entrada)).toBe(esperado));
  it("null/undefined no rompen", () => { expect(normalizarTextoBusqueda(null)).toBe(""); expect(tokensBusqueda(undefined)).toEqual([]); });
  it("tokens normalizados", () => expect(tokensBusqueda("  José   PÉREZ ")).toEqual(["jose", "perez"]));
  it("José == jose == josé == JOSE al buscar", () => {
    for (const q of ["jose", "José", "josé", "JOSE", " jose  "]) expect(coincideBusquedaPersona(q, "José Antonio Pérez")).toBe(true);
    expect(coincideBusquedaPersona("munoz", "Luis Muñoz")).toBe(true);
    expect(coincideBusquedaPersona("perez", "Ana Pérez")).toBe(true);
    expect(coincideBusquedaPersona("alvarez", "Rosa Álvarez")).toBe(true);
  });
});

describe("multi-token", () => {
  it("'jose perez' encuentra 'José Antonio Pérez López' (no pegados) pero no 'José Antonio García López'", () => {
    expect(coincideBusquedaPersona("jose perez", "José Antonio Pérez López")).toBe(true);
    expect(coincideBusquedaPersona("perez jose", "José Antonio Pérez López")).toBe(true); // el orden no importa
    expect(coincideBusquedaPersona("jose perez", "José Antonio García López")).toBe(false);
  });
  it("todas las palabras deben estar: no es permisivo", () => {
    expect(coincideBusquedaPersona("jose zzz", "José Pérez")).toBe(false);
  });
});

describe("ranking", () => {
  const nombres = ["Ana José Pérez", "Mariajosé López", "José Pérez López", "José", "Marcos Jose Ruiz"];
  const orden = (q: string) => filtrarPersonas(nombres, q, { nombre: (n) => n });
  it("rangos individuales: exacto 0 < prefijo 1 < palabra 2 < todos los tokens 3 < otro texto 4", () => {
    expect(rangoCoincidenciaPersona("jose", "José")).toBe(0);
    expect(rangoCoincidenciaPersona("jose", "José Pérez López")).toBe(1);
    expect(rangoCoincidenciaPersona("jose", "Ana José Pérez")).toBe(2);
    expect(rangoCoincidenciaPersona("jose", "Mariajosé López")).toBe(3); // subcadena dentro de una palabra
    expect(rangoCoincidenciaPersona("jose perez", "José Antonio Pérez")).toBe(3);
    expect(rangoCoincidenciaPersona("emp-1", "Carlos Pineda")).toBe(4);
  });
  it("orden: exacto > prefijo > palabra > parcial, y alfabético dentro del mismo nivel", () => {
    expect(orden("jose")).toEqual(["José", "José Pérez López", "Ana José Pérez", "Marcos Jose Ruiz", "Mariajosé López"]);
  });
  it("el orden alfabético ignora tildes ('Álvaro' antes que 'Bruno')", () => {
    expect(filtrarPersonas(["Bruno José", "Álvaro José"], "jose", { nombre: (n) => n })).toEqual(["Álvaro José", "Bruno José"]);
  });
  it("sin consulta no reordena ni recorta; el límite se respeta", () => {
    expect(filtrarPersonas(nombres, "  ", { nombre: (n) => n })).toEqual(nombres);
    expect(filtrarPersonas(Array.from({ length: 50 }, (_, i) => `José ${i}`), "jose", { nombre: (n) => n }, 20)).toHaveLength(20);
  });
  it("coincidir solo por código/puesto es el último nivel y respeta buscable", () => {
    const gente = [{ n: "Carlos Pineda", c: "EMP-001" }, { n: "EMP Mario", c: "X" }];
    expect(filtrarPersonas(gente, "emp", { nombre: (g) => g.n, buscable: (g) => g.c }).map((g) => g.n)).toEqual(["EMP Mario", "Carlos Pineda"]);
    expect(filtrarPersonas(gente, "emp-001", { nombre: (g) => g.n })).toEqual([]); // sin buscable, el código no participa
  });
});

describe("identificación visual (nombre real + código/puesto; nunca el nombre normalizado ni DPI)", () => {
  it("dos José distintos muestran identificación distinta", () => {
    const a: CatalogoSearchOption = { value: "1", label: "José Pérez López", detail: "EMP-0042 · Piloto" };
    const b: CatalogoSearchOption = { value: "2", label: "José Pérez López", detail: "EMP-0077 · Auxiliar" };
    expect(etiquetaOpcion(a)).toBe("José Pérez López · EMP-0042 · Piloto");
    expect(etiquetaOpcion(a)).not.toBe(etiquetaOpcion(b));
    expect(etiquetaOpcion({ value: "3", label: "José" })).toBe("José"); // sin datos: no se inventan
  });
  it("etiquetaPersona omite datos ausentes y muestra el nombre real con tildes", () => {
    expect(etiquetaPersona("José Antonio Pérez López", "EMP-0042", null, "Piloto")).toBe("José Antonio Pérez López · EMP-0042 · Piloto");
    expect(etiquetaPersona("José", undefined, "  ")).toBe("José");
  });
  it("el resultado conserva el nombre almacenado (la normalización no lo altera)", () => {
    const [r] = filtrarOpcionesBusqueda([{ value: "1", label: "José Antonio Pérez López" }], "jose perez");
    expect(r.label).toBe("José Antonio Pérez López");
  });
});

describe("integración con los catálogos de Operaciones (misma forma de opciones que cada pantalla)", () => {
  // Fondos: searchText = solo nombre (el código NO domina la búsqueda) · Gastos: detail = código · puesto
  const empleados = [
    { id: 1, codigo: "EMP-0042", nombre: "José Pérez López", puesto: "Piloto" },
    { id: 2, codigo: "EMP-0077", nombre: "Jose López", puesto: "Auxiliar" },
    { id: 3, codigo: "EMP-0100", nombre: "JOSÉ García", puesto: "Piloto" },
    { id: 4, codigo: "EMP-0200", nombre: "Luis Muñoz", puesto: null },
  ];
  const fondos = empleados.map((e) => ({ value: String(e.id), label: e.nombre, detail: [e.codigo, e.puesto].filter(Boolean).join(" · "), searchText: e.nombre }));
  const gastos = empleados.map((e) => ({ value: String(e.id), label: e.nombre, detail: [e.codigo, e.puesto].filter(Boolean).join(" · ") }));
  it("Fondos: 'jose' encuentra los tres José; 'munoz' a Muñoz; 'jose perez' solo a José Pérez López", () => {
    expect(filtrarOpcionesBusqueda(fondos, "jose").map((o) => o.value).sort()).toEqual(["1", "2", "3"]);
    expect(filtrarOpcionesBusqueda(fondos, "munoz").map((o) => o.value)).toEqual(["4"]);
    expect(filtrarOpcionesBusqueda(fondos, "jose perez").map((o) => o.value)).toEqual(["1"]);
    expect(filtrarOpcionesBusqueda(fondos, "EMP-0042")).toEqual([]); // regla previa intacta: en Fondos el código no busca
  });
  it("Gastos / Requerimientos / Viáticos: el detalle (código · puesto) sigue siendo buscable", () => {
    expect(filtrarOpcionesBusqueda(gastos, "emp-0042").map((o) => o.value)).toEqual(["1"]);
    expect(filtrarOpcionesBusqueda(gastos, "jose piloto").map((o) => o.value).sort()).toEqual(["1", "3"]);
  });
  it("requirentes/solicitantes (usuarios): busca por nombre sin tildes y muestra el nombre real", () => {
    const usuarios = [{ value: "9", label: "Ángel Muñoz" }, { value: "10", label: "Ana Ruiz" }];
    expect(filtrarOpcionesBusqueda(usuarios, "angel munoz").map((o) => o.label)).toEqual(["Ángel Muñoz"]);
  });
  it("no se agregan personas: solo se devuelven opciones que ya estaban en el catálogo recibido", () => {
    const salida = filtrarOpcionesBusqueda(gastos, "jose");
    for (const o of salida) expect(gastos).toContain(o);
    expect(filtrarOpcionesBusqueda([], "jose")).toEqual([]);
  });
});

describe("Programación (piloto/auxiliares) y pantallas — reglas previas intactas", () => {
  const piloto = src("src/components/tms/piloto-select.tsx");
  const aux = src("src/components/tms/auxiliares-select.tsx");
  const catalogo = src("src/components/tms/catalogo-search-select.tsx");
  it("piloto: usa la búsqueda compartida; los ocupados NO se filtran de la lista, solo se marcan y bloquean", () => {
    expect(piloto).toContain('import { filtrarPersonas } from "@/lib/busqueda-personas";');
    expect(piloto).toContain("filtrarPersonas(pilotos, q, { nombre: (p) => p.nombre, buscable: (p) => p.codigo }, 20)");
    expect(piloto).not.toMatch(/pilotos\s*\.filter\([^)]*ocupados/);
    expect(piloto).toContain("if (ocupados?.[p.id]) return;");
    expect(piloto).toContain("disabled={Boolean(ocupacion)}");
    expect(piloto).toContain("No se encontraron empleados.");
  });
  it("piloto: escribir un nombre NO vincula a un empleado por coincidencia sin tildes (solo por nombre exacto, como antes)", () => {
    expect(piloto).toContain("p.nombre.toLowerCase() === val.trim().toLowerCase()");
  });
  it("auxiliares: siguen excluyéndose los ya elegidos; ocupados marcados y bloqueados; catálogo sin ampliar", () => {
    expect(aux).toContain("auxiliares.filter((a) => !empleadoIds.includes(a.id))");
    expect(aux).toContain("filtrarPersonas(disponibles, q, { nombre: (a) => a.nombre, buscable: (a) => a.codigo }, 20)");
    expect(aux).toContain("|| ocupados?.[a.id]) return;");
    expect(aux).toContain("a.nombre.toLowerCase() === t.toLowerCase() && !empleadoIds.includes(a.id)");
    expect(aux).toContain("No se encontraron empleados.");
  });
  it("el selector compartido no selecciona solo: el input filtra y la selección ocurre en el desplegable", () => {
    expect(catalogo).toContain("El input solo filtra");
    expect(catalogo).toContain("onChange={(e) => setBusqueda(e.target.value)}");
    expect(catalogo).toContain("{sinResultados ?? \"Sin coincidencias.\"}");
    expect(catalogo).toContain("seleccion && !filtradas.some((o) => o.value === seleccion.value)"); // la selección se conserva aunque cambie la búsqueda
  });
  it("Fondos, Gastos y Viáticos muestran 'No se encontraron empleados.' en sus selectores de empleado", () => {
    expect(src("src/app/e/[slug]/fondos/page.tsx")).toContain('placeholder="Buscar empleado por nombre..." sinResultados="No se encontraron empleados."');
    expect(src("src/app/e/[slug]/gastos/page.tsx").match(/placeholder="Buscar empleado\.\.\." sinResultados="No se encontraron empleados\."/g)).toHaveLength(3);
    expect(src("src/components/tms/viaticos-requerimientos-client.tsx")).toContain('sinResultados="No se encontraron empleados."');
  });
  it("Compras / Requerimientos comparten el mismo selector (misma semántica)", () => {
    expect(src("src/components/compras/requerimiento-form-client.tsx")).toContain("<CatalogoSearchSelect label=\"Persona que requiere\"");
  });
  it("no hay normalizadores paralelos ni cambios de SQL/migraciones en esta mejora", () => {
    for (const f of ["piloto-select", "auxiliares-select", "catalogo-search-select"]) {
      expect(src(`src/components/tms/${f}.tsx`)).not.toMatch(/toLocaleLowerCase\("es"\)\)?\.includes|\.toLowerCase\(\)\.includes/);
    }
  });
});
