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

  it("12) abrirEditar carga TODOS los campos editables en el formulario (identidad, contacto, puesto, fecha/hora, modalidad, lugar, entrevistador/auxiliar, estado, resultado, notas)", () => {
    const fn = src.slice(src.indexOf("function abrirEditar"), src.indexOf("const debeIncluirIdentidad"));
    for (const campo of [
      "primerNombre:", "primerApellido:", "candidatoTelefono:", "candidatoEmail:",
      "puesto:", "fecha:", "hora:", "entrevistadorUsuarioId:", "auxiliarUsuarioId:", "modalidad:",
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

describe("ATRACCION-TALENTO-2 — catálogo de usuarios elegibles como entrevistador/auxiliar", () => {
  it("usa /rrhh/entrevistas/usuarios (no el catálogo de empleados ni el endpoint general de empleados)", () => {
    expect(src).toContain("/api/empresas/${slug}/rrhh/entrevistas/usuarios");
    expect(src).not.toContain("/api/empresas/${slug}/rrhh/entrevistas/entrevistadores");
    expect(src).not.toContain("/api/empresas/${slug}/empleados?estado=Activo");
  });
  it("lee data.usuarios de la respuesta", () => {
    expect(src).toContain("data.usuarios ?? []");
  });
  it("usa /rrhh/entrevistas/puestos para el catálogo real de puestos", () => {
    expect(src).toContain("/api/empresas/${slug}/rrhh/entrevistas/puestos");
    expect(src).toContain("data.puestos ?? []");
  });
  it("el formulario tiene dos UsuarioEntrevistaPicker: entrevistador principal y auxiliar (opcional)", () => {
    const ocurrencias = src.split("<UsuarioEntrevistaPicker").length - 1;
    expect(ocurrencias).toBe(2);
    expect(src).toContain('label="Entrevistador principal"');
    expect(src).toContain('label="Auxiliar de entrevista (opcional)"');
  });
  it("cambiar el entrevistador principal marca entrevistadorTocado (para no pisar el histórico al editar otro campo)", () => {
    const bloque = src.slice(src.indexOf('label="Entrevistador principal"') - 400, src.indexOf('label="Entrevistador principal"'));
    expect(bloque).toContain("setEntrevistadorTocado(true)");
  });
});

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — reselección al reprogramar", () => {
  it("usa el helper puro calcularPeriodoTrasGuardar para decidir si cambió el mes/año (no duplica la lógica inline)", () => {
    expect(src).toContain('from "@/lib/rrhh/entrevista-form"');
    expect(src).toContain("calcularPeriodoTrasGuardar(");
  });

  it("1) diaSel se actualiza a la fecha recién guardada (form.fecha), tanto si cambia de mes como si no", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    expect(submit).toContain("const nuevoDiaSel = form.fecha;");
    expect(submit).toContain("setDiaSel(nuevoDiaSel);");
  });

  it("2) si cambió el período (mes/año), setAnio/setMes se actualizan y NO se llama cargar() manualmente (evita doble carga)", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    const ramaCambio = submit.slice(submit.indexOf("if (periodo.cambioPeriodo)"), submit.indexOf("} else {"));
    expect(ramaCambio).toContain("setAnio(periodo.anio);");
    expect(ramaCambio).toContain("setMes(periodo.mes);");
    expect(ramaCambio).not.toContain("await cargar()");
  });

  it("si NO cambió el período, se llama cargar() manualmente (mismo mes ya cargado, sin refetch automático por deps)", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    const ramaSinCambio = submit.slice(submit.indexOf("} else {"), submit.lastIndexOf("}"));
    expect(ramaSinCambio).toContain("await cargar();");
  });

  it("3/4) el formulario se resetea a la nueva fecha sin perder candidato/documentos/expediente (EntrevistaDocumentos y ExpedienteCandidato siguen atados a editandoId/expedienteId, no al formulario)", () => {
    expect(src).toContain('<EntrevistaDocumentos slug={slug} entrevistaId={editandoId} />');
    expect(src).toContain("setForm({ ...vacio(), fecha: nuevoDiaSel });");
  });
});

