import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const empleados = leer("src/app/e/[slug]/rrhh/empleados/page.tsx");
// ATRACCION-TALENTO-1: la UI real de Entrevistas se movió a este componente compartido
// (src/app/e/[slug]/rrhh/entrevistas/page.tsx ahora es solo un redirect — ver page.test.ts ahí).
const entrevistasPage = leer("src/components/rrhh/entrevistas-page-client.tsx");

describe("ALTA EMPLEADO desde entrevista aprobada (19-27)", () => {
  it("19-24) transfiere primerNombre, segundoNombre, tercer/cuartoNombre, primerApellido, segundoApellido, apellidoCasada", () => {
    for (const campo of ["primerNombre", "segundoNombre", "tercerNombre", "cuartoNombre", "primerApellido", "segundoApellido", "apellidoCasada"]) {
      expect(empleados).toContain(`${campo}: candidato.candidato${campo[0].toUpperCase()}${campo.slice(1)}`);
    }
  });
  it("25) nombre completo: se sigue componiendo con componerNombre/componerNombreCompleto al guardar", () => {
    expect(empleados).toContain("componerNombreCompleto");
    expect(empleados).toContain("formToBody(form)"); // formToBody ya recompone nombre si el campo libre está vacío
  });
  it("26) nombreManual queda false cuando la entrevista SÍ trae identidad estructurada", () => {
    expect(empleados).toContain("nombreManual: !tieneEstructura");
    expect(empleados).toContain("tieneIdentidadEstructurada(");
  });
  it("27) entrevista histórica (sin estructura) mantiene el fallback: nombre = candidatoNombre, nombreManual = true", () => {
    expect(empleados).toContain("nombre: candidato.candidatoNombre");
    // tieneEstructura=false -> nombreManual: !false === true
  });
  it("muestra el aviso pedido cuando la entrevista es histórica sin estructura", () => {
    expect(empleados).toContain("El candidato proviene de una entrevista anterior sin nombres separados");
  });
  it("no bloquea el alta si faltan campos estructurados (solo avisa)", () => {
    // El componente sigue permitiendo continuar (setVista("ficha")) sin importar tieneEstructura.
    const bloque = empleados.slice(empleados.indexOf("tieneEstructura"), empleados.indexOf('setVista("ficha")') + 20);
    expect(bloque).not.toMatch(/return;/);
  });
});

describe("UI — rediseño de la pantalla de Entrevistas (28-36)", () => {
  it("28) calendario y listado del día siguen presentes", () => {
    expect(entrevistasPage).toContain("diasDelMes.map");
    expect(entrevistasPage).toContain("entrevistasDelDia.map");
  });
  it("29) botón Hoy presente y navega al día actual", () => {
    expect(entrevistasPage).toContain("onClick={irAHoy}");
    expect(entrevistasPage).toContain("function irAHoy()");
  });
  it("30) día seleccionado se resalta y se muestra", () => {
    expect(entrevistasPage).toContain("aria-pressed={diaSel === diaIso}");
    expect(entrevistasPage).toContain("DÍA SELECCIONADO");
  });
  it("31) nueva entrevista hereda la fecha del día seleccionado", () => {
    expect(entrevistasPage).toContain("abrirNueva(diaSel)");
    expect(entrevistasPage).toContain("fecha: diaIso ?? vacio().fecha");
  });
  it("32) seleccionar una entrevista llena el formulario (único estado, reutilizado)", () => {
    expect(entrevistasPage).toContain("function abrirEditar(ent: Entrevista)");
    expect(entrevistasPage).toContain("onClick={() => abrirEditar(ent)}");
  });
  it("33) cancelar limpia la edición", () => {
    expect(entrevistasPage).toContain("function cancelarEdicion()");
    expect(entrevistasPage).toContain("onClick={cancelarEdicion}");
  });
  it("34) secciones Identidad/Contacto/Entrevista/Evaluación/Documentos, todas presentes", () => {
    for (const seccion of ["IDENTIDAD DEL CANDIDATO", "CONTACTO", "DATOS DE ENTREVISTA", "EVALUACIÓN", "DOCUMENTOS"]) {
      expect(entrevistasPage).toContain(seccion);
    }
  });
  it("35) estado/resultado visibles en el formulario al editar (no solo en la lista)", () => {
    expect(entrevistasPage).toContain('value={form.estado}');
    expect(entrevistasPage).toContain('value={form.resultado}');
  });
  it("36) 'Crear empleado' sigue disponible cuando el resultado es Aprobado, dentro y fuera del formulario", () => {
    const ocurrencias = entrevistasPage.split("Crear empleado").length - 1;
    expect(ocurrencias).toBeGreaterThanOrEqual(2); // lista del día + sección de la entrevista seleccionada
    expect(entrevistasPage).toContain('href={`/e/${slug}/rrhh/empleados?entrevista=${editandoId}`}');
  });
  it("layout desktop: calendario 2/3, día seleccionado 1/3", () => {
    expect(entrevistasPage).toContain("lg:grid-cols-3");
    expect(entrevistasPage).toContain("lg:col-span-2");
  });
  it("responsive: el grid se apila en móvil (grid-cols-1 por defecto)", () => {
    expect(entrevistasPage).toContain("grid-cols-1 gap-4 lg:grid-cols-3");
  });
});

describe("AJUSTE PR #375 — protección adicional en el formulario de Entrevistas", () => {
  it("usa el helper puro entrevista-form.ts para decidir/validar la identidad (no duplica la lógica inline)", () => {
    expect(entrevistasPage).toContain('from "@/lib/rrhh/entrevista-form"');
    expect(entrevistasPage).toContain("construirIdentidadPatch(");
    expect(entrevistasPage).toContain("calcularDebeIncluirIdentidad(");
  });
  it("los inputs de primer nombre/apellido solo son required cuando debeIncluirIdentidad es true (no bloquean el guardado nativo del navegador en históricos)", () => {
    expect(entrevistasPage).toContain('required={debeIncluirIdentidad}');
  });
  it("guardando se protege con try/catch/finally: nunca queda en true si fetch falla o la respuesta no es JSON", () => {
    const inicio = entrevistasPage.indexOf("async function onSubmit");
    const fin = entrevistasPage.indexOf("\n  }", entrevistasPage.indexOf("finally {", inicio));
    const bloque = entrevistasPage.slice(inicio, fin);
    expect(bloque).toContain("try {");
    expect(bloque).toContain("} catch {");
    expect(bloque).toContain("} finally {");
    expect(bloque).toContain("setGuardando(false);");
  });
  it("entrevistaCargadaSinEstructura se fija al ABRIR (abrirEditar), no se recalcula en cada tecla", () => {
    expect(entrevistasPage).toContain("setEntrevistaCargadaSinEstructura(!tieneIdentidadEstructurada({");
  });
});
