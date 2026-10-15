import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CatalogoSearchSelect, filtrarOpcionesBusqueda, opcionesConHistorico } from "@/components/tms/catalogo-search-select";
import { CombustiblesClient } from "@/components/flota/combustibles-client";
import { CombustibleRegistro } from "@/components/flota/combustible-registro";
import { capacidadesCombustible } from "./combustible-permisos";
import { estacionesDelProveedor, estacionAlCambiarProveedor } from "./combustible-estaciones-ui";
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async original => ({ ...await original<typeof import("@/lib/permisos")>(), permisosEfectivos: vi.fn() }));
import { getSession } from "@/lib/session";
import { obtenerEmpresaPorSlug, empresasParaUsuario } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { cambiarAccion, VERSION_PERMISOS } from "@/lib/permisos-catalogo";
import type { PermisoModulo } from "@/lib/permisos-shared";
import NuevoValePage from "@/app/e/[slug]/combustibles/nuevo/page";
import { CombustibleNuevoClient } from "@/components/flota/combustible-nuevo-client";
const fila = (modulo: string, ver = true): PermisoModulo => ({ modulo, puedeVer: ver, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
const base = [fila(VERSION_PERMISOS), fila("flota_combustible")];
const empresa = { id: 7, slug: "kt", nombre: "KT", activa: true, modulos: ["tms"] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ id: 9, username: "op", rol: "JefeOperaciones", empresaId: 7 } as never);
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(empresa as never);
  vi.mocked(empresasParaUsuario).mockResolvedValue([empresa] as never);
  vi.mocked(permisosEfectivos).mockResolvedValue(base);
});
describe("captura separada y buscador reutilizado", () => {
  it("busca proveedor por fragmento/tildes y conserva ID real, nunca el texto como valor", () => {
    const opciones = [{ value: "3", label: "Shell Guatemala" }, { value: "5", label: "Puma Estación Central" }];
    expect(filtrarOpcionesBusqueda(opciones, "shel").map(o => o.value)).toEqual(["3"]);
    expect(filtrarOpcionesBusqueda(opciones, "estacion").map(o => o.value)).toEqual(["5"]);
    expect(filtrarOpcionesBusqueda(opciones, "texto inventado")).toEqual([]);
    const html = renderToStaticMarkup(createElement(CatalogoSearchSelect, { label: "Proveedor", placeholder: "Buscar proveedor...", value: "5", options: opciones, inputClassName: "x", onChange: vi.fn() }));
    expect(html).toContain('type="search"'); expect(html).toContain('<option value="5" selected="">Puma'); expect(html).not.toContain("Nombre manual");
  });
  it("formulario y mantenimiento reutilizan buscador sin modificar el componente compartido", () => {
    const form = readFileSync("src/components/flota/combustible-registro.tsx", "utf8");
    const estaciones = readFileSync("src/components/flota/combustible-estaciones-client.tsx", "utf8");
    expect(form).toContain('<CatalogoSearchSelect label="Proveedor"');
    expect(form).toContain('type="hidden" name="proveedorId" value={proveedorId}');
    expect(estaciones).toContain('label="Filtrar proveedor"');
    expect(estaciones).toContain('label="Proveedor"');
    expect(estaciones).toContain('type="hidden" name="proveedorId" value={proveedorEdicion}');
    expect(opcionesConHistorico([], "55", "Proveedor anterior")).toEqual([{ value: "55", label: "Proveedor anterior (histórico)" }]);
  });
  it("principal solo enlaza alta con permiso y no monta formulario de alta", () => {
    const permisos = cambiarAccion(base, "flota_combustible", "registrar", true);
    const html = renderToStaticMarkup(createElement(CombustiblesClient, { slug: "kt", capacidades: capacidadesCombustible(permisos, false) }));
    expect(html).toContain('href="/e/kt/combustibles/nuevo"'); expect(html).not.toContain("Guardar vale");
    const sinRegistro = renderToStaticMarkup(createElement(CombustiblesClient, { slug: "kt", capacidades: capacidadesCombustible(base, false) }));
    expect(sinRegistro).not.toContain('href="/e/kt/combustibles/nuevo"');
    expect(sinRegistro).toContain("Resumen mensual"); expect(sinRegistro).toContain("Conciliación");
  });
  it("formulario no envía viaje_id ni siquiera al editar histórico", () => {
    const vale = { id: 1, proveedorId: 3, vehiculoId: 7, viajeId: 99, numeroVale: "A", fechaConsumo: "2026-10-15", tipoCombustible: "diesel", galones: 1, monto: 30, km: null, gasolinera: "Anterior", placa: "P-1" };
    for (const historico of [undefined, vale]) {
      const html = renderToStaticMarkup(createElement(CombustibleRegistro, { slug: "kt", vale: historico, onSaved: vi.fn(), onCancel: vi.fn() }));
      expect(html).not.toContain('name="viajeId"'); expect(html).not.toContain("ID de viaje Flota"); expect(html).toContain("Guardar vale");
    }
  });
  it("proveedor/estación filtra IDs y limpia selección al cambiar proveedor", () => {
    const estaciones = [{ id: 55, proveedorId: 3, nombre: "Shell Roosevelt" }, { id: 66, proveedorId: 5, nombre: "Puma" }];
    expect(estacionesDelProveedor(estaciones, "3")).toEqual([estaciones[0]]);
    expect(estacionAlCambiarProveedor(estaciones, "5", "55")).toBe("");
    expect(estacionAlCambiarProveedor(estaciones, "3", "55")).toBe("55");
  });
  it("filtro de estaciones conserva texto y ID real del proveedor al consultar", () => {
    const source = readFileSync("src/components/flota/combustible-estaciones-client.tsx", "utf8");
    expect(source).toContain('placeholder="Buscar estación..."');
    expect(source).toContain("new URLSearchParams({ buscar, proveedorId: proveedor, activo })");
    expect(source).toContain("onChange={setProveedor}");
  });
  it("Ver sin Registrar no recibe formulario por URL directa (guard real)", async () => {
    expect((await NuevoValePage({ params: Promise.resolve({ slug: "kt" }) })).type).toBe("p");
  });
  it("Registrar permite la pantalla con guard real", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue(cambiarAccion(base, "flota_combustible", "registrar", true));
    const page = await NuevoValePage({ params: Promise.resolve({ slug: "kt" }) });
    expect(page.type).toBe(CombustibleNuevoClient); expect(page.props.slug).toBe("kt");
  });
  it("la nueva pantalla tampoco cruza empresas", async () => {
    vi.mocked(empresasParaUsuario).mockResolvedValue([]);
    expect((await NuevoValePage({ params: Promise.resolve({ slug: "kt" }) })).type).toBe("p");
  });
  it("guardar/cancelar vuelven con una navegación, sin refresh extra", () => {
    const wrapper = readFileSync("src/components/flota/combustible-nuevo-client.tsx", "utf8");
    expect(wrapper).toContain('router.push(`/e/${slug}/combustibles`)');
    expect(wrapper).toContain("onSaved={volver} onCancel={volver}");
    expect(wrapper).not.toContain("router.refresh");
  });
});
