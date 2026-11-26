import { describe, expect, it } from "vitest";
import { logoDeEmpresa } from "./logo-comprobante";

describe("logo del comprobante", () => {
  it("la empresa kt-monaco sin logo_url usa el logo de marca Logiservicios Mónaco incrustado (data URI PNG)", () => {
    const logo = logoDeEmpresa({ id: 1, slug: "kt-monaco", logoUrl: null });
    expect(logo).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  });
  it("una empresa sin logo propio ni de marca no toma el de otra ni el de Novalvion: devuelve null", () => {
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: null })).toBeNull();
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "   " })).toBeNull();
  });
  it("un logo_url que apunta al directorio de OTRA empresa o con rutas peligrosas se ignora (no se lee fuera de uploads)", () => {
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "empresas/8/logo.png" })).toBeNull();
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "../../etc/passwd" })).toBeNull();
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "a\0b.png" })).toBeNull();
  });
});
