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
  it("2) sin foto (tieneFoto=false): iniciales directas, NO se renderiza <img> ni se solicita el endpoint /foto", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "sitsa", empleadoId: 7, nombre: "Ana Gómez", ampliable: true, compacta: true, tieneFoto: false }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/foto");
    expect(html).not.toContain("<button"); // sin imagen no hay ampliación
    expect(html).toContain("Sin fotografía de Ana Gómez");
    expect(html).toContain(">AG<");
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("rounded-full");
  });
  it("2b) con foto explícita (tieneFoto=true) y sin dato (undefined): igual que antes, misma URL privada", () => {
    for (const tieneFoto of [true, undefined]) {
      const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "sitsa", empleadoId: 7, nombre: "Ana Gómez", ampliable: true, compacta: true, tieneFoto }));
      expect(html).toContain('src="/api/empresas/sitsa/empleados/7/foto"');
      expect(html).toContain("Ampliar fotografía de Ana Gómez");
      expect(html).not.toContain("Sin fotografía de");
    }
  });
  it("2c) onError se conserva solo como red de seguridad (archivo ausente/ilegible); una imagen fallida nunca abre ampliación", () => {
    const f = leer("src/components/rrhh/foto-empleado-miniatura.tsx");
    expect(f).toContain("onError={() => setFallida(src)}");
    expect(f).toContain("tieneFoto === false || fallida === src");
    expect(f).toContain("tieneFoto !== false && fallida !== src");
  });
  it("3) ampliación: reutiliza FotoAmpliada del dashboard (no crea otro modal); clic no dispara el doble clic/expediente de la fila", () => {
    const f = leer("src/components/rrhh/foto-empleado-miniatura.tsx");
    expect(f).toContain('import { FotoAmpliada } from "@/components/rrhh/detalle-movimientos-mensual"');
    expect(f).toContain("onClick={(ev) => { ev.stopPropagation(); setAmpliada(true); }}");
    // doble clic sobre la foto no debe subir al <tr onDoubleClick> (expediente)
    expect(f).toContain("onDoubleClick={(ev) => ev.stopPropagation()}");
    expect(page).toContain("onDoubleClick={() => setDocsEmp(e)}"); // el resto de la fila sigue abriendo el expediente
    expect(f).not.toContain("createPortal");
  });
  it("sin ampliable (Planillas) el componente es igual que antes: sin botón", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "s", empleadoId: 1, nombre: "A B" }));
    expect(html).not.toContain("<button");
    expect(html).toContain("h-10 w-10");
  });
  it("4) sin N+1: listarEmpleados determina tieneFoto con UNA consulta en lote (no una por empleado) y la página la pasa a la miniatura", () => {
    const e = leer("src/lib/rrhh/empleados.ts");
    expect(e).toContain("contarDocumentosPorEmpleado(");
    expect(e).toContain("empleadosConFoto(");
    expect(e.match(/empleadosConFoto\(/g)).toHaveLength(1);
    expect(e).toContain("e.tieneFoto = conFoto.has(e.id)");
    expect(page).toContain("<FotoEmpleadoMiniatura slug={slug} empleadoId={e.id} nombre={e.nombre} tieneFoto={e.tieneFoto} ampliable compacta usarMiniatura />");
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
  it("listado usa derivado lazy; ampliación y ficha conservan original", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "s", empleadoId: 7, nombre: "Ana", usarMiniatura: true, ampliable: true }));
    expect(html).toContain('src="/api/empresas/s/empleados/7/foto/miniatura"');
    expect(html).toContain('loading="lazy"');
    expect(leer("src/components/rrhh/foto-empleado-miniatura.tsx")).toContain("<FotoAmpliada src={originalSrc}");
    expect(leer("src/components/rrhh/foto-empleado-miniatura.tsx")).toContain("usarMiniatura = false");
    expect(page).toContain('`/api/empresas/${slug}/empleados/${editId}/foto`');
  });
  it("sin foto no pide tampoco la miniatura", () => {
    const html = renderToStaticMarkup(createElement(FotoEmpleadoMiniatura, { slug: "s", empleadoId: 7, nombre: "Ana", usarMiniatura: true, tieneFoto: false }));
    expect(html).not.toContain("<img");
  });
  it("supervisores usa catálogo ligero independiente y mantiene etiquetas históricas", () => {
    expect(page).toContain("${slug}/empleados/supervisores");
    expect(page).not.toContain("${slug}/empleados?estado=Activo");
    expect(page).toContain("mergeSupervisorLabels(supervisores)");
    expect(page).toContain("supervisores.map((s) => s.id)");
    expect(page).toContain("supervisoresDisponibles.filter((s) => s.id !== editId");
  });
});
