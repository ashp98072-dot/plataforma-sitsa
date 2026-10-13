# Control de entrega de documentos — Base común (PR 1)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** contra una MariaDB desechable. **No probado en producción, no aprobado para producción.**
Alcance de este PR: librería común + esquema propuesto + permisos. **Sin UI, sin conectar Fondos/Gastos/Compras, sin ejecutar SQL real.**

## 1. Qué es

Una **entrega** traslada la custodia física del expediente de un documento (Solicitud de fondo, Gasto operativo, Requerimiento de
compra) de un **área** a otra, con firma de quien entrega y firma de quien recibe. Es una entidad **separada del estado del documento**:
registrar entregas no cambia el estado de la solicitud/gasto/requerimiento («Liquidar» en Fondos conserva su significado).

Las áreas son **categorías**, nunca personas: quién puede actuar por un área lo decide un permiso.

## 2. Etapas aprobadas (2026-10-13)

| Módulo | Pares origen → destino | Área inicial | Estados del documento que admiten entrega |
|---|---|---|---|
| Fondos | Operaciones→Tesorería · Tesorería→Contabilidad · Operaciones→Contabilidad · Contabilidad→Operaciones | Operaciones | Autorizada, Liquidada |
| Gastos | Operaciones→Contabilidad · Contabilidad→Operaciones | Operaciones | Autorizada (con `activo = 1`; los históricos con `estado IS NULL` quedan fuera) |
| Compras | Compras→Tesorería · Compras→Contabilidad · Tesorería→Contabilidad · Contabilidad→Compras | Compras | Autorizada |

Se definen **en código** (`src/lib/entregas/catalogo.ts`), no en la base. Gastos no tiene etapa de pago/reintegro y Compras no inventa
recepción ni pago.

## 3. Modelo de datos (`documento_entregas`, propuesta aditiva)

Una tabla nueva; no altera ninguna existente ni crea filas. Ver `sql/migrate-2026-10-documento-entregas.sql`.

- Documento: `modulo`, `entidad_tipo`, `entidad_id`, `documento_codigo` (snapshot). Referencia polimórfica: la existencia y la empresa se
  validan en la aplicación con `SELECT … FOR UPDATE` filtrado por `empresa_id`.
- Etapas: `etapa_origen`, `etapa_destino`; `modo` (`SISTEMA` | `PRESENCIAL`); `estado` (`EMITIDA` | `RECIBIDA` | `RECHAZADA` | `ANULADA`).
- Emisión: usuario/nombre/rol (snapshot), `emitido_en`, `firma_emision_id` **NOT NULL**, observaciones.
- Recepción: usuario/nombre/rol del receptor, `recibido_en`, `firma_recepcion_id`, observaciones; en presencial, además el usuario
  que operó el dispositivo. **No hay documento de identidad ni campo de cargo**: se usa nombre + rol del sistema.
- Cierre sin recepción: `cerrado_por_*`, `cerrado_en`, `motivo_cierre`.
- Idempotencia: `clave_idempotencia` + `huella_idempotencia` (ambas obligatorias).
- `pendiente_documento`: columna generada `PERSISTENT` = `'MODULO:id'` solo si `estado = 'EMITIDA'`.

### Invariantes garantizados por la base

| Invariante | Mecanismo |
|---|---|
| Una sola entrega pendiente por documento | `UNIQUE (empresa_id, pendiente_documento)` |
| Emisión idempotente por empresa | `UNIQUE (empresa_id, clave_idempotencia)` |
| Firma de emisión siempre presente; RECIBIDA exige firma de recepción distinta | `NOT NULL` + FK + `chk_de_recepcion` + `chk_de_firmas_distintas` |
| Datos de recepción solo en RECIBIDA; de cierre solo en RECHAZADA/ANULADA | `chk_de_recepcion`, `chk_de_cierre` |
| SISTEMA: receptor con usuario; PRESENCIAL: sin usuario y con operador | `chk_de_recepcion` |
| Nadie recibe su propia entrega | `chk_de_receptor_no_emisor` |
| Solo el receptor en el sistema rechaza (nunca presencial) | `chk_de_rechazo_sistema` |
| Enumeraciones y coherencia módulo/entidad, origen ≠ destino | `chk_de_modulo/entidad_tipo/etapas/modo/estado` |
| Una firma no se borra mientras la use una entrega | FK `RESTRICT` a `firmas_electronicas` |

Con MariaDB 10.4 (desechable) y 11.8 (producción) los CHECK se aplican; se comprobaron 16 violaciones por SQL directo.

## 4. Estrategia de concurrencia

