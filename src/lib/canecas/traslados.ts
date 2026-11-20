import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { calcularTransito, estadoTraslado, registrarRecepcion } from "./traslados-reglas";

type PartidaRecepcion = { partidaId: number; recibido: number; faltante: number; motivo: string };
type Recepcion = { clave: string; recibe: string; condicion: string; observaciones: string; partidas: PartidaRecepcion[] };
type Marca = { nombre: string; logo: Buffer | null; logoTipo: string | null };
type Borrador = { clave: string; origenId: number; destinoId: number; entrega: string; transporte: string; observaciones: string; partidas: { productoId: number; cantidad: number }[] };

async function transaccion<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

async function bloquearTraslado(conn: PoolConnection, empresa: number, id: number) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM canecas_traslados WHERE empresa_id=? AND id=? FOR UPDATE", [empresa, id]);
  if (!rows[0]) throw new Error("TRASLADO_NO_ENCONTRADO");
  return rows[0];
}

async function partidasTraslado(conn: PoolConnection, empresa: number, id: number) {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT * FROM canecas_traslado_partidas WHERE empresa_id=? AND traslado_id=? ORDER BY producto_id FOR UPDATE", [empresa, id]);
  if (!rows.length) throw new Error("SIN_PARTIDAS");
  return rows;
}

/** Crear el borrador nunca altera los saldos. El mismo UUID solo admite el mismo contenido. */
export async function crearTraslado(pool: Pool, empresa: number, usuario: number, input: Borrador) {
  const partidas = [...input.partidas].sort((a, b) => a.productoId - b.productoId);
  if (input.origenId === input.destinoId || !partidas.length || new Set(partidas.map(p => p.productoId)).size !== partidas.length) throw new Error("PARTIDAS_INVALIDAS");
  if (partidas.some(p => !Number.isSafeInteger(p.cantidad) || p.cantidad <= 0 || p.cantidad > 2147483647)) throw new Error("CANTIDAD_INVALIDA");
  const huella = createHash("sha256").update(JSON.stringify({ ...input, partidas })).digest("hex");
  try { return await transaccion(pool, async conn => {
    const [previos] = await conn.query<RowDataPacket[]>("SELECT id,huella FROM canecas_traslados WHERE empresa_id=? AND clave_operacion=? FOR UPDATE", [empresa, input.clave]);
    if (previos[0]) {
      if (previos[0].huella !== huella) throw new Error("CLAVE_REUTILIZADA");
      return { id: Number(previos[0].id), yaRegistrado: true };
    }
    const [ubicaciones] = await conn.query<RowDataPacket[]>("SELECT id FROM canecas_ubicaciones WHERE empresa_id=? AND id IN (?,?) AND activo=1", [empresa, input.origenId, input.destinoId]);
    if (ubicaciones.length !== 2) throw new Error("UBICACION_NO_ENCONTRADA");
    for (const p of partidas) {
      const [productos] = await conn.query<RowDataPacket[]>("SELECT id FROM canecas_productos WHERE empresa_id=? AND id=? AND activo=1", [empresa, p.productoId]);
      if (!productos.length) throw new Error("PRODUCTO_NO_ENCONTRADO");
    }
    const [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_traslados (empresa_id,origen_id,destino_id,numero,clave_operacion,huella,entrega,transporte,observaciones,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)", [empresa, input.origenId, input.destinoId, `TR-${randomUUID()}`, input.clave, huella, input.entrega, input.transporte, input.observaciones, usuario]);
    for (const p of partidas) await conn.execute("INSERT INTO canecas_traslado_partidas (empresa_id,traslado_id,producto_id,cantidad) VALUES (?,?,?,?)", [empresa, r.insertId, p.productoId, p.cantidad]);
    return { id: r.insertId, yaRegistrado: false };
  }); } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    const [previos] = await pool.query<RowDataPacket[]>("SELECT id,huella FROM canecas_traslados WHERE empresa_id=? AND clave_operacion=?", [empresa, input.clave]);
    if (!previos[0]) throw error;
    if (previos[0].huella !== huella) throw new Error("CLAVE_REUTILIZADA");
    return { id: Number(previos[0].id), yaRegistrado: true };
  }
}

