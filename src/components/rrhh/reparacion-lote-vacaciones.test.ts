import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReparacionLoteVacaciones } from "./reparacion-lote-vacaciones";

const fuente = readFileSync(new URL("./reparacion-lote-vacaciones.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./pendientes-reparacion-vacaciones.tsx", import.meta.url), "utf8");
const pagina = readFileSync(new URL("../../app/e/[slug]/rrhh/vacaciones/page.tsx", import.meta.url), "utf8");

describe("Reparación por lote — UI", () => {
  it("al abrirse solo calcula la vista previa: sin botón de confirmar ni resultado, y nada se ejecuta", () => {
    const m = renderToStaticMarkup(createElement(ReparacionLoteVacaciones, { slug: "empresa-sintetica", onCerrar: () => {}, onTerminado: () => {} }));
    expect(m).toContain("Calculando vista previa");
    expect(m).not.toContain("Confirmar reparación");
    expect(m).not.toContain("Resultado del lote");
    expect(m).toContain("role=\"dialog\"");
  });

  it("solo UN fetch con método POST (el botón de confirmar), con confirmar:true y únicamente ids + huellas de los ELEGIBLES; la vista previa es GET", () => {
    expect(fuente.match(/method: "POST"/g)).toHaveLength(1);
    expect(fuente).toContain("confirmar: true, empleados: elegibles.map((f) => ({ empleadoId: f.empleadoId, huella: f.huella }))");
    expect(fuente).toContain("f.estado === \"ELEGIBLE\" && f.huella");
    expect(fuente).not.toMatch(/empresa_?id/i);
    const efectos = fuente.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    expect(efectos.every((e) => !e.includes("method") && !e.includes("confirmar()"))).toBe(true);
  });

  it("muestra el resumen, la tabla pedida y la advertencia aprobada; el botón dice «Confirmar reparación de X colaboradores»", () => {
    for (const t of [
      "Pendientes:", "Elegibles:", "Bloqueados:", "Sin cambios:", "Empleado", "Código", "Fecha de contratación", "Motivos actuales", "Períodos actuales", "Períodos propuestos",
      "Saldo antes", "Saldo después", "Consumo preservado", "Bloqueos", "Estado", "No reparado — requiere revisión manual",
      "Se reconstruirán los períodos de vacaciones de {elegibles.length} colaborador(es) usando la fecha de contratación actual de cada uno.",
      "No se modifica la fecha de contratación. No se modifican incidencias, vacaciones ni evidencias. Los colaboradores bloqueados no serán modificados.",
      "Confirmar reparación de ${elegibles.length} colaboradores",
      "Reparados correctamente:", "Cambió desde vista previa:", "Ya no requerían reparación:", "Errores inesperados:", "Empleado</th><th className=\"pr-3\">Resultado</th><th>Mensaje",
    ]) expect(fuente).toContain(t);
  });

  it("el botón de confirmar solo existe con elegibles y se deshabilita mientras se ejecuta; se refresca todo al terminar", () => {
    expect(fuente).toContain("{elegibles.length > 0 ? (");
    expect(fuente).toContain("disabled={ejecutando || cargando}");
    expect(fuente).toContain("await onTerminado();");
    expect(fuente).toContain("await cargarPrevia();");
  });

  it("el panel de pendientes ofrece «Revisar reparación de pendientes» y la página refresca empleado, saldo e historial al terminar", () => {
    expect(panel).toContain("Revisar reparación de pendientes");
    expect(panel).toContain("setLoteAbierto(true)");
    expect(panel).toContain("if (lista.length === 0 && !loteAbierto) return null;");
    expect(pagina).toContain("onLoteTerminado={async () => { await cargar(); setVersionReparacion((v) => v + 1); }}");
  });
});