describe("ATRACCION-TALENTO-2 (secciones 3, 15) — compatibilidad histórica y reordenamiento del formulario", () => {
  it("15) abrirEditar solo detecta histórico cuando entrevistadorUsuarioId es null Y entrevistadorEmpleadoId no lo es (usuario > empleado histórico)", () => {
    const fn = src.slice(src.indexOf("function abrirEditar"), src.indexOf("setForm({\n      id: ent.id"));
    expect(fn).toContain("ent.entrevistadorUsuarioId == null && ent.entrevistadorEmpleadoId != null");
  });

  it("18) editar SOLO otros campos (no tocar el picker) nunca manda entrevistadorUsuarioId en el PATCH — no se limpia el histórico", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    expect(submit).toContain("(!editandoId || entrevistadorTocado) ? { entrevistadorUsuarioId: form.entrevistadorUsuarioId || null } : {}");
  });

  it("crear SIEMPRE manda entrevistadorUsuarioId (puede ser null = sin entrevistador)", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    expect(submit).toContain("!editandoId ||");
  });

  it("auxiliarUsuarioId siempre se manda (crear y editar) — sin equivalente histórico que proteger", () => {
    const submit = src.slice(src.indexOf("async function onSubmit"), src.indexOf("async function cambiarEstadoRapido"));
    expect(submit).toContain("auxiliarUsuarioId: form.auxiliarUsuarioId || null,");
  });

  it("15) orden del formulario: IDENTIDAD, CONTACTO, DATOS DE ENTREVISTA, EVALUACIÓN, DOCUMENTOS (sin cambiar funcionalidad)", () => {
    const orden = ["IDENTIDAD DEL CANDIDATO", "CONTACTO", "DATOS DE ENTREVISTA", "EVALUACIÓN", "DOCUMENTOS"].map((s) => src.indexOf(s));
    for (let i = 1; i < orden.length; i++) expect(orden[i]).toBeGreaterThan(orden[i - 1]);
  });
});

describe("ATRACCION-TALENTO-2 (sección 13) — catálogo real de puestos + Otro puesto", () => {
  it("el select de puesto ofrece el catálogo real y una opción 'Otro puesto…'", () => {
    const bloque = src.slice(src.indexOf("DATOS DE ENTREVISTA"), src.indexOf("</fieldset>", src.indexOf("DATOS DE ENTREVISTA")));
    expect(bloque).toContain("puestos.map((p)");
    expect(bloque).toContain("Otro puesto…");
  });

  it("al editar, si el puesto guardado no está en el catálogo, se abre en modo texto libre sin perder el valor (setPuestoOtro(!puestos.includes(ent.puesto)))", () => {
    const fn = src.slice(src.indexOf("function abrirEditar"), src.indexOf("setForm({\n      id: ent.id"));
    expect(fn).toContain("setPuestoOtro(!puestos.includes(ent.puesto));");
  });
});

describe("ATRACCION-TALENTO-2 (sección 9) — entrevistador/auxiliar visibles en el panel DÍA SELECCIONADO", () => {
  it("usa resolverEntrevistadorMostrado (precedencia usuario > empleado histórico) y no imprime línea vacía si no hay entrevistador", () => {
    expect(src).toContain("resolverEntrevistadorMostrado(ent)");
    expect(src).toContain('if (mostrado.tipo === "ninguno") return null;');
  });
  it("muestra 'Auxiliar: <nombre>' solo cuando existe auxiliarUsuarioNombre", () => {
    expect(src).toContain("{ent.auxiliarUsuarioNombre ? (");
    expect(src).toContain("Auxiliar: {ent.auxiliarUsuarioNombre}");
  });
  it("etiqueta 'Histórico · empleado' cuando el entrevistador mostrado viene del empleado histórico", () => {
    expect(src).toContain('mostrado.tipo === "empleado_historico"');
    expect(src).toContain("Histórico · empleado");
  });
});
