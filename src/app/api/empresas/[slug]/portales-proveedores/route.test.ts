import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/proveedores/credenciales", () => ({ cifrarCredencial: vi.fn(() => "cifrado"), descifrarCredencial: vi.fn(() => "clave") }));
import { requireTenant } from "@/lib/tenant";
import { query, execute } from "@/lib/db";
import { cifrarCredencial, descifrarCredencial } from "@/lib/proveedores/credenciales";
import { GET, POST } from "./route";
import { POST as revelar } from "./[id]/revelar/route";
import { DELETE } from "./[id]/route";

const ctx = { params: Promise.resolve({ slug: "empresa", id: "3" }) };
const datos = { proveedor: "Proveedor", nombrePortal: "Portal", url: "https://example.com", usuarioPortal: "usuario", password: "secreto" };
const req = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
const filas = (datos: Record<string, unknown>[]) => datos as RowDataPacket[];

function sesion(rol = "Operaciones", empresaId = 7) {
  vi.mocked(requireTenant).mockResolvedValue({ empresa: { id: empresaId }, session: { id: 12, rol } } as Awaited<ReturnType<typeof requireTenant>>);
}

describe("portales de proveedores: validación y aislamiento", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sesion();
    vi.mocked(cifrarCredencial).mockReturnValue("cifrado");
    vi.mocked(descifrarCredencial).mockReturnValue("clave");
    vi.mocked(query).mockResolvedValue([]);
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1, insertId: 3 } as Awaited<ReturnType<typeof execute>>);
  });

  it.each([
    ["proveedor", "", "El proveedor"],
    ["nombrePortal", "", "El nombre del portal"],
    ["url", "invalida", "El enlace del portal no es válido."],
    ["usuarioPortal", "", "El usuario del proveedor"],
    ["password", undefined, "La contraseña es obligatoria"],
    ["id", 0, "El identificador del portal"],
  ])("identifica %s sin devolver valores ni escribir", async (campo, valor, mensaje) => {
    const respuesta = await POST(req({ ...datos, [campo]: valor }), ctx);
    expect(respuesta.status).toBe(400);
    const body = await respuesta.json();
    expect(body.error).toContain(mensaje);
    expect(body.erroresCampos[campo]).toBe(body.error);
    expect(JSON.stringify(body)).not.toContain("secreto");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([undefined, 99, 0, "otro", null])("no Admin ignora asignación %s y crea para sí mismo", async (asignadoUsuarioId) => {
    expect((await POST(req({ ...datos, asignadoUsuarioId }), ctx)).status).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("INSERT"), [7, "Proveedor", "Portal", "https://example.com", "usuario", "cifrado", 12, null, true, 12]);
    expect(query).not.toHaveBeenCalled();
  });

  it("Admin puede asignar a usuario permitido de la empresa", async () => {
    sesion("Admin");
    vi.mocked(query).mockResolvedValue(filas([{ id: 99 }]));
    expect((await POST(req({ ...datos, asignadoUsuarioId: 99 }), ctx)).status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ue.empresa_id = ?"), [99, "Operaciones", "GerenteOperaciones", "JefeOperaciones", "AuxiliarOperaciones", "Facturador", 7]);
    expect(vi.mocked(execute).mock.calls[0][1]?.[6]).toBe(99);
  });

  it("Admin debe elegir usuario y no puede asignar fuera de empresa", async () => {
    sesion("Admin");
    expect((await POST(req(datos), ctx)).status).toBe(400);
    expect((await POST(req({ ...datos, asignadoUsuarioId: 99 }), ctx)).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("editar sin password conserva cifrado y limita empresa/asignación", async () => {
    vi.mocked(query).mockResolvedValue(filas([{ id: 3 }]));
    expect((await POST(req({ ...datos, id: 3, password: "", asignadoUsuarioId: 99 }), ctx)).status).toBe(200);
    const [sql, params] = vi.mocked(execute).mock.calls[0];
    expect(sql).not.toContain("password_cifrado");
    expect(params).toEqual(["Proveedor", "Portal", "https://example.com", "usuario", 12, null, true, 3, 7, 12]);
    expect(cifrarCredencial).not.toHaveBeenCalled();
  });

  it("no edita portal ajeno", async () => {
    expect((await POST(req({ ...datos, id: 3 }), ctx)).status).toBe(404);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND asignado_usuario_id = ?"), [3, 7, 12]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("GET no contiene password ni cifrado aunque la fila contenga secretos", async () => {
    vi.mocked(query).mockResolvedValue(filas([{ id: 3, proveedor: "P", nombre_portal: "N", url: "https://example.com", usuario_portal: "u", asignado_usuario_id: 12, asignado_username: "u", activo: 1, creado_en: "2026-09-17", password: "secreto", password_cifrado: "cifrado" }]));
    const body = await (await GET(req({}), ctx)).json();
    expect(body.portales[0]).not.toHaveProperty("password");
    expect(body.portales[0]).not.toHaveProperty("password_cifrado");
    expect(query).toHaveBeenCalledWith(expect.not.stringContaining("password_cifrado"), [7, 12]);
  });

  it("revelar solo devuelve password del portal activo asignado en empresa", async () => {
    vi.mocked(query).mockResolvedValue(filas([{ password_cifrado: "cifrado" }]));
    const respuesta = await revelar(req({}), ctx);
    expect(await respuesta.json()).toEqual({ password: "clave" });
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND asignado_usuario_id = ? AND activo = 1"), [3, 7, 12]);
  });

  it.each(["otra empresa", "otro usuario", "inactivo"])("no revela %s ni descifra", async () => {
    expect((await revelar(req({}), ctx)).status).toBe(404);
    expect(descifrarCredencial).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ?"), [3, 7, 12]);
  });

  it("Admin conserva reveal de cualquier asignación/estado dentro de su empresa", async () => {
    sesion("Admin", 8);
    vi.mocked(query).mockResolvedValue(filas([{ password_cifrado: "cifrado" }]));
    expect((await revelar(req({}), ctx)).status).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.not.stringContaining("AND activo = 1"), [3, 8]);
  });

  it("eliminar respeta empresa y asignación", async () => {
    expect((await DELETE(req({}), ctx)).status).toBe(200);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("AND asignado_usuario_id = ?"), [3, 7, 12]);
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as Awaited<ReturnType<typeof execute>>);
    expect((await DELETE(req({}), ctx)).status).toBe(404);
  });

  it("rol sin permiso no consulta, escribe ni revela", async () => {
    sesion("RRHH");
    for (const action of [POST, GET, revelar, DELETE]) expect((await action(req(datos), ctx)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(descifrarCredencial).not.toHaveBeenCalled();
  });
});
