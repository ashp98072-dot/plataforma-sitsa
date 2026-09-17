import { expect, it } from "vitest";
import { normalizarMetodoPagoCompra, seleccionarProveedorCompra } from "./metodos-pago";
import { lineaCompraSchema } from "./requerimiento-schema";

it.each(["TARJETA DE CREDITO", "Tarjeta de Crédito", "Tarjeta crédito", "TARJETA", " tarjeta  de credito "])("normaliza %s a Tarjeta de crédito", valor => {
  expect(normalizarMetodoPagoCompra(valor)).toBe("Tarjeta de crédito");
  expect(seleccionarProveedorCompra({ proveedor_id: 0, metodo_pago: "Transferencia" }, 16, valor).metodo_pago).toBe("Tarjeta de crédito");
});
it.each(["Efectivo", "Transferencia", "Transferencia móvil", "Cheque", "Otro"])("conserva método %s", valor => expect(normalizarMetodoPagoCompra(valor)).toBe(valor));
it.each([null, undefined, "", " "])("habitual vacío %s conserva método actual", valor => {
  expect(seleccionarProveedorCompra({ proveedor_id: 0, metodo_pago: "Cheque" }, 3, valor)).toEqual({ proveedor_id: 3, metodo_pago: "Cheque" });
});
it("cambiar explícitamente proveedor actualiza default, sin cambiar condición ni otros campos", () => {
  const linea = { id: 21, proveedor_id: 3, metodo_pago: "Efectivo", condicion_pago: "Contado" };
  const cambiada = seleccionarProveedorCompra(linea, 4, "TARJETA DE CREDITO");
  expect(cambiada).toEqual({ ...linea, proveedor_id: 4, metodo_pago: "Tarjeta de crédito" });
  expect(seleccionarProveedorCompra(cambiada, 5, "Transferencia").metodo_pago).toBe("Transferencia");
});
it("override manual posterior queda intacto; seleccionar el mismo proveedor no reimpone habitual", () => {
  const defaultLinea = seleccionarProveedorCompra({ proveedor_id: 0, metodo_pago: "Transferencia" }, 3, "TARJETA DE CREDITO");
  const manual = { ...defaultLinea, metodo_pago: "Cheque" };
  expect(seleccionarProveedorCompra(manual, 3, "TARJETA DE CREDITO")).toBe(manual);
});
it("desconocido preserva texto y pasa validación segura de VARCHAR(80)", () => {
  const desconocido = "Pago especial del proveedor";
  expect(normalizarMetodoPagoCompra(desconocido)).toBe(desconocido);
  expect(seleccionarProveedorCompra({ proveedor_id: 0, metodo_pago: "Transferencia" }, 3, desconocido).metodo_pago).toBe(desconocido);
  const linea = { fecha: "2026-09-17", proveedor_id: 3, repuesto_descripcion: "Filtro", condicion_pago: "Contado", total: "1.00" };
  expect(lineaCompraSchema.safeParse({ ...linea, metodo_pago: desconocido }).success).toBe(true);
  for (const valor of ["", " ", "x".repeat(81), "Cheque\u0000inseguro"]) expect(lineaCompraSchema.safeParse({ ...linea, metodo_pago: valor }).success).toBe(false);
});
