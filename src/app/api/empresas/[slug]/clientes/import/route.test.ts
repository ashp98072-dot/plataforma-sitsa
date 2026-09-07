import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/clientes/acceso", () => ({ requireClientesOFacturacion: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ listarClientes: vi.fn(), crearCliente: vi.fn(), actualizarCliente: vi.fn() }));
vi.mock("@/lib/tms/cliente-contactos", () => ({ crearContactoCliente: vi.fn(), listarContactosCliente: vi.fn() }));
vi.mock("@/lib/clientes/import-excel", async (original) => ({
  ...await original<typeof import("@/lib/clientes/import-excel")>(),
  parsearExcelClientes: vi.fn(),
  parsearContactosExcelClientes: vi.fn(),
}));
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { listarClientes, crearCliente, actualizarCliente } from "@/lib/clientes/repository";
import { crearContactoCliente, listarContactosCliente } from "@/lib/tms/cliente-contactos";
import {
  parsearContactosExcelClientes,
  parsearExcelClientes,
  type FilaClienteExcel,
  type FilaContactoClienteExcel,
} from "@/lib/clientes/import-excel";
import type { Cliente } from "@/lib/clientes/tipos";
import { POST } from "./route";

const cliente = (id: number, nit: string, extras: Partial<Cliente> = {}): Cliente => ({
  id, empresaId: 7, codigo: `CLI-${id}`, nombre: "Marca compartida", razonSocial: `Sociedad ${id}`,
  nit, rtu: null, telefono: null, email: null, direccion: null, contactoNombre: null, contactoTelefono: null,
  tipo: "comercial", estado: "Activo", condicionCredito: null, notas: null, tmsClienteId: id + 100, creadoAt: null, actualizadoAt: null, ...extras,
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
  // Hoja CONTACTOS: vacía por defecto en todas las pruebas de clientes ya
  // existentes — el comportamiento debe quedar exactamente igual que antes.
  vi.mocked(parsearContactosExcelClientes).mockResolvedValue([]);
  vi.mocked(listarContactosCliente).mockResolvedValue([]);
  vi.mocked(crearContactoCliente).mockResolvedValue({
    id: 1, clienteId: 1, nombre: "x", cargo: null, telefono: null, email: null, observaciones: null, activo: true,
  });
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

const contacto = (extras: Partial<FilaContactoClienteExcel> = {}): FilaContactoClienteExcel => ({
  filaExcel: 2, clienteCodigo: null, clienteNombre: null, nombre: "Ana Pérez", cargo: null, telefono: null, email: null, observaciones: null, ...extras,
});
async function ejecutarConContactos(filas: FilaClienteExcel[], contactos: FilaContactoClienteExcel[], accion = "validar") {
  vi.mocked(parsearExcelClientes).mockResolvedValue(filas);
  vi.mocked(parsearContactosExcelClientes).mockResolvedValue(contactos);
  const form = new FormData();
  form.set("archivo", new File(["prueba"], "clientes.xlsx")); form.set("accion", accion);
  return POST(new Request("http://localhost/api/empresas/prueba/clientes/import", { method: "POST", body: form }), { params: Promise.resolve({ slug: "prueba" }) });
}

it("hoja CONTACTOS: un contacto se vincula a un cliente NUEVO del mismo archivo, por código", async () => {
  const body = await (await ejecutarConContactos(
    [fila("300-3", { codigo: "CLI-3" })],
    [contacto({ clienteCodigo: "CLI-3" })],
    "importar",
  )).json();
  expect(body.contactosCreados).toBe(1);
  expect(crearContactoCliente).toHaveBeenCalledWith(7, 103, expect.objectContaining({ nombre: "Ana Pérez" }));
});

it("hoja CONTACTOS: un contacto se vincula a un cliente EXISTENTE (OMITIR), no solo a los NUEVOS/ACTUALIZAR", async () => {
  const body = await (await ejecutarConContactos(
    [fila("200-2", { codigo: "CLI-2", actualizar: false })],
    [contacto({ clienteCodigo: "CLI-2" })],
    "importar",
  )).json();
  expect(body.resumen.omitidos).toBe(1); // el cliente NO se modifica...
  expect(body.contactosCreados).toBe(1); // ...pero su contacto sí se agrega.
  expect(crearContactoCliente).toHaveBeenCalledWith(7, 102, expect.objectContaining({ nombre: "Ana Pérez" }));
});

it("hoja CONTACTOS: sin cliente coincidente (código/nombre) => SIN_CLIENTE, nunca se crea el contacto", async () => {
  const body = await (await ejecutarConContactos(
    [fila("300-3", { codigo: "CLI-3" })],
    [contacto({ clienteCodigo: "NO-EXISTE" })],
    "importar",
  )).json();
  expect(body.resumenContactos).toEqual({ total: 1, ok: 0, sinCliente: 1 });
  expect(body.contactosCreados).toBe(0);
  expect(crearContactoCliente).not.toHaveBeenCalled();
});

it("hoja CONTACTOS: un contacto con el mismo nombre ya existente para ese cliente se omite (no se duplica)", async () => {
  vi.mocked(listarContactosCliente).mockResolvedValue([
    { id: 9, clienteId: 103, nombre: "Ana Pérez", cargo: null, telefono: null, email: null, observaciones: null, activo: true },
  ]);
  const body = await (await ejecutarConContactos(
    [fila("300-3", { codigo: "CLI-3" })],
    [contacto({ clienteCodigo: "CLI-3", nombre: "Ana Pérez" })],
    "importar",
  )).json();
  expect(body.contactosCreados).toBe(0);
  expect(body.contactosOmitidos).toBe(1);
  expect(crearContactoCliente).not.toHaveBeenCalled();
});

it("hoja CONTACTOS: en modo 'validar' nunca escribe nada, solo informa resumenContactos/contactos", async () => {
  const body = await (await ejecutarConContactos(
    [fila("300-3", { codigo: "CLI-3" })],
    [contacto({ clienteCodigo: "CLI-3" })],
    "validar",
  )).json();
  expect(body.resumenContactos).toEqual({ total: 1, ok: 1, sinCliente: 0 });
  expect(body.contactos[0].estadoValidacion).toBe("OK");
  expect(crearContactoCliente).not.toHaveBeenCalled();
  expect(crearCliente).not.toHaveBeenCalled();
});

it("sin hoja CONTACTOS (array vacío): resumenContactos es null y el import de clientes no cambia", async () => {
  const body = await (await ejecutarConContactos([fila("300-3", { codigo: "CLI-3" })], [], "importar")).json();
  expect(body.resumenContactos).toBeNull();
  expect(crearContactoCliente).not.toHaveBeenCalled();
  expect(body.creados).toBe(1);
});

it("hoja CONTACTOS: cliente_codigo tiene prioridad sobre cliente_nombre cuando ambos vienen y apuntan distinto", async () => {
  // Dos clientes NUEVOS con el MISMO nombre comercial (posible en la
  // realidad, ver caso "Diana") pero código y NIT distintos. El contacto
  // trae cliente_codigo="CLI-2" (apunta al segundo) Y cliente_nombre="Mismo
  // Nombre" (que por sí solo sería ambiguo entre los dos) — debe ganar el
  // código, nunca el nombre. (listarClientes se vacía porque el default de
  // beforeEach ya trae clientes con NIT "100-1"/"200-2" que chocarían con
  // estas filas "nuevas" y las volverían ACTUALIZAR en vez de NUEVO.)
  vi.mocked(listarClientes).mockResolvedValue([]);
  vi.mocked(crearCliente)
    .mockResolvedValueOnce(cliente(1, "100-1", { codigo: "CLI-1", nombre: "Mismo Nombre" }))
    .mockResolvedValueOnce(cliente(2, "200-2", { codigo: "CLI-2", nombre: "Mismo Nombre" }));
  const body = await (await ejecutarConContactos(
    [
      fila("100-1", { codigo: "CLI-1", nombre: "Mismo Nombre" }),
      fila("200-2", { codigo: "CLI-2", nombre: "Mismo Nombre", filaExcel: 3 }),
    ],
    [contacto({ clienteCodigo: "CLI-2", clienteNombre: "Mismo Nombre", nombre: "Ana Pérez" })],
    "importar",
  )).json();
  expect(body.contactosCreados).toBe(1);
  expect(crearContactoCliente).toHaveBeenCalledWith(7, 102, expect.objectContaining({ nombre: "Ana Pérez" }));
});

it("REGRESIÓN (caso real 'Diana'): mismo nombre + NIT distinto — cada cliente recibe SOLO sus propios contactos si el archivo usa cliente_codigo", async () => {
  const filas = [
    fila("111-1", { codigo: "CLI-A", nombre: "Diana", filaExcel: 2 }),
    fila("222-2", { codigo: "CLI-B", nombre: "Diana", filaExcel: 3 }),
  ];
  const contactosArchivo = [
    contacto({ clienteCodigo: "CLI-A", clienteNombre: "Diana", nombre: "Contacto A", filaExcel: 2 }),
    contacto({ clienteCodigo: "CLI-B", clienteNombre: "Diana", nombre: "Contacto B", filaExcel: 3 }),
  ];
  vi.mocked(crearCliente)
    .mockResolvedValueOnce(cliente(10, "111-1", { codigo: "CLI-A", nombre: "Diana" }))
    .mockResolvedValueOnce(cliente(20, "222-2", { codigo: "CLI-B", nombre: "Diana" }));
  const body = await (await ejecutarConContactos(filas, contactosArchivo, "importar")).json();
  expect(body.contactosCreados).toBe(2);
  expect(crearContactoCliente).toHaveBeenCalledWith(7, 110, expect.objectContaining({ nombre: "Contacto A" }));
  expect(crearContactoCliente).toHaveBeenCalledWith(7, 120, expect.objectContaining({ nombre: "Contacto B" }));
});

describe("idempotencia: reimportar exactamente el mismo archivo no duplica nada", () => {
  it("clientes: 0 duplicados en la 2da corrida (se actualiza, no se crea de nuevo)", async () => {
    const filas = [fila("100-1", { codigo: "CLI-1" }), fila("200-2", { codigo: "CLI-2", filaExcel: 3 })];
    let db: Cliente[] = [];
    vi.mocked(listarClientes).mockImplementation(async () => db);
    vi.mocked(crearCliente).mockImplementation(async (_e, input) => {
      const c = cliente(db.length + 1, input.nit ?? "", { codigo: input.codigo ?? null, nombre: input.nombre });
      db = [...db, c];
      return c;
    });

    vi.mocked(parsearExcelClientes).mockResolvedValue(filas);
    const importar = () => {
      const form = new FormData();
      form.set("archivo", new File(["x"], "c.xlsx"));
      form.set("accion", "importar");
      return POST(new Request("http://localhost/api/empresas/prueba/clientes/import", { method: "POST", body: form }), { params: Promise.resolve({ slug: "prueba" }) });
    };
    const r1 = await (await importar()).json();
    expect(r1.creados).toBe(2);
    expect(db).toHaveLength(2);

    const r2 = await (await importar()).json();
    expect(db).toHaveLength(2); // no creció
    expect(r2.creados).toBe(0);
    expect(r2.actualizados).toBe(2);
  });

  it("contactos: 0 duplicados en la 2da corrida (se omiten por nombre ya existente)", async () => {
    const filas = [fila("100-1", { codigo: "CLI-1" })];
    const contactosArchivo = [contacto({ clienteCodigo: "CLI-1", nombre: "Ana Pérez" })];
    let nombresGuardados: string[] = [];
    vi.mocked(listarContactosCliente).mockImplementation(async () =>
      nombresGuardados.map((n, i) => ({ id: i, clienteId: 101, nombre: n, cargo: null, telefono: null, email: null, observaciones: null, activo: true })),
    );
    vi.mocked(crearContactoCliente).mockImplementation(async (_e, _tmsId, input) => {
      nombresGuardados = [...nombresGuardados, input.nombre];
      return { id: nombresGuardados.length, clienteId: 101, nombre: input.nombre, cargo: null, telefono: null, email: null, observaciones: null, activo: true };
    });

    const r1 = await (await ejecutarConContactos(filas, contactosArchivo, "importar")).json();
    expect(r1.contactosCreados).toBe(1);

    const r2 = await (await ejecutarConContactos(filas, contactosArchivo, "importar")).json();
    expect(r2.contactosCreados).toBe(0);
    expect(r2.contactosOmitidos).toBe(1);
    expect(nombresGuardados).toHaveLength(1); // no se duplicó
  });
});
