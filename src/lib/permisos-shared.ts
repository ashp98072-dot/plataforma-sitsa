import type { Modulo, RolGlobal } from "@/lib/roles";
import { MODULO_LABEL } from "@/lib/roles";

/** Submódulos de Control de Asistencias (RRHH). */
export const RRHH_SUBMODULOS = [
  "empleados",
  "marcajes",
  "reportes",
  "vacaciones",
  "en_ruta",
  "incidencias",
  "configuracion",
  "planillas",
  "descuentos",
  "prestaciones",
  "horas_extra",
  "inventario",
  "centros_costo",
  "entrevistas",
  "recordatorios",
  "bitacora_legal",
] as const;

export type RrhhSubmodulo = (typeof RRHH_SUBMODULOS)[number];

export const RRHH_SUBMODULO_LABEL: Record<RrhhSubmodulo, string> = {
  empleados: "Empleados",
  marcajes: "Registrar Marcaje",
  reportes: "Reportes",
  vacaciones: "Vacaciones",
  en_ruta: "En Ruta",
  incidencias: "Incidencias",
  configuracion: "Configuración",
  planillas: "Planillas",
  descuentos: "Descuentos",
  prestaciones: "Prestaciones",
  horas_extra: "Horas Extra",
  inventario: "Inventario",
  centros_costo: "Centros de Costo",
  entrevistas: "Entrevistas",
  recordatorios: "Recordatorios",
  bitacora_legal: "Bitácora Legal",
};

/**
 * Submódulos de Flota / Predios (alineados a control-flota).
 * Prefijo flota_ para no chocar con reportes RRHH.
 */
export const FLOTA_SUBMODULOS = [
  "flota_vehiculos",
  "flota_servicios",
  "flota_compras",
  "flota_lecturas",
  "flota_reportes",
  "flota_piloto",
  "flota_inventario",
] as const;

export type FlotaSubmodulo = (typeof FLOTA_SUBMODULOS)[number];

export const FLOTA_SUBMODULO_LABEL: Record<FlotaSubmodulo, string> = {
  flota_vehiculos: "Vehículos",
  flota_servicios: "Servicios / Taller",
  flota_compras: "Compras / Facturas",
  flota_lecturas: "Lecturas km",
  flota_reportes: "Reportes flota",
  flota_piloto: "Registrar viaje (piloto)",
  flota_inventario: "Inventario equipo",
};

/**
 * Módulos de plataforma (sin flota: se desglosa en FLOTA_SUBMODULOS).
 *
 * VIAT-1: "viaticos" es un permiso EXPLÍCITO e independiente del rol o de
 * ser supervisor — ningún rol lo incluye por defecto en
 * modulosPropiosDelRol() (queda como "cruzado" con permisoVacio para
 * todos, Admin aparte). Un Admin debe otorgarlo persona por persona desde
 * Usuarios.
 *
 * VIAT-2 — "OPERACIONES AUTORIZA, FACTURADOR PAGA": se separa la capacidad
 * de autorizar de la de pagar/entregar en dos permisos propios, mismo
 * catálogo ver/crear/editar/eliminar de siempre, sin segundo sistema de
 * permisos:
 *   - "viaticos_autorizar": `editar` = autorizar (PROGRAMADO -> AUTORIZADO).
 *   - "viaticos_pagar": `editar` = registrar entrega/pago
 *     (AUTORIZADO -> ENTREGADO); `ver` = ver la bandeja "Viáticos por
 *     pagar" (incluye dato bancario ya existente en la ficha RRHH del
 *     empleado — banco/cuenta_bancaria/tipo_cuenta — nunca se inventa ni
 *     se muestra en ningún otro panel de viáticos).
 *   - "viaticos" queda con alcance más angosto: `ver` = ver el Control de
 *     Viáticos general (TMS, todas las solicitudes); `editar` = liquidar
 *     (ENTREGADO -> LIQUIDADO), el único paso que no se reasignó a un
 *     permiso propio en esta fase.
 * OPS-1 (actualización): "Facturador" SÍ es ahora un RolGlobal propio
 * (jerarquía operativa real confirmada por la empresa) — pero eso NO
 * cambia la regla de fondo: `viaticos_pagar` sigue siendo un permiso
 * explícito, independiente del rol, que un Admin puede otorgar a
 * CUALQUIER usuario (Facturador lo trae por defecto, pero también podría
 * quitársele o dárselo a alguien con otro rol). Igual que
 * "viaticos_autorizar" (que GerenteOperaciones/JefeOperaciones traen por
 * defecto) y el nuevo "viajes_cerrar" (que JefeOperaciones/
 * GerenteOperaciones traen por defecto): el rol solo fija el DEFAULT al
 * crear el usuario, nunca es la autoridad real del endpoint. Ver
 * src/lib/tms/viaticos.ts, src/lib/tms/cierre-viaje.ts y
 * src/lib/tenant.ts (requireTenantViaticosAutorizar/Pagar/ViajesCerrar).
 */
