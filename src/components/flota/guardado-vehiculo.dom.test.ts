// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "kt" }),
  useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("tab=vehiculos") }));
const session = vi.hoisted(() => ({ rol: "Admin", permisos: [], empresaNombre: "KT", username: "operador" }));
vi.mock("@/lib/empresa-session", () => ({ useEmpresaSession: () => session }));
import FlotaClient from "@/app/e/[slug]/flota/flota-client";
let root: Root, host: HTMLDivElement;
let finish: (response: Response) => void;
let fail: (reason: Error) => void;
let refreshed: boolean;
let holdReload: boolean;
let completeReload: () => void;
const writes: { url: string; body: Record<string, unknown> }[] = [];
const vehicle = { id: 1297, empresa_id: 1, placa: "C-035BXR", marca: "Anterior", modelo: "", activo: 1,
  estado: "Activo", esDueno: true, puedeEditar: true, filtros: [], accesoEmpresaIds: [],
  odometro_funcional: 1, tipo_propiedad: "EMPRESA", empresa_propietaria_id: 1,
  revision_propiedad: 0, tipo_vehiculo: "" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function button(text: string) {
  const b = Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === text);
  if (!b) throw Error(`No existe botón ${text}`);
  return b;
}
function input(label: string) {
  const l = Array.from(host.querySelectorAll("label")).find(l => l.textContent?.trim().startsWith(label));
  const el = l?.querySelector("input");
  if (!el) throw Error(`No existe campo ${label}`);
  return el;
}
async function change(label: string, value: string) {
  await act(async () => {
    const el = input(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  writes.length = 0; refreshed = false; holdReload = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method) {
      writes.push({ url, body: JSON.parse(String(init.body)) });
      return new Promise<Response>((resolve, reject) => { finish = resolve; fail = reject; });
    }
    if (url.endsWith("/vehiculos")) {
      if (holdReload) await new Promise<void>(resolve => { completeReload = resolve; });
      return response({ vehiculos: [{ ...vehicle,
      empresa_propietaria_id: refreshed ? 2 : 1, revision_propiedad: refreshed ? 1 : 0 }],
      empresas: [{ id: 1, nombre: "KT" }, { id: 2, nombre: "Otro propietario" }],
      empresaActualId: 1, propiedadHabilitada: true });
    }
    return response({});
  }));
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(createElement(FlotaClient)); });
  await act(async () => { button("Editar").click(); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("guardado general bloquea propiedad, doble submit, edición y cambio de unidad hasta terminar", async () => {
  await change("Marca", "Borrador del usuario");
  await act(async () => { submit(); button("Confirmar y guardar propietario").click(); submit(); });
  expect(writes).toHaveLength(1); expect(writes[0].url).toMatch(/\/vehiculos$/);
  expect(writes[0].body.marca).toBe("Borrador del usuario");
  expect(input("Marca").closest("fieldset")!.disabled).toBe(true);
  await act(async () => { button("Editar").click(); });
  expect(input("Marca").value).toBe("Borrador del usuario");
  await act(async () => { finish(response({ mensaje: "Guardado" })); });
  expect(host.querySelector("form")).toBeNull();
});

it.each([400, 409, 500])("error general %s conserva todos los cambios y libera el formulario", async status => {
  await change("Marca", "Pendiente");
  await act(async () => { submit(); });
  await act(async () => { finish(response({ error: "No guardado" }, status)); });
  expect(input("Marca").value).toBe("Pendiente"); expect(input("Marca").closest("fieldset")!.disabled).toBe(false);
  await act(async () => { button("Confirmar y guardar propietario").click(); });
  expect(writes).toHaveLength(2);
  await act(async () => { finish(response({ error: "Sin cambio" }, 400)); });
});

it("fallo de red conserva el borrador y permite un nuevo intento", async () => {
  await change("Marca", "No perder");
  await act(async () => { submit(); });
  await act(async () => { fail(Error("Red interrumpida")); });
  expect(input("Marca").value).toBe("No perder");
  await act(async () => { submit(); }); expect(writes).toHaveLength(2);
  await act(async () => { finish(response({ error: "Revisar" }, 400)); });
});

it("propiedad bloquea submit general y conserva el borrador general tras recargar", async () => {
  await change("Marca", "Cambios sin enviar");
  await act(async () => {
    const select = Array.from(host.querySelectorAll("select")).find(s => s.textContent?.includes("Otro propietario"))!;
    select.value = "2"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => { button("Confirmar y guardar propietario").click(); submit(); button("Confirmar y guardar propietario").click(); });
  expect(writes).toHaveLength(1); expect(writes[0].url).toMatch(/\/propiedad$/);
  expect(input("Marca").closest("fieldset")!.disabled).toBe(true);
  refreshed = true;
  await act(async () => { finish(response({ revision: 1, mensaje: "Propiedad guardada" })); });
  expect(input("Marca").value).toBe("Cambios sin enviar"); expect(input("Marca").closest("fieldset")!.disabled).toBe(false);
  await act(async () => { submit(); });
  expect(writes).toHaveLength(2); expect(writes[1].body.marca).toBe("Cambios sin enviar");
  await act(async () => { finish(response({ mensaje: "Guardado" })); });
});

it.each([409, 500])("error de propiedad %s no descarta el borrador general", async status => {
  await change("Marca", "Conservar");
  await act(async () => { button("Confirmar y guardar propietario").click(); });
  await act(async () => { finish(response({ error: "Revisar propietario" }, status)); });
  expect(input("Marca").value).toBe("Conservar"); expect(input("Marca").closest("fieldset")!.disabled).toBe(false);
});

it("mantiene el bloqueo durante la recarga posterior a guardar propiedad", async () => {
  await change("Marca", "Borrador intacto");
  await act(async () => { button("Confirmar y guardar propietario").click(); });
  holdReload = true;
  await act(async () => { finish(response({ revision: 1, mensaje: "Guardado" })); });
  await act(async () => { submit(); button("Guardando...").click(); });
  expect(writes).toHaveLength(1); expect(input("Marca").closest("fieldset")!.disabled).toBe(true);
  await act(async () => { completeReload(); });
  expect(input("Marca").value).toBe("Borrador intacto");
  expect(input("Marca").closest("fieldset")!.disabled).toBe(false);
});

it("cancelar confirmación no bloquea el guardado general", async () => {
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  await change("Marca", "Conservar si cancelo");
  await act(async () => { button("Confirmar y guardar propietario").click(); });
  expect(writes).toHaveLength(0);
  await act(async () => { submit(); }); expect(writes).toHaveLength(1);
  await act(async () => { finish(response({ error: "No guardar" }, 400)); });
  expect(input("Marca").value).toBe("Conservar si cancelo");
});

it("respuesta ilegible no descarta cambios ni deja el candado tomado", async () => {
  await change("Marca", "Conservar respuesta inválida");
  await act(async () => { submit(); });
  await act(async () => { finish(new Response("{")); });
  expect(input("Marca").value).toBe("Conservar respuesta inválida");
  expect(input("Marca").closest("fieldset")!.disabled).toBe(false);
});
