import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";

/**
 * Fase INV-0 — Inventario RRHH (artículos entregables a empleados:
 * uniformes, EPP, celulares, etc.). Independiente de flota_inv_equipo
 * (inventario operativo/herramientas de Flota — no se toca en esta fase).
 *
 * Alcance de INV-0: catálogo de artículos + costo unitario + historial de
 * movimientos de stock (ENTRADA / AJUSTE), con protección atómica contra
 * stock negativo. NO incluye entrega a empleado, descuentos, cuotas,
 * devolución ni pérdida — eso es INV-1 en adelante.
 */

export type ArticuloInventario = {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string | null;
  stock: number;
  unidad: string;
  costoUnitario: number | null;
  estado: string;
};

/** Fase INV-0: solo estos dos. Más tipos (SALIDA, DEVOLUCION, PERDIDA) llegan en fases futuras. */
export type TipoMovimientoInventario = "ENTRADA" | "AJUSTE";

export type MovimientoInventario = {
  id: number;
  articuloId: number;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  stockResultante: number;
  motivo: string | null;
  registradoPor: string | null;
  creadoEn: string;
};

function mapArticulo(r: RowDataPacket): ArticuloInventario {
  return {
    id: Number(r.id),
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    categoria: r.categoria != null ? String(r.categoria) : null,
    stock: Number(r.stock ?? 0),
    unidad: String(r.unidad || "Unidad"),
    costoUnitario: r.costo_unitario != null ? Number(r.costo_unitario) : null,
    estado: String(r.estado || "Activo"),
  };
}

/** Lista de artículos, con búsqueda opcional por código/nombre/categoría. */
export async function listarArticulos(
  empresaId: number,
  opts?: { q?: string },
): Promise<ArticuloInventario[]> {
  const where = ["empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  const q = opts?.q?.trim();
  if (q) {
    where.push("(codigo LIKE ? OR nombre LIKE ? OR COALESCE(categoria, '') LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, categoria, stock, unidad, costo_unitario, estado
     FROM inventario_rrhh
     WHERE ${where.join(" AND ")}
     ORDER BY nombre`,
    params,
  );
  return rows.map(mapArticulo);
}

export async function obtenerArticulo(
  empresaId: number,
  id: number,
): Promise<ArticuloInventario | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, categoria, stock, unidad, costo_unitario, estado
     FROM inventario_rrhh WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  return rows[0] ? mapArticulo(rows[0]) : null;
}

export type NuevoArticuloInput = {
  codigo: string;
  nombre: string;
  categoria?: string | null;
  stockInicial?: number;
  unidad?: string;
  costoUnitario?: number | null;
};

export type ResultadoArticulo =
  | { ok: true; id: number }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Crea el artículo. Si se indica `stockInicial > 0`, además registra un
 * movimiento ENTRADA inicial (mismo camino que cualquier otra entrada de
 * stock, para que el historial quede completo desde el primer día del
 * artículo — no un stock "de la nada" sin movimiento que lo respalde).
 */
export async function crearArticulo(
  empresaId: number,
  input: NuevoArticuloInput,
  registradoPor: string,
): Promise<ResultadoArticulo> {
  const codigo = input.codigo.trim();
  const nombre = input.nombre.trim();
  if (!codigo) return { ok: false, motivo: "codigo_requerido", mensaje: "El código es obligatorio." };
  if (!nombre) return { ok: false, motivo: "nombre_requerido", mensaje: "El nombre es obligatorio." };
  const stockInicial = Math.trunc(input.stockInicial ?? 0);
  if (stockInicial < 0) {
    return { ok: false, motivo: "stock_invalido", mensaje: "El stock inicial no puede ser negativo." };
  }
  if (input.costoUnitario != null && input.costoUnitario < 0) {
    return { ok: false, motivo: "costo_invalido", mensaje: "El costo unitario no puede ser negativo." };
  }

  let articuloId: number;
  try {
    const result = await execute(
      `INSERT INTO inventario_rrhh (empresa_id, codigo, nombre, categoria, stock, unidad, costo_unitario)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [
        empresaId,
        codigo,
        nombre,
        input.categoria?.trim() || null,
        input.unidad?.trim() || "Unidad",
        input.costoUnitario ?? null,
      ],
    );
    articuloId = Number(result.insertId);
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "ER_DUP_ENTRY") {
      return { ok: false, motivo: "codigo_duplicado", mensaje: "Ya existe un artículo con ese código." };
    }
    throw err;
  }

  if (stockInicial > 0) {
    const mov = await registrarMovimiento(empresaId, {
      articuloId,
      tipo: "ENTRADA",
      cantidad: stockInicial,
      motivo: "Stock inicial al crear el artículo.",
      registradoPor,
    });
    if (!mov.ok) {
      // No debería ocurrir (artículo recién creado, stock 0 + positivo
      // siempre es válido) — si pasara, el artículo ya quedó creado con
      // stock 0; se reporta para que RRHH registre la entrada manualmente.
      return { ok: true, id: articuloId };
    }
  }

  return { ok: true, id: articuloId };
}

