import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { z } from "zod";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { CAMPOS_EXCEL_PARAMETROS, CAMPOS_EXCEL_PERFIL, mapCamposExcel } from "./cotizacion-costeo-excel-campos";
import { decimalCosteoSql } from "./cotizacion-costeo-excel";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de vigencia no es válida.").refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, "La fecha de vigencia no es válida.");
const noNegativo = z.number().finite().min(0);
const positivo = z.number().finite().gt(0);
const nullableNoNegativo = noNegativo.nullable();

export const parametrosAjustesSchema = z.object({
  seguroMercaderiaAnual: noNegativo.nullable().optional(),
  cantidadCamiones: positivo.int().max(2147483647).nullable().optional(),
  viajesAnuales: positivo.nullable().optional(),
  diasDepreciacionMes: positivo.nullable().optional(),
  diasGastosMes: positivo.nullable().optional(),
  gastosAdministracion: noNegativo.nullable().optional(),
  gastosMantenimiento: noNegativo.nullable().optional(),
  gastosSeguridad: noNegativo.nullable().optional(),
  gastosPredios: noNegativo.nullable().optional(),
  diasLaboralesMes: positivo.nullable().optional(),
  vigenteDesde: fecha,
  precioCombustibleGalon: positivo,
  ivaTasa: z.number().finite().min(0).max(1),
  costoPilotoDia: noNegativo,
  costoAuxiliarDia: noNegativo,
  viaticoPilotoDia: noNegativo,
  viaticoAuxiliarDia: noNegativo,
  viaticoGuiaDia: noNegativo,
  hotelDia: nullableNoNegativo,
  margenObjetivo: z.number().finite().min(0).max(1).nullable(),
}).strict().superRefine((v, ctx) => {
  for (const c of CAMPOS_EXCEL_PARAMETROS) {
    const tipo = c.type.match(/^DECIMAL\((\d+),(\d+)\)$/);
    if (tipo && v[c.key] != null && v[c.key]! >= 10 ** (Number(tipo[1]) - Number(tipo[2]))) ctx.addIssue({code:"custom",path:[c.key],message:"El valor excede la precisión de almacenamiento."});
  }
  const gastos = [v.gastosAdministracion, v.gastosMantenimiento, v.gastosSeguridad, v.gastosPredios];
  if (gastos.some(x => x != null) && gastos.some(x => x == null)) ctx.addIssue({code:"custom",path:["gastosAdministracion"],message:"Complete los cuatro gastos (0 cuando no aplica), o deje los cuatro vacíos."});
  if ((v.seguroMercaderiaAnual ?? 0) > 0 && (v.cantidadCamiones == null || v.viajesAnuales == null)) ctx.addIssue({code:"custom",path:["seguroMercaderiaAnual"],message:"El seguro anual requiere flota y viajes anuales."});
  if (gastos.some(x => x != null && x > 0) && (v.cantidadCamiones == null || v.diasGastosMes == null)) ctx.addIssue({code:"custom",path:["diasGastosMes"],message:"Los gastos requieren flota y días mensuales."});
});

const perfilBase = z.object({
  salarioPilotoMensual: noNegativo.nullable().optional(),
  salarioAuxiliarMensual: noNegativo.nullable().optional(),
  viajesMes: positivo.nullable().optional(),
  precioLlanta: noNegativo.nullable().optional(),
  cantidadLlantas: positivo.int().max(2147483647).nullable().optional(),
  nombre: z.string().trim().min(1).max(120),
  activo: z.boolean(),
  costoAdquisicion: nullableNoNegativo,
  diasOperacionMes: positivo,
  gpsMensual: noNegativo,
  seguroVehiculoMensual: noNegativo,
  costoAceiteServicio: noNegativo,
  vidaUtilAceiteKm: positivo,
  costoJuegoLlantas: noNegativo,
  vidaUtilLlantasKm: positivo,
  rendimientoKmGalon: positivo,
  deprecValorBase: nullableNoNegativo,
  deprecAnios: z.number().finite().gt(0).nullable(),
  deprecDiasOperacionMes: z.number().finite().gt(0).nullable(),
  refrigValorBase: nullableNoNegativo,
  refrigAnios: z.number().finite().gt(0).nullable(),
  refrigDiasOperacionMes: z.number().finite().gt(0).nullable(),
}).strict();

