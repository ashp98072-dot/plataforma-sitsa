import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CombustibleRegistro } from "@/components/flota/combustible-registro";
import { etiquetaOpcion, filtrarOpcionesBusqueda } from "@/components/tms/catalogo-search-select";
import { MENSAJE_SIN_ESTACIONES, opcionesEstacion, opcionesVehiculo, requiereRegistrarEstaciones } from "./combustible-estaciones-ui";

/** Registrar vale: sin proveedor visible; unidad y estación en buscadores. */
const render = (vale?: Parameters<typeof CombustibleRegistro>[0]["vale"]) =>
  renderToStaticMarkup(createElement(CombustibleRegistro, { slug: "kt", vale, onSaved: vi.fn(), onCancel: vi.fn() }));
const estaciones = [
  { id: 55, proveedorId: 3, nombre: "Shell Roosevelt", proveedorNombre: "Shell", direccion: "Calzada Roosevelt km 12" },
  { id: 56, proveedorId: 3, nombre: "Estación Mixco", proveedorNombre: "Shell", direccion: null },
  { id: 70, proveedorId: 9, nombre: "Estación Roosevelt", proveedorNombre: "Puma", direccion: "Zona 11" },
];
const vehiculos = [
  { id: 7, placa: "C-123ABC", descripcion: "Camión 5 toneladas" },
  { id: 8, placa: "P-456XYZ", descripcion: "Pick-up Hilux blanca" },
  { id: 9, placa: "M-789QRS", descripcion: null },
];
const ids = (o: { value: string }[]) => o.map(x => x.value);

