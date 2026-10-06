import type { PermisoModulo } from "./permisos-shared";
import { tienePermiso } from "./permisos-shared";
import { puedeEditarModulo, type Modulo, type RolGlobal } from "./roles";
import { alcanceFacturacionPorRol } from "./facturacion/alcance-rol";

export type FlagPermiso = keyof Omit<PermisoModulo, "modulo">;
export type AreaPermiso = "rrhh" | "operaciones" | "flota" | "contabilidad" | "sitio" | "administracion";
export type AccionCatalogo = {
  id: string; label: string; modulo: string; flag: FlagPermiso;
  /** Aclaración opcional que la matriz de Usuarios muestra bajo la etiqueta. */
  descripcion?: string;
  /** Únicamente un grant equivalente anterior, nunca eliminar -> anular. */
  legacy?: { modulo: string; flag: FlagPermiso };
  /** Acción del mismo módulo que debe estar activa para que esta lo esté (p. ej. editar requiere ver). Activarla activa la requerida; quitar la requerida la limpia. */
  requiere?: string;
  /** Subtítulo con el que la matriz de Usuarios agrupa visualmente acciones consecutivas del módulo (no cambia el catálogo ni la persistencia). */
  grupo?: string;
};
export type ModuloCatalogo = { id: string; label: string; area: AreaPermiso; acciones: AccionCatalogo[] };
export const AREAS_PERMISOS = [
  {id:"rrhh",titulo:"RRHH"},
  {id:"operaciones",titulo:"Operaciones"},
  {id:"flota",titulo:"Flota / Predios"},
  {id:"contabilidad",titulo:"Contabilidad / Facturación"},
  {id:"sitio",titulo:"Sitio Web"},
  {id:"administracion",titulo:"Administración"},
] as const;
const accion = (modulo: string, id: string, label: string, flag: FlagPermiso): AccionCatalogo => ({ modulo, id, label, flag });
const nueva = (base: string, id: string, label: string, flag: FlagPermiso): AccionCatalogo => ({
  id, label, modulo: `${base}_${id}`, flag: "puedeVer", legacy: { modulo: base, flag },
});
function modulo(id: string, label: string, area: AreaPermiso, acciones: [FlagPermiso, string, string][]): ModuloCatalogo {
  return { id, label, area, acciones: [
    accion(id, "ver", "Ver", "puedeVer"),
    ...acciones.map(([flag, clave, texto]) => accion(id, clave, texto, flag)),
  ] };
}
const C: FlagPermiso = "puedeCrear", E: FlagPermiso = "puedeEditar", D: FlagPermiso = "puedeEliminar";
/** Solo operaciones presentes en las rutas/servicios del discovery. Los flags son un detalle de persistencia. */
export const CATALOGO_PERMISOS: ModuloCatalogo[] = [
  modulo("rrhh","Dashboard Talento Humano","rrhh",[]),
  modulo("empleados","Empleados","rrhh",[[C,"registrar","Registrar / importar empleados"],[E,"editar","Editar ficha y documentos"],[D,"desactivar","Desactivar / quitar documentos"]]),
  modulo("marcajes","Marcajes","rrhh",[[C,"registrar","Registrar marcaje"],[E,"corregir","Importar / corregir marcajes"]]),
  modulo("reportes","Reportes de asistencia","rrhh",[]),
  modulo("vacaciones","Vacaciones","rrhh",[[C,"registrar","Registrar solicitud"],[E,"resolver","Gestionar / resolver solicitudes"],[D,"quitar","Quitar registro"]]),
  modulo("en_ruta","En Ruta","rrhh",[[C,"registrar","Registrar"],[D,"quitar","Quitar registro"]]),
  modulo("incidencias","Incidencias","rrhh",[[C,"registrar","Registrar incidencia / anexo"],[E,"editar","Editar incidencia / anexo"]]),
  modulo("configuracion","Configuración de RRHH","rrhh",[[C,"capturar","Capturar antecedentes fiscales"],[E,"configurar","Configurar / confirmar antecedentes"]]),
  modulo("planillas","Planillas","rrhh",[[C,"generar","Crear / generar período"],[E,"gestionar","Editar / autorizar planilla"]]),
  modulo("descuentos","Descuentos","rrhh",[[C,"registrar","Registrar descuento"],[E,"gestionar","Editar / cancelar / importar"]]),
  modulo("prestaciones","Prestaciones","rrhh",[[C,"registrar","Registrar prestación"],[E,"editar","Editar prestación"],[D,"anular","Anular prestación"]]),
  modulo("horas_extra","Horas Extra","rrhh",[[E,"gestionar","Registrar / resolver horas extra"]]),
  modulo("inventario","Inventario de RRHH","rrhh",[[C,"registrar","Registrar artículo"],[E,"gestionar","Editar / entregar / devolver / cambiar"]]),
  modulo("centros_costo","Centros de Costo","rrhh",[[E,"gestionar","Registrar / editar / activar"]]),
  modulo("entrevistas","Entrevistas","rrhh",[[E,"gestionar","Registrar / editar / dar seguimiento"]]),
  modulo("recordatorios","Recordatorios","rrhh",[[E,"gestionar","Registrar / editar / completar"]]),
  modulo("bitacora_legal","Bitácora Legal","rrhh",[[E,"gestionar","Registrar / dar seguimiento"]]),
  modulo("rrhh_requerimientos","Requerimientos de RRHH","rrhh",[[C,"registrar","Registrar requerimiento"],[E,"editar","Editar requerimiento"]]),
  modulo("rrhh_proveedores","Proveedores de RRHH","rrhh",[[C,"registrar","Registrar proveedor"],[E,"editar","Editar / activar proveedor"]]),
  modulo("programacion","Programación / Planes y Viajes","operaciones",[[C,"asignar","Crear / asignar viaje"],[E,"editar","Editar asignación"]]),
  modulo("rutas","Rutas","operaciones",[[C,"registrar","Registrar ruta"],[E,"editar","Editar ruta"],[D,"quitar","Quitar ruta"]]),
  modulo("gastos","Gastos operativos / Solicitudes de fondo","operaciones",[[C,"registrar","Registrar gasto / solicitud"],[E,"editar","Editar gasto / solicitud"],[D,"desactivar","Desactivar gasto"]]),
  modulo("viaticos","Viáticos","operaciones",[]),
  modulo("cotizaciones","Cotizaciones","operaciones",[[C,"crear","Crear cotización"],[E,"editar","Editar borrador"]]),
  modulo("cotizaciones_costeo","Costeo interno — CONFIDENCIAL","operaciones",[[C,"calcular","Calcular / registrar costeo"],[E,"calcular_borrador","Calcular al editar borrador"]]),
  modulo("cotizaciones_ajustes","Ajustes de costeo","operaciones",[[C,"vigencia","Crear vigencia / perfil"],[E,"perfil","Editar perfil"]]),
  modulo("multas","Multas y sanciones","operaciones",[[C,"registrar","Registrar multa / revisión"],[E,"gestionar","Editar / resolver / anular"]]),
  modulo("proveedor_portales","Accesos proveedores","operaciones",[[C,"registrar","Registrar acceso"],[E,"editar","Editar acceso"],[D,"quitar","Quitar acceso"]]),
  modulo("compras_requerimientos","Requerimientos de compra","operaciones",[[C,"registrar","Registrar requerimiento"],[E,"editar","Editar pendiente"]]),
  modulo("compras_proveedores","Proveedores comerciales","operaciones",[[C,"registrar","Registrar proveedor"],[E,"editar","Editar / activar proveedor"]]),
  modulo("clientes","Clientes","operaciones",[[C,"registrar","Registrar cliente"],[E,"gestionar","Editar cliente / contactos"]]),
  modulo("tms","TMS / Logística","operaciones",[]),
  modulo("reciclaje","Reciclaje","operaciones",[]),
  modulo("tarimas","Tarimas","operaciones",[]),
  modulo("flota","Dashboard Flota","flota",[]),
  modulo("flota_vehiculos","Vehículos","flota",[[C,"registrar","Registrar / importar vehículo"],[E,"editar","Editar vehículo / documentos"],[D,"desactivar","Desactivar vehículo"]]),
  modulo("flota_servicios","Servicios / Taller / Historial","flota",[[C,"registrar","Registrar servicio"],[E,"gestionar","Gestionar servicio / adjuntos"]]),
  modulo("flota_compras","Compras / Facturas de Flota","flota",[[E,"gestionar","Gestionar compra / adjuntos"]]),
  modulo("flota_inventario","Inventario de equipo","flota",[[C,"registrar","Registrar equipo"],[E,"editar","Editar equipo"],[D,"quitar","Quitar equipo"]]),
  modulo("flota_lecturas","Lecturas km","flota",[[C,"registrar","Registrar lectura"],[E,"gestionar","Gestionar lectura / evidencias"]]),
  modulo("flota_reportes","Reportes de Flota","flota",[]),
  modulo("flota_piloto","Viajes de Flota","flota",[[C,"registrar","Registrar viaje / evidencias"]]),
  modulo("flota_combustible","Combustible","flota",[[E,"revisar","Revisar / aprobar / rechazar / conciliar"]]),
  modulo("facturacion","Facturación clientes","contabilidad",[[C,"crear","Crear factura borrador"],[E,"editar","Editar factura borrador"]]),
  modulo("contabilidad","Contabilidad","contabilidad",[[C,"registrar","Registrar datos contables"],[E,"gestionar","Gestionar datos contables"]]),
  modulo("cms","Sitio Web / CMS","sitio",[]),
];
const agregar = (id: string, ...acciones: AccionCatalogo[]) => CATALOGO_PERMISOS.find(m => m.id === id)!.acciones.push(...acciones);
agregar("rrhh_requerimientos", accion("rrhh_requerimientos_autorizar","autorizar","Autorizar / rechazar requerimientos de RRHH",E));
agregar("compras_requerimientos", accion("compras_autorizar","autorizar","Autorizar / rechazar compras",E));
agregar("gastos", accion("gastos_autorizar","autorizar_fondos","Autorizar / rechazar solicitudes de fondo",E), accion("gastos_operativos_autorizar","autorizar_gastos","Autorizar / rechazar gastos operativos",E));
agregar("viaticos",
  accion("viaticos_autorizar","autorizar","Autorizar / rechazar",E),
  accion("viaticos_pagar","ver_pagos","Ver bandeja de pagos", "puedeVer"),
  accion("viaticos_pagar","pagar","Registrar requerimiento / pago / entrega",E),
  accion("viaticos_liquidar","liquidar","Liquidar",E),
  accion("viaticos_comprobantes","comprobantes","Descargar comprobantes", "puedeVer"));
