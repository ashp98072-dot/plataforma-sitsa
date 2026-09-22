import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");

describe("Formulario de Cotizaciones — «Mensaje para el cliente»", () => {
  const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
  const pos = (texto: string) => {
    const i = page.indexOf(texto);
    expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1);
    return i;
  };

  it("va después de Documento emitido por / Atención a / Cargo dentro de C. Presentación comercial", () => {
    const b = page.slice(pos("C. Presentación comercial"), pos("D. Condiciones de servicio"));
    const posEnB = (texto: string) => {
      const i = b.indexOf(texto);
      expect(i, `no se encontró dentro de B: ${texto}`).toBeGreaterThan(-1);
      return i;
    };
    const orden = ["Documento emitido por", "Atención a (opcional)", "Cargo / referencia (opcional)", "Mensaje para el cliente"].map(posEnB);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
    expect(b).toContain("Mensaje para el cliente");
  });

  it("es un textarea editable, limitado a 2000 caracteres, y viaja en el payload de crear/editar", () => {
    const campo = page.slice(pos("Mensaje para el cliente"), pos("Mensaje para el cliente") + 400);
    expect(campo).toContain("<textarea");
    expect(campo).toContain("maxLength={2000}");
    expect(campo).toContain("value={form.mensajeComercial}");
    expect(page).toContain("mensajeComercial: form.mensajeComercial.trim() || null,");
  });

  it("al elegir la marca, si el usuario NUNCA tocó el mensaje, se precarga en silencio con el default de esa marca", () => {
    const select = page.slice(pos('Documento emitido por'), pos('Atención a (opcional)'));
    expect(select).toContain("mensajeTocado ? f.mensajeComercial : (presentacion?.[marca]?.mensaje ?? f.mensajeComercial)");
  });

  it("una vez editado a mano (mensajeTocado), cambiar de marca NO lo pisa: se avisa qué mensaje se aplicaría, con un botón explícito para usarlo", () => {
    const aviso = page.slice(pos("Se aplicaría el mensaje predeterminado"), pos("Se aplicaría el mensaje predeterminado") + 500);
    expect(aviso).toContain("Usar este mensaje");
    expect(page).toContain('onChange={(e) => { setMensajeTocado(true); setForm((f) => ({ ...f, mensajeComercial: e.target.value })); }}');
  });

  it("editar una cotización guardada carga su propio mensaje y lo marca como tocado (no se sobreescribe si luego se cambia la marca)", () => {
    const editar = page.slice(pos("function editar(c: Cotizacion)"), pos("function aplicarRuta"));
    expect(editar).toContain("mensajeComercial: c.mensajeComercial ?? \"\",");
    expect(editar).toContain("setMensajeTocado(true);");
  });

  it("«Nueva cotización» reinicia mensajeTocado y precarga el default de la marca inicial, si ya está disponible", () => {
    const nueva = page.slice(pos("function nueva()"), pos("function editar(c: Cotizacion)"));
    expect(nueva).toContain("setMensajeTocado(false);");
    expect(nueva).toContain("presentacion?.[DOCUMENTO_EMISOR_DEFAULT]?.mensaje");
  });

  it("lee los defaults desde /tms/cotizaciones/presentacion (permiso base, no el de Ajustes)", () => {
    expect(page).toContain("/api/empresas/${slug}/tms/cotizaciones/presentacion");
  });

  it("el detalle de la lista muestra el mensaje guardado de esa cotización", () => {
    expect(page).toContain("Mensaje al cliente:");
    expect(page).toContain("{c.mensajeComercial ??");
  });

  it("el costeo interno nunca aparece cerca de este campo: sigue después de condiciones", () => {
    const orden = ["C. Presentación comercial", "D. Condiciones de servicio", "E. Costeo interno"].map(pos);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
  });
});

describe("Ajustes de cotizaciones — pestaña «Presentación comercial»", () => {
  const cliente = leer("src/components/tms/cotizacion-ajustes-client.tsx");

  it("agrega una tercera pestaña, sin quitar las dos existentes", () => {
    expect(cliente).toContain('setTab("parametros")');
    expect(cliente).toContain('setTab("perfiles")');
    expect(cliente).toContain('setTab("presentacion")');
    expect(cliente).toContain("Presentación comercial");
  });

  it("un formulario por marca, con mensaje introductorio y cierre; el placeholder es el texto fijo de esa marca", () => {
    expect(cliente).toContain("DOCUMENTOS_EMISOR.map(marca=>");
    expect(cliente).toContain("Mensaje introductorio predeterminado");
    expect(cliente).toContain("Cierre / despedida predeterminado");
    expect(cliente).toContain("placeholder={MARCAS_DOCUMENTO[marca].saludo}");
    expect(cliente).toContain("placeholder={MARCAS_DOCUMENTO[marca].cierre}");
  });

  it("guarda contra /tms/cotizaciones/ajustes/presentacion y deja los campos deshabilitados sin permiso de editar", () => {
    expect(cliente).toContain("/api/empresas/${slug}/tms/cotizaciones/ajustes/presentacion");
    expect(cliente).toContain("disabled={!puedeEditar}");
  });

  it("advierte que es solo plantilla: cambiar el default no toca cotizaciones ya guardadas", () => {
    expect(cliente).toMatch(/NO modifica las cotizaciones ya guardadas/);
  });
});
