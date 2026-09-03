import { describe, expect, it } from "vitest";
import { ROLES } from "./roles";
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

  describe("VIATICOS-FIRMA — matriz de permisos autorizar/pagar/liquidar", () => {
    it("1/2) Jefe y Gerente de Operaciones autorizan por defecto (viaticos_autorizar:editar)", () => {
      expect(tienePermiso(permisosDefaultPorRol("JefeOperaciones"), "viaticos_autorizar", "editar")).toBe(true);
      expect(tienePermiso(permisosDefaultPorRol("GerenteOperaciones"), "viaticos_autorizar", "editar")).toBe(true);
    });

    it("3) Facturador NO autoriza por defecto", () => {
      expect(tienePermiso(permisosDefaultPorRol("Facturador"), "viaticos_autorizar", "editar")).toBe(false);
    });

    it("4) Auxiliar de Operaciones no autoriza, no paga, no liquida (no trae ninguno de los 3 permisos)", () => {
      const permisos = permisosDefaultPorRol("AuxiliarOperaciones");
      expect(tienePermiso(permisos, "viaticos_autorizar", "editar")).toBe(false);
      expect(tienePermiso(permisos, "viaticos_pagar", "editar")).toBe(false);
      expect(tienePermiso(permisos, "viaticos_liquidar", "editar")).toBe(false);
    });

    it("9) Facturador liquida por defecto (viaticos_liquidar:editar) y solo ve el control general (viaticos:ver, nunca editar)", () => {
      const permisos = permisosDefaultPorRol("Facturador");
      expect(tienePermiso(permisos, "viaticos_liquidar", "editar")).toBe(true);
      expect(tienePermiso(permisos, "viaticos", "ver")).toBe(true);
      expect(tienePermiso(permisos, "viaticos", "editar")).toBe(false);
    });

    it("10) Jefe/Gerente de Operaciones NO liquidan por defecto (viaticos_liquidar no está en su matriz)", () => {
      expect(tienePermiso(permisosDefaultPorRol("JefeOperaciones"), "viaticos_liquidar", "editar")).toBe(false);
      expect(tienePermiso(permisosDefaultPorRol("GerenteOperaciones"), "viaticos_liquidar", "editar")).toBe(false);
    });

    // 22) "no depende de empleado_supervisores": verificado por inspección,
    // no por prueba automatizada — permisosDefaultPorRol/tienePermiso no
    // importan ni referencian esa tabla en ningún punto de este archivo ni
    // de src/lib/tenant.ts (requireTenantViaticosAutorizar/Pagar/Liquidar
    // solo consultan permisosEfectivos, nunca la jerarquía de supervisión).
  });

  describe("VIATICOS-COMPROBANTE-PDF — viaticos_comprobantes", () => {
    it("ningún rol lo trae por defecto (opt-in exclusivo, un Admin lo otorga desde Usuarios)", () => {
      // Admin excluido: su matriz default ya incluye todos los módulos (el
      // acceso real de Admin en producción pasa por el bypass explícito de
      // requireTenantViaticosComprobantes, no por esta matriz) — igual
      // criterio que el resto de este archivo, que nunca prueba Admin
      // contra permisos granulares por rol.
      for (const rol of ROLES.filter((r) => r !== "Admin")) {
        expect(tienePermiso(permisosDefaultPorRol(rol), "viaticos_comprobantes", "ver")).toBe(false);
      }
    });
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