agregar("programacion", accion("viajes_cerrar","cerrar","Cerrar administrativamente",E), nueva("programacion","exportar","Exportar reportes", "puedeVer"));
agregar("cotizaciones", nueva("cotizaciones","estado","Cambiar estado / marcar enviada",E));
agregar("facturacion", nueva("facturacion","emitir","Emitir factura",E), nueva("facturacion","anular","Anular factura",E), nueva("facturacion","pagos","Registrar pago",C));
// FACTURACION-PERMISOS-CONFIG-REQUISITOS: «Configuración empresa» y «Requisitos clientes» dejan de depender del ROL (alcanceFacturacion) y pasan a ser acciones
// asignables, independientes de emitir/anular/pagar («Emitir factura» solo es borrador -> emitida; nunca edita NIT, razón social, FEL ni configuración).
// Cada sección usa una fila propia (VARCHAR(40)) con dos flags: ver = puedeVer, editar = puedeEditar. Sin fila explícita NO hay acceso (a diferencia de `nueva`, no hay
// fallback a facturacion:editar); la equivalencia legacy por rol se materializa como filas en adaptarPermisosLegacy. Activar cualquiera activa «Ver» de Facturación.
export const FILA_FACTURACION_EMPRESA = "facturacion_empresa";
export const FILA_FACTURACION_REQUISITOS = "facturacion_clientes_requisitos";
agregar("facturacion",
  { ...accion(FILA_FACTURACION_EMPRESA,"ver_empresa","Ver configuración de facturación de la empresa","puedeVer"), grupo: "Configuración de la empresa" },
  { ...accion(FILA_FACTURACION_EMPRESA,"editar_empresa","Editar configuración de facturación de la empresa",E), requiere: "ver_empresa", grupo: "Configuración de la empresa" },
  { ...accion(FILA_FACTURACION_REQUISITOS,"ver_requisitos","Ver requisitos de facturación de clientes","puedeVer"), grupo: "Requisitos de clientes" },
  { ...accion(FILA_FACTURACION_REQUISITOS,"editar_requisitos","Editar requisitos de facturación de clientes",E), requiere: "ver_requisitos", grupo: "Requisitos de clientes" });