function trioCompleto(v: Record<string, unknown>, campos: string[]) {
  const presentes = campos.filter((c) => v[c] != null).length;
  return presentes === 0 || presentes === campos.length;
}
function validarTrios<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.superRefine((v, ctx) => {
    for (const c of CAMPOS_EXCEL_PERFIL) {
      const tipo = c.type.match(/^DECIMAL\((\d+),(\d+)\)$/);
      const valor = (v as Record<string,unknown>)[c.key];
      if (tipo && typeof valor === "number" && valor >= 10 ** (Number(tipo[1]) - Number(tipo[2]))) ctx.addIssue({code:"custom",path:[c.key],message:"El valor excede la precisión de almacenamiento."});
    }
    if (!trioCompleto(v, ["precioLlanta", "cantidadLlantas"])) {
      ctx.addIssue({ code: "custom", path: ["precioLlanta"], message: "Complete precio y cantidad de llantas o déjelos vacíos para usar el juego histórico." });
    }
    if (!trioCompleto(v, ["deprecValorBase", "deprecAnios", "deprecDiasOperacionMes"])) {
      ctx.addIssue({ code: "custom", path: ["deprecValorBase"], message: "Complete los tres datos de depreciación o déjelos vacíos." });
    }
    if (!trioCompleto(v, ["refrigValorBase", "refrigAnios", "refrigDiasOperacionMes"])) {
      ctx.addIssue({ code: "custom", path: ["refrigValorBase"], message: "Complete los tres datos de refrigeración o déjelos vacíos." });
    }
  });
}

export const perfilAjustesCrearSchema = validarTrios(perfilBase.extend({
  codigo: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/, "El código solo admite A-Z, 0-9 y guion bajo."),
}));
export const perfilAjustesActualizarSchema = validarTrios(perfilBase);
export type ParametrosAjustesInput = z.infer<typeof parametrosAjustesSchema>;
export type PerfilAjustesCrearInput = z.infer<typeof perfilAjustesCrearSchema>;
export type PerfilAjustesActualizarInput = z.infer<typeof perfilAjustesActualizarSchema>;

export class ErrorAjustesCosteo extends Error {
  constructor(message: string, public readonly status = 409) { super(message); this.name = "ErrorAjustesCosteo"; }
}

const n = (v: unknown) => Number(v);
const campoExcelSql = (c: {type:string}, v:number|null|undefined) => {
  const tipo = c.type.match(/^DECIMAL\(\d+,(\d+)\)$/);
  return tipo ? decimalCosteoSql(v ?? null, Number(tipo[1])) : v ?? null;
};
const nn = (v: unknown) => v == null ? null : Number(v);
export const hoyGuatemala = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());

export type ParametroAjustes = ParametrosAjustesInput & { id: number; creadoPor: string | null; creadoEn: string; esVigenciaActual: boolean };
export type PerfilAjustes = PerfilAjustesCrearInput & { id: number; creadoPor: string | null; creadoEn: string; actualizadoEn: string };

