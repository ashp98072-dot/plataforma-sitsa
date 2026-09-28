import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  autorizarDescuentoInterno,
  crearDescuentoInterno,
  validarEmpleado,
  PERIODICIDADES,
  type Periodicidad,
} from "@/lib/rrhh/descuentos";
import { hoyLocal } from "@/lib/rrhh/dates";
import { redondearQ } from "@/lib/rrhh/contratos-pago";
import {
  calcularEstadoEntrega,
  cantidadDisponibleParaAjuste,
  validarCantidadAjuste,
  validarCompatibilidadPrecioCambio,
  type EstadoEntregaDerivado,
  type TipoAjusteInventario,
} from "@/lib/rrhh/inventario-ajustes";

/**
 * Fase INV-0 — Inventario RRHH (artículos entregables a empleados:
 * uniformes, EPP, celulares, etc.). Independiente de flota_inv_equipo
 * (inventario operativo/herramientas de Flota — no se toca en esta fase).
 *
 * Alcance de INV-0: catálogo de artículos + costo unitario + historial de
 * movimientos de stock (ENTRADA / AJUSTE), con protección atómica contra
 * stock negativo.
 *
 * Fase INV-1 — entrega a empleado (crearEntrega): descuenta stock, registra
 * el movimiento SALIDA y, si corresponde, crea un descuento D1/D2
 * (clasificación INVENTARIO) ya ACTIVO con sus cuotas — todo en UNA sola
 * transacción con registrarMovimientoInterno/crearDescuentoInterno/
 * autorizarDescuentoInterno (mismo motor D1/D2, no uno paralelo). Devolución
 * y pérdida quedan para una fase posterior.
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

/**
 * Fase INV-1: agrega SALIDA (entrega a empleado). RRHH-INVENTARIO-CAMBIOS-1
 * agrega DEVOLUCION (regresa stock, de una devolución o del lado "regresa"
 * de un cambio) y CAMBIO_SALIDA (el lado "entrega el artículo nuevo" de un
 * cambio — distinto de SALIDA para no confundirlo con una entrega inicial
 * en el historial). PERDIDA queda para una fase futura.
 */
export type TipoMovimientoInventario =
  | "ENTRADA"
  | "AJUSTE"
  | "SALIDA"
  | "DEVOLUCION"
  | "CAMBIO_SALIDA";

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

class ErrorMovimiento extends Error {
  constructor(
    public motivo: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Fase INV-1 (extraída de registrarMovimiento, exportada): núcleo atómico
 * de un movimiento de stock — UPDATE condicionado (stock + cantidad >= 0) +
 * INSERT del movimiento. Recibe `conn`: participa en la transacción del
 * llamador (crearEntrega la usa junto con la creación del descuento, todo
 * en una sola transacción); no abre ni confirma nada por sí misma, no
 * registra auditoría (eso lo hace el llamador, después de un commit
 * exitoso). Lanza ErrorMovimiento si el artículo no existe/no es de esta
 * empresa o si dejaría el stock en negativo — el mismo UPDATE condicionado
 * es lo que impide stock negativo, incluso ante dos movimientos
 * concurrentes sobre el mismo artículo (bloqueo de fila InnoDB).
 *
 * No valida `cantidad`/`motivo` — eso lo hace el llamador según el tipo
 * (ENTRADA/AJUSTE/SALIDA tienen reglas distintas, ver registrarMovimiento y
 * crearEntrega).
 */
export async function registrarMovimientoInterno(
  conn: PoolConnection,
  empresaId: number,
  input: {
    articuloId: number;
    tipo: TipoMovimientoInventario;
    cantidad: number;
    motivo: string | null;
    registradoPor: string;
  },
): Promise<{ movimientoId: number; stockResultante: number }> {
  const [res] = await conn.execute<ResultSetHeader>(
    `UPDATE inventario_rrhh
     SET stock = stock + ?
     WHERE id = ? AND empresa_id = ? AND stock + ? >= 0`,
    [input.cantidad, input.articuloId, empresaId, input.cantidad],
  );
  if (res.affectedRows !== 1) {
    // Puede ser: el artículo no existe/no es de esta empresa, o el
    // movimiento dejaría el stock negativo — no distinguimos cuál para no
    // filtrar existencia de artículos de otra empresa; el mensaje cubre
    // ambos casos con seguridad.
    throw new ErrorMovimiento(
      "stock_insuficiente",
      "No se pudo aplicar: el artículo no existe o el movimiento dejaría el stock en negativo.",
    );
  }

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT stock FROM inventario_rrhh WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [input.articuloId, empresaId],
  );
  const stockResultante = Number(rows[0]?.stock ?? 0);

  const [movResult] = await conn.execute<ResultSetHeader>(
    `INSERT INTO inventario_rrhh_movimientos
      (empresa_id, articulo_id, tipo, cantidad, stock_resultante, motivo, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      input.articuloId,
      input.tipo,
      input.cantidad,
      stockResultante,
      input.motivo,
      input.registradoPor,
    ],
  );

  return { movimientoId: Number(movResult.insertId), stockResultante };
}

/**
 * Registra un movimiento de stock (ENTRADA o AJUSTE) de forma atómica —
 * abre su propia transacción y llama a registrarMovimientoInterno. Uso
 * independiente (pantalla de Inventario, fuera de una entrega). AJUSTE
 * exige `motivo` no vacío (ENTRADA no lo exige, aunque se admite). Los
 * movimientos son append-only: nunca se actualiza ni borra una fila de
 * inventario_rrhh_movimientos ya creada.
 */
export async function registrarMovimiento(
  empresaId: number,
  input: {
    articuloId: number;
    tipo: "ENTRADA" | "AJUSTE";
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
  let resultado: { movimientoId: number; stockResultante: number };
  try {
    await conn.beginTransaction();
    resultado = await registrarMovimientoInterno(conn, empresaId, {
      articuloId: input.articuloId,
      tipo: input.tipo,
      cantidad,
      motivo,
      registradoPor: input.registradoPor,
    });
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
    detalle: `Artículo #${input.articuloId} · ${cantidad > 0 ? "+" : ""}${cantidad} · stock resultante ${resultado.stockResultante} · ${motivo ?? "sin motivo"}`,
  });

