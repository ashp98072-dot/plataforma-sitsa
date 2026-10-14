# FEL-2A — Modelo, dominio e idempotencia FEL con proveedor MOCK

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (compilación, ESLint dirigido, pruebas unitarias/arquitectura y pruebas de BD y
concurrencia contra MariaDB 11.8.9 desechable). **NO probado en producción, NO aprobado para producción, SQL NO ejecutado en ninguna
BD real.** Base: `main` en `0ce0a33f` (PR #450).

> **FEL-2A IMPLEMENTADO ≠ INFILE INTEGRADO.** No existe red, ni proveedor real, ni emisión.
> **MOCK ≠ sandbox de INFILE.** Un `CERTIFICADO` del MOCK **no es un documento SAT válido**: su autorización lleva el prefijo
> `MOCK-` y el esquema impide que un documento MOCK pertenezca a un ambiente `PROD` (`ck_fel_amb_mock_no_prod`).
> **`estado_admin = 'Emitida'` ≠ CERTIFICADO.** La única verdad fiscal es `fel_documentos.estado = 'CERTIFICADO'` con identidad completa.

Contexto: [ARQUITECTURA](FEL-INFILE-ARQUITECTURA.md) · [PLAN](FEL-INFILE-PLAN.md) · [DATOS FALTANTES](FEL-INFILE-DATOS-FALTANTES.md) ·
[CONT PR C](CONTABILIDAD-PR-C-FACTURAS-DISCOVERY.md).

## 1. Qué incluye y qué NO incluye

| Incluye | NO incluye (decisión explícita) |
|---|---|
| 4 tablas: `fel_emisores`, `fel_emisor_ambientes`, `fel_documentos`, `fel_intentos` + **1** `ADD UNIQUE INDEX` aditivo en `fact_facturas` | Proveedor INFILE, red, sandbox, credenciales reales, payload INFILE |
| Dominio `src/lib/fel/*`: estados, `FelProvider`, MOCK, mapper neutral, servicio idempotente, cifrado `FEL_CREDENTIALS_KEY`, redacción | UI, botón «Certificar», rutas/API, permisos, reemplazo de `emitirFactura` |
| Factura, nota de crédito/débito, anulación y refacturación **modeladas y probadas con MOCK** | Certificación real de notas, anulación real, regla de negocio de qué/cuánto corregir |
| `obtenerCertificacionFactura` / `obtenerDocumentoFel` (lectura, para PR C futuro) | **Contabilidad:** ningún `FACTURA_EMITIDA`, evento, asiento ni import de `factura-emitida.ts` |
| Pruebas de arquitectura que fijan lo anterior | `fact_viajes_facturacion_externa` (ver §8: diferida a FEL-2B) |

## 2. Discovery físico y diferencias contra los documentos FEL antiguos

Verificado en el DDL de `main` (migraciones `fact-1/2/4`, `contabilidad-*`, `confirmaciones-bancarias`; `schema.sql` **no** define
`fact_facturas`).

| # | Los documentos FEL antiguos decían… | `main` real | Consecuencia en FEL-2A |
|---|---|---|---|
| 1 | `fact_facturas` no guarda la entidad; agregar `entidad_id`, `moneda`, `tipo_documento` | `entidad_id INT NULL`, `moneda CHAR(3)`, `condicion_pago`, retención y FK `fk_fact_factura_entidad` **ya existen** (FACT-4) | No se agregan columnas. `tipo_documento` vive en `fel_documentos`, no en la factura |
| 2 | Agregar `UNIQUE (empresa_id,id)` y `UNIQUE (empresa_id,id,entidad_id)` a `fact_facturas` | Solo existe `uq_factura_numero (empresa_id, numero_factura)`; ninguna clave compuesta | **Una** clave aditiva `uq_factura_ambito (empresa_id, entidad_id, id)`: es la que usa la FK. `id` es PK, así que se cumple trivialmente |
| 3 | Datos del emisor «ya en entidad» | `cont_entidades` = `codigo`, `nombre`, `activa`. **Sin NIT ni datos fiscales.** `empresas` tampoco | No hay datos que reutilizar ni duplicar. `fel_emisor_ambientes` guarda solo `nit_emisor`/`nombre_fiscal` (NULL, sin seeds) |
| 4 | `fel_emisores.proveedor` | El proveedor puede variar por ambiente (MOCK solo TEST) | `proveedor` va en `fel_emisor_ambientes` y en `fel_documentos`, atado por FK compuesta de 4 columnas |
| 5 | Estados `CERTIFICADA/RECHAZADA/INCIERTA/NO_ENCONTRADA/ANULACION_*` | — | Se unifican en `PENDIENTE, CERTIFICADO, RECHAZADO, INCIERTO, NO_ENCONTRADO, ANULADO` (mismo vocabulario que los resultados del proveedor). `ANULACION_PENDIENTE/INCIERTA` quedan para FEL-5 (la anulación queda registrada en `fel_intentos`) |
| 6 | `clave_idempotencia` única en el documento | Dos conceptos distintos | `referencia_emisor` (única; es lo que se envía al proveedor y no cambia en reenvíos) + `clave_solicitud` por intento (`UNIQUE (empresa_id, clave_solicitud)`) con la huella de la solicitud |
| 7 | Secretos con el mecanismo de portal | `credenciales.ts` usa `PORTAL_CREDENTIALS_KEY` **o `AUTH_SECRET`** | FEL usa `FEL_CREDENTIALS_KEY` **sin** respaldo en `AUTH_SECRET`; falta ⇒ `ERROR_CONFIG`; AAD = empresa\|entidad\|ambiente |
| 8 | «Una fila viva por factura: columna generada a validar en MariaDB» | Validado en 11.8.9 | `factura_viva` (STORED) + `UNIQUE (empresa_id, factura_id, factura_viva)`; solo aplica a `FACTURA`, así que se admiten varias notas |
| 9 | «Éxito ⇒ `estado_admin='Emitida'` en la misma transacción» | `emitirFactura` es un botón + número digitado y no conoce FEL | **No se integra** en FEL-2A: `fact_facturas` no se modifica (lo fija una prueba). La sincronización de `estado_admin` es FEL-4 |
| 10 | No-autorreferencia por CHECK | MariaDB no admite `AUTO_INCREMENT` en CHECK y la FK acepta una fila que se referencia a sí misma con `id` explícito | **Invariante de aplicación** (ver §5), con verify y prueba de arquitectura |

## 3. Modelo (resumen; DDL en `sql/migrate-2026-10-fel-2a-modelo.sql`)

- **`fel_emisores`**: `(empresa_id, entidad_id)` único, `modo DESACTIVADO|TEST|PROD`, `activo`. **Única fuente del modo.** FK compuesta a
  `cont_entidades(empresa_id, id)`.
- **`fel_emisor_ambientes`**: una fila por `(emisor, ambiente TEST|PROD)` con `proveedor`, `base_url`/`nit_emisor`/`nombre_fiscal`
  (NULL: nada se inventa) y `secreto_cifrado` (AES-256-GCM). `CHECK` de formato de proveedor y **MOCK jamás en PROD**.
- **`fel_documentos`** (verdad fiscal): FKs compuestas que incluyen `empresa_id` a la factura (`empresa, entidad, id`), al emisor
  (`empresa, emisor, entidad`), al ambiente+proveedor (`empresa, emisor, ambiente, proveedor`) y al documento origen (`empresa,
  emisor, id`). `ON DELETE/UPDATE RESTRICT` en todo: un documento certificado nunca se borra por cascada. CHECKs: `CERTIFICADO/ANULADO`
  exigen autorización+serie+número+fecha; los demás estados no pueden traerlos; `ANULADO` exige fecha y motivo; notas exigen origen.
  `UNIQUE (empresa, ambiente, autorizacion)` y `(empresa, emisor, ambiente, serie, numero)`.
- **`fel_intentos`**: un envío/consulta/anulación por fila (`ENVIANDO` → resultado, se cierra una sola vez). Sin secretos ni XML;
  respuesta redactada y acotada.
- **`fact_facturas`**: único cambio `ADD UNIQUE INDEX IF NOT EXISTS uq_factura_ambito (empresa_id, entidad_id, id)`.

### 3.1 Estados fiscales (`src/lib/fel/estados.ts`)

```
PENDIENTE ──CERTIFICADO──▶ CERTIFICADO ──(solo respuesta ANULADO válida)──▶ ANULADO
PENDIENTE ──RECHAZADO───▶ RECHAZADO            (terminal; corregir = documento NUEVO con otra referencia)
PENDIENTE ──INCIERTO────▶ INCIERTO ──consulta──▶ CERTIFICADO | RECHAZADO | NO_ENCONTRADO | (sigue INCIERTO / PENDIENTE)
NO_ENCONTRADO ──reenvío con la MISMA referencia y el MISMO DTO congelado──▶ PENDIENTE
```

`NO_ENCONTRADO` **solo** puede nacer de una consulta (también por tipo: `certificar` no lo admite, y si un proveedor lo devuelve
se trata como `INCIERTO`). Excepción, timeout del servicio, `ERROR_CONFIG` al enviar o respuesta ilegible ⇒ `INCIERTO`.

### 3.2 Factura, nota, anulación y refacturación

- **Factura**: una `FACTURA` viva por `fact_facturas` (`factura_viva`); `RECHAZADO` no cuenta como viva.
- **Nota de crédito/débito**: documento propio con `documento_origen_id`, `factura_id` = el de la factura original, mismo emisor/
  ambiente. Origen debe ser una `FACTURA` **CERTIFICADA** de la misma empresa; el origen **no se modifica**. Los importes los aporta
  el llamador (qué se corrige y cuánto es decisión pendiente). Notas parciales múltiples son legítimas (claves distintas).
- **Anulación**: solo desde `CERTIFICADO` y **solo** con respuesta `ANULADO` del proveedor. `INCIERTO/RECHAZADO/ERROR_CONFIG/excepción`
  dejan el documento `CERTIFICADO`. **No** toca `fact_facturas.estado_admin` ni libera viajes.
- **Refacturación**: no existe un tipo mágico. Es una `FACTURA` **nueva** (otra `fact_facturas`, misma empresa y entidad) con
  `documento_origen_id` = el original. Regla **provisional** de FEL-2A (a confirmar con negocio/contador): el original debe estar
  `ANULADO` o tener una nota de crédito `CERTIFICADA`. Cadena trazable por `documento_origen_id`; el original no se borra.

## 4. Idempotencia y concurrencia (protocolo implementado)

1. **TX1** (READ COMMITTED): `SELECT … FOR UPDATE` de la factura (o del documento origen) → réplica por clave (misma clave +
   misma solicitud ⇒ mismo documento; distinta solicitud ⇒ `CONFLICTO_IDEMPOTENCIA`) → documento vivo existente (se **continúa**) →
   configuración (emisor activo, modo TEST/PROD, ambiente, proveedor, secreto) → mapper (bloqueos estructurados) → `INSERT`
   documento `PENDIENTE` + intento `ENVIANDO` + auditoría → `COMMIT`.
2. **Llamada al proveedor fuera de toda transacción**, con timeout acotado.
3. **TX2**: bloquea el documento, aplica el resultado por la máquina de estados, cierra el intento, audita.

Reglas: `INCIERTO` o `PENDIENTE` **nunca** se reenvía a ciegas: se consulta primero. `PENDIENTE` con intento `ENVIANDO` vigente ⇒
«en proceso» (no hay segundo envío); vencida la ventana (5 min por defecto) se trata como `INCIERTO` y se consulta (caída entre TX1
y TX2). El reenvío tras `NO_ENCONTRADO` reutiliza referencia y DTO congelado. Sin `GET_LOCK`: row locks + `UNIQUE`.

## 5. Invariantes que la BD **no** puede garantizar (aplicación + verify)

- **No-autorreferencia / inmutabilidad de `documento_origen_id`**: ningún `UPDATE` del servicio lo asigna (prueba de arquitectura) y
  `verify-2026-10-fel-2a-modelo.sql` lo audita (`documento_origen_id = id`). Sin autorreferencia y con origen inmutable no hay ciclos.
- **`factura_id` de una nota = `factura_id` de su origen**: lo valida el servicio bajo lock; la BD solo garantiza misma empresa/emisor.
- **`modo` PROD/TEST ⇒ existe la fila de ambiente correspondiente**: lo valida el servicio (`ERROR_CONFIG`).

## 6. Diseño TEST ≠ PROD

El modo vive **solo** en `fel_emisores.modo`; el ambiente de un documento se resuelve **una vez** en TX1 y queda congelado en el
documento, atado por FK a su fila de ambiente (no se puede crear un documento TEST sin fila TEST ni PROD sin fila PROD). Los secretos
se cifran con AAD `fel|empresa|entidad|ambiente`: un secreto TEST no descifra como PROD. MOCK no puede ser PROD. Las notas deben
emitirse en el **mismo** ambiente que su origen (si el modo del emisor cambió ⇒ `ERROR_CONFIG`).

## 7. Mapper `Factura → DTO` neutral

Emite solo lo que `main` conoce sin ambigüedad (emisor/receptor/líneas/importes con Decimal, GTQ). **Bloquea** (sin crear documento):
factura no `Borrador`, sin entidad, moneda ≠ GTQ, con retención, sin fecha, sin líneas FACT-4, clasificación nula, importes que no
cuadran, emisor sin NIT/nombre fiscal, cliente sin NIT o sin razón social (sin respaldo en el nombre comercial). **No genera**:
payload INFILE, tipo SAT FACT/FCAM, régimen, frases, establecimiento, validación del NIT/CUI/CF, unidades, exentos, adenda, retenciones.

## 8. Facturación externa (Milenium): diferida a FEL-2B

`fact_viajes_facturacion_externa` **no** se implementa aquí. Razones: (a) su exclusión mutua real exige tocar
`listarViajesPendientes`/`crearFactura` (flujo productivo de facturación), fuera del alcance «sin UI productiva ni reemplazar el flujo»;
(b) el criterio de marcado (por fecha de corte, cliente o lista), quién autoriza y el formato de la referencia siguen en
[DATOS FALTANTES §A4](FEL-INFILE-DATOS-FALTANTES.md); (c) es independiente de la idempotencia FEL. El diseño de
[ARQUITECTURA §6.1.f/§6.2](FEL-INFILE-ARQUITECTURA.md) sigue vigente.

## 9. SQL requerido (NO ejecutado)

`sql/preflight-2026-10-fel-2a-modelo.sql` (solo lectura) → `sql/migrate-2026-10-fel-2a-modelo.sql` → `sql/verify-2026-10-fel-2a-modelo.sql`.
`sql/schema.sql` alineado. Sin seeds, sin backfill, sin datos, sin DROP. `IF NOT EXISTS` es NOOP estructural (no repara drift):
preflight/verify son obligatorios. Reversión (si se aprobara): las 4 tablas están vacías tras migrar y el índice es aditivo.

## 10. Pruebas (todas locales; **no es CI**)

- `src/lib/fel/dominio.test.ts` (27): estados, MOCK determinista, **sin red**, mapper, secretos/AAD/redacción, arquitectura
  (sin contabilidad/UI/facturación productiva, `documento_origen_id` inmutable), SQL (aditivo, `schema.sql` = migración, preflight/
  verify solo lectura).
- `src/lib/fel/fel.db.test.ts` (41, `FEL_TEST_DB_PORT=3399`, MariaDB 11.8.9 desechable): instalación + segunda migración NOOP,
  aislamiento empresa/entidad, TEST≠PROD en ambos sentidos, MOCK≠PROD, CHECKs, todos los escenarios de certificación/rechazo/
  incierto/respuesta perdida/pendiente/no encontrado/excepción/timeout, idempotencia misma/distinta solicitud, doble clic, workers y
  carrera de 10, caída entre envío y registro, notas, anulación, refacturación, aislamiento, bloqueos, sin eventos ni asientos, sin
  fuga de secretos. Verificadas con **mutaciones** (reenvío a ciegas ⇒ 2 pruebas fallan; sin `FOR UPDATE` ⇒ 3 fallan).

## 11. Pendiente real antes de INFILE (FEL-3)

Todo [DATOS FALTANTES §A y §B](FEL-INFILE-DATOS-FALTANTES.md) sigue **sin resolverse**. Adicionalmente FEL-2A deja abiertas estas
decisiones: estados de `estado_admin` desde los que se puede certificar (hoy solo `Borrador`, según ARQUITECTURA §5); regla de
refacturación (§3.2); qué cliente/campo manda para el receptor; contrato de consulta de INFILE (cómo responde «no existe» y la
consistencia eventual) para habilitar `NO_ENCONTRADO` real; columnas fiscales adicionales de `fel_emisor_ambientes` (afiliación IVA,
establecimiento, frases, dirección) y de `fel_documentos` (XML/PDF) que se agregan **aditivamente** cuando exista la documentación.