export async function listarParametrosAjustes(empresaId: number, hoy = hoyGuatemala()): Promise<ParametroAjustes[]> {
  const rows = await query<RowDataPacket[]>(`SELECT id, DATE_FORMAT(vigente_desde,'%Y-%m-%d') vigente_desde, precio_combustible_galon, iva_tasa,
    costo_piloto_dia, costo_auxiliar_dia, viatico_piloto_dia, viatico_auxiliar_dia, viatico_guia_dia, hotel_dia,
    margen_objetivo, seguro_mercaderia_anual, cantidad_camiones, viajes_anuales, dias_depreciacion_mes, dias_gastos_mes, gastos_administracion, gastos_mantenimiento, gastos_seguridad, gastos_predios, dias_laborales_mes, creado_por, DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') creado_en
    FROM tms_cotizacion_costeo_parametros WHERE empresa_id = ? ORDER BY vigente_desde DESC, id DESC`, [empresaId]);
  const actual = rows.find((r) => String(r.vigente_desde) <= hoy)?.id;
  return rows.map((r) => ({ ...mapCamposExcel(r, CAMPOS_EXCEL_PARAMETROS), id:n(r.id), vigenteDesde:String(r.vigente_desde), precioCombustibleGalon:n(r.precio_combustible_galon),
    ivaTasa:n(r.iva_tasa), costoPilotoDia:n(r.costo_piloto_dia), costoAuxiliarDia:n(r.costo_auxiliar_dia),
    viaticoPilotoDia:n(r.viatico_piloto_dia), viaticoAuxiliarDia:n(r.viatico_auxiliar_dia), viaticoGuiaDia:n(r.viatico_guia_dia),
    hotelDia:nn(r.hotel_dia), margenObjetivo:nn(r.margen_objetivo), creadoPor:r.creado_por == null ? null : String(r.creado_por),
    creadoEn:String(r.creado_en), esVigenciaActual:r.id === actual }));
}

export async function listarPerfilesAjustes(empresaId: number): Promise<PerfilAjustes[]> {
  const rows = await query<RowDataPacket[]>(`SELECT *, DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') creado_fmt,
    DATE_FORMAT(actualizado_en,'%Y-%m-%d %H:%i:%s') actualizado_fmt FROM tms_cotizacion_costeo_perfiles
    WHERE empresa_id = ? ORDER BY activo DESC, nombre ASC`, [empresaId]);
  return rows.map((r) => ({ ...mapCamposExcel(r, CAMPOS_EXCEL_PERFIL), id:n(r.id), codigo:String(r.codigo), nombre:String(r.nombre), activo:Boolean(r.activo),
    costoAdquisicion:nn(r.costo_adquisicion), diasOperacionMes:n(r.dias_operacion_mes), gpsMensual:n(r.gps_mensual),
    seguroVehiculoMensual:n(r.seguro_vehiculo_mensual), costoAceiteServicio:n(r.costo_aceite_servicio), vidaUtilAceiteKm:n(r.vida_util_aceite_km),
    costoJuegoLlantas:n(r.costo_juego_llantas), vidaUtilLlantasKm:n(r.vida_util_llantas_km), rendimientoKmGalon:n(r.rendimiento_km_galon),
    deprecValorBase:nn(r.deprec_valor_base), deprecAnios:nn(r.deprec_anios), deprecDiasOperacionMes:nn(r.deprec_dias_operacion_mes),
    refrigValorBase:nn(r.refrig_valor_base), refrigAnios:nn(r.refrig_anios), refrigDiasOperacionMes:nn(r.refrig_dias_operacion_mes),
    creadoPor:r.creado_por == null ? null : String(r.creado_por), creadoEn:String(r.creado_fmt), actualizadoEn:String(r.actualizado_fmt) }));
}

async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; }
  catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
function duplicado(e: unknown) { return (e as { code?: string }).code === "ER_DUP_ENTRY"; }

