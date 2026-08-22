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

/** Fase INV-1: agrega SALIDA (entrega a empleado). DEVOLUCION/PERDIDA quedan para fases futuras. */
export type TipoMovimientoInventario = "ENTRADA" | "AJUSTE" | "SALIDA";

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
    return {
      id: Number(r.id),
      articuloId: Number(r.articulo_id),
      // Fase INV-1: incluye SALIDA — antes solo distinguía AJUSTE/ENTRADA.
      tipo: (tipo === "AJUSTE" || tipo === "SALIDA" ? tipo : "ENTRADA") as TipoMovimientoInventario,
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
  estado: "ENTREGADO";
  creadoEn: string;
};

function mapEntrega(r: RowDataPacket): EntregaInventario {
  return {
    id: Number(r.id),
    articuloId: Number(r.articulo_id),
    articuloNombre: r.articulo_nombre != null ? String(r.articulo_nombre) : "",
    articuloCodigo: r.articulo_codigo != null ? String(r.articulo_codigo) : "",
    empleadoId: Number(r.empleado_id),
    empleadoNombre: r.empleado_nombre != null ? String(r.empleado_nombre) : "",
    empleadoCodigo: r.empleado_codigo != null ? String(r.empleado_codigo) : "",
    cantidad: Number(r.cantidad),
    costoUnitarioEntrega: Number(r.costo_unitario_entrega ?? 0),
    costoTotal: Number(r.costo_total ?? 0),
    montoCobrado: Number(r.monto_cobrado ?? 0),
    descuentoId: r.descuento_id != null ? Number(r.descuento_id) : null,
    movimientoId: r.movimiento_id != null ? Number(r.movimiento_id) : null,
    motivo: r.motivo != null ? String(r.motivo) : null,
    entregadoPor: r.entregado_por != null ? String(r.entregado_por) : null,
    estado: "ENTREGADO",
    creadoEn: String(r.creado_en),
  };
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
  return rows.map(mapEntrega);
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
  return rows[0] ? mapEntrega(rows[0]) : null;
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
