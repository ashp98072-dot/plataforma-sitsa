import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantCalendario: vi.fn() }));
import { CalendarioContable, CalendarioLibro, FormularioCalendario, ErrorConsultaPeriodos } from "@/components/contabilidad/calendario-contable";
import CalendarioPage from "@/app/e/[slug]/contabilidad/calendario/page";
import { requireTenantCalendario } from "@/lib/tenant";
describe("C3C-1: render y permisos de pantalla, sin fetch ni BD", () => {
  it('reinicia el selector por identidad de empresa; render inicial cargando y sin opciones previas',()=>{
    const a=CalendarioContable({slug:'lab-a',puedeCrear:false});
    const b=CalendarioContable({slug:'lab-b',puedeCrear:false});
    expect(a.key).toBe('lab-a');expect(b.key).toBe('lab-b');
    const html=renderToStaticMarkup(b);expect(html).toContain('Cargando libros contables');expect(html).toContain('disabled');
    // Contrato estático: no acredita ejecución de efectos ni interacción DOM.
  });
  it("error de períodos ofrece reintento independiente del formulario", () => {
    const reintentar = vi.fn();
    const vista = ErrorConsultaPeriodos({ error: "Fallo ficticio", cargando: false, reintentar })!;
    expect(renderToStaticMarkup(vista)).toContain("Reintentar consulta de períodos");
    vista.props.children[1].props.onClick();
    expect(reintentar).toHaveBeenCalledOnce();
    expect(ErrorConsultaPeriodos({ error: "", cargando: false, reintentar })).toBeNull();
  });
  it("muestra alcance CONFIGURADO y selector de libro", () => {
    const html = renderToStaticMarkup(createElement(CalendarioContable, { slug: "ficticio", puedeCrear: false }));
    expect(html).toContain("Configurar el calendario no activa el control de períodos");
    expect(html).toContain("Libro contable");
    expect(html).not.toContain("<form");
  });
  it("lectura no contiene formulario ni acciones de creación", () => {
    const html = renderToStaticMarkup(createElement(CalendarioLibro, { slug: "ficticio", entidadId: 9, puedeCrear: false }));
    expect(html).not.toContain("<form"); expect(html).not.toContain("Guardar calendario");
  });
  it("formulario permite límites explícitos y agregar períodos sin aperturas/cierres", () => {
    const html = renderToStaticMarkup(createElement(FormularioCalendario, { url: "/ficticio", alCrear: vi.fn() }));
    for (const texto of ["Código del ejercicio", "Inicio del ejercicio", "Fin del ejercicio", "Período 1", "Agregar período", "Guardar calendario configurado"]) expect(html).toContain(texto);
    expect(html.match(/type="date"/g)).toHaveLength(4);
    expect(html).not.toContain("Cerrar período"); expect(html).not.toContain("Abrir ejercicio");
  });
  it("la página exige guard propio y pasa solo capacidad efectiva de crear", async () => {
    const guard = vi.mocked(requireTenantCalendario);
    guard.mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const denied = await CalendarioPage({ params: Promise.resolve({ slug: "ficticio" }) });
    expect(renderToStaticMarkup(denied)).toContain("Sin acceso");
    guard.mockResolvedValueOnce({ empresa: { id: 7 }, session: { id: 4 } } as never).mockResolvedValueOnce({ error: new Response(null, { status: 403 }) } as never);
    const page = await CalendarioPage({ params: Promise.resolve({ slug: "ficticio" }) });
    expect(page.props).toMatchObject({ slug: "ficticio", puedeCrear: false });
  });
});
