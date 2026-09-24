import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { getPool, query, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { resolverUsuarioDeEmpresaTx } from "@/lib/tms/identidad-administrativa";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES, sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { calcularPeriodoRequerimiento } from "./viaticos-requerimientos-periodo";
import { ACCION_FIRMA_REQUIRENTE, nombreEmpresaRequirente, type GuardarRequerimientoViatico, type RequerimientoViatico, type TransicionRequerimientoViatico } from "./viaticos-requerimientos-schema";

export class ErrorRequerimientoViatico extends Error { constructor(message: string, public status = 400) { super(message); } }
const CENTAVOS_MAX = 99999999999999;
function centavos(valor: string | number) { const [e, d = ""] = String(valor).split("."); return Number(e) * 100 + Number(d.padEnd(2, "0")); }
function dinero(c: number) { return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`; }
const fechaSql = (v: unknown) => String(v ?? "").slice(0, 10);
const textoONull = (v: unknown) => (v != null && String(v).trim() ? String(v).trim() : null);

export async function catalogosRequerimientoViatico(empresaId: number) {
  const [personal, vehiculos, clientes, usuarios] = await Promise.all([
    query<RowDataPacket[]>(`SELECT tp.id, tp.codigo, tp.nombre, COALESCE(e.categoria_ops,tp.tipo) cargo, e.dpi,
      COALESCE(cfg.monto_defecto,0) monto_sugerido FROM tms_personal tp
      LEFT JOIN empleados e ON e.id=tp.id_empleado AND e.empresa_id=tp.empresa_id
      LEFT JOIN tms_viaticos_config cfg ON cfg.empresa_id=tp.empresa_id AND cfg.puesto=COALESCE(e.categoria_ops,tp.tipo) AND cfg.activo=1
      WHERE tp.empresa_id=? AND tp.estado='Activo' ORDER BY tp.nombre`, [empresaId]),
    query<RowDataPacket[]>(`SELECT id, placa, marca, modelo, descripcion FROM flota_vehiculos WHERE empresa_id=? AND activo=1 ORDER BY placa`, [empresaId]),
    query<RowDataPacket[]>(`SELECT id, nombre FROM tms_clientes WHERE empresa_id=? AND activo=1 ORDER BY nombre`, [empresaId]),
    query<RowDataPacket[]>(`SELECT u.id,u.nombre FROM usuarios u LEFT JOIN usuario_empresa ue ON ue.usuario_id=u.id AND ue.empresa_id=?
      WHERE u.activo=1 AND (u.acceso_todas_empresas=1 OR ue.usuario_id IS NOT NULL) ORDER BY u.nombre`, [empresaId]),
  ]);
  return { personal, vehiculos, clientes, usuarios };
}

function mapCabecera(r: RowDataPacket): RequerimientoViatico {
  return { ...r, id: Number(r.id), codigo: String(r.codigo), estado: r.estado, total: String(r.total), fecha_requerimiento: fechaSql(r.fecha_requerimiento), periodo_desde: r.periodo_desde ? fechaSql(r.periodo_desde) : null, periodo_hasta: r.periodo_hasta ? fechaSql(r.periodo_hasta) : null } as RequerimientoViatico;
}
export async function listarRequerimientosViatico(empresaId: number) {
  return (await query<RowDataPacket[]>(`SELECT r.*,COUNT(l.id) cantidad_lineas FROM tms_viatico_requerimientos r
    LEFT JOIN tms_viatico_requerimiento_lineas l ON l.empresa_id=r.empresa_id AND l.requerimiento_id=r.id
    WHERE r.empresa_id=? GROUP BY r.id ORDER BY r.id DESC LIMIT 500`, [empresaId])).map(mapCabecera);
}
export async function obtenerRequerimientoViatico(empresaId: number, id: number, conn?: PoolConnection) {
  const run = async (sql: string, params: SqlParams) => conn ? (await conn.query<RowDataPacket[]>(sql, params))[0] : query<RowDataPacket[]>(sql, params);
  const rows = await run(`SELECT * FROM tms_viatico_requerimientos WHERE empresa_id=? AND id=? LIMIT 1`, [empresaId, id]);
  if (!rows[0]) return null;
  const lineas = await run(`SELECT * FROM tms_viatico_requerimiento_lineas WHERE empresa_id=? AND requerimiento_id=? ORDER BY orden,id`, [empresaId, id]);
  return { ...mapCabecera(rows[0]), lineas: lineas.map(l => ({ ...l, id:Number(l.id), fecha_solicitud:fechaSql(l.fecha_solicitud), fecha_viaje:fechaSql(l.fecha_viaje), cantidad:String(l.cantidad), monto_sugerido:String(l.monto_sugerido), monto_unitario:String(l.monto_unitario), total:String(l.total) })) };
}

async function snapshotLinea(conn: PoolConnection, empresaId: number, l: GuardarRequerimientoViatico["lineas"][number]) {
  const [p] = await conn.query<RowDataPacket[]>(`SELECT tp.id,tp.id_empleado,tp.nombre,COALESCE(e.categoria_ops,tp.tipo) cargo,e.cuenta_bancaria,e.banco,
    COALESCE(cfg.monto_defecto,0) sugerido FROM tms_personal tp LEFT JOIN empleados e ON e.id=tp.id_empleado AND e.empresa_id=tp.empresa_id
    LEFT JOIN tms_viaticos_config cfg ON cfg.empresa_id=tp.empresa_id AND cfg.puesto=COALESCE(e.categoria_ops,tp.tipo) AND cfg.activo=1
    WHERE tp.empresa_id=? AND tp.id=? AND tp.estado='Activo' LIMIT 1`, [empresaId,l.personalId]);
  if (!p[0]) throw new ErrorRequerimientoViatico("El colaborador no pertenece a esta empresa o no está activo.");
  const [v] = l.vehiculoId ? await conn.query<RowDataPacket[]>(`SELECT placa FROM flota_vehiculos WHERE empresa_id=? AND id=? LIMIT 1`,[empresaId,l.vehiculoId]) : [[]] as unknown as [RowDataPacket[]];
  if (l.vehiculoId && !v[0]) throw new ErrorRequerimientoViatico("La unidad no pertenece a esta empresa.");
  const [c] = l.clienteId ? await conn.query<RowDataPacket[]>(`SELECT nombre FROM tms_clientes WHERE empresa_id=? AND id=? LIMIT 1`,[empresaId,l.clienteId]) : [[]] as unknown as [RowDataPacket[]];
  if (l.clienteId && !c[0]) throw new ErrorRequerimientoViatico("El cliente no pertenece a esta empresa.");
  const sugerido = centavos(String(p[0].sugerido ?? 0)), unitario = centavos(l.montoUnitario), cantidad = centavos(l.cantidad);
  const total = Math.round(cantidad * unitario / 100);
  if (total > CENTAVOS_MAX) throw new ErrorRequerimientoViatico("El total excede el límite permitido.");
  if (sugerido !== unitario && !l.motivoCambio) throw new ErrorRequerimientoViatico("Indica el motivo del cambio del monto sugerido.");
  return { l, p:p[0], placa:v[0]?.placa ?? null, cliente:c[0]?.nombre ?? null, sugerido:dinero(sugerido), total:dinero(total) };
}

/** Periodo snapshot: tipo elegido + referencia (por defecto la fecha de viaje más antigua). Sin tipo → sin periodo (NULL). */
function periodoDeRequerimiento(datos: GuardarRequerimientoViatico) {
  if (!datos.periodoTipo) return { periodoTipo: null, periodoDesde: null, periodoHasta: null };
  const referencia = datos.periodoReferencia ?? datos.lineas.map(l => l.fechaViaje).sort()[0];
  return calcularPeriodoRequerimiento(datos.periodoTipo, referencia);
}

export async function guardarRequerimientoViatico(empresaId:number, usuarioId:number, usuarioNombre:string, datos:GuardarRequerimientoViatico, id?:number) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const requirente = await resolverUsuarioDeEmpresaTx(conn,empresaId,datos.requirenteUsuarioId);
    if (!requirente) throw new ErrorRequerimientoViatico("La persona que requiere no pertenece a esta empresa.");
    const resueltas = [] as Awaited<ReturnType<typeof snapshotLinea>>[];
    for (const l of datos.lineas) resueltas.push(await snapshotLinea(conn,empresaId,l));
    const total = resueltas.reduce((s,l)=>s+centavos(l.total),0);
    const periodo=periodoDeRequerimiento(datos);
    let reqId=id;
    if (id) {
      const [actual] = await conn.query<RowDataPacket[]>(`SELECT estado,version FROM tms_viatico_requerimientos WHERE empresa_id=? AND id=? FOR UPDATE`,[empresaId,id]);
      if (!actual[0]) throw new ErrorRequerimientoViatico("Requerimiento no encontrado.",404);
      if (!["BORRADOR","PENDIENTE"].includes(String(actual[0].estado))) throw new ErrorRequerimientoViatico("El requerimiento ya está congelado y no puede editarse.",409);
      if (Number(actual[0].version)!==datos.version) throw new ErrorRequerimientoViatico("El requerimiento cambió; recarga la página.",409);
      await conn.execute(`UPDATE tms_viatico_requerimientos SET fecha_requerimiento=?,periodo_tipo=?,periodo_desde=?,periodo_hasta=?,empresa_requirente_nombre=?,requirente_usuario_id=?,requirente_nombre_snapshot=?,total=?,observaciones=?,version=version+1 WHERE empresa_id=? AND id=?`,[datos.fechaRequerimiento,periodo.periodoTipo,periodo.periodoDesde,periodo.periodoHasta,nombreEmpresaRequirente(datos.empresaRequirente),datos.requirenteUsuarioId,requirente.nombre,dinero(total),datos.observaciones,empresaId,id]);
      await conn.execute(`DELETE FROM tms_viatico_requerimiento_lineas WHERE empresa_id=? AND requerimiento_id=?`,[empresaId,id]);
    } else {
      const [sol] = await conn.query<RowDataPacket[]>(`SELECT nombre FROM usuarios WHERE id=? AND activo=1 LIMIT 1`,[usuarioId]);
      const temporal=`TMP-${randomUUID()}`;
      const [r] = await conn.execute<ResultSetHeader>(`INSERT INTO tms_viatico_requerimientos (empresa_id,codigo,fecha_requerimiento,periodo_tipo,periodo_desde,periodo_hasta,empresa_requirente_nombre,requirente_usuario_id,requirente_nombre_snapshot,solicitante_usuario_id,solicitante_nombre_snapshot,estado,total,observaciones,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,'BORRADOR',?,?,?)`,[empresaId,temporal,datos.fechaRequerimiento,periodo.periodoTipo,periodo.periodoDesde,periodo.periodoHasta,nombreEmpresaRequirente(datos.empresaRequirente),datos.requirenteUsuarioId,requirente.nombre,usuarioId,String(sol[0]?.nombre||usuarioNombre),dinero(total),datos.observaciones,usuarioId]);
      reqId=r.insertId; const codigo=`VR-${new Date().getFullYear()}-${String(reqId).padStart(6,"0")}`;
      await conn.execute(`UPDATE tms_viatico_requerimientos SET codigo=? WHERE empresa_id=? AND id=?`,[codigo,empresaId,reqId]);
    }
    for (const [i,x] of resueltas.entries()) await conn.execute(`INSERT INTO tms_viatico_requerimiento_lineas (empresa_id,requerimiento_id,orden,fecha_solicitud,fecha_viaje,personal_id,empleado_id,personal_nombre_snapshot,cargo_snapshot,cuenta_snapshot,banco_snapshot,vehiculo_id,placa_snapshot,cliente_id,cliente_nombre_snapshot,cantidad,destino,monto_sugerido,monto_unitario,motivo_cambio,total,plan_id,origen,observaciones) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'MANUAL',?)`,[empresaId,reqId,i+1,x.l.fechaSolicitud,x.l.fechaViaje,x.l.personalId,x.p.id_empleado,x.p.nombre,x.p.cargo,textoONull(x.p.cuenta_bancaria),textoONull(x.p.banco),x.l.vehiculoId,x.placa,x.l.clienteId,x.cliente,x.l.cantidad,x.l.destino,x.sugerido,x.l.montoUnitario,x.l.motivoCambio,x.total,x.l.observaciones]);
    await registrarAuditoriaTx(conn,{empresaId,usuario:usuarioNombre,accion:id?"editar_requerimiento_viatico":"crear_requerimiento_viatico",modulo:"tms",detalle:`Requerimiento de viáticos #${reqId}`});
    await conn.commit(); return await obtenerRequerimientoViatico(empresaId,reqId!);
  } catch(e){ await conn.rollback(); throw e; } finally { conn.release(); }
}