describe("formulario Registrar vale", () => {
  it("NO muestra Proveedor y muestra los campos pedidos", () => {
    const html = render();
    expect(html).not.toMatch(/Proveedor/); expect(html).not.toContain('name="proveedorId"');
    for (const texto of ["Unidad / placa", "Buscar placa o unidad...", "Número de vale", "Fecha de consumo", "Combustible", "Galones", "Monto Q", "Kilometraje", "Estación / gasolinera", "Evidencia imagen/PDF", "Observaciones", "Guardar vale"]) {
      expect(html, texto).toContain(texto);
    }
    expect(html).toContain('name="vehiculoId"'); expect(html).toContain('name="estacionId"');
  });
  it("unidad y estación son buscadores con valor oculto: no hay captura manual de nombre", () => {
    const html = render();
    expect(html).not.toContain("Nombre manual");
    expect(html.match(/type="search"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Buscar estación o proveedor...");
  });
  it("histórico: conserva unidad y estación aunque ya no estén en el catálogo activo, sin IDs técnicos", () => {
    const html = render({ id: 1, proveedorId: 3, vehiculoId: 7, estacionId: 55, viajeId: null, numeroVale: "A", fechaConsumo: "2026-10-15", tipoCombustible: "diesel", galones: 1, monto: 30, km: null, gasolinera: "Shell Roosevelt vieja", placa: "C-OLD123" });
    expect(html).toContain("C-OLD123 (histórico)"); expect(html).toContain("Shell Roosevelt vieja (histórico)");
    expect(html).not.toMatch(/Estación #|Proveedor #|Unidad #/);
  });
  it("histórico SIN estación: se puede seguir sin ella y se muestra el texto conservado", () => {
    const html = render({ id: 2, proveedorId: 3, vehiculoId: 7, estacionId: null, viajeId: null, numeroVale: "B", fechaConsumo: "2026-10-15", tipoCombustible: "gasolina", galones: 1, monto: 30, km: null, gasolinera: "Texto antiguo", placa: "C-1" });
    expect(html).toContain("Texto histórico conservado: Texto antiguo"); expect(html).toContain("Sin estación catalogada (histórico)");
  });
  it("vale nuevo: la estación es obligatoria", () => {
    const html = render();
    expect(html).toContain("— Seleccionar estación —"); expect(html).not.toContain("Sin estación catalogada");
  });
  it("sin estaciones registradas: mensaje y enlace al mantenimiento (no se crean estaciones aquí)", () => {
    expect(MENSAJE_SIN_ESTACIONES).toBe("Debes registrar primero la estación de combustible.");
    expect(requiereRegistrarEstaciones(true, true, [])).toBe(true);
    expect(requiereRegistrarEstaciones(false, true, [])).toBe(false); // mientras carga no se avisa en falso
    expect(requiereRegistrarEstaciones(true, false, [])).toBe(false); // histórico sin estación puede seguir así
    expect(requiereRegistrarEstaciones(true, true, opcionesEstacion(estaciones))).toBe(false);
    const fuente = readFileSync("src/components/flota/combustible-registro.tsx", "utf8");
    expect(fuente).toContain("href={`/e/${slug}/combustibles/estaciones`}");
    expect(fuente).not.toMatch(/method:\s*["']POST["'][^}]*estaciones|estaciones[^}]*method:\s*["']POST/); // sin alta inline
    expect(fuente).toContain("disabled={guardando || sinEstacionesDisponibles}");
  });
  it("el envío no incluye proveedor y exige unidad y estación antes de llamar al servidor", () => {
    const fuente = readFileSync("src/components/flota/combustible-registro.tsx", "utf8");
    expect(fuente).not.toMatch(/name="proveedorId"|setProveedorId|const \[proveedorId/); // el tipo ValeEditable conserva proveedorId solo como dato de lectura
    expect(fuente).toContain('setError("Selecciona la unidad / placa.")');
    expect(fuente).toContain("if (exigeEstacion && !estacionId)");
  });
});

describe("selector buscable de unidad", () => {
  const opciones = opcionesVehiculo(vehiculos);
  it("encuentra por placa (sin distinguir mayúsculas ni guiones de más)", () => {
    expect(ids(filtrarOpcionesBusqueda(opciones, "c-123"))).toEqual(["7"]);
    expect(ids(filtrarOpcionesBusqueda(opciones, "xyz"))).toEqual(["8"]);
  });
  it("encuentra por descripción y por varias palabras", () => {
    expect(ids(filtrarOpcionesBusqueda(opciones, "hilux"))).toEqual(["8"]);
    expect(ids(filtrarOpcionesBusqueda(opciones, "camion toneladas"))).toEqual(["7"]);
    expect(filtrarOpcionesBusqueda(opciones, "inexistente")).toEqual([]);
  });
  it("se muestra «Placa · descripción», el valor es el ID real y la unidad sin descripción no rompe", () => {
    expect(etiquetaOpcion(opciones[0])).toBe("C-123ABC · Camión 5 toneladas");
    expect(opciones[0].value).toBe("7");
    expect(etiquetaOpcion(opciones[2])).toBe("M-789QRS");
  });
  it("conserva la unidad histórica fuera del catálogo y no agrega otras", () => {
    const con = opcionesVehiculo(vehiculos, { id: 99, placa: "OLD-1" });
    expect(con[0]).toEqual({ value: "99", label: "OLD-1 (histórico)" });
    expect(con).toHaveLength(vehiculos.length + 1);
    expect(opcionesVehiculo(vehiculos, { id: 7, placa: "C-123ABC" })).toHaveLength(vehiculos.length); // ya está: sin duplicar
  });
});

describe("selector buscable de estación", () => {
  const opciones = opcionesEstacion(estaciones);
  it("se ve «Estación · Proveedor» sin IDs técnicos", () => {
    expect(opciones.map(etiquetaOpcion)).toEqual(["Shell Roosevelt · Shell", "Estación Mixco · Shell", "Estación Roosevelt · Puma"]);
    for (const o of opciones) expect(etiquetaOpcion(o)).not.toMatch(/#|\bid\b/i);
  });
  it("encuentra por nombre de estación", () => {
    expect(ids(filtrarOpcionesBusqueda(opciones, "mixco"))).toEqual(["56"]);
    expect(ids(filtrarOpcionesBusqueda(opciones, "roosevelt")).sort()).toEqual(["55", "70"]);
  });
  it("encuentra por proveedor", () => {
    expect(ids(filtrarOpcionesBusqueda(opciones, "puma"))).toEqual(["70"]);
    expect(ids(filtrarOpcionesBusqueda(opciones, "shell")).sort()).toEqual(["55", "56"]);
  });
  it("encuentra por dirección / referencia", () => {
    expect(ids(filtrarOpcionesBusqueda(opciones, "zona 11"))).toEqual(["70"]);
    expect(ids(filtrarOpcionesBusqueda(opciones, "km 12"))).toEqual(["55"]);
  });
  it("histórico: conserva la estación anterior (por su nombre) aunque ya no esté activa", () => {
    const con = opcionesEstacion(estaciones, { id: 12, nombre: "Gasolinera cerrada" });
    expect(con[0]).toEqual({ value: "12", label: "Gasolinera cerrada (histórico)" });
    expect(opcionesEstacion(estaciones, { id: 55, nombre: "Shell Roosevelt" })).toHaveLength(estaciones.length);
    expect(opcionesEstacion(estaciones, { id: 12, nombre: null })[0].label).toBe("Estación anterior (histórico)");
  });
});

describe("diagnóstico de producción (solo lectura, sin ejecutar)", () => {
  it("el script de diagnóstico solo contiene SELECT/SHOW (nunca DDL ni DML)", () => {
    const crudo = readFileSync("sql/diagnostico-2026-10-combustibles-estaciones-guardado.sql", "utf8");
    const sqlDiag = crudo.replace(/--[^\n]*/g, "").replace(/SHOW CREATE TABLE/gi, "SHOW TABLA");
    expect(sqlDiag).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REPLACE|CALL)\b/i);
    expect(crudo).toMatch(/SHOW CREATE TABLE flota_combustible_estaciones/);
  });
  it("no se agregó SQL de migración en este ajuste (sin esquema nuevo)", () => {
    const migraciones = ["sql/migrate-2026-10-combustibles-estaciones.sql", "sql/migrate-2026-10-combustibles-c1.sql"].map(f => readFileSync(f, "utf8")).join("\n");
    expect(migraciones).not.toMatch(/proveedor_id\s+INT\s+NOT\s+NULL[^,]*DEFAULT/i);
  });
});