  return { ok: true, stockResultante: resultado.stockResultante };
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
  return rows.map((r) => {
    const tipo = String(r.tipo);
    const TIPOS_VALIDOS: readonly string[] = ["AJUSTE", "SALIDA", "DEVOLUCION", "CAMBIO_SALIDA"];
    return {
      id: Number(r.id),
      articuloId: Number(r.articulo_id),
      // Fase INV-1/RRHH-INVENTARIO-CAMBIOS-1: cualquier tipo desconocido cae a ENTRADA (mismo criterio previo).
      tipo: (TIPOS_VALIDOS.includes(tipo) ? tipo : "ENTRADA") as TipoMovimientoInventario,
      cantidad: Number(r.cantidad),
      stockResultante: Number(r.stock_resultante),
      motivo: r.motivo != null ? String(r.motivo) : null,
      registradoPor: r.registrado_por != null ? String(r.registrado_por) : null,
      creadoEn: String(r.creado_en),
    };
  });
}

// ---------------------------------------------------------------------------
// Fase INV-1 — Entrega a empleado. Conecta inventario con el motor D1/D2 de
// descuentos (rrhh_descuentos_maestro/rrhh_descuento_cuotas) sin duplicarlo
// — ver crearDescuentoInterno/autorizarDescuentoInterno en descuentos.ts. La
// entrega vive en una tabla NUEVA e independiente: inventario_rrhh_entregas.
// descuento_id apunta HACIA el descuento (nunca al revés), así D1/D2 no
// necesitan ningún cambio de schema.
// ---------------------------------------------------------------------------

export type AjusteEntrega = {
  id: number;
  entregaId: number;
  tipo: TipoAjusteInventario;
  cantidad: number;
  articuloNuevoId: number | null;
  articuloNuevoNombre: string | null;
  entregaNuevaId: number | null;
  motivo: string;
  registradoPor: string | null;
  creadoEn: string;
};

export type EntregaInventario = {
  id: number;
  articuloId: number;
  articuloNombre: string;
  articuloCodigo: string;
  empleadoId: number;
  empleadoNombre: string;
  empleadoCodigo: string;
  cantidad: number;
  /** Precio vigente AL MOMENTO de la entrega — no cambia si luego cambia inventario_rrhh.costo_unitario. */
  costoUnitarioEntrega: number;
  costoTotal: number;
  montoCobrado: number;
  descuentoId: number | null;
  movimientoId: number | null;
  motivo: string | null;
  entregadoPor: string | null;
  /**
   * RRHH-INVENTARIO-CAMBIOS-1: SIEMPRE calculado desde `cantidad` + `ajustes`
   * (ver calcularEstadoEntrega) — la fila en BD nunca se actualiza después
   * de creada, sigue guardando 'ENTREGADO' para siempre.
   */
  estado: EstadoEntregaDerivado;
  /** Cuánto de esta entrega sigue disponible para devolver/cambiar. */
  cantidadDisponible: number;
  /** Historial de devoluciones/cambios de ESTA entrega, más reciente primero. */
  ajustes: AjusteEntrega[];
  creadoEn: string;
};

function mapEntrega(r: RowDataPacket, ajustes: AjusteEntrega[]): EntregaInventario {
  const cantidad = Number(r.cantidad);
  return {
    id: Number(r.id),
    articuloId: Number(r.articulo_id),
    articuloNombre: r.articulo_nombre != null ? String(r.articulo_nombre) : "",
    articuloCodigo: r.articulo_codigo != null ? String(r.articulo_codigo) : "",
    empleadoId: Number(r.empleado_id),
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : "",
    empleadoCodigo: r.empleado_codigo != null ? String(r.empleado_codigo) : "",
    cantidad,
    costoUnitarioEntrega: Number(r.costo_unitario_entrega ?? 0),
    costoTotal: Number(r.costo_total ?? 0),
    montoCobrado: Number(r.monto_cobrado ?? 0),
    descuentoId: r.descuento_id != null ? Number(r.descuento_id) : null,
    movimientoId: r.movimiento_id != null ? Number(r.movimiento_id) : null,
    motivo: r.motivo != null ? String(r.motivo) : null,
    entregadoPor: r.entregado_por != null ? String(r.entregado_por) : null,
    estado: calcularEstadoEntrega(cantidad, ajustes),
    cantidadDisponible: cantidadDisponibleParaAjuste(cantidad, ajustes),
    ajustes,
    creadoEn: String(r.creado_en),
  };
}