1. **Emitir:** idempotencia por clave **antes** de copiar la imagen (reintento barato). En la transacción: `FOR UPDATE` del documento
   (siempre con `empresa_id`) → relectura **con bloqueo** de la clave (si otra petición con la misma clave terminó mientras esperábamos,
   se devuelve la original) → `FOR UPDATE` de todas las entregas del documento → custodia/pendiente/par → firma + `INSERT` + auditoría en
   la **misma transacción**. El `UNIQUE` de pendiente y el de clave son la garantía final (`ER_DUP_ENTRY` → 409 / original).
2. **Cerrar (recibir/rechazar/anular/presencial):** lectura previa sin bloqueo (404/409 antes de tocar archivos) → en la transacción
   `FOR UPDATE` de la entrega → `UPDATE … WHERE estado = 'EMITIDA'` condicionado; 0 filas → 409. Dos cierres simultáneos: gana uno.
3. **Archivos de firma:** se escriben antes de la transacción (no es transaccional) y se **compensan** (borran) si no hay commit o si la
   operación fue una repetición.

## 5. Idempotencia

- Emitir: clave obligatoria (`^[A-Za-z0-9_-]{16,64}$`, la que genera el cliente por intento). Misma clave + mismo contenido → misma
  entrega, sin segunda firma ni segunda imagen. Misma clave + contenido distinto (incluido otro emisor) → **409**. Otra empresa →
  independiente. La huella cubre módulo, documento, destino, modo, observaciones y emisor; el **origen lo decide el servidor**.
- Cerrar: un reintento idéntico del **mismo actor** sobre una entrega ya cerrada devuelve el resultado sin escribir; otro actor o
  contenido distinto → 409.

## 6. Permisos (creados, **no asignados a ningún rol**)

Filas de `usuario_modulo` (sin SQL). La acción `editar` = «puede actuar». Admin conserva el bypass administrativo del sistema.

| Fila | Habilita |
|---|---|
| `fondos_entrega_emitir` / `gastos_entrega_emitir` / `compras_entrega_emitir` | Actuar por el área inicial del módulo (Operaciones / Compras): emitir y recibir devoluciones |
| `entregas_area_tesoreria` | Actuar por Tesorería (Fondos, Compras) |
| `entregas_area_contabilidad` | Actuar por Contabilidad (los tres módulos) |
| `entregas_presencial` | Registrar recepciones presenciales |
| `entregas_anular` | Anular entregas pendientes emitidas por otra persona |
| `documentos_entregas` | Base «Ver» del grupo en la matriz de Usuarios |

Los permisos existentes (`gastos`, `gastos_autorizar`, `compras_autorizar`, `tms`, `contabilidad`…) **no** dan autoridad de entrega
(probado). Dependen del módulo de empresa `tms`. La asignación es manual desde Usuarios.

## 7. Firmas

Se reutiliza `firmas_electronicas` y `crearFirmaInterna`, ligadas **al documento** (mismos `modulo`/`entidad_tipo` que sus firmas
existentes), con acciones `ENTREGAR_DOCUMENTO` y `RECIBIR_DOCUMENTO`, método `FIRMA_MANUSCRITA`.

- Emisión y recepción: firma **obligatoria** (PNG válido, ≤ 1 MB); puede ser la guardada («Mi firma», copia independiente) o dibujada.
- Presencial: firma **dibujada obligatoria**; el firmante no tiene usuario (`usuario_id` NULL en la firma; único cambio de código
  compartido: `DatosFirmaInterna.usuarioId: number | null`, la columna ya era nullable). Operador del dispositivo en el payload firmado
  y en la entrega.

## 8. Qué NO hace este PR

UI, endpoints, bandeja visual, PDF/Excel, conexión con Fondos/Gastos/Compras, notificaciones, backfill de históricos (los históricos
quedan sin entregas; el PDF mostrará casillas en blanco), ni ejecución de SQL en bases reales.

## 9. Verificación

| Nivel | Resultado |
|---|---|
| Compilación (`tsc --noEmit`) | ✅ |
| ESLint (archivos tocados) | ✅ |
| `git diff --check` | ✅ |
| Pruebas unitarias nuevas | ✅ 32 |
| Pruebas contra MariaDB 10.4 desechable (schema.sql + migraciones previas + esta) | ✅ 33 (3 corridas estables) |
| Preflight → migración → migración repetida → verificación posterior (desechable) | ✅ `LISTO PARA MIGRAR` / `ESTRUCTURA OK` |
| Suite completa | 21 fallos preexistentes (mismos 10 archivos que `main`) |
| Probado en producción / aprobado para producción | ❌ No |

## 10. Para producción (cuando se autorice, en este orden)

1. `sql/preflight-2026-10-documento-entregas.sql` (solo lectura) → revisar `LISTO PARA MIGRAR`.
2. `sql/migrate-2026-10-documento-entregas.sql` (manual, autorizado).
3. `sql/verificar-2026-10-documento-entregas.sql` → `ESTRUCTURA OK` (33 columnas, 3 UNIQUE, 7 FK, 11 CHECK).
4. Asignar permisos manualmente desde Usuarios.