export const PLATAFORMA_PERMISIBLES = [
  "multas",
  "tms",
  "clientes",
  "facturacion",
  "contabilidad",
  "reciclaje",
  "tarimas",
  "cms",
  "viaticos",
  "viaticos_autorizar",
  "viaticos_pagar",
  // VIATICOS-FIRMA: liquidar (ENTREGADO -> LIQUIDADO) deja de vivir bajo
  // el permiso genérico "viaticos" y pasa a ser su propio permiso
  // explícito — mismo patrón exacto que viaticos_autorizar/viaticos_pagar
  // arriba. Facturador lo trae por defecto (junto con viaticos_pagar);
  // ningún otro rol lo trae por defecto (ver modulosPropiosDelRol). "No
  // mantener fallback permanente a viaticos:editar" — un usuario que hoy
  // liquida solo por tener viaticos:editar manual necesita este permiso
  // nuevo asignado explícitamente (ver reporte de entrega, riesgo #14).
  "viaticos_liquidar",
  // VIATICOS-COMPROBANTE-PDF: descargar en PDF los comprobantes de
  // autorización de viáticos (incluye la firma electrónica interna) —
  // permiso propio y explícito, mismo patrón exacto que
  // viaticos_autorizar/viaticos_pagar/viaticos_liquidar arriba. Ningún
  // rol lo trae por defecto (ver modulosPropiosDelRol) — un Admin debe
  // otorgarlo persona por persona desde Usuarios, igual que los otros
  // tres. Deliberadamente NO se llama "viaticos_exportar" para no
  // confundirse con la exportación Excel/banco ya existente de la
  // bandeja "Viáticos por pagar" (esa sigue gateada por
  // viaticos_pagar, sin cambios aquí).
  "viaticos_comprobantes",
  // OPS-1: cierre administrativo del viaje (Descargado -> Cerrado).
  // Mismo patrón que viaticos_autorizar/viaticos_pagar: permiso propio,
  // ningún rol lo trae salvo los explícitamente definidos abajo
  // (GerenteOperaciones/JefeOperaciones), y el endpoint de cierre lo
  // exige sin importar el rol.
  "viajes_cerrar",
  // Corrección de matriz de permisos: Programación ya NO depende
  // exclusivamente de "tms" — es un permiso propio (ver/crear/editar/
  // eliminar), igual que viajes_cerrar. Sigue exigiendo que la empresa
  // tenga el módulo "tms" habilitado (Programación vive dentro de TMS),
  // pero dentro de eso, quién puede crear/editar viajes ahora se decide
  // con este permiso explícito, no con el genérico "tms:editar". Ver
  // requireTenantProgramacion en src/lib/tenant.ts.
  "programacion",
  // OPS-5.2a: Rutas (catálogo maestro de rutas/servicios por cliente,
  // VIAT-4) deja de depender exclusivamente de "tms" — mismo patrón que
  // "programacion": permiso propio (ver/crear/editar/eliminar), sigue
  // exigiendo que la empresa tenga "tms" habilitado (Rutas vive dentro
  // de TMS, no es una capacidad de empresa aparte — NO se agrega
  // "rutas" a MODULOS/roles.ts). Por compatibilidad histórica, los
  // endpoints de Rutas aceptan rutas:<acción> O tms:<acción> — ver
  // requireTenantRutas en src/lib/tenant.ts.
  "rutas",
  // FLOTA-COMBUSTIBLE-1 (Fase 2): revisar/aprobar/rechazar las cargas de
  // combustible que el piloto registra desde el Portal — permiso propio
  // y explícito, NO agregado a FLOTA_SUBMODULOS a propósito: ese arreglo
  // se reparte por completo ("...FLOTA_SUBMODULOS") a varios roles
  // (Operaciones legado, CoordinadorPredios, Visualizador) que nunca
  // pidieron autoridad de aprobación de gastos — meterlo ahí se lo habría
  // dado sin que nadie lo decidiera. En cambio, sigue el mismo patrón que
  // viaticos_autorizar: GerenteOperaciones y JefeOperaciones lo traen por
  // defecto (ver modulosPropiosDelRol) porque el usuario confirmó "los de
  // operaciones son los que autorizan"; ningún otro rol lo trae por
  // defecto. Gatea sobre el módulo de empresa "flota" (ver
  // moduloEmpresaDelPermiso), igual que el resto de Flota/Predios.
  "flota_combustible",
] as const;