function mapAjuste(r: RowDataPacket): AjusteEntrega {
  return {
    id: Number(r.id),
    entregaId: Number(r.entrega_id),
    tipo: String(r.tipo) as TipoAjusteInventario,
    cantidad: Number(r.cantidad),
    articuloNuevoId: r.articulo_nuevo_id != null ? Number(r.articulo_nuevo_id) : null,
    articuloNuevoNombre: r.articulo_nuevo_nombre != null ? String(r.articulo_nuevo_nombre) : null,
    entregaNuevaId: r.entrega_nueva_id != null ? Number(r.entrega_nueva_id) : null,
    motivo: String(r.motivo ?? ""),
    registradoPor: r.registrado_por != null ? String(r.registrado_por) : null,
    creadoEn: String(r.creado_en),
  };
}

/**
 * Ajustes (devoluciones/cambios) de VARIAS entregas en una sola consulta
 * (sin N+1) — mismo criterio que auxiliaresDePlanes/paradasDePlanes en TMS.
 */
async function ajustesDeEntregas(
  empresaId: number,
  entregaIds: number[],
): Promise<Map<number, AjusteEntrega[]>> {
  const mapa = new Map<number, AjusteEntrega[]>();
  if (entregaIds.length === 0) return mapa;
  const placeholders = entregaIds.map(() => "?").join(",");
  const rows = await query<RowDataPacket[]>(
    `SELECT aj.*, art.nombre AS articulo_nuevo_nombre
     FROM inventario_rrhh_ajustes aj
     LEFT JOIN inventario_rrhh art ON art.id = aj.articulo_nuevo_id
     WHERE aj.empresa_id = ? AND aj.entrega_id IN (${placeholders})
     ORDER BY aj.creado_en DESC, aj.id DESC`,
    [empresaId, ...entregaIds],
  );
  for (const row of rows) {
    const ajuste = mapAjuste(row);
    const lista = mapa.get(ajuste.entregaId) ?? [];
    lista.push(ajuste);
    mapa.set(ajuste.entregaId, lista);
  }
  return mapa;
}

const SELECT_ENTREGA = `
  SELECT ent.*, art.nombre AS articulo_nombre, art.codigo AS articulo_codigo,
         emp.nombre AS empleado_nombre, emp.codigo AS empleado_codigo
  FROM inventario_rrhh_entregas ent
  INNER JOIN inventario_rrhh art ON art.id = ent.articulo_id
  INNER JOIN empleados emp ON emp.id = ent.empleado_id`;

/** Historial de entregas de la empresa, más recientes primero — opcionalmente por artículo o empleado. */
export async function listarEntregas(
  empresaId: number,
  opts?: { articuloId?: number; empleadoId?: number },
): Promise<EntregaInventario[]> {
  const where = ["ent.empresa_id = ?"];
  const params: (string | number)[] = [empresaId];
  if (opts?.articuloId) {
    where.push("ent.articulo_id = ?");
    params.push(opts.articuloId);
  }
  if (opts?.empleadoId) {
    where.push("ent.empleado_id = ?");
    params.push(opts.empleadoId);
  }
  const rows = await query<RowDataPacket[]>(
    `${SELECT_ENTREGA} WHERE ${where.join(" AND ")} ORDER BY ent.creado_en DESC, ent.id DESC LIMIT 300`,
    params,
  );
  const ajustesPorEntrega = await ajustesDeEntregas(empresaId, rows.map((r) => Number(r.id)));
  return rows.map((r) => mapEntrega(r, ajustesPorEntrega.get(Number(r.id)) ?? []));
}

/** Una entrega por id (con sus ajustes) — usada por devolver()/cambiar() para precargar la UI. */
export async function obtenerEntrega(
  empresaId: number,
  entregaId: number,
): Promise<EntregaInventario | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_ENTREGA} WHERE ent.empresa_id = ? AND ent.id = ? LIMIT 1`,
    [empresaId, entregaId],
  );
  if (!rows[0]) return null;
  const ajustes = await ajustesDeEntregas(empresaId, [entregaId]);
  return mapEntrega(rows[0], ajustes.get(entregaId) ?? []);
}

/** Entrega vinculada a un descuento — para que `RRHH > Descuentos` muestre "Origen: Inventario" con detalle (artículo/cantidad/fecha) sin duplicar datos. */
export async function obtenerEntregaPorDescuento(
  empresaId: number,
  descuentoId: number,
): Promise<EntregaInventario | null> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT_ENTREGA} WHERE ent.empresa_id = ? AND ent.descuento_id = ? LIMIT 1`,
    [empresaId, descuentoId],
  );
  if (!rows[0]) return null;
  const ajustes = await ajustesDeEntregas(empresaId, [Number(rows[0].id)]);
  return mapEntrega(rows[0], ajustes.get(Number(rows[0].id)) ?? []);
}