export async function crearParametrosAjustes(empresaId: number, usuario: string, input: ParametrosAjustesInput) {
  try { return await tx(async (conn) => {
    const [r] = await conn.execute<ResultSetHeader>(`INSERT INTO tms_cotizacion_costeo_parametros
      (empresa_id,vigente_desde,precio_combustible_galon,iva_tasa,costo_piloto_dia,costo_auxiliar_dia,viatico_piloto_dia,
       viatico_auxiliar_dia,viatico_guia_dia,hotel_dia,margen_objetivo,creado_por,seguro_mercaderia_anual,cantidad_camiones,viajes_anuales,dias_depreciacion_mes,dias_gastos_mes,gastos_administracion,gastos_mantenimiento,gastos_seguridad,gastos_predios,dias_laborales_mes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [empresaId,input.vigenteDesde,input.precioCombustibleGalon,input.ivaTasa,input.costoPilotoDia,input.costoAuxiliarDia,
       input.viaticoPilotoDia,input.viaticoAuxiliarDia,input.viaticoGuiaDia,input.hotelDia,input.margenObjetivo,usuario,...CAMPOS_EXCEL_PARAMETROS.map(c => campoExcelSql(c,input[c.key]))]);
    await registrarAuditoriaTx(conn,{empresaId,usuario,accion:"crear_vigencia_costeo",modulo:"tms_cotizaciones",detalle:`Nueva vigencia de costeo desde ${input.vigenteDesde}.`});
    return Number(r.insertId);
  }); } catch(e) { if (duplicado(e)) throw new ErrorAjustesCosteo("Ya existe una configuración con esa fecha de vigencia."); throw e; }
}

const CAMPOS_PERFIL = `nombre,activo,costo_adquisicion,dias_operacion_mes,gps_mensual,seguro_vehiculo_mensual,costo_aceite_servicio,
 vida_util_aceite_km,costo_juego_llantas,vida_util_llantas_km,rendimiento_km_galon,deprec_valor_base,deprec_anios,
 deprec_dias_operacion_mes,refrig_valor_base,refrig_anios,refrig_dias_operacion_mes,viajes_mes,precio_llanta,cantidad_llantas,salario_piloto_mensual,salario_auxiliar_mensual`;
const valoresPerfil = (x: PerfilAjustesActualizarInput) => [x.nombre,x.activo,x.costoAdquisicion,x.diasOperacionMes,x.gpsMensual,x.seguroVehiculoMensual,
  x.costoAceiteServicio,x.vidaUtilAceiteKm,x.costoJuegoLlantas,x.vidaUtilLlantasKm,x.rendimientoKmGalon,x.deprecValorBase,x.deprecAnios,
  x.deprecDiasOperacionMes,x.refrigValorBase,x.refrigAnios,x.refrigDiasOperacionMes,...CAMPOS_EXCEL_PERFIL.map(c => campoExcelSql(c,x[c.key]))];

export async function crearPerfilAjustes(empresaId:number, usuario:string, input:PerfilAjustesCrearInput) {
  try { return await tx(async(conn) => {
    const [r] = await conn.execute<ResultSetHeader>(`INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id,codigo,${CAMPOS_PERFIL},creado_por)
      VALUES (${Array(25).fill("?").join(",")})`, [empresaId,input.codigo,...valoresPerfil(input),usuario]);
    await registrarAuditoriaTx(conn,{empresaId,usuario,accion:"crear_perfil_costeo",modulo:"tms_cotizaciones",detalle:`Perfil de costeo ${input.codigo} creado.`});
    return Number(r.insertId);
  }); } catch(e) { if(duplicado(e)) throw new ErrorAjustesCosteo("Ya existe un perfil con ese código."); throw e; }
}

export async function actualizarPerfilAjustes(empresaId:number,id:number,usuario:string,input:PerfilAjustesActualizarInput) {
  return tx(async(conn) => {
    const [antes] = await conn.query<RowDataPacket[]>("SELECT codigo, activo FROM tms_cotizacion_costeo_perfiles WHERE empresa_id=? AND id=? FOR UPDATE",[empresaId,id]);
    if(!antes[0]) throw new ErrorAjustesCosteo("Perfil no encontrado.",404);
    const asignaciones = CAMPOS_PERFIL.split(",").map((c)=>`${c.trim()}=?`).join(",");
    await conn.execute<ResultSetHeader>(`UPDATE tms_cotizacion_costeo_perfiles SET ${asignaciones} WHERE empresa_id=? AND id=?`,[...valoresPerfil(input),empresaId,id]);
    const cambioActivo = Boolean(antes[0].activo) !== input.activo;
    await registrarAuditoriaTx(conn,{empresaId,usuario,accion:cambioActivo ? (input.activo?"activar_perfil_costeo":"desactivar_perfil_costeo") : "editar_perfil_costeo",
      modulo:"tms_cotizaciones",detalle:`Perfil de costeo ${String(antes[0].codigo)} actualizado.`});
  });
}