// FLOTA-EDITAR-VEHICULOS-OTRAS-EMPRESAS: acción especializada de Vehículos (fila propia `flota_vehiculos_otras_empresas`, flag editar). Activarla implica
// «Ver vehículos» y quitar «Ver vehículos» la limpia (mismas dependencias que el resto de acciones, ver cambiarAccion). No es acceso global: solo habilita editar
// vehículos de otras empresas que sean ACCESIBLES desde la empresa activa (propios o compartidos con ella); no amplía las operaciones solo-dueña.
agregar("flota_vehiculos", { ...accion("flota_vehiculos_otras_empresas","editar_otras_empresas","Editar vehículos de otras empresas",E),
  descripcion: "Permite editar vehículos compartidos de otras empresas cuando son accesibles desde la empresa activa." });
agregar("tms", nueva("tms","gestionar","Gestionar datos operativos",E));
agregar("reciclaje", nueva("reciclaje","gestionar","Gestionar reciclaje",E));
agregar("tarimas", nueva("tarimas","gestionar","Gestionar tarimas",E));
agregar("cms", nueva("cms","publicar","Editar / publicar contenido",E));

export const ACCIONES_NUEVAS = CATALOGO_PERMISOS.flatMap(m => m.acciones.filter(a => a.legacy));
const flag = (permisos: PermisoModulo[], moduloId: string, campo: FlagPermiso) =>
  Boolean(permisos.find(p => p.modulo === moduloId)?.[campo]);