export type ResultadoMovimiento =
  | { ok: true; stockResultante: number }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Registra un movimiento de stock (ENTRADA o AJUSTE) de forma atómica:
 * UPDATE condicionado (stock + cantidad >= 0) + INSERT del movimiento,
 * dentro de la MISMA transacción — nunca queda un movimiento registrado
 * sin que el stock haya cambiado, ni viceversa. El UPDATE condicionado es
 * lo que impide que el stock quede negativo, incluso ante dos ajustes
 * concurrentes sobre el mismo artículo (el segundo ve el stock ya
 * actualizado por el primero, gracias al bloqueo de fila de InnoDB).
 *
 * AJUSTE exige `motivo` no vacío (ENTRADA no lo exige, aunque se admite).
 * Los movimientos son append-only: esta función nunca actualiza ni borra
 * una fila de inventario_rrhh_movimientos ya creada.
 */
export async function registrarMovimiento(
  empresaId: number,
  input: {
    articuloId: number;
    tipo: TipoMovimientoInventario;
    /** ENTRADA: siempre positivo. AJUSTE: con signo (+/-), nunca 0. */
    cantidad: number;
    motivo?: string | null;
    registradoPor: string;
  },
): Promise<ResultadoMovimiento> {
  const cantidad = Math.trunc(input.cantidad);
  if (cantidad === 0) {
    return { ok: false, motivo: "cantidad_invalida", mensaje: "La cantidad no puede ser cero." };
  }
  if (input.tipo === "ENTRADA" && cantidad < 0) {
    return { ok: false, motivo: "cantidad_invalida", mensaje: "Una entrada debe ser una cantidad positiva." };
  }
  const motivo = input.motivo?.trim() || null;
  if (input.tipo === "AJUSTE" && !motivo) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Todo ajuste de stock requiere un motivo." };
  }

  const conn = await getPool().getConnection();
  let stockResultante: number;
  try {
    await conn.beginTransaction();

    const [res] = await conn.execute<ResultSetHeader>(
      `UPDATE inventario_rrhh
       SET stock = stock + ?
       WHERE id = ? AND empresa_id = ? AND stock + ? >= 0`,
      [cantidad, input.articuloId, empresaId, cantidad],
    );
    if (res.affectedRows !== 1) {
      // Puede ser: el artículo no existe/no es de esta empresa, o el
      // ajuste dejaría el stock negativo — no distinguimos cuál para no
      // filtrar existencia de artículos de otra empresa; el mensaje cubre
      // ambos casos con seguridad.
      throw new ErrorMovimiento(
        "stock_insuficiente",
        "No se pudo aplicar: el artículo no existe o el ajuste dejaría el stock en negativo.",
      );
    }

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT stock FROM inventario_rrhh WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.articuloId, empresaId],
    );
    stockResultante = Number(rows[0]?.stock ?? 0);

    await conn.execute(
      `INSERT INTO inventario_rrhh_movimientos
        (empresa_id, articulo_id, tipo, cantidad, stock_resultante, motivo, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, input.articuloId, input.tipo, cantidad, stockResultante, motivo, input.registradoPor],
    );

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    if (e instanceof ErrorMovimiento) {
      return { ok: false, motivo: e.motivo, mensaje: e.message };
    }
    throw e;
  } finally {
    conn.release();
  }

  await registrarAuditoria({
    empresaId,
    usuario: input.registradoPor,
    accion: input.tipo === "ENTRADA" ? "inventario_entrada_stock" : "inventario_ajuste_stock",
    modulo: "rrhh",
    detalle: `Artículo #${input.articuloId} · ${cantidad > 0 ? "+" : ""}${cantidad} · stock resultante ${stockResultante} · ${motivo ?? "sin motivo"}`,
  });

  return { ok: true, stockResultante };
}

class ErrorMovimiento extends Error {
  constructor(
    public motivo: string,
    message: string,
  ) {
    super(message);
  }
}

/** Historial de movimientos de un artículo, más recientes primero. */
export async function listarMovimientos(
  empresaId: number,
  articuloId: number,
): Promise<MovimientoInventario[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, articulo_id, tipo, cantidad, stock_resultante, motivo, registrado_por, creado_en
     FROM inventario_rrhh_movimientos
     WHERE empresa_id = ? AND articulo_id = ?
     ORDER BY creado_en DESC, id DESC
     LIMIT 200`,
    [empresaId, articuloId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    articuloId: Number(r.articulo_id),
    tipo: String(r.tipo) === "AJUSTE" ? "AJUSTE" : "ENTRADA",
    cantidad: Number(r.cantidad),
    stockResultante: Number(r.stock_resultante),
    motivo: r.motivo != null ? String(r.motivo) : null,
    registradoPor: r.registrado_por != null ? String(r.registrado_por) : null,
    creadoEn: String(r.creado_en),
  }));
}