export type NuevaEntregaInput = {
  articuloId: number;
  empleadoId: number;
  cantidad: number;
  /** Si se omite, se usa el costo_unitario actual del artículo. */
  costoUnitario?: number | null;
  cobraEmpleado: boolean;
  /** Solo si cobraEmpleado. Por defecto = costoTotal (cantidad × costoUnitario) — RRHH puede bajarlo si la empresa subsidia una parte. */
  montoCobrado?: number | null;
  numeroCuotas?: number;
  periodicidad?: Periodicidad;
  cadaNQuincenas?: number | null;
  fechaInicio?: string;
  motivo?: string | null;
  entregadoPor: string;
};

export type ResultadoEntrega =
  | { ok: true; id: number; descuentoId: number | null; stockResultante: number }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Entrega un artículo a un empleado: descuenta stock, registra el
 * movimiento SALIDA y crea la entrega — y, si `cobraEmpleado`, crea además
 * el descuento D1/D2 (clasificación INVENTARIO) YA ACTIVO con sus cuotas
 * generadas — todo en UNA sola transacción (validar → descontar stock →
 * movimiento → entrega → descuento → cuotas → commit). Si cualquier paso
 * falla, se revierte todo: nunca queda stock descontado sin entrega, ni
 * entrega cobrable sin descuento, ni descuento sin cuotas.
 *
 * Confirmar la entrega cobrable EQUIVALE a autorizar el descuento — no hay
 * un paso de aprobación separado para este origen (RRHH ya lo está
 * autorizando al confirmar la entrega).
 */
export async function crearEntrega(
  empresaId: number,
  input: NuevaEntregaInput,
): Promise<ResultadoEntrega> {
  const cantidad = Math.trunc(input.cantidad);
  if (!(cantidad > 0)) {
    return { ok: false, motivo: "cantidad_invalida", mensaje: "La cantidad debe ser mayor a cero." };
  }

  const articulo = await obtenerArticulo(empresaId, input.articuloId);
  if (!articulo) {
    return {
      ok: false,
      motivo: "articulo_invalido",
      mensaje: "El artículo no existe o no pertenece a esta empresa.",
    };
  }
  const empleado = await validarEmpleado(empresaId, input.empleadoId);
  if (!empleado) {
    return {
      ok: false,
      motivo: "empleado_invalido",
      mensaje: "El colaborador no existe, no está Activo, o no pertenece a esta empresa.",
    };
  }
  // Aviso temprano de UX — la protección REAL contra stock negativo es el
  // UPDATE condicionado dentro de registrarMovimientoInterno, más abajo
  // (esta comprobación aquí puede quedar desactualizada si otro movimiento
  // ocurre entre este chequeo y la transacción; por eso no es la única).
  if (cantidad > articulo.stock) {
    return {
      ok: false,
      motivo: "stock_insuficiente",
      mensaje: `Stock insuficiente: hay ${articulo.stock} disponible(s) de "${articulo.nombre}".`,
    };
  }

  const costoUnitario = input.costoUnitario ?? articulo.costoUnitario ?? 0;
  if (costoUnitario < 0) {
    return { ok: false, motivo: "costo_invalido", mensaje: "El costo unitario no puede ser negativo." };
  }
  const costoTotal = redondearQ(costoUnitario * cantidad);
  const cobra = Boolean(input.cobraEmpleado);
  const montoCobrado = cobra ? redondearQ(input.montoCobrado ?? costoTotal) : 0;
  const periodicidad = input.periodicidad ?? "CADA_QUINCENA";

  if (cobra) {
    if (!(montoCobrado > 0)) {
      return {
        ok: false,
        motivo: "monto_invalido",
        mensaje: "El monto a cobrar debe ser mayor a cero si la entrega genera descuento.",
      };
    }
    if (!input.numeroCuotas || input.numeroCuotas < 1) {
      return { ok: false, motivo: "cuotas_invalidas", mensaje: "Indica el número de cuotas." };
    }
    if (!PERIODICIDADES.includes(periodicidad)) {
      return { ok: false, motivo: "periodicidad_invalida", mensaje: "Periodicidad inválida." };
    }
    if (periodicidad === "CADA_N_QUINCENAS" && !(Number(input.cadaNQuincenas) > 0)) {
      return {
        ok: false,
        motivo: "periodicidad_incompleta",
        mensaje: "Indica cada cuántas quincenas se aplica.",
      };
    }
  }

  const motivo = input.motivo?.trim() || null;
  const conn = await getPool().getConnection();
  let entregaId: number;
  let descuentoIdFinal: number | null = null;
  let stockResultante: number;
  try {
    await conn.beginTransaction();

    const mov = await registrarMovimientoInterno(conn, empresaId, {
      articuloId: input.articuloId,
      tipo: "SALIDA",
      cantidad: -cantidad,
      motivo: motivo ?? `Entrega a ${empleado.nombre}`,
      registradoPor: input.entregadoPor,
    });
    stockResultante = mov.stockResultante;

    const [entregaResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO inventario_rrhh_entregas
        (empresa_id, articulo_id, empleado_id, cantidad, costo_unitario_entrega, costo_total,
         monto_cobrado, movimiento_id, motivo, entregado_por, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ENTREGADO')`,
      [
        empresaId,
        input.articuloId,
        input.empleadoId,
        cantidad,
        costoUnitario,
        costoTotal,
        montoCobrado,
        mov.movimientoId,
        motivo,
        input.entregadoPor,
      ],
    );
    entregaId = Number(entregaResult.insertId);

    if (cobra) {
      const fechaInicio = input.fechaInicio || hoyLocal();
      const concepto = `Entrega: ${cantidad} × ${articulo.nombre}`;
      const { id: descuentoId } = await crearDescuentoInterno(conn, empresaId, {
        empleadoId: input.empleadoId,
        concepto,
        clasificacion: "INVENTARIO",
        motivo,
        montoOriginal: montoCobrado,
        periodicidad,
        numeroCuotas: input.numeroCuotas!,
        cadaNQuincenas: input.cadaNQuincenas ?? null,
        fechaInicio,
        creadoPor: input.entregadoPor,
      });
      await autorizarDescuentoInterno(conn, empresaId, descuentoId, input.entregadoPor, {
        periodicidad,
        fechaInicio,
        numeroCuotas: input.numeroCuotas!,
        cadaNQuincenas: input.cadaNQuincenas ?? null,
        montoOriginal: montoCobrado,
      });
      await conn.execute(
        `UPDATE inventario_rrhh_entregas SET descuento_id = ? WHERE id = ? AND empresa_id = ?`,
        [descuentoId, entregaId, empresaId],
      );
      descuentoIdFinal = descuentoId;
    }

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
    usuario: input.entregadoPor,
    accion: "inventario_entrega",
    modulo: "rrhh",
    detalle:
      `Entrega #${entregaId} · ${cantidad} × ${articulo.nombre} · ${empleado.nombre}` +
      (descuentoIdFinal
        ? ` · descuento #${descuentoIdFinal} Q${montoCobrado.toFixed(2)} (${input.numeroCuotas} cuota(s))`
        : " · sin cobro"),
  });

  return { ok: true, id: entregaId, descuentoId: descuentoIdFinal, stockResultante };
}

