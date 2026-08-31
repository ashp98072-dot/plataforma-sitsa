import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/clientes/acceso", () => ({ requireClientesOFacturacion: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ listarClientes: vi.fn(), crearCliente: vi.fn(), actualizarCliente: vi.fn() }));
vi.mock("@/lib/clientes/import-excel", async (original) => ({
  ...await original<typeof import("@/lib/clientes/import-excel")>(), parsearExcelClientes: vi.fn(),
}));
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { listarClientes, crearCliente, actualizarCliente } from "@/lib/clientes/repository";
import { parsearExcelClientes, type FilaClienteExcel } from "@/lib/clientes/import-excel";
import type { Cliente } from "@/lib/clientes/tipos";
import { POST } from "./route";

const cliente = (id: number, nit: string, extras: Partial<Cliente> = {}): Cliente => ({
  id, empresaId: 7, codigo: `CLI-${id}`, nombre: "Marca compartida", razonSocial: `Sociedad ${id}`,
  nit, rtu: null, telefono: null, email: null, direccion: null, contactoNombre: null, contactoTelefono: null,
  tipo: "comercial", estado: "Activo", notas: null, tmsClienteId: id + 100, creadoAt: null, actualizadoAt: null, ...extras,
});
const fila = (nit: string | null, extras: Partial<FilaClienteExcel> = {}): FilaClienteExcel => ({
  filaExcel: 2, nombre: "Marca compartida", nit, codigo: null, rtu: null, tipo: "comercial", estado: "Activo", actualizar: true, ...extras,
});
async function ejecutar(filas: FilaClienteExcel[], accion = "validar") {
  vi.mocked(parsearExcelClientes).mockResolvedValue(filas);
  const form = new FormData();
  form.set("archivo", new File(["prueba"], "clientes.xlsx")); form.set("accion", accion);
  return POST(new Request("http://localhost/api/empresas/prueba/clientes/import", { method: "POST", body: form }), { params: Promise.resolve({ slug: "prueba" }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireClientesOFacturacion).mockResolvedValue({ empresa: { id: 7 } } as never);
  vi.mocked(listarClientes).mockResolvedValue([cliente(1, "100-1"), cliente(2, "200-2")]);
  vi.mocked(actualizarCliente).mockResolvedValue(cliente(1, "100-1"));
  vi.mocked(crearCliente).mockResolvedValue(cliente(3, "300-3"));
});
it("mismo nombre con NIT diferentes actualiza cada identidad correspondiente", async () => {
  const r = await ejecutar([fila("100-1"), fila("200-2", { filaExcel: 3 })]);
  const body = await r.json();
  expect(body.resumen.errores).toBe(0);
  expect(body.filas.map((f: { clienteId: number }) => f.clienteId)).toEqual([1, 2]);
  expect(body.filas[0].detalle).toContain("NIT 100-1");
  expect(listarClientes).toHaveBeenCalledWith(7, { estado: "todos" });
  expect(actualizarCliente).not.toHaveBeenCalled();
});
it("un NIT nuevo con nombre repetido crea otro registro, sin reemplazar al existente", async () => {
  const body = await (await ejecutar([fila("300-3")], "importar")).json();
  expect(body.creados).toBe(1);
  expect(crearCliente).toHaveBeenCalledWith(7, expect.objectContaining({ nit: "300-3", nombre: "Marca compartida" }));
  expect(actualizarCliente).not.toHaveBeenCalled();
});
it("confirmar importación conserva los ids de cada NIT", async () => {
  await ejecutar([fila("100-1"), fila("200-2", { filaExcel: 3 })], "importar");
  expect(actualizarCliente).toHaveBeenNthCalledWith(1, 7, 1, expect.objectContaining({ nit: "100-1" }));
  expect(actualizarCliente).toHaveBeenNthCalledWith(2, 7, 2, expect.objectContaining({ nit: "200-2" }));
  expect(crearCliente).not.toHaveBeenCalled();
});
it.each([
  fila("200-2", { codigo: "CLI-1" }),
  fila("300-3", { codigo: "CLI-1" }),
  fila(null),
])("no escribe una identificación contradictoria o ambigua %#", async (f) => {
  const body = await (await ejecutar([f], "importar")).json();
  expect(body.resumen.errores).toBe(1);
  expect(actualizarCliente).not.toHaveBeenCalled(); expect(crearCliente).not.toHaveBeenCalled();
});
it("mantiene respaldo por nombre único sin identificadores", async () => {
  vi.mocked(listarClientes).mockResolvedValue([cliente(1, "100-1")]);
  const body = await (await ejecutar([fila(null)])).json();
  expect(body.filas[0].clienteId).toBe(1);
});
it("permite completar un NIT vacío por código explícito", async () => {
  vi.mocked(listarClientes).mockResolvedValue([cliente(1, "")]);
  const body = await (await ejecutar([fila("100-1", { codigo: "CLI-1" })])).json();
  expect(body.filas[0].estadoValidacion).toBe("ACTUALIZAR");
});
it("RTU identifica sin mezclar nombres repetidos", async () => {
  vi.mocked(listarClientes).mockResolvedValue([cliente(1, "100-1", { rtu: "R1" }), cliente(2, "200-2", { rtu: "R2" })]);
  const body = await (await ejecutar([fila(null, { rtu: "R2" })])).json();
  expect(body.filas[0].clienteId).toBe(2);
});
it("duplicados de NIT se bloquean incluso con códigos distintos", async () => {
  const body = await (await ejecutar([fila("300-3", { codigo: "N1" }), fila("300-3", { codigo: "N2", filaExcel: 3 })])).json();
  expect(body.filas[1].estadoValidacion).toBe("ERROR");
});
it("sin actualizar_si_existe omite el NIT identificado", async () => {
  const body = await (await ejecutar([fila("200-2", { actualizar: false })], "importar")).json();
  expect(body.resumen.omitidos).toBe(1); expect(actualizarCliente).not.toHaveBeenCalled();
});
it("permiso denegado impide analizar y escribir", async () => {
  vi.mocked(requireClientesOFacturacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
  expect((await ejecutar([fila("100-1")], "importar")).status).toBe(403);
  expect(listarClientes).not.toHaveBeenCalled(); expect(actualizarCliente).not.toHaveBeenCalled();
});