/** Vista explícita: NO infiere ver desde acciones; flota paraguas solo si no hay fila específica. */
export function tienePermisoBase(permisos: PermisoModulo[], moduloId: string): boolean {
  const propio = permisos.find(p => p.modulo === moduloId);
  if (propio) return propio.puedeVer;
  return moduloId.startsWith("flota_") && flag(permisos,"flota","puedeVer");
}
/** Las matrices legacy admitían TMS como alternativa; V2 usa su base propia. */
export function tienePermisoOperativo(permisos: PermisoModulo[], moduloId: string, accion: "ver" | "crear" | "editar" | "eliminar"): boolean {
  if (permisos.some(p => p.modulo === VERSION_PERMISOS && p.puedeVer)) {
    return tienePermisoBase(permisos,moduloId) && tienePermiso(permisos,moduloId,accion);
  }
  return tienePermiso(permisos,moduloId,accion) || tienePermiso(permisos,"tms",accion);
}
export function tieneAccionCatalogo(permisos: PermisoModulo[], moduloId: string, id: string): boolean {
  const a = CATALOGO_PERMISOS.find(m => m.id === moduloId)?.acciones.find(x => x.id === id);
  if (!a) return false;
  const explicit = permisos.find(p => p.modulo === a.modulo);
  if (explicit) return Boolean(explicit[a.flag]);
  if (!a.legacy) return false;
  const legacy = flag(permisos,a.legacy.modulo,a.legacy.flag);
  // Cotizaciones y exportación ya aceptaban TMS: nunca aplicar este fallback a costeo/facturación.
  return legacy || ((moduloId === "cotizaciones" || moduloId === "programacion") && flag(permisos,"tms",a.legacy.flag))
    || (["tms","reciclaje","tarimas","cms"].includes(moduloId) && flag(permisos,moduloId,"puedeCrear"));
}
const vacio = (id: string): PermisoModulo => ({modulo:id,puedeVer:false,puedeCrear:false,puedeEditar:false,puedeEliminar:false});
export const VERSION_PERMISOS = "permisos_acciones_v2";
/** Adaptación en memoria de accesos de lectura ya concedidos por los guards legacy.
 * Una matriz V2 explícita no vuelve a heredar esos grants al desmarcar Ver.
 */