export type PlataformaPermisible = (typeof PLATAFORMA_PERMISIBLES)[number];

export type AccionPermiso = "ver" | "crear" | "editar" | "eliminar";

export type PermisoModulo = {
  modulo: string;
  puedeVer: boolean;
  puedeCrear: boolean;
  puedeEditar: boolean;
  puedeEliminar: boolean;
};

export function permisoVacio(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: false,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  };
}

export function permisoFull(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: true,
    puedeEliminar: true,
  };
}

export function permisoSoloVer(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: true,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  };
}

/** Ver + crear (sin editar/eliminar). Ideal para kiosco de marcaje. */
export function permisoVerCrear(modulo: string): PermisoModulo {
  return {
    modulo,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: false,
    puedeEliminar: false,
  };
}

export function esRrhhSubmodulo(m: string): m is RrhhSubmodulo {
  return (RRHH_SUBMODULOS as readonly string[]).includes(m);
}

export function esFlotaSubmodulo(m: string): m is FlotaSubmodulo {
  return (FLOTA_SUBMODULOS as readonly string[]).includes(m);
}

export function esPlataformaPermisible(m: string): m is PlataformaPermisible {
  return (PLATAFORMA_PERMISIBLES as readonly string[]).includes(m);
}

/**
 * Módulo de plataforma "padre" del que depende un permiso — para filtrar
 * la matriz de Usuarios por los módulos que la empresa actual (slug de la
 * URL) tiene habilitados en `empresa.modulos` (modulos_json). Reutiliza el
 * mecanismo YA existente de módulos por empresa (src/lib/empresas.ts +
 * requireTenant* en tenant.ts) — no crea ninguna tabla ni flag nuevos.
 *
 * "viaticos"/"viaticos_autorizar"/"viaticos_pagar"/"viajes_cerrar"/
 * "programacion" no son un Modulo de navegación propio (no aparecen en
 * empresa.modulos) — viven dentro de "tms", así que su disponibilidad por
 * empresa depende de si esa empresa tiene "tms" habilitado. Los que SÍ
 * son un Modulo real (tms, clientes, facturacion, contabilidad, reciclaje,
 * tarimas, cms) dependen de sí mismos. RRHH/Flota submódulos devuelven
 * null (no aplica este filtro — se rigen por otro mecanismo).
 */