// ---------------------------------------------------------------------------
// RRHH-INVENTARIO-CAMBIOS-1 — Devolución y cambio de artículo sobre una
// entrega ya realizada. Ver sql/discovery-2026-09-rrhh-inventario-cambios.sql
// para el análisis completo. La entrega ORIGINAL nunca se actualiza
// (append-only real): cada devolución/cambio queda como una fila nueva en
// inventario_rrhh_ajustes, con sus propios movimientos de stock.
// ---------------------------------------------------------------------------

type FilaEntregaBloqueada = RowDataPacket & {
  id: number;
  articulo_id: number;
  empleado_id: number;
  cantidad: number;
  costo_unitario_entrega: string | number;
  monto_cobrado: string | number;
  articulo_nombre: string;
  articulo_codigo: string;
};

/**
 * Bloquea (FOR UPDATE) la entrega original dentro de la transacción — mismo
 * criterio ya usado en tms/planes (route.ts) para serializar dos
 * devoluciones/cambios concurrentes sobre la MISMA entrega: la segunda
 * llamada espera a que la primera confirme/revierta antes de poder leer
 * `cantidadDisponible`, así nunca ambas ven "disponible" el mismo cupo.
 * `inventario_rrhh_entregas` nunca se actualiza — este SELECT ... FOR UPDATE
 * solo pide el lock de fila, nunca escribe sobre ella.
 */
async function bloquearEntregaTx(
  conn: PoolConnection,
  empresaId: number,
  entregaId: number,
): Promise<FilaEntregaBloqueada | null> {
  const [rows] = await conn.query<FilaEntregaBloqueada[]>(
    `SELECT ent.*, art.nombre AS articulo_nombre, art.codigo AS articulo_codigo
     FROM inventario_rrhh_entregas ent
     INNER JOIN inventario_rrhh art ON art.id = ent.articulo_id
     WHERE ent.id = ? AND ent.empresa_id = ? LIMIT 1 FOR UPDATE`,
    [entregaId, empresaId],
  );
  return rows[0] ?? null;
}