export function adaptarPermisosLegacy(permisos: PermisoModulo[], rol?: string): PermisoModulo[] {
  return conEquivalenciasFacturacion(adaptarBase(permisos, rol), rol);
}
/**
 * Equivalencia por ROL de «Configuración empresa» / «Requisitos clientes» (antes salía de alcanceFacturacion(rol)). Solo agrega la fila de permiso cuando AÚN NO
 * existe: una fila explícita (aunque esté en cero) es la fuente de verdad y no se vuelve a mirar el rol. Requiere «Ver Facturación». Sin rol (p. ej. al normalizar
 * lo que envía la UI) no hace nada. Aplica tanto a matrices anteriores a la V2 como a V2 ya guardadas que todavía no tenían estas filas.
 */
function conEquivalenciasFacturacion(permisos: PermisoModulo[], rol?: string): PermisoModulo[] {
  if (!rol || !flag(permisos,"facturacion","puedeVer")) return permisos;
  const alc = alcanceFacturacionPorRol(rol);
  const salida = [...permisos];
  for (const [fila, ver, editar] of [
    [FILA_FACTURACION_EMPRESA, alc.verEmpresa, alc.editarEmpresa],
    [FILA_FACTURACION_REQUISITOS, alc.verClientes, alc.editarClientes],
  ] as const) {
    if (!ver || salida.some(p => p.modulo === fila)) continue;
    salida.push({...vacio(fila), puedeVer: true, puedeEditar: editar});
  }
  return salida;
}
function adaptarBase(permisos: PermisoModulo[], rol?: string): PermisoModulo[] {
  if (permisos.some(p => p.modulo === VERSION_PERMISOS && p.puedeVer)) return permisos.map(p => ({...p}));
  const mapa = new Map(permisos.map(p => [p.modulo,{...p}]));
  // Los permisos especializados también inferían lectura desde su acción.
  // Materializar esa lectura evita romper sus GET al activar el contrato V2.
  for (const id of new Set(CATALOGO_PERMISOS.flatMap(m => m.acciones.filter(a => !a.legacy).map(a => a.modulo)))) {
    const propio = mapa.get(id);
    if (propio && id !== "compras_requerimientos" && tienePermiso(permisos,id,"ver")) {
      mapa.set(id,{...propio,puedeVer:true});
    }
  }
  if (rol === "RRHH") mapa.set("rrhh",{...(mapa.get("rrhh") ?? vacio("rrhh")),puedeVer:true});
  if (CATALOGO_PERMISOS.some(m => m.area === "flota" && tienePermiso(permisos,m.id,"ver"))) {
    mapa.set("flota",{...(mapa.get("flota") ?? vacio("flota")),puedeVer:true});
  }
  if (rol && ["Operaciones","GerenteOperaciones","JefeOperaciones","AuxiliarOperaciones","Facturador"].includes(rol)) {
    // El acceso anterior era por rol + asignación; se conserva solo para matrices legacy.
    mapa.set("proveedor_portales",{modulo:"proveedor_portales",puedeVer:true,puedeCrear:true,puedeEditar:true,puedeEliminar:true});
  }
  for (const m of CATALOGO_PERMISOS) {
    let ver = m.id === "compras_requerimientos" ? flag(permisos,m.id,"puedeVer") : tienePermiso(permisos,m.id,"ver");
    if (m.id.startsWith("flota_")) {
      const propio = mapa.get(m.id) ?? vacio(m.id);
      propio.puedeCrear = tienePermiso(permisos,m.id,"crear");
      propio.puedeEditar = tienePermiso(permisos,m.id,"editar");
      propio.puedeEliminar = tienePermiso(permisos,m.id,"eliminar");
      mapa.set(m.id,propio);
    }
    if (["rutas","gastos","cotizaciones"].includes(m.id)) {
      ver ||= tienePermiso(permisos,"tms","ver");
      const propio = mapa.get(m.id) ?? vacio(m.id);
      for (const [campo, accion] of [["puedeCrear","crear"],["puedeEditar","editar"],["puedeEliminar","eliminar"]] as const) {
        propio[campo] ||= tienePermiso(permisos,"tms",accion);
      }
      mapa.set(m.id,propio);
    }
    if (m.id === "viaticos") ver ||= ["viaticos_autorizar","viaticos_pagar","viaticos_liquidar"].some(id => tienePermiso(permisos,id,"ver"));
    if (ver) mapa.set(m.id,{...(mapa.get(m.id) ?? vacio(m.id)),puedeVer:true});
  }
  // Estos guards generales antes aceptaban editar por rol. Se conserva
  // ese acceso en una acción separada, sin conceder rutas/programación.
  for (const id of ["tms","reciclaje","tarimas","cms"] as const) {
    const a = CATALOGO_PERMISOS.find(m=>m.id===id)!.acciones[1]!;
    if (!mapa.has(a.modulo) && rol && puedeEditarModulo(rol as RolGlobal, id as Modulo) && tienePermiso(permisos,id,"ver")) {
      mapa.set(a.modulo,{...vacio(a.modulo),puedeVer:true});
    }
  }
  mapa.set(VERSION_PERMISOS,{...vacio(VERSION_PERMISOS),puedeVer:true});
  return [...mapa.values()];
}
/** Defensa server-side: acciones activas implican su base, conserva filas desconocidas. */
export function normalizarMatriz(permisos: PermisoModulo[]): PermisoModulo[] {
  let salida = materializarAcciones(adaptarPermisosLegacy(permisos));
  for (const m of CATALOGO_PERMISOS) for (const a of m.acciones.slice(1)) {
    if (tieneAccionCatalogo(salida,m.id,a.id)) salida = cambiarAccion(salida,m.id,a.id,true);
  }
  return salida;
}
/** Materializa los nuevos grants equivalentes al editar; filas explícitas y extras se preservan. */
export function materializarAcciones(permisos: PermisoModulo[]): PermisoModulo[] {
  const salida = permisos.map(p => ({...p}));
  for (const m of CATALOGO_PERMISOS) for (const a of m.acciones.filter(x => x.legacy)) {
    if (!salida.some(p => p.modulo === a.modulo))
      salida.push({...vacio(a.modulo),[a.flag]:tieneAccionCatalogo(permisos,m.id,a.id)});
  }
  return salida;
}
/** Una acción activa su base; quitar la base limpia únicamente las acciones de ese módulo. */
export function cambiarAccion(permisos: PermisoModulo[], moduloId: string, id: string, valor: boolean): PermisoModulo[] {
  const m = CATALOGO_PERMISOS.find(x => x.id === moduloId);
  const a = m?.acciones.find(x => x.id === id);
  if (!m || !a) return permisos;
  const mapa = new Map(materializarAcciones(permisos).map(p => [p.modulo,{...p}]));
  const asignar = (item: AccionCatalogo, enabled: boolean) => {
    const p = mapa.get(item.modulo) ?? vacio(item.modulo);
    mapa.set(item.modulo,{...p,[item.flag]:enabled});
  };
  asignar(a,valor);
  if (id !== "ver" && valor) asignar(m.acciones[0]!,true);
  // Dependencia dentro del módulo (p. ej. editar requiere ver): activarla activa la requerida y quitar la requerida limpia las que dependen de ella.
  const requerida = a.requiere ? m.acciones.find(x => x.id === a.requiere) : undefined;
  if (valor && requerida) asignar(requerida,true);
  if (!valor) for (const dependiente of m.acciones.filter(x => x.requiere === id)) asignar(dependiente,false);
  if (id !== "ver" && valor && a.modulo !== m.id) {
    // Las bandejas/GET de los permisos especializados requieren su lectura.
    const propio = mapa.get(a.modulo)!;
    mapa.set(a.modulo,{...propio,puedeVer:true});
  }
  if (id === "ver" && !valor) {
    mapa.set(m.id,vacio(m.id));
    for (const dependiente of m.acciones.slice(1)) mapa.set(dependiente.modulo,vacio(dependiente.modulo));
  }
  return [...mapa.values()];
}
export function marcarArea(permisos: PermisoModulo[], ids: string[], modo: "todo" | "ver" | "quitar"): PermisoModulo[] {
  let salida = permisos;
  for (const id of ids) {
    salida = cambiarAccion(salida,id,"ver",false);
    const m = CATALOGO_PERMISOS.find(x => x.id === id);
    if (modo !== "quitar") for (const a of m?.acciones ?? []) {
      if (modo === "todo" || a.id === "ver") salida = cambiarAccion(salida,id,a.id,true);
    }
  }
  return salida;
}