/** Descuenta una sola vez el disponible no reservado y emite el documento inicial. */
export async function enviarTraslado(pool: Pool, empresa: number, id: number, usuario: number, marca: Marca) {
  return transaccion(pool, async conn => {
    const traslado = await bloquearTraslado(conn, empresa, id);
    if (traslado.estado !== "BORRADOR") return { yaEnviado: true };
    const partidas = await partidasTraslado(conn, empresa, id);
    const detalles: { partidaId: number; producto: string; presentacion: string; cantidad: number }[] = [];
    for (const partida of partidas) {
      const cantidad = Number(partida.cantidad);
      if (!Number.isSafeInteger(cantidad) || cantidad <= 0 || cantidad > 2147483647) throw new Error("CANTIDAD_INVALIDA");
      const [saldos] = await conn.query<RowDataPacket[]>("SELECT fisico,reservado FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE", [empresa, partida.producto_id, traslado.origen_id]);
      if (!saldos[0] || Number(saldos[0].fisico) - Number(saldos[0].reservado) < cantidad) throw new Error("EXISTENCIA_INSUFICIENTE");
      const [productos] = await conn.query<RowDataPacket[]>("SELECT nombre,presentacion FROM canecas_productos WHERE empresa_id=? AND id=?", [empresa, partida.producto_id]);
      if (!productos[0]) throw new Error("PRODUCTO_NO_ENCONTRADO");
      detalles.push({ partidaId: Number(partida.id), producto: productos[0].nombre, presentacion: productos[0].presentacion, cantidad });
      await conn.execute("UPDATE canecas_saldos SET fisico=fisico-? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?", [cantidad, empresa, partida.producto_id, traslado.origen_id]);
      await conn.execute("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (?,?,?,'SALIDA',?,?,?)", [empresa, partida.producto_id, traslado.origen_id, -cantidad, traslado.numero, usuario]);
    }
    const [ubicaciones] = await conn.query<RowDataPacket[]>("SELECT id,nombre FROM canecas_ubicaciones WHERE empresa_id=? AND id IN (?,?)", [empresa, traslado.origen_id, traslado.destino_id]);
    const origen = ubicaciones.find(u => u.id === traslado.origen_id)?.nombre;
    const destino = ubicaciones.find(u => u.id === traslado.destino_id)?.nombre;
    if (!origen || !destino) throw new Error("UBICACION_NO_ENCONTRADA");
    await conn.execute("UPDATE canecas_traslados SET estado='ENVIADO',enviado_por=?,enviado_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND id=?", [usuario, empresa, id]);
    const [fecha] = await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(enviado_en,'%Y-%m-%d %H:%i:%s') AS fecha FROM canecas_traslados WHERE empresa_id=? AND id=?", [empresa, id]);
    const datos = { empresa: marca.nombre, numero: traslado.numero, origen, destino, fecha: fecha[0].fecha, entrega: traslado.entrega, transporte: traslado.transporte, observaciones: traslado.observaciones, detalles, recepciones: [] };
    await conn.execute("INSERT INTO canecas_traslado_documentos (empresa_id,traslado_id,version,datos,logo,logo_tipo,creado_por) VALUES (?,?,1,?,?,?,?)", [empresa, id, JSON.stringify(datos), marca.logo, marca.logoTipo, usuario]);
    return { yaEnviado: false };
  });
}

