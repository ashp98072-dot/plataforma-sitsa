import { createHash, randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader } from "mysql2/promise";

export { TEXTO_FIRMA_INTERNA } from "./textos";

/**
 * VIATICOS-FIRMA — activación de la base de firma electrónica INTERNA y
 * SIMBÓLICA diseñada en PORTAL-HARDENING-2 (Fase H, ver
 * FIRMA-ELECTRONICA-DISENO.md y sql/propuesta-2026-08-firma-electronica.sql,
 * ya aplicada manualmente por el usuario — SOLO la tabla
 * `firmas_electronicas`, sin `firma_pins`).
 *
 * Esto NO es Firma Electrónica Avanzada, ni un certificado, ni requiere un
 * Prestador de Servicios de Certificación — es prueba interna de que un
 * usuario autenticado, en un momento dado, reautenticado con su
 * contraseña, ejecutó una acción sensible, con un hash verificable del
 * payload relevante. Nunca usar los términos "Firma Electrónica Avanzada",
 * "certificado", "PSC" ni "firma legal" en ningún texto de UI — ver
 * `TEXTO_FIRMA_INTERNA`.
 *
 * `nombreFirmante`/`rolFirmante` (Fase "DATOS DE LA FIRMA") NO tienen
 * columna propia en `firmas_electronicas` (la tabla ya fue aplicada tal
 * cual la propuesta original) — se guardan DENTRO de `payload_canonico`
 * como snapshot histórico correcto: el rol de un usuario puede cambiar
 * después de firmar, así que un JOIN en vivo contra `usuarios`/`sesión`
 * mostraría el rol ACTUAL, no el rol AL MOMENTO DE FIRMAR. Guardarlo en el
 * payload es la única forma de que sea un snapshot fiel, y no exige una
 * migración adicional.
 */

export type DatosFirmaInterna = {
  empresaId: number;
  usuarioId: number;
  /** NULL en este ticket: los firmantes (Jefe/Gerente Operaciones, Facturador) son usuarios de staff, no colaboradores del Portal. */
  empleadoId: number | null;
  nombreFirmante: string;
  rolFirmante: string;
  accion: string;
  modulo: string;
  entidadTipo: string;
  entidadId: number;
  /** Datos específicos de la acción firmada — lo que hace que el hash sea verificable contra lo que realmente ocurrió. */
  valoresRelevantes: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export type ResultadoFirmaInterna = {
  id: number;
  codigoFirma: string;
  fechaHoraServidor: Date;
  hashPayload: string;
  nombreFirmante: string;
  rolFirmante: string;
};

/** JSON canónico: claves ordenadas alfabéticamente (recursivo), sin espacios — mismo criterio documentado en FIRMA-ELECTRONICA-DISENO.md §4. */
function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor !== null && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    const ordenado: Record<string, unknown> = {};
    for (const clave of Object.keys(obj).sort()) {
      ordenado[clave] = ordenarClaves(obj[clave]);
    }
    return ordenado;
  }
  return valor;
}

export function payloadCanonicoJson(payload: Record<string, unknown>): string {
  return JSON.stringify(ordenarClaves(payload));
}

/** SIG-YYYYMMDD-XXXXXXXX — legible, único (8 hex aleatorios; colisión ~1 en 4 mil millones, protegido además por UNIQUE KEY en la tabla). */
function generarCodigoFirma(fecha: Date): string {
  const fechaParte = fecha.toISOString().slice(0, 10).replace(/-/g, "");
  const azar = randomBytes(4).toString("hex").toUpperCase();
  return `SIG-${fechaParte}-${azar}`;
}

/**
 * Inserta la firma DENTRO de la transacción de negocio del caller (mismo
 * `conn` que hace el UPDATE de la entidad) — "Firma + transición +
 * auditoría: MISMA transacción" (regla dura del ticket). La contraseña YA
 * debe haberse verificado ANTES de llamar esta función (fuera de la
 * transacción — un password incorrecto no debe ni empezar a tocar la fila
 * de negocio, ver verificarPasswordUsuarioActual en src/lib/auth.ts).
 */
export async function crearFirmaInterna(
  conn: PoolConnection,
  datos: DatosFirmaInterna,
): Promise<ResultadoFirmaInterna> {
  const fecha = new Date();
  const payload = {
    accion: datos.accion,
    empresaId: datos.empresaId,
    entidadId: datos.entidadId,
    entidadTipo: datos.entidadTipo,
    fechaHoraServidor: fecha.toISOString(),
    nombreFirmante: datos.nombreFirmante,
    rolFirmante: datos.rolFirmante,
    valoresRelevantes: datos.valoresRelevantes,
    version: "1",
  };
  const payloadCanonico = payloadCanonicoJson(payload);
  const hashPayload = createHash("sha256").update(payloadCanonico, "utf8").digest("hex");
  const codigoFirma = generarCodigoFirma(fecha);

  const [r] = await conn.execute<ResultSetHeader>(
    `INSERT INTO firmas_electronicas
      (empresa_id, usuario_id, empleado_id, accion, modulo, entidad_tipo, entidad_id,
       fecha_hora_servidor, hash_payload, payload_canonico, ip, user_agent, metodo, resultado, codigo_firma, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PASSWORD', 'EXITOSA', ?, '1')`,
    [
      datos.empresaId, datos.usuarioId, datos.empleadoId, datos.accion, datos.modulo,
      datos.entidadTipo, datos.entidadId, fecha, hashPayload, payloadCanonico,
      datos.ip ?? null, datos.userAgent ?? null, codigoFirma,
    ],
  );
  return {
    id: Number(r.insertId),
    codigoFirma,
    fechaHoraServidor: fecha,
    hashPayload,
    nombreFirmante: datos.nombreFirmante,
    rolFirmante: datos.rolFirmante,
  };
}
