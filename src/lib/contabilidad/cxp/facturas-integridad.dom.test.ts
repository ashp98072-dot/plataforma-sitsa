// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CxpClient } from "@/components/contabilidad/cxp-client";
import { desgloseFacturaLectura } from "./saldo-lectura";

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals();
});
it("el listado montado muestra factura normal y sobreaplicada sin saldo ficticio ni detalle de pagos", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const facturas = ["107.01", "0.00"].map((pagado, i) => ({
    id: i + 1, proveedorId: i + 11, proveedorNombre: `Proveedor QA ${i + 1}`, serie: "QA", numero: String(i + 1),
    fechaDocumento: "2026-11-05", fechaVencimiento: null, baseNeto: "100.00", ivaMonto: "12.00", isrMonto: "5.00", isrPorcentaje: "5.00",
    totalNetoPagar: "107.00", estadoAdmin: "REGISTRADA", motivoAnulacion: null,
    ...desgloseFacturaLectura(i + 1, "REGISTRADA", { totalDocumento: "112.00", isrMonto: "5.00", totalNetoPagar: "107.00" }, pagado),
  }));
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/entidades")) return Response.json({ entidades: [{ id: 5, codigo: "QA", nombre: "Sintética", activa: 1 }] });
    if (url.endsWith("/facturas?entidad=5")) return Response.json({ total: 2, facturas });
    throw new Error("Solicitud inesperada: " + url);
  });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(CxpClient, { slug: "qa", puedeVer: true, puedeRegistrar: false, puedeAnular: false, puedeVerFiscal: false, puedeEditarFiscal: false, puedeVerPagos: false })));
  await act(async () => {});
  const rows = container.querySelectorAll("tbody tr"); expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Sobreaplicada"); expect(rows[0].querySelector('[role="alert"]')?.textContent).toContain("exceso 0.01");
  expect(rows[0].children[9].textContent).toBe("Revisión de integridad pendiente");
  expect(rows[1].children[9].textContent).toBe("Q107.00");
  expect(rows[1].textContent).toContain("Pendiente");
  expect(container.textContent).toContain("2 facturas.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(container.textContent).not.toContain("Reversar");
});
