import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolverUnidadAnterior } from "@/app/e/[slug]/cotizaciones/page";

const page = readFileSync("src/app/e/[slug]/cotizaciones/page.tsx", "utf8").replace(/\r\n/g, "\n");
const pos = (texto: string) => { const i = page.indexOf(texto); expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1); return i; };

describe("Cotizaciones — rutas en un solo bloque", () => {
  it("ordena datos generales, rutas, presentación, condiciones y costeo", () => {
    const orden = ["A. Cliente y datos generales", "B. Rutas / viajes cotizados", "C. Presentación comercial", "D. Condiciones de servicio", "E. Costeo interno"].map(pos);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
  });

  it("Ruta 1 reúne origen, destino, unidad y precio", () => {
    const ruta1 = page.slice(pos("Ruta 1 · Origen"), pos("{form.lineasAdicionales.map"));
    for (const campo of ["form.origenTexto", "form.destinoTexto", "form.unidadDescripcion", "form.tarifaCotizada"]) expect(ruta1).toContain(campo);
  });

  it("presentación comercial ya no contiene unidad ni tarifa", () => {
    const presentacion = page.slice(pos("C. Presentación comercial"), pos("D. Condiciones de servicio"));
    expect(presentacion).not.toContain("form.unidadDescripcion");
    expect(presentacion).not.toContain("form.tarifaCotizada");
    for (const campo of ["Documento emitido por", "Atención a", "Cargo / referencia", "Mensaje para el cliente"]) expect(presentacion).toContain(campo);
  });

  it("rutas adicionales se agregan, editan y quitan inmutablemente", () => {
    expect(page).toContain("lineasAdicionales: [...f.lineasAdicionales, { ...LINEA_FORM_VACIA }]");
    expect(page).toContain("f.lineasAdicionales.map((l, i) => (i === indice ? { ...l, ...cambios } : l))");
    expect(page).toContain("f.lineasAdicionales.filter((_, i) => i !== indice)");
    expect(page).toContain("Ruta {i + 2} · Origen");
    expect(page).toContain("+ Agregar ruta");
    expect(page).toContain("Quitar ruta");
  });

  it("edición precarga Ruta 1 y todas las rutas 2+ sin activar sincronización histórica", () => {
    const editar = page.slice(pos("function editar(c: Cotizacion)"), pos("function agregarLinea"));
    for (const campo of ["origenTexto: c.origenTexto", "destinoTexto: c.destinoTexto", "unidadDescripcion: c.unidadDescripcion", "tarifaCotizada: String(c.tarifaCotizada)"]) expect(editar).toContain(campo);
    expect(editar).toContain("lineasAdicionales: (c.lineasAdicionales ?? []).map");
    expect(editar).toContain("usarUnidadAnterior: false");
  });

  it("misma unidad sigue la ruta anterior y al desactivarla conserva edición manual", () => {
    const lineas = [
      { origenTexto: "", destinoTexto: "", unidadDescripcion: "Cinco toneladas", tarifaCotizada: "1", usarUnidadAnterior: true },
      { origenTexto: "", destinoTexto: "", unidadDescripcion: "", tarifaCotizada: "1", usarUnidadAnterior: true },
      { origenTexto: "", destinoTexto: "", unidadDescripcion: "Panel", tarifaCotizada: "1", usarUnidadAnterior: false },
    ];
    expect(resolverUnidadAnterior("2.7 toneladas", lineas, 0)).toBe("2.7 toneladas");
    expect(resolverUnidadAnterior("2.7 toneladas", lineas, 1)).toBe("2.7 toneladas");
    expect(resolverUnidadAnterior("2.7 toneladas", lineas, 2)).toBe("2.7 toneladas");
    expect(resolverUnidadAnterior("2.7 toneladas", lineas, 3)).toBe("Panel");
    const bloque = page.slice(pos("Ruta {i + 2} · Origen"), pos("+ Agregar ruta"));
    expect(bloque).toContain("disabled={l.usarUnidadAnterior}");
    expect(bloque).toContain("Usar la misma unidad/camión de la ruta anterior");
  });

  it("ruta de catálogo precarga Ruta 1, incluida unidad recurrente cuando está vacía", () => {
    const aplicar = page.slice(pos("function aplicarRuta"), pos("async function guardar"));
    expect(aplicar).toContain('unidadDescripcion: f.unidadDescripcion || ruta.unidadRecurrentePlaca || ""');
  });

  it("mantiene IVA global dentro de rutas y persiste Ruta 1/Ruta 2+ con el modelo actual", () => {
    const rutas = page.slice(pos("B. Rutas / viajes cotizados"), pos("C. Presentación comercial"));
    expect(rutas.match(/La tarifa ya incluye IVA/g)).toHaveLength(1);
    const guardar = page.slice(pos("async function guardar"), pos("async function cambiarEstado"));
    expect(guardar).toContain("unidadDescripcion: form.unidadDescripcion.trim() || null");
    expect(guardar).toContain("lineasAdicionales,");
  });
});