async function ajustesPreviosTx(
  conn: PoolConnection,
  empresaId: number,
  entregaId: number,
): Promise<{ tipo: TipoAjusteInventario; cantidad: number }[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT tipo, cantidad FROM inventario_rrhh_ajustes WHERE empresa_id = ? AND entrega_id = ?`,
    [empresaId, entregaId],
  );
  return rows.map((r) => ({ tipo: String(r.tipo) as TipoAjusteInventario, cantidad: Number(r.cantidad) }));
}

export type OrigenFinancieroEntrega = {
  /** La entrega que INICIÓ la cadena — la que tiene (o no) el cobro/descuento real. */
  entregaRaizId: number;
  huboCobro: boolean;
  descuentoId: number | null;
  /** Costo unitario histórico de la entrega RAÍZ — referencia real para comparar precios en un cambio encadenado. */
  costoUnitarioOriginal: number;
};

/**
 * CORRECCIÓN POST-REVISIÓN (RRHH-INVENTARIO-CAMBIOS-1) — un CAMBIO crea una
 * entrega NUEVA con `monto_cobrado = 0` y `descuento_id = NULL` (nunca
 * duplica el cobro). Eso es correcto para esa entrega en sí, pero significa
 * que mirar solo `entrega.monto_cobrado` en un SEGUNDO cambio (ej. M -> L,
 * cuando la cadena real es S[con cobro] -> M -> L) pierde el contexto
 * financiero: M "parece" sin cobro aunque la deuda de S le siga pisando los
 * talones. Esta función camina la cadena hacia atrás por
 * `inventario_rrhh_ajustes.entrega_nueva_id` (¿esta entrega nació de un
 * cambio? ¿de cuál?) hasta llegar a la entrega RAÍZ (la que nunca fue
 * "entrega_nueva_id" de ningún ajuste) y devuelve el contexto financiero
 * real desde ahí — nunca desde un eslabón intermedio.
 *
 * Protecciones:
 *  - Tenant: cada lectura (entrega y ajuste padre) filtra por `empresa_id`
 *    explícitamente — nunca cruza a una entrega de otra empresa.
 *  - Ciclos/cadenas inválidas: límite duro de 50 saltos + un Set de
 *    visitados; si se repite un id (ciclo) o se excede el límite, lanza un
 *    Error explícito (nunca un loop infinito silencioso). Con el diseño
 *    actual (una entrega solo puede ser `entrega_nueva_id` de UN ajuste,
 *    porque nace de UN solo cambio) un ciclo real no debería ser posible,
 *    pero la protección existe igual — nunca confiar ciegamente en la
 *    integridad de datos históricos.
 */
async function resolverOrigenFinancieroTx(
  conn: PoolConnection,
  empresaId: number,
  entregaId: number,
): Promise<OrigenFinancieroEntrega> {
  const visitados = new Set<number>();
  let actualId = entregaId;
  for (let saltos = 0; saltos < 50; saltos++) {
    if (visitados.has(actualId)) {
      throw new Error(
        `inventario_rrhh_ajustes: ciclo detectado resolviendo el origen financiero de la entrega #${entregaId} (repite #${actualId}).`,
      );
    }
    visitados.add(actualId);

    const [filaRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, monto_cobrado, descuento_id, costo_unitario_entrega
       FROM inventario_rrhh_entregas WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [actualId, empresaId],
    );
    const fila = filaRows[0];
    if (!fila) {
      throw new Error(
        `inventario_rrhh_ajustes: entrega #${actualId} no encontrada (empresa ${empresaId}) resolviendo el origen financiero de #${entregaId}.`,
      );
    }

    const [padreRows] = await conn.query<RowDataPacket[]>(
      `SELECT entrega_id FROM inventario_rrhh_ajustes WHERE empresa_id = ? AND entrega_nueva_id = ? LIMIT 1`,
      [empresaId, actualId],
    );
    const padre = padreRows[0];
    if (!padre) {
      // actualId nunca fue "entrega_nueva_id" de ningún ajuste -> es la raíz.
      return {
        entregaRaizId: actualId,
        huboCobro: Number(fila.monto_cobrado) > 0,
        descuentoId: fila.descuento_id != null ? Number(fila.descuento_id) : null,
        costoUnitarioOriginal: Number(fila.costo_unitario_entrega),
      };
    }
    actualId = Number(padre.entrega_id);
  }
  throw new Error(
    `inventario_rrhh_ajustes: cadena de cambios demasiado larga resolviendo el origen financiero de la entrega #${entregaId} (posible ciclo).`,
  );
}

export type ResultadoDevolucion =
  | { ok: true; ajusteId: number; entregaId: number; cantidad: number; stockResultante: number }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Devuelve `cantidad` unidades de una entrega al stock del artículo
 * original. Transaccional: bloquea la entrega, calcula cuánto sigue
 * disponible (cantidad - ajustes previos), valida, regresa stock
 * (registrarMovimientoInterno, tipo DEVOLUCION) y deja la fila de ajuste —
 * todo o nada. NUNCA toca la fila de la entrega original.
 *
 * CORRECCIÓN POST-REVISIÓN: si la entrega (o su ORIGEN FINANCIERO —
 * resolverOrigenFinancieroTx, para cubrir una devolución de una entrega
 * DERIVADA de un cambio) tiene cobro/descuento asociado, se RECHAZA
 * (`devolucion_con_cobro_requiere_ajuste`, 409) sin tocar stock ni cuotas
 * — devolver stock físico mientras el empleado sigue debiendo por ese
 * artículo (o el motor de descuentos no sabe reflejar la devolución sin
 * arriesgar cuotas ya aplicadas) es exactamente la inconsistencia que este
 * ticket pide evitar. RRHH debe resolver el descuento primero con las
 * herramientas ya existentes en Descuentos (pausar/cancelar) antes de
 * poder devolver el artículo por esta vía.
 */
