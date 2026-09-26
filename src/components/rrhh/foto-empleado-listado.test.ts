import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FotoEmpleadoMiniatura } from "./foto-empleado-miniatura";

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const page = leer("src/app/e/[slug]/rrhh/empleados/page.tsx");

describe("RRHH Empleados — foto en el listado", () => {
  it("1) con foto: miniatura 32px, circular, object-cover, ampliable, misma URL privada", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "sitsa", empleadoId: 7, nombre: "Ana Gómez", ampliable: true, compacta: true }));
    expect(html).toContain('src="/api/empresas/sitsa/empleados/7/foto"');
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("rounded-full");
    expect(html).toContain("object-cover");
    expect(html).toContain("Ampliar fotografía de Ana Gómez");
    expect(html).not.toContain("Ampliar fotografía de Ana Gómez</");
  });
  it("2) sin foto: el mismo componente cae a iniciales (onError → 'Sin fotografía de'), sin modal", () => {
    const f = leer("src/components/rrhh/foto-empleado-miniatura.tsx");
    expect(f).toContain("onError={() => setFallida(src)}");
    expect(f).toContain("Sin fotografía de");
    expect(f).toContain("fallida !== src"); // una imagen fallida nunca abre ampliación
  });
  it("3) ampliación: reutiliza FotoAmpliada del dashboard (no crea otro modal); clic no dispara el doble clic/expediente de la fila", () => {
    const f = leer("src/components/rrhh/foto-empleado-miniatura.tsx");
    expect(f).toContain('import { FotoAmpliada } from "@/components/rrhh/detalle-movimientos-mensual"');
    expect(f).toContain("ev.stopPropagation()");
    expect(f).not.toContain("createPortal");
  });
  it("sin ampliable (Planillas) el componente es igual que antes: sin botón", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "s", empleadoId: 1, nombre: "A B" }));
    expect(html).not.toContain("<button");
    expect(html).toContain("h-10 w-10");
  });
  it("4) sin N+1: listarEmpleados no cambia (una consulta + conteo de docs en lote) y no trae foto", () => {
    const e = leer("src/lib/rrhh/empleados.ts");
    expect(e).toContain("contarDocumentosPorEmpleado(");
    expect(e).not.toMatch(/foto/i);
    expect(page).toContain("<FotoEmpleadoMiniatura slug={slug} empleadoId={e.id} nombre={e.nombre} ampliable compacta />");
  });
  it("5-7) tabla: columna Foto al inicio y el resto de columnas y celdas intactas", () => {
    const orden = ["Foto", "Código", "Nombre", "Puesto", "Contrato", "Pago", "Área", "Entrada lab.", "Contratación", "Horario", "Estado", "Docs"];
    const idx = orden.map((t) => page.indexOf(`>${t}</th>`));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(page).toContain("{mostrarDpi ? <th");
    expect(page).toContain("onDoubleClick={() => setDocsEmp(e)}");
  });
  it("8) exportaciones Excel/PDF no mencionan la miniatura", () => {
    for (const p of ["src/app/api/empresas/[slug]/empleados/export/route.ts", "src/lib/rrhh/empleados-export.ts"]) {
      expect(leer(p)).not.toContain("FotoEmpleadoMiniatura");
    }
  });
  it("9) tenant: el endpoint de foto sigue exigiendo tenant y busca el empleado por empresa", () => {
    const r = leer("src/app/api/empresas/[slug]/empleados/[id]/foto/route.ts");
    expect(r).toContain('requireTenantRrhh(slug, "empleados", "ver")');
    expect(r).toContain("obtenerEmpleado(guard.empresa.id, id)");
  });
});
