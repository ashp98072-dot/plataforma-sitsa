import { describe, expect, it } from "vitest";
import { ROLES } from "./roles";
import {
  GRUPOS_PERMISOS,
  esPlataformaPermisible,
  labelPermiso,
  mergePermisosConCatalogo,
  moduloEmpresaDelPermiso,
  permisoFull,
  permisoSoloVer,
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

  describe("FLOTA-COMBUSTIBLE-1 (Fase 2) — flota_combustible", () => {
    it("Jefe y Gerente de Operaciones lo traen por defecto (mismo criterio que viaticos_autorizar: 'los de operaciones son los que autorizan')", () => {
      expect(tienePermiso(permisosDefaultPorRol("JefeOperaciones"), "flota_combustible", "editar")).toBe(true);
      expect(tienePermiso(permisosDefaultPorRol("GerenteOperaciones"), "flota_combustible", "editar")).toBe(true);
    });

    it("Auxiliar de Operaciones NO lo trae por defecto", () => {
      expect(tienePermiso(permisosDefaultPorRol("AuxiliarOperaciones"), "flota_combustible", "editar")).toBe(false);
    });

    it("ningún otro rol lo trae por defecto (incluye CoordinadorPredios/Operaciones legado/Visualizador, que reciben ...FLOTA_SUBMODULOS pero flota_combustible queda fuera de ese arreglo a propósito)", () => {
      const otros = ROLES.filter(
        (r) => r !== "Admin" && r !== "GerenteOperaciones" && r !== "JefeOperaciones",
      );
      for (const rol of otros) {
        expect(tienePermiso(permisosDefaultPorRol(rol), "flota_combustible", "editar")).toBe(false);
      }
    });
  });

  describe("PERMISOS-GASTOS-FONDOS-UI-1 — fila 'Gastos operativos / Solicitudes de fondo'", () => {
    it("'gastos' es un módulo asignable en el catálogo (aparece en Administración > Usuarios)", () => {
      expect(esPlataformaPermisible("gastos")).toBe(true);
    });

    it("tiene una etiqueta propia (no cae al genérico MODULO_LABEL, que no tiene 'gastos')", () => {
      expect(labelPermiso("gastos")).toBe("Gastos operativos / Solicitudes de fondo");
    });

    it("depende del módulo de empresa 'tms' (igual que programacion/rutas) — no es una fila de TMS/Logística sustituta", () => {
      expect(moduloEmpresaDelPermiso("gastos")).toBe("tms");
    });

    it("aparece en el grupo 'Permisos Operaciones por módulos', no dentro de TMS/Logística ni duplicando esa fila", () => {
      const operaciones = GRUPOS_PERMISOS.find((g) => g.id === "operaciones");
      expect(operaciones?.modulos).toContain("gastos");
      // Fila propia e independiente de "tms" — ambas conviven en la matriz.
      expect(operaciones?.modulos).toContain("tms");
    });

    it("ningún rol lo trae marcado por defecto salvo Admin (mantener matriz actual — la fila nace vacía)", () => {
      for (const rol of ROLES.filter((r) => r !== "Admin")) {
        expect(tienePermiso(permisosDefaultPorRol(rol), "gastos", "ver")).toBe(false);
      }
      expect(tienePermiso(permisosDefaultPorRol("Admin"), "gastos", "ver")).toBe(true);
    });

    it("al fusionar con el catálogo, un usuario existente sin 'gastos' guardado lo recibe vacío (no se pierde ni se autoconcede al recargar)", () => {
      const permisos = mergePermisosConCatalogo("JefeOperaciones", [
        { modulo: "tms", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true },
      ]);
      expect(tienePermiso(permisos, "gastos", "ver")).toBe(false);
      expect(tienePermiso(permisos, "gastos", "crear")).toBe(false);
    });

    it("al fusionar con el catálogo, un 'gastos' ya guardado se conserva tal cual (persiste al recargar)", () => {
      const permisos = mergePermisosConCatalogo("JefeOperaciones", [
        permisoFull("gastos"),
      ]);
      expect(tienePermiso(permisos, "gastos", "ver")).toBe(true);
      expect(tienePermiso(permisos, "gastos", "crear")).toBe(true);
      expect(tienePermiso(permisos, "gastos", "editar")).toBe(true);
      expect(tienePermiso(permisos, "gastos", "eliminar")).toBe(true);
    });

    it("usuario con solo gastos:ver puede entrar pero NO puede crear, y no obtiene tms:crear de regalo", () => {
      const permisos = mergePermisosConCatalogo("Visualizador", [
        permisoSoloVer("gastos"),
      ]);
      expect(tienePermiso(permisos, "gastos", "ver")).toBe(true);
      expect(tienePermiso(permisos, "gastos", "crear")).toBe(false);
      expect(tienePermiso(permisos, "tms", "crear")).toBe(false);
    });

    it("usuario con gastos:crear puede crear sin necesitar tms:crear", () => {
      const permisos = mergePermisosConCatalogo("Visualizador", [
        permisoFull("gastos"),
      ]);
      expect(tienePermiso(permisos, "gastos", "crear")).toBe(true);
      expect(tienePermiso(permisos, "tms", "crear")).toBe(false);
    });
  });

  describe("permisos independientes para autorizar y rechazar Fondos/Gastos", () => {
    it("es un módulo asignable propio, con etiqueta clara y bajo el módulo de empresa 'tms'", () => {
      expect(esPlataformaPermisible("gastos_autorizar")).toBe(true);
      expect(labelPermiso("gastos_autorizar")).toBe("Solicitudes de fondo: autorizar y rechazar");
      expect(moduloEmpresaDelPermiso("gastos_autorizar")).toBe("tms");
      expect(esPlataformaPermisible("gastos_operativos_autorizar")).toBe(true);
      expect(labelPermiso("gastos_operativos_autorizar")).toBe("Gastos operativos: autorizar y rechazar");
      expect(moduloEmpresaDelPermiso("gastos_operativos_autorizar")).toBe("tms");
      expect(labelPermiso("viaticos_autorizar")).toBe("Viáticos: autorizar y rechazar");
    });

    it("aparece en el grupo 'Operaciones' de la matriz de Usuarios, junto a (no dentro de) 'gastos'", () => {
      const operaciones = GRUPOS_PERMISOS.find((g) => g.id === "operaciones");
      expect(operaciones?.modulos).toContain("gastos_autorizar");
      expect(operaciones?.modulos).toContain("gastos_operativos_autorizar");
      expect(operaciones?.modulos).toContain("gastos");
    });

    it("Jefe y Gerente de Operaciones lo traen por defecto (mismo criterio que viaticos_autorizar); ningún otro rol salvo Admin", () => {
      expect(tienePermiso(permisosDefaultPorRol("JefeOperaciones"), "gastos_autorizar", "editar")).toBe(true);
      expect(tienePermiso(permisosDefaultPorRol("GerenteOperaciones"), "gastos_autorizar", "editar")).toBe(true);
      expect(tienePermiso(permisosDefaultPorRol("Admin"), "gastos_autorizar", "editar")).toBe(true);
      for (const rol of ROLES.filter((r) => r !== "Admin" && r !== "JefeOperaciones" && r !== "GerenteOperaciones")) {
        expect(tienePermiso(permisosDefaultPorRol(rol), "gastos_autorizar", "editar")).toBe(false);
      }
    });

    it("AuxiliarOperaciones y Facturador NO lo traen (mismo criterio que viaticos_autorizar)", () => {
      expect(tienePermiso(permisosDefaultPorRol("AuxiliarOperaciones"), "gastos_autorizar", "editar")).toBe(false);
      expect(tienePermiso(permisosDefaultPorRol("Facturador"), "gastos_autorizar", "editar")).toBe(false);
    });

    it("no cambia el permiso 'gastos' base: tener 'gastos' full NO otorga 'gastos_autorizar'", () => {
      const permisos = mergePermisosConCatalogo("Visualizador", [permisoFull("gastos")]);
      expect(tienePermiso(permisos, "gastos", "editar")).toBe(true);
      expect(tienePermiso(permisos, "gastos_autorizar", "editar")).toBe(false);
      expect(tienePermiso(permisos, "gastos_operativos_autorizar", "editar")).toBe(false);
    });

    it("un usuario existente sin 'gastos_autorizar' guardado lo recibe vacío al recargar (secure by default)", () => {
      const permisos = mergePermisosConCatalogo("Contabilidad", [
        { modulo: "gastos", puedeVer: true, puedeCrear: true, puedeEditar: true, puedeEliminar: true },
      ]);
      expect(tienePermiso(permisos, "gastos_autorizar", "editar")).toBe(false);
      expect(tienePermiso(permisos, "gastos_operativos_autorizar", "editar")).toBe(false);
    });

    it("un 'gastos_autorizar' otorgado explícitamente se conserva al recargar", () => {
      const permisos = mergePermisosConCatalogo("Visualizador", [permisoFull("gastos_autorizar")]);
      expect(tienePermiso(permisos, "gastos_autorizar", "editar")).toBe(true);
    });

    it("los permisos de Fondos y Gastos son independientes", () => {
      const soloFondos = mergePermisosConCatalogo("Visualizador", [permisoFull("gastos_autorizar")]);
      const soloGastos = mergePermisosConCatalogo("Visualizador", [permisoFull("gastos_operativos_autorizar")]);
      expect(tienePermiso(soloFondos, "gastos_operativos_autorizar", "editar")).toBe(false);
      expect(tienePermiso(soloGastos, "gastos_autorizar", "editar")).toBe(false);
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