export async function registrarDevolucion(
  empresaId: number,
  entregaId: number,
  input: { cantidad: number; motivo: string; registradoPor: string },
): Promise<ResultadoDevolucion> {
  const motivo = input.motivo?.trim() || "";
  if (!motivo) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Indica el motivo de la devolución." };
  }

  const conn = await getPool().getConnection();
  let ajusteId: number;
  let stockResultante: number;
  const cantidad = Math.trunc(input.cantidad);
  try {
    await conn.beginTransaction();

    const entrega = await bloquearEntregaTx(conn, empresaId, entregaId);
    if (!entrega) {
      await conn.rollback();
      return { ok: false, motivo: "no_encontrado", mensaje: "Entrega no encontrada." };
    }

    const origenFinanciero = await resolverOrigenFinancieroTx(conn, empresaId, entregaId);
    if (origenFinanciero.huboCobro) {
      await conn.rollback();
      const refDescuento = origenFinanciero.descuentoId ? ` (descuento #${origenFinanciero.descuentoId})` : "";
      return {
        ok: false,
        motivo: "devolucion_con_cobro_requiere_ajuste",
        mensaje:
          `Esta entrega tiene un cobro/descuento asociado${refDescuento} — devolver el artículo requiere ajustar ` +
          `primero el descuento manualmente en RRHH > Descuentos. No se modificó nada.`,
      };
    }

    const ajustesPrevios = await ajustesPreviosTx(conn, empresaId, entregaId);
    const disponible = cantidadDisponibleParaAjuste(entrega.cantidad, ajustesPrevios);
    const validacion = validarCantidadAjuste(cantidad, disponible);
    if (!validacion.ok) {
      await conn.rollback();
      return validacion;
    }

    const mov = await registrarMovimientoInterno(conn, empresaId, {
      articuloId: entrega.articulo_id,
      tipo: "DEVOLUCION",
      cantidad,
      motivo: `Devolución de entrega #${entregaId}: ${motivo}`,
      registradoPor: input.registradoPor,
    });
    stockResultante = mov.stockResultante;

    const [ajusteResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO inventario_rrhh_ajustes
        (empresa_id, entrega_id, tipo, cantidad, movimiento_devolucion_id, motivo, registrado_por)
       VALUES (?, ?, 'DEVOLUCION', ?, ?, ?, ?)`,
      [empresaId, entregaId, cantidad, mov.movimientoId, motivo, input.registradoPor],
    );
    ajusteId = Number(ajusteResult.insertId);

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
    accion: "inventario_devolucion",
    modulo: "rrhh",
    detalle: `Devolución de entrega #${entregaId} · ${cantidad} unidad(es) · motivo: ${motivo}`,
  });

  return { ok: true, ajusteId, entregaId, cantidad, stockResultante };
}

export type ResultadoCambio =
  | {
      ok: true;
      ajusteId: number;
      entregaId: number;
      entregaNuevaId: number;
      cantidad: number;
      stockResultanteOriginal: number;
      stockResultanteNuevo: number;
    }
  | { ok: false; motivo: string; mensaje: string };

/**
 * Cambia `cantidad` unidades de una entrega por otro artículo: devuelve
 * stock del artículo original, descuenta stock del artículo nuevo, crea una
 * entrega NUEVA para el artículo nuevo (vinculada a la original vía el
 * ajuste) y deja la fila de ajuste — TODO en una sola transacción. Si
 * cualquier paso falla (incluido stock insuficiente del artículo nuevo),
 * rollback total: nunca queda "S devuelta pero M no entregada" ni viceversa.
 *
 * Descuentos (sección 8 del ticket): si la entrega original NO generó cobro,
 * el cambio nunca toca ningún descuento. Si generó cobro, solo se permite
 * cuando el artículo nuevo cuesta EXACTAMENTE igual por unidad que el
 * histórico de la entrega original (validarCompatibilidadPrecioCambio) — el
 * descuento original sigue cubriendo la misma deuda sin tocarse. Una
 * diferencia real de precio se rechaza con un mensaje claro, sin tocar
 * stock/entrega/descuento (ver discovery: no existe hoy un mecanismo seguro
 * para cambiar el monto_original de un descuento ACTIVO).
 */
