import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ obtenerPersonalOperativoDeEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({ obtenerEmpleado: vi.fn() }));
vi.mock("@/lib/rrhh/horas-extra", () => ({ listarSubordinados: vi.fn() }));
vi.mock("./logout-button", () => ({ default: () => null }));
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerPersonalOperativoDeEmpleado } from "@/lib/flota/pilotos";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { listarSubordinados } from "@/lib/rrhh/horas-extra";
import PortalHomePage from "./page";
function enlaces(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(enlaces);
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return [];
  return [...(node.props.href ? [node.props.href] : []), ...enlaces(node.props.children)];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getColaboradorSession).mockResolvedValue({ empresaId: 3, empleadoId: 7 } as NonNullable<Awaited<ReturnType<typeof getColaboradorSession>>>);
  vi.mocked(listarSubordinados).mockResolvedValue([]);
  vi.mocked(obtenerEmpleado).mockResolvedValue({ horasExtraHabilitado: false } as NonNullable<Awaited<ReturnType<typeof obtenerEmpleado>>>);
  vi.mocked(obtenerPersonalOperativoDeEmpleado).mockResolvedValue({ id: 8, tipo: "Piloto", nombre: "Prueba" });
});
it("piloto ve viáticos y no ve horas extra deshabilitadas", async () => {
  const links = enlaces(await PortalHomePage());
  expect(links).toContain("/portal/viaticos");
  expect(links).not.toContain("/portal/horas-extra");
});
it("horas extra aparece solo con habilitación incluso si es supervisor", async () => {
  vi.mocked(listarSubordinados).mockResolvedValue([{}] as Awaited<ReturnType<typeof listarSubordinados>>);
  expect(enlaces(await PortalHomePage())).not.toContain("/portal/horas-extra");
  vi.mocked(obtenerEmpleado).mockResolvedValue({ horasExtraHabilitado: true } as NonNullable<Awaited<ReturnType<typeof obtenerEmpleado>>>);
  expect(enlaces(await PortalHomePage())).toContain("/portal/horas-extra");
});
it("no ofrece la tarjeta de viáticos de piloto a personal no operativo", async () => {
  vi.mocked(obtenerPersonalOperativoDeEmpleado).mockResolvedValue(null);
  expect(enlaces(await PortalHomePage())).not.toContain("/portal/viaticos");
});