export function moduloEmpresaDelPermiso(m: string): Modulo | null {
  if (m === "multas") return "tms";
  if (m === "flota_combustible") return "flota";
  if (
    m === "viaticos" ||
    m === "viaticos_autorizar" ||
    m === "viaticos_pagar" ||
    m === "viaticos_liquidar" ||
    m === "viaticos_comprobantes" ||
    m === "viajes_cerrar" ||
    m === "programacion" ||
    // OPS-5.2a: "rutas" tampoco es un Modulo de navegación propio — igual
    // que "programacion", su disponibilidad por empresa depende de "tms".
    m === "rutas"
  ) {
    return "tms";
  }
  if (esPlataformaPermisible(m)) return m as Modulo;
  return null;
}

export function labelPermiso(modulo: string): string {
  if (modulo === "multas") return "Multas y sanciones";
  if (esRrhhSubmodulo(modulo)) return RRHH_SUBMODULO_LABEL[modulo];
  if (esFlotaSubmodulo(modulo)) return FLOTA_SUBMODULO_LABEL[modulo];
  if (modulo === "flota") return MODULO_LABEL.flota;
  // "viaticos"/"viaticos_autorizar"/"viaticos_pagar" no son un Modulo de
  // roles.ts (no tocan el gate de módulo por empresa/rol) — solo permisos
  // explícitos dentro de PLATAFORMA_PERMISIBLES.
  if (modulo === "viaticos") return "Viáticos (ver control general)";
  if (modulo === "viaticos_autorizar") return "Viáticos: autorizar";
  if (modulo === "viaticos_pagar") return "Viáticos: registrar pago/entrega";
  if (modulo === "viaticos_liquidar") return "Viáticos: liquidar";
  if (modulo === "viaticos_comprobantes") return "Viáticos: descargar comprobantes de autorización";
  if (modulo === "viajes_cerrar") return "Viajes: cerrar administrativamente";
  if (modulo === "programacion") return "Programación";
  if (modulo === "rutas") return "Rutas";
  if (modulo === "flota_combustible") return "Flota: revisar/aprobar combustible";
  if (esPlataformaPermisible(modulo)) {
    return MODULO_LABEL[modulo as Modulo] ?? modulo;
  }
  return modulo;
}

/** Etiqueta amigable del rol en formularios. */
export function labelRol(rol: string): string {
  if (rol === "Reclutamiento") return "Reclutamiento";
  if (rol === "CoordinadorPredios") return "Predios";
  if (rol === "CoordinadorCompras") return "Compras";
  if (rol === "Piloto") return "Piloto";
  if (rol === "Marcaje") return "Marcaje (kiosco)";
  if (rol === "GerenteOperaciones") return "Gerente de Operaciones";
  if (rol === "JefeOperaciones") return "Jefe de Operaciones";
  if (rol === "AuxiliarOperaciones") return "Auxiliar de Operaciones";
  if (rol === "Facturador") return "Facturador";
  if (rol === "Operaciones") return "Operaciones (legado)";
  return rol;
}

/** Catálogo total asignable (RRHH + Predios + plataforma). */
export function catalogoGlobalPermisos(): string[] {
  return [...RRHH_SUBMODULOS, ...FLOTA_SUBMODULOS, ...PLATAFORMA_PERMISIBLES];
}

/** Apartados colapsables en Usuarios y agrupación del menú. */
export type GrupoPermisosId =
  | "rrhh"
  | "operaciones"
  | "flota"
  | "contabilidad"
  | "otros";