export async function registrarCambio(
  empresaId: number,
  entregaId: number,
  input: { cantidad: number; articuloNuevoId: number; motivo: string; registradoPor: string },
): Promise<ResultadoCambio> {
  const motivo = input.motivo?.trim() || "";
  if (!motivo) {
    return { ok: false, motivo: "motivo_requerido", mensaje: "Indica el motivo del cambio." };
  }

  const conn = await getPool().getConnection();
  let ajusteId: number;
  let entregaNuevaId: number;
  let stockResultanteOriginal: number;
  let stockResultanteNuevo: number;
  let articuloNuevoNombre = "";
  let articuloOriginalNombre = "";
  const cantidad = Math.trunc(input.cantidad);
  try {
    await conn.beginTransaction();

    const entrega = await bloquearEntregaTx(conn, empresaId, entregaId);
    if (!entrega) {
      await conn.rollback();
      return { ok: false, motivo: "no_encontrado", mensaje: "Entrega no encontrada." };
    }
    articuloOriginalNombre = entrega.articulo_nombre;

    if (input.articuloNuevoId === entrega.articulo_id) {
      await conn.rollback();
      return {
        ok: false,
        motivo: "articulo_igual",
        mensaje: "El artículo nuevo debe ser distinto al artículo original de la entrega.",
      };
    }

    const ajustesPrevios = await ajustesPreviosTx(conn, empresaId, entregaId);
    const disponible = cantidadDisponibleParaAjuste(entrega.cantidad, ajustesPrevios);
    const validacionCantidad = validarCantidadAjuste(cantidad, disponible);
    if (!validacionCantidad.ok) {
      await conn.rollback();
      return validacionCantidad;
    }

    const [articulosNuevoRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, nombre, codigo, costo_unitario FROM inventario_rrhh WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [input.articuloNuevoId, empresaId],
    );
    const articuloNuevo = articulosNuevoRows[0];
    if (!articuloNuevo) {
      await conn.rollback();
      return {
        ok: false,
        motivo: "articulo_invalido",
        mensaje: "El artículo nuevo no existe o no pertenece a esta empresa.",
      };
    }
    articuloNuevoNombre = String(articuloNuevo.nombre);
    const costoUnitarioNuevo = Number(articuloNuevo.costo_unitario ?? 0);

    // CORRECCIÓN POST-REVISIÓN: comparar contra el origen financiero REAL
    // (camina la cadena de cambios hacia la raíz), nunca contra
    // entrega.monto_cobrado/costo_unitario_entrega directos — en un cambio
    // encadenado (S[cobro] -> M -> L) la entrega M ya tiene
    // monto_cobrado = 0 por diseño (no duplica el cobro), pero la deuda de
    // S le sigue pisando los talones. Ver resolverOrigenFinancieroTx.
    const origenFinanciero = await resolverOrigenFinancieroTx(conn, empresaId, entregaId);
    const validacionPrecio = validarCompatibilidadPrecioCambio({
      huboCobro: origenFinanciero.huboCobro,
      costoUnitarioOriginal: origenFinanciero.costoUnitarioOriginal,
      costoUnitarioNuevo,
    });
    if (!validacionPrecio.ok) {
      await conn.rollback();
      return validacionPrecio;
    }

    const movDevolucion = await registrarMovimientoInterno(conn, empresaId, {
      articuloId: entrega.articulo_id,
      tipo: "DEVOLUCION",
      cantidad,
      motivo: `Cambio de entrega #${entregaId}: devuelve ${cantidad} × ${articuloOriginalNombre} (${motivo})`,
      registradoPor: input.registradoPor,
    });
    stockResultanteOriginal = movDevolucion.stockResultante;

    const movSalida = await registrarMovimientoInterno(conn, empresaId, {
      articuloId: input.articuloNuevoId,
      tipo: "CAMBIO_SALIDA",
      cantidad: -cantidad,
      motivo: `Cambio de entrega #${entregaId}: entrega ${cantidad} × ${articuloNuevoNombre} (${motivo})`,
      registradoPor: input.registradoPor,
    });
    stockResultanteNuevo = movSalida.stockResultante;

    const costoTotalNuevo = redondearQ(costoUnitarioNuevo * cantidad);
    const [entregaNuevaResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO inventario_rrhh_entregas
        (empresa_id, articulo_id, empleado_id, cantidad, costo_unitario_entrega, costo_total,
         monto_cobrado, descuento_id, movimiento_id, motivo, entregado_por, estado)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, 'ENTREGADO')`,
      [
        empresaId,
        input.articuloNuevoId,
        entrega.empleado_id,
        cantidad,
        costoUnitarioNuevo,
        costoTotalNuevo,
        movSalida.movimientoId,
        `Cambio de entrega #${entregaId}: ${articuloOriginalNombre} → ${articuloNuevoNombre} (${motivo})`,
        input.registradoPor,
      ],
    );
    entregaNuevaId = Number(entregaNuevaResult.insertId);

    const [ajusteResult] = await conn.execute<ResultSetHeader>(
      `INSERT INTO inventario_rrhh_ajustes
        (empresa_id, entrega_id, tipo, cantidad, articulo_nuevo_id, entrega_nueva_id,
         movimiento_devolucion_id, movimiento_salida_id, motivo, registrado_por)
       VALUES (?, ?, 'CAMBIO', ?, ?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        entregaId,
        cantidad,
        input.articuloNuevoId,
        entregaNuevaId,
        movDevolucion.movimientoId,
        movSalida.movimientoId,
        motivo,
        input.registradoPor,
      ],
    );
    ajusteId = Number(ajusteResult.insertId);

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
    accion: "inventario_cambio",
    modulo: "rrhh",
    detalle:
      `Cambio entrega #${entregaId} · ${cantidad} × ${articuloOriginalNombre} → ${articuloNuevoNombre} · ` +
      `nueva entrega #${entregaNuevaId} · motivo: ${motivo}`,
  });

  return {
    ok: true,
    ajusteId,
    entregaId,
    entregaNuevaId,
    cantidad,
    stockResultanteOriginal,
    stockResultanteNuevo,
  };
}
