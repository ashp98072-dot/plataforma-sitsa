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
 * usuario autenticado ejecutó una acción sensible, con un hash verificable
 * del payload relevante. Nunca usar los términos "Firma Electrónica
 * Avanzada", "certificado", "PSC" ni "firma legal" en ningún texto de UI —
 * ver `TEXTO_FIRMA_INTERNA`.
 *
 * `metodo` (CORRECCIÓN URGENTE — autorizar sin contraseña): NO toda firma
 * de este mecanismo reautentica con contraseña. `'PASSWORD'` (default) =
 * reautenticación con contraseña actual (verificarPasswordUsuarioActual,
 * ver src/lib/auth.ts) — usado por liquidarViatico, sin cambios.
 * `'FIRMA_MANUSCRITA'` = sesión autenticada + permiso explícito + trazo
 * manuscrito dibujado (imagen obligatoria) son la prueba de identidad —
 * usado por autorizarViatico desde este hotfix. Ningún caso permite
 * autorización anónima: el permiso (`viaticos_autorizar:editar`) sigue
 * siendo obligatorio en AMBOS métodos, verificado por el endpoint antes
 * de llegar aquí.
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

/**
 * VIATICOS-FIRMA (firma visual) — referencia a la imagen PNG de la firma
 * manuscrita YA guardada en disco (guardarUpload, subdir "firmas") antes
 * de llamar aquí. Nunca se guarda el binario/base64 en esta tabla, solo la
 * ruta relativa (mismo patrón que ops_multa_documentos/evidencias_
 * incidencias) + metadata + su SHA-256 (que sí entra al payload_canonico
 * firmado, ver más abajo). Opcional: no todas las firmas de esta tabla
 * tienen imagen (p. ej. la firma técnica preexistente sin canvas, o el
 * flujo masivo "Autorizar seleccionados" que sigue firmando solo con
 * contraseña — ver reporte de entrega VIATICOS-FIRMA-VISUAL).
 */
export type ImagenFirmaInterna = {
  relative: string;
  original: string;
  mime: string;
  size: number;
  sha256: string;
};

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
  imagen?: ImagenFirmaInterna | null;
  /**
   * CORRECCIÓN URGENTE (autorizar sin contraseña) — método real de
   * reautenticación/prueba de identidad de ESTA firma. Antes se hardcodeaba
   * `'PASSWORD'` para toda firma, aunque desde este hotfix AUTORIZAR ya no
   * reverifica contraseña (sesión autenticada + permiso + firma manuscrita
   * son suficientes). Default `'PASSWORD'` para no romper llamadores
   * existentes (liquidarViatico sigue exigiendo contraseña, sin cambios).
   * `metodo` ya es VARCHAR(20) en el esquema — no requiere SQL.
   */
  metodo?: "PASSWORD" | "FIRMA_MANUSCRITA";
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
  /** VIATICOS-FIRMA (firma visual) — para que el llamador sepa si mostrar el <img> sin exponer imagen_ruta. */
  tieneImagen: boolean;
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
 * auditoría: MISMA transacción" (regla dura del ticket). Si `metodo` es
 * `'PASSWORD'` (default), la contraseña YA debe haberse verificado ANTES
 * de llamar esta función (fuera de la transacción — un password
 * incorrecto no debe ni empezar a tocar la fila de negocio, ver
 * verificarPasswordUsuarioActual en src/lib/auth.ts). Si es
 * `'FIRMA_MANUSCRITA'`, la prueba de identidad es la sesión autenticada +
 * el permiso ya verificado por el endpoint + el trazo manuscrito — no hay
 * contraseña que verificar.
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
    // VIATICOS-FIRMA (firma visual) — liga el hash técnico de la firma a
    // los bytes EXACTOS de la imagen manuscrita usada (null si esta firma
    // no lleva imagen). NUNCA se guarda la imagen/base64 en el payload,
    // solo su SHA-256.
    imagenSha256: datos.imagen?.sha256 ?? null,
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
       fecha_hora_servidor, hash_payload, payload_canonico, ip, user_agent, metodo, resultado, codigo_firma, version,
       imagen_ruta, imagen_nombre_original, imagen_mime, imagen_tamano)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXITOSA', ?, '1', ?, ?, ?, ?)`,
    [
      datos.empresaId, datos.usuarioId, datos.empleadoId, datos.accion, datos.modulo,
      datos.entidadTipo, datos.entidadId, fecha, hashPayload, payloadCanonico,
      datos.ip ?? null, datos.userAgent ?? null, datos.metodo ?? "PASSWORD", codigoFirma,
      datos.imagen?.relative ?? null, datos.imagen?.original ?? null,
      datos.imagen?.mime ?? null, datos.imagen?.size ?? null,
    ],
  );
  return {
    id: Number(r.insertId),
    codigoFirma,
    fechaHoraServidor: fecha,
    hashPayload,
    nombreFirmante: datos.nombreFirmante,
    rolFirmante: datos.rolFirmante,
    tieneImagen: datos.imagen != null,
  };
}