export const GRUPOS_PERMISOS: {
  id: GrupoPermisosId;
  titulo: string;
  descripcion: string;
  modulos: string[];
}[] = [
  {
    id: "rrhh",
    titulo: "Permisos RRHH por módulos",
    descripcion: "Control de asistencias: personal, marcajes, vacaciones…",
    modulos: [...RRHH_SUBMODULOS],
  },
  {
    id: "operaciones",
    titulo: "Permisos Operaciones por módulos",
    descripcion:
      "Programación, TMS / logística, clientes, facturación de clientes, reciclaje, tarimas, viáticos (control, autorizar, pagar) y cierre administrativo de viajes.",
    modulos: [
      "programacion",
      "multas",
      "rutas",
      "tms",
      "clientes",
      "facturacion",
      "reciclaje",
      "tarimas",
      "viaticos",
      "viaticos_autorizar",
      "viaticos_pagar",
      "viaticos_liquidar",
      "viaticos_comprobantes",
      "viajes_cerrar",
    ],
  },
  {
    id: "flota",
    titulo: "Permisos Flota / Predios por módulos",
    descripcion: "Vehículos, taller, lecturas, reportes, viajes y revisión de combustible.",
    // "flota_combustible" se agrega aquí como literal (no dentro de
    // FLOTA_SUBMODULOS) a propósito: sigue siendo visible/asignable en
    // este grupo de Usuarios, pero sin heredar los "...FLOTA_SUBMODULOS"
    // que se reparten completos a Operaciones (legado), CoordinadorPredios
    // y Visualizador — ver el comentario en PLATAFORMA_PERMISIBLES.
    modulos: [...FLOTA_SUBMODULOS, "flota_combustible"],
  },
  {
    id: "contabilidad",
    titulo: "Permisos Contabilidad / Facturación",
    descripcion: "Cuentas, asientos, cartera y facturación de la empresa.",
    modulos: ["contabilidad", "facturacion"],
  },
  {
    id: "otros",
    titulo: "Otros módulos",
    descripcion: "Sitio web (CMS) y extras.",
    modulos: ["cms"],
  },
];

/** Grupo principal a abrir según el rol al crear usuario. */
export function grupoPrincipalDelRol(rol: RolGlobal): GrupoPermisosId {
  switch (rol) {
    case "RRHH":
    case "Reclutamiento":
    case "Marcaje":
      return "rrhh";
    case "Contabilidad":
      return "contabilidad";
    case "Operaciones":
    case "GerenteOperaciones":
    case "JefeOperaciones":
    case "AuxiliarOperaciones":
    case "Facturador":
      return "operaciones";
    case "CoordinadorPredios":
    case "CoordinadorCompras":
    case "Piloto":
      return "flota";
    default:
      return "rrhh";
  }
}

