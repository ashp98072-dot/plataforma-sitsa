import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ATRACCION-TALENTO-1 (sección 7-8 y 11 del ticket) — verificación por
 * código fuente (mismo criterio que app-shell-operaciones.test.ts: es un
 * client component grande con fetch/estado, sin harness de render en este
 * repo). El backend (PATCH /entrevistas/[id]) NO se tocó — ver
 * entrevistas-identidad-api.test.ts para la cobertura de edición de
 * campos/estado/resultado/documentos ya existente.
 */
const src = readFileSync("src/components/rrhh/entrevistas-page-client.tsx", "utf8");

describe("botón 'Editar' explícito en el panel DÍA SELECCIONADO", () => {
  it("8/11) existe un botón visible 'Editar' que llama abrirEditar(ent)", () => {
    expect(src).toMatch(/onClick=\{\(\) => abrirEditar\(ent\)\}[\s\S]{0,20}>\s*Editar\s*</);
  });

  it("12) abrirEditar carga TODOS los campos editables en el formulario (identidad, contacto, puesto, fecha/hora, modalidad, lugar, entrevistador, estado, resultado, notas)", () => {
    const fn = src.slice(src.indexOf("function abrirEditar"), src.indexOf("const debeIncluirIdentidad"));
    for (const campo of [
      "primerNombre:", "primerApellido:", "candidatoTelefono:", "candidatoEmail:",
      "puesto:", "fecha:", "hora:", "entrevistadorEmpleadoId:", "modalidad:",
      "lugarOEnlace:", "estado:", "resultado:", "notas:",
    ]) {
      expect(fn).toContain(campo);
    }
  });

  it("18) cambiar la fecha mueve la entrevista: fechaHora se reconstruye de form.fecha/form.hora en cada guardado (PATCH)", () => {
    expect(src).toContain("fechaHora: `${form.fecha}T${form.hora}`");
  });

  it("17) los documentos existentes se conservan: EntrevistaDocumentos se monta con el mismo entrevistaId mientras se edita, nunca se borra al editar", () => {
    expect(src).toContain("<EntrevistaDocumentos slug={slug} entrevistaId={editandoId} />");
    expect(src).not.toMatch(/borrarDocumento|eliminarDocumento(s)?\(/);
  });

  it("después de guardar: recarga (cargar()), sale de modo edición (setEditandoId(null)) y muestra mensaje de éxito", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    expect(submit).toContain("setEditandoId(null)");
    expect(submit).toContain("await cargar()");
    expect(submit).toContain("setMsg(data.mensaje");
  });
});