const pasos:Record<string,{desde:string[];hacia:string}>={enviar:{desde:["BORRADOR"],hacia:"PENDIENTE"},autorizar:{desde:["PENDIENTE"],hacia:"AUTORIZADO"},rechazar:{desde:["PENDIENTE"],hacia:"RECHAZADO"},entregar:{desde:["AUTORIZADO"],hacia:"ENTREGADO"},liquidar:{desde:["ENTREGADO"],hacia:"LIQUIDADO"}};
export async function transicionarRequerimientoViatico(empresaId:number,id:number,usuarioId:number,usuarioNombre:string,usuarioRol:string,datos:TransicionRequerimientoViatico){
  let firmaRuta:string|null=null; let firmaImagen:{relative:string;original:string;mime:string;size:number;sha256:string}|null=null;
  if(datos.accion==="autorizar"){
    const plantilla=await leerBytesFirmaGuardada(usuarioId);
    if(plantilla&&esPngValido(Buffer.from(plantilla.bytes))){const f=await guardarUpload(empresaId,"firmas",`firma_viatico_requerimiento_autorizar_${id}`,{name:plantilla.original||"firma.png",size:plantilla.bytes.byteLength,arrayBuffer:async()=>plantilla.bytes});firmaRuta=f.relative;firmaImagen={relative:f.relative,original:f.original,mime:"image/png",size:f.size,sha256:sha256Hex(plantilla.bytes)};}
  }
  // Firma del REQUIRENTE al emitir (enviar): SOLO si el requirente es el usuario de sesión (nunca se firma por otra persona).
  let firmaRequirente:{relative:string;original:string;mime:string;size:number;sha256:string;origen:"GUARDADA"|"DIBUJADA"}|null=null;
  if(datos.accion==="enviar"&&datos.firmaRequirente){
    const [r]=await query<RowDataPacket[]>(`SELECT requirente_usuario_id FROM tms_viatico_requerimientos WHERE empresa_id=? AND id=? LIMIT 1`,[empresaId,id]);
    if(r&&Number(r.requirente_usuario_id)===usuarioId){
      let bytes:ArrayBuffer|null=null;let original="firma.png";
      if(datos.firmaRequirente.modo==="GUARDADA"){const g=await leerBytesFirmaGuardada(usuarioId);if(g){bytes=g.bytes;original=g.original;}}
      else{const b=Buffer.from(datos.firmaRequirente.imagenBase64,"base64");if(b.length<=MAX_FIRMA_IMAGEN_BYTES)bytes=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;}
      if(!bytes||!esPngValido(new Uint8Array(bytes)))throw new ErrorRequerimientoViatico("La firma no es válida; dibuja tu firma o configura Mi firma.",400);
      const f=await guardarUpload(empresaId,"firmas",`firma_viatico_requerimiento_requirente_${id}`,{name:original,size:bytes.byteLength,arrayBuffer:async()=>bytes!});
      firmaRuta=f.relative;firmaRequirente={relative:f.relative,original:f.original,mime:"image/png",size:f.size,sha256:sha256Hex(bytes),origen:datos.firmaRequirente.modo};
    }
  }
  const conn=await getPool().getConnection(); let confirmado=false; try{ await conn.beginTransaction();
    const [rows]=await conn.query<RowDataPacket[]>(`SELECT estado,version,total,requirente_usuario_id FROM tms_viatico_requerimientos WHERE empresa_id=? AND id=? FOR UPDATE`,[empresaId,id]); const actual=rows[0];
    if(!actual) throw new ErrorRequerimientoViatico("Requerimiento no encontrado.",404); const paso=pasos[datos.accion];
    if(Number(actual.version)!==datos.version || !paso.desde.includes(String(actual.estado))) throw new ErrorRequerimientoViatico("La transición ya no es válida; recarga la página.",409);
    const extra: string[]=[]; const params:SqlParams=[paso.hacia];
    if(datos.accion==="autorizar"){
      extra.push("autorizado_por_usuario_id=?","autorizado_por_nombre=?","autorizado_en=NOW()");params.push(usuarioId,usuarioNombre);
      await crearFirmaInterna(conn,{empresaId,usuarioId,empleadoId:null,nombreFirmante:usuarioNombre,rolFirmante:usuarioRol,accion:"AUTORIZAR_REQUERIMIENTO_VIATICO",modulo:"TMS",entidadTipo:"REQUERIMIENTO_VIATICO",entidadId:id,valoresRelevantes:{requerimientoId:id,estadoAnterior:actual.estado,estadoNuevo:"AUTORIZADO",total:actual.total},metodo:"FIRMA_MANUSCRITA",origenFirma:firmaImagen?"GUARDADA":null,imagen:firmaImagen});
    }
    if(datos.accion==="enviar"&&firmaRequirente&&Number(actual.requirente_usuario_id)===usuarioId){
      await crearFirmaInterna(conn,{empresaId,usuarioId,empleadoId:null,nombreFirmante:usuarioNombre,rolFirmante:usuarioRol,accion:ACCION_FIRMA_REQUIRENTE,modulo:"TMS",entidadTipo:"REQUERIMIENTO_VIATICO",entidadId:id,valoresRelevantes:{requerimientoId:id,estadoAnterior:actual.estado,estadoNuevo:"PENDIENTE",total:actual.total,rol:"REQUIRENTE"},metodo:"FIRMA_MANUSCRITA",origenFirma:firmaRequirente.origen,imagen:firmaRequirente});
    }
    if(datos.accion==="rechazar"){extra.push("rechazado_por_usuario_id=?","rechazado_por_nombre=?","rechazado_en=NOW()","motivo_rechazo=?");params.push(usuarioId,usuarioNombre,datos.motivo);}
    if(datos.accion==="entregar"){extra.push("metodo_entrega=?","referencia_entrega=?","observaciones_entrega=?","entregado_por_usuario_id=?","entregado_por_nombre=?","entregado_en=NOW()");params.push(datos.metodo,datos.referencia,datos.observaciones,usuarioId,usuarioNombre);}
    if(datos.accion==="liquidar"){extra.push("observaciones_liquidacion=?","liquidado_por_usuario_id=?","liquidado_por_nombre=?","liquidado_en=NOW()");params.push(datos.observaciones,usuarioId,usuarioNombre);}
    params.push(empresaId,id,datos.version); await conn.execute(`UPDATE tms_viatico_requerimientos SET estado=?,${extra.length?extra.join(",")+",":""}version=version+1 WHERE empresa_id=? AND id=? AND version=?`,params);
    await registrarAuditoriaTx(conn,{empresaId,usuario:usuarioNombre,accion:`${datos.accion}_requerimiento_viatico`,modulo:"tms",detalle:`Requerimiento de viáticos #${id}: ${actual.estado} -> ${paso.hacia}`});
    await conn.commit(); confirmado=true; return await obtenerRequerimientoViatico(empresaId,id);
  }catch(e){await conn.rollback();throw e;}finally{conn.release();if(!confirmado&&firmaRuta)try{borrarUpload(firmaRuta);}catch{}}
}