/** Las partidas no declaradas siguen en tránsito; los faltantes requieren autorización previa. */
export async function recibirTraslado(pool: Pool, empresa: number, id: number, usuario: number, input: Recepcion, autorizaFaltante: boolean) {
  const partidas = [...input.partidas].sort((a, b) => a.partidaId - b.partidaId);
  if (!partidas.length || new Set(partidas.map(p => p.partidaId)).size !== partidas.length) throw new Error("PARTIDAS_INVALIDAS");
  if (partidas.some(p => p.faltante > 0 && (!autorizaFaltante || !p.motivo.trim()))) throw new Error("FALTANTE_NO_AUTORIZADO");
  const huella = createHash("sha256").update(JSON.stringify({ ...input, partidas })).digest("hex");
  return transaccion(pool, async conn => {
    const traslado = await bloquearTraslado(conn, empresa, id);
    const [existentes] = await conn.query<RowDataPacket[]>("SELECT id,traslado_id,huella FROM canecas_traslado_recepciones WHERE empresa_id=? AND clave_operacion=?", [empresa, input.clave]);
    if (existentes[0]) {
      if (Number(existentes[0].traslado_id) !== id || existentes[0].huella !== huella) throw new Error("CLAVE_REUTILIZADA");
      return { yaRegistrada: true };
    }
    if (traslado.estado !== "ENVIADO") throw new Error("ESTADO_INVALIDO");
    const actuales = await partidasTraslado(conn, empresa, id);
    const [creada] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_traslado_recepciones (empresa_id,traslado_id,clave_operacion,huella,recibe,condicion,observaciones,usuario_id) VALUES (?,?,?,?,?,?,?,?)", [empresa, id, input.clave, huella, input.recibe, input.condicion, input.observaciones, usuario]);
    for (const p of partidas) {
      const actual = actuales.find(a => Number(a.id) === p.partidaId);
      if (!actual) throw new Error("PARTIDA_NO_ENCONTRADA");
      const saldo = registrarRecepcion({ enviado: Number(actual.cantidad), recibido: Number(actual.recibido), faltante: Number(actual.faltante) }, p.recibido, p.faltante);
      await conn.execute("UPDATE canecas_traslado_partidas SET recibido=?,faltante=? WHERE empresa_id=? AND traslado_id=? AND id=?", [saldo.recibido, saldo.faltante, empresa, id, p.partidaId]);
      await conn.execute("INSERT INTO canecas_traslado_recepcion_partidas (empresa_id,traslado_id,recepcion_id,partida_id,recibido,faltante,motivo) VALUES (?,?,?,?,?,?,?)", [empresa, id, creada.insertId, p.partidaId, p.recibido, p.faltante, p.motivo]);
      if (p.recibido > 0) {
        await conn.execute("INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (?,?,?,0,0) ON DUPLICATE KEY UPDATE fisico=fisico", [empresa, actual.producto_id, traslado.destino_id]);
        const [saldos] = await conn.query<RowDataPacket[]>("SELECT fisico FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE", [empresa, actual.producto_id, traslado.destino_id]);
        if (Number(saldos[0].fisico) + p.recibido > 2147483647) throw new Error("SALDO_EXCEDE_LIMITE");
        await conn.execute("UPDATE canecas_saldos SET fisico=fisico+? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?", [p.recibido, empresa, actual.producto_id, traslado.destino_id]);
        await conn.execute("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (?,?,?,'ENTRADA',?,?,?)", [empresa, actual.producto_id, traslado.destino_id, p.recibido, traslado.numero, usuario]);
      }
      actual.recibido = saldo.recibido; actual.faltante = saldo.faltante;
    }
    const estado = estadoTraslado(actuales.map(p => ({ enviado: Number(p.cantidad), recibido: Number(p.recibido), faltante: Number(p.faltante) })));
    await conn.execute("UPDATE canecas_traslados SET estado=? WHERE empresa_id=? AND id=?", [estado, empresa, id]);
    const [documentos] = await conn.query<RowDataPacket[]>("SELECT version,datos,logo,logo_tipo FROM canecas_traslado_documentos WHERE empresa_id=? AND traslado_id=? ORDER BY version DESC LIMIT 1", [empresa, id]);
    if (!documentos[0]) throw new Error("DOCUMENTO_NO_ENCONTRADO");
    const anterior = typeof documentos[0].datos === "string" ? JSON.parse(documentos[0].datos) : documentos[0].datos;
    const [fechas] = await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') AS fecha FROM canecas_traslado_recepciones WHERE empresa_id=? AND id=?", [empresa, creada.insertId]);
    const eventos = [...anterior.recepciones, { fecha: fechas[0].fecha, recibe: input.recibe, condicion: input.condicion, observaciones: input.observaciones, partidas }];
    await conn.execute("INSERT INTO canecas_traslado_documentos (empresa_id,traslado_id,version,datos,logo,logo_tipo,creado_por) VALUES (?,?,?,?,?,?,?)", [empresa, id, Number(documentos[0].version) + 1, JSON.stringify({ ...anterior, recepciones: eventos }), documentos[0].logo, documentos[0].logo_tipo, usuario]);
    return { yaRegistrada: false, estado, enTransito: actuales.reduce((n, p) => n + calcularTransito({ enviado: Number(p.cantidad), recibido: Number(p.recibido), faltante: Number(p.faltante) }), 0) };
  });
}

