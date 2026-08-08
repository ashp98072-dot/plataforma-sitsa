import { NextResponse } from "next/server";

/** Quién ve/edita cada parte de Facturación. */
export type AlcanceFacturacion = {
  verEmpresa: boolean;
  editarEmpresa: boolean;
  verClientes: boolean;
  editarClientes: boolean;
};

/**
 * Contabilidad → solo facturación de la empresa.
 * Operaciones → solo facturación por cliente.
 * Admin → ambas. Visualizador → lectura de ambas.
 */
export function alcanceFacturacion(rol: string): AlcanceFacturacion {
  if (rol === "Admin") {
    return {
      verEmpresa: true,
      editarEmpresa: true,
      verClientes: true,
      editarClientes: true,
    };
  }
  if (rol === "Contabilidad") {
    return {
      verEmpresa: true,
      editarEmpresa: true,
      verClientes: false,
      editarClientes: false,
    };
  }
  if (rol === "Operaciones") {
    return {
      verEmpresa: false,
      editarEmpresa: false,
      verClientes: true,
      editarClientes: true,
    };
  }
  if (rol === "Visualizador") {
    return {
      verEmpresa: true,
      editarEmpresa: false,
      verClientes: true,
      editarClientes: false,
    };
  }
  return {
    verEmpresa: false,
    editarEmpresa: false,
    verClientes: false,
    editarClientes: false,
  };
}

export function denyFacturacionAlcance(
  mensaje = "Sin permiso para esta parte de facturación.",
) {
  return NextResponse.json({ error: mensaje }, { status: 403 });
}
