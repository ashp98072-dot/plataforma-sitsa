import { describe, expect, it } from "vitest";
import {
  mergePermisosConCatalogo,
  permisosDefaultPorRol,
  tienePermiso,
} from "./permisos-shared";

describe("permisos críticos por rol", () => {
  it("Reclutamiento administra entrevistas pero no elimina empleados", () => {
    const permisos = permisosDefaultPorRol("Reclutamiento");
    expect(tienePermiso(permisos, "entrevistas", "editar")).toBe(true);
    expect(tienePermiso(permisos, "empleados", "crear")).toBe(true);
    expect(tienePermiso(permisos, "empleados", "eliminar")).toBe(false);
    expect(tienePermiso(permisos, "planillas", "ver")).toBe(false);
  });

  it("Facturador paga viáticos sin obtener Programación", () => {
    const permisos = permisosDefaultPorRol("Facturador");
    expect(tienePermiso(permisos, "viaticos_pagar", "editar")).toBe(true);
    expect(tienePermiso(permisos, "programacion", "ver")).toBe(false);
  });

  it("respeta un permiso explícitamente desmarcado", () => {
    const permisos = mergePermisosConCatalogo("RRHH", [
      {
        modulo: "vacaciones",
        puedeVer: false,
        puedeCrear: false,
        puedeEditar: false,
        puedeEliminar: false,
      },
    ]);
    expect(tienePermiso(permisos, "vacaciones", "ver")).toBe(false);
  });
});
