import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Igual que otros tests de contrato UI del repo: no se añade un runtime DOM.
const fuente = readFileSync(resolve(process.cwd(), "src/components/proveedores/portales-proveedores-client.tsx"), "utf8");

describe("contrato del formulario de proveedores", () => {
  it("creación omite id cero y no Admin omite asignación", () => {
    expect(fuente).toContain("id: form.id || undefined");
    expect(fuente).toContain("asignadoUsuarioId: puedeAdministrar ? form.asignadoUsuarioId : undefined");
  });
  it("permite mostrar/ocultar y copiar sin persistir credenciales", () => {
    expect(fuente).toContain('type={mostrarPassword ? "text" : "password"}');
    expect(fuente).toContain('copiar(form.password, "Contraseña")');
    expect(fuente).toContain("navigator.clipboard.writeText(valor)");
    expect(fuente).not.toMatch(/localStorage|sessionStorage/);
  });
  it("limpia formulario y visibilidad después de guardar y presenta el error seguro", () => {
    const guardar = fuente.slice(fuente.indexOf("async function guardar"), fuente.indexOf("function editar"));
    expect(guardar.indexOf("if (!res.ok)")).toBeLessThan(guardar.indexOf("...FORM_INICIAL"));
    expect(guardar).toContain("...FORM_INICIAL");
    expect(guardar).toContain("setMostrarPassword(false)");
    expect(guardar).toContain('setError(body.error ?? "No se pudo guardar.")');
    expect(fuente).toContain('password: ""');
  });
});