/** Módulos propios del perfil (matriz principal al crear/editar usuario). */
export function modulosPropiosDelRol(rol: RolGlobal): string[] {
  switch (rol) {
    case "Admin":
      return catalogoGlobalPermisos();
    case "RRHH":
      return [...RRHH_SUBMODULOS];
    case "Reclutamiento":
      return ["entrevistas", "empleados"];
    case "Marcaje":
      return ["marcajes"];
    case "Contabilidad":
      return ["contabilidad", "facturacion", "clientes"];
    case "Operaciones":
      // TMS + Predios + clientes + facturación por cliente + otros ops.
      // "programacion" se agrega para que el rol legado siga viendo/
      // editando Programación sin regresión, ahora que ese permiso es
      // propio (antes viajaba implícito dentro de "tms"). OPS-5.2a:
      // mismo criterio para "rutas" (antes viajaba implícito dentro de
      // "tms" también).
      return [
        "tms",
        "programacion",
        "rutas",
        "clientes",
        "facturacion",
        ...FLOTA_SUBMODULOS,
        "reciclaje",
        "tarimas",
      ];
    // OPS-1 — jerarquía operativa real. "TMS seguimiento" sigue viviendo
    // bajo el permiso "tms" (requireTenantModulo(slug, "tms")) — separarlo
    // queda pendiente de reportar, no implementado aún.
    // "Programación" SÍ es ahora un permiso propio (ver requireTenant
    // Programacion en tenant.ts) — Gerente/Jefe/Auxiliar lo traen por
    // defecto, Facturador NO. GerenteOperaciones y JefeOperaciones traen
    // por defecto viaticos_autorizar y viajes_cerrar; NUNCA
    // viaticos_pagar (eso es de Facturador). AuxiliarOperaciones NO trae
    // ninguno de los tres permisos de viáticos/cierre — solo
    // tms+programacion+rutas+clientes (crear/editar Programación/Rutas),
    // tal como se confirmó. OPS-5.2a: "rutas" ahora es también un
    // permiso propio (ver requireTenantRutas en tenant.ts) — mismos tres
    // roles operativos lo traen por defecto, Facturador NO (mismo
    // criterio que "programacion").
    case "GerenteOperaciones":
    case "JefeOperaciones":
      // FLOTA-COMBUSTIBLE-1 (Fase 2): "los de operaciones son los que
      // autorizan" (confirmado por el usuario) — mismo criterio que
      // viaticos_autorizar arriba: estos dos roles sí lo traen por
      // defecto, AuxiliarOperaciones/Facturador NO.
      return ["tms", "programacion", "rutas", "clientes", "viaticos", "viaticos_autorizar", "viajes_cerrar", "multas", "flota_combustible"];
    case "AuxiliarOperaciones":
      return ["tms", "programacion", "rutas", "clientes", "multas"];
    case "Facturador":
      // Facturador NO recibe "tms" por defecto (no debe editar viajes en
      // general) — su alcance es viaticos_pagar/viaticos_liquidar (cada
      // uno con su propio guard, requireTenantViaticosPagar/Liquidar) y
      // facturación. "viaticos" (control general) se otorga SOLO lectura
      // — ver permisosDefaultPorRol, caso especial igual al de "multas"
      // para GerenteOperaciones/JefeOperaciones — Facturador nunca recibe
      // viaticos_autorizar ni viajes_cerrar. Ver "viajes cerrados listos
      // para facturación" queda cubierto por la alerta de la campana
      // (gateada por facturacion:ver), no por acceso a TMS.
      return ["viaticos", "viaticos_pagar", "viaticos_liquidar", "facturacion"];
    case "CoordinadorPredios":
      // Predios = flota. TMS/Reciclaje/Tarimas van en otras áreas si se otorgan.
      return [...FLOTA_SUBMODULOS];
    case "CoordinadorCompras":
      return ["flota_compras", "flota_servicios", "flota_vehiculos"];
    case "Piloto":
      return ["flota_piloto", "flota_lecturas"];
    case "Visualizador":
      return [
        ...RRHH_SUBMODULOS,
        ...FLOTA_SUBMODULOS,
        "tms",
        "clientes",
        "facturacion",
        "contabilidad",
        "reciclaje",
        "tarimas",
      ];
    default:
      return [];
  }
}

/**
 * Módulos de otras áreas / plazas que se pueden otorgar además del perfil.
 * Ej.: Operaciones → Planillas; Contabilidad → Vehículos / Predios…
 */
export function modulosOtrasAreasDelRol(rol: RolGlobal): string[] {
  // Piloto es una cuenta operativa no vinculada a RRHH; no se le ofrecen
  // permisos cruzados. Los colaboradores usan /portal con identidad propia.
  if (rol === "Admin" || rol === "Marcaje" || rol === "Piloto") return [];
  const propios = new Set(modulosPropiosDelRol(rol));
  return catalogoGlobalPermisos().filter((m) => !propios.has(m));
}

/** Catálogo completo editable para un rol (propios + cruzados). */
export function catalogoPermisosRol(rol: RolGlobal): string[] {
  return [...modulosPropiosDelRol(rol), ...modulosOtrasAreasDelRol(rol)];
}

export function permisosDefaultPorRol(rol: RolGlobal): PermisoModulo[] {
  if (rol === "Admin") {
    return catalogoPermisosRol("Admin").map((m) => permisoFull(m));
  }

  const propios = modulosPropiosDelRol(rol);
  const cruzados = modulosOtrasAreasDelRol(rol);

  if (rol === "GerenteOperaciones" || rol === "JefeOperaciones" || rol === "AuxiliarOperaciones") {
    return [
      ...propios.map((m) => m === "multas"
        ? { ...permisoVerCrear(m), puedeEditar: rol !== "AuxiliarOperaciones" }
        : permisoFull(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "Visualizador") {
    return [
      ...propios.map((m) => permisoSoloVer(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "Reclutamiento") {
    return [
      permisoFull("entrevistas"),
      { ...permisoVerCrear("empleados") },
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  // VIATICOS-FIRMA: Facturador tiene su propio caso especial (igual que
  // GerenteOperaciones/JefeOperaciones lo tienen para "multas" arriba) —
  // "viaticos" (control general) queda SOLO LECTURA por defecto, nunca
  // editar (eso ya NO significa "liquidar" — liquidar es
  // viaticos_liquidar, propio y separado). viaticos_pagar/
  // viaticos_liquidar/facturacion sí quedan con permiso completo.
  if (rol === "Facturador") {
    return [
      ...propios.map((m) => (m === "viaticos" ? permisoSoloVer(m) : permisoFull(m))),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (
    rol === "RRHH" ||
    rol === "Contabilidad" ||
    rol === "Operaciones"
  ) {
    return [
      ...propios.map((m) => permisoFull(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "CoordinadorPredios") {
    return [
      ...propios.map((m) => permisoFull(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "CoordinadorCompras") {
    return [
      ...propios.map((m) => permisoFull(m)),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "Piloto") {
    return [
      ...propios.map((m) =>
        m === "flota_piloto" ? permisoFull(m) : permisoSoloVer(m),
      ),
      ...cruzados.map((m) => permisoVacio(m)),
    ];
  }

  if (rol === "Marcaje") {
    return propios.map((m) => permisoVerCrear(m));
  }

  return catalogoPermisosRol(rol).map((m) => permisoVacio(m));
}

export function mergePermisosConCatalogo(
  rol: RolGlobal,
  base: PermisoModulo[],
): PermisoModulo[] {
  const map = new Map(base.map((p) => [p.modulo, p]));
  // Compat: si solo venía el paraguas "flota", expandir a submódulos.
  const legacyFlota = map.get("flota");
  if (legacyFlota) {
    for (const sub of FLOTA_SUBMODULOS) {
      if (!map.has(sub)) {
        map.set(sub, { ...legacyFlota, modulo: sub });
      }
    }
  }
  return catalogoPermisosRol(rol).map(
    (m) => map.get(m) ?? permisoVacio(m),
  );
}

export function tienePermiso(
  permisos: PermisoModulo[],
  modulo: string,
  accion: AccionPermiso,
): boolean {
  const p = permisos.find((x) => x.modulo === modulo);
  if (p) {
    switch (accion) {
      case "ver":
        if (p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar) {
          return true;
        }
        break;
      case "crear":
        if (p.puedeCrear) return true;
        break;
      case "editar":
        if (p.puedeEditar) return true;
        break;
      case "eliminar":
        if (p.puedeEliminar) return true;
        break;
    }
  }
  // Paraguas legacy "flota" → cualquier submódulo Predios
  if (esFlotaSubmodulo(modulo)) {
    return tienePermisoDirecto(permisos, "flota", accion);
  }
  return false;
}

function tienePermisoDirecto(
  permisos: PermisoModulo[],
  modulo: string,
  accion: AccionPermiso,
): boolean {
  const p = permisos.find((x) => x.modulo === modulo);
  if (!p) return false;
  switch (accion) {
    case "ver":
      return p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar;
    case "crear":
      return p.puedeCrear;
    case "editar":
      return p.puedeEditar;
    case "eliminar":
      return p.puedeEliminar;
    default:
      return false;
  }
}

/** Plataforma + rrhh/flota derivados de la matriz (para menú / acceso). */
export function modulosPlataformaDesdePermisos(
  permisos: PermisoModulo[],
): Modulo[] {
  const out = new Set<Modulo>();
  for (const p of permisos) {
    if (!tienePermiso(permisos, p.modulo, "ver") && p.modulo !== "flota") {
      continue;
    }
    if (p.modulo === "flota" && tienePermisoDirecto(permisos, "flota", "ver")) {
      out.add("flota");
      continue;
    }
    if (!tienePermiso(permisos, p.modulo, "ver")) continue;
    // "viaticos"/"viaticos_autorizar"/"viaticos_pagar"/"viaticos_liquidar"/
    // "viajes_cerrar"/"programacion"/"rutas" son permisos de acción dentro
    // de TMS, no módulos de navegación propios (no hay un Modulo
    // "viaticos*"/"viajes_cerrar"/"programacion"/"rutas" en roles.ts) — se
    // excluyen aquí para no romper el tipo Modulo[] de esta función;
    // siguen siendo PlataformaPermisible válidos para el resto del
    // sistema (catálogo, editor de permisos, tienePermiso()).
    if (
      esPlataformaPermisible(p.modulo) &&
      p.modulo !== "multas" &&
      p.modulo !== "viaticos" &&
      p.modulo !== "viaticos_autorizar" &&
      p.modulo !== "viaticos_pagar" &&
      p.modulo !== "viaticos_liquidar" &&
      p.modulo !== "viaticos_comprobantes" &&
      p.modulo !== "viajes_cerrar" &&
      p.modulo !== "programacion" &&
      p.modulo !== "rutas" &&
      p.modulo !== "flota_combustible"
    ) {
      out.add(p.modulo);
    }
    if (esRrhhSubmodulo(p.modulo)) {
      out.add("rrhh");
    }
    if (esFlotaSubmodulo(p.modulo)) {
      out.add("flota");
    }
  }
  return [...out];
}

export const RRHH_NAV: {
  sub: RrhhSubmodulo;
  label: string;
  path: string;
}[] = [
  { sub: "empleados", label: "Empleados", path: "empleados" },
  { sub: "marcajes", label: "Registrar Marcaje", path: "marcajes" },
  { sub: "reportes", label: "Reportes", path: "reportes" },
  { sub: "vacaciones", label: "Vacaciones / En Ruta", path: "vacaciones" },
  { sub: "incidencias", label: "Incidencias", path: "incidencias" },
  { sub: "planillas", label: "Planillas", path: "planillas" },
  { sub: "descuentos", label: "Descuentos", path: "descuentos" },
  { sub: "prestaciones", label: "Prestaciones", path: "prestaciones" },
  { sub: "horas_extra", label: "Horas Extra", path: "horas-extra" },
  { sub: "inventario", label: "Inventario", path: "inventario" },
  { sub: "centros_costo", label: "Centros de Costo", path: "centros-costo" },
  { sub: "entrevistas", label: "Entrevistas", path: "entrevistas" },
  { sub: "recordatorios", label: "Recordatorios", path: "recordatorios" },
  { sub: "bitacora_legal", label: "Bitácora Legal", path: "bitacora-legal" },
  { sub: "configuracion", label: "Configuración", path: "configuracion" },
  {
    sub: "configuracion",
    label: "Ubicaciones de Marcaje",
    path: "ubicaciones-marcaje",
  },
];

/** Navegación Predios / control-flota. */
export const FLOTA_NAV: {
  // "flota_combustible" no es un FlotaSubmodulo (ver comentario en
  // PLATAFORMA_PERMISIBLES) — el tipo se ensancha solo aquí para poder
  // listarlo en esta navegación, sin agregarlo al arreglo FLOTA_SUBMODULOS
  // que se reparte completo a varios roles por defecto.
  sub: FlotaSubmodulo | "flota_combustible";
  label: string;
  path: string;
}[] = [
  { sub: "flota_vehiculos", label: "Vehículos", path: "vehiculos" },
  { sub: "flota_servicios", label: "En taller", path: "taller" },
  { sub: "flota_servicios", label: "Registrar servicio", path: "servicios" },
  { sub: "flota_servicios", label: "Historial servicios", path: "historial-servicios" },
  { sub: "flota_compras", label: "Compras", path: "compras" },
  { sub: "flota_inventario", label: "Inventario equipo", path: "inventario-equipo" },
  { sub: "flota_lecturas", label: "Lecturas", path: "lecturas" },
  { sub: "flota_reportes", label: "Reportes flota", path: "reportes" },
  { sub: "flota_piloto", label: "Registrar viaje", path: "piloto" },
  // FLOTA-COMBUSTIBLE-1 (Fase 2): revisión/aprobación de cargas de
  // combustible del piloto.
  { sub: "flota_combustible", label: "Combustible", path: "combustible" },
];
