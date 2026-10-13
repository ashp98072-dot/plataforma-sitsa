# Control de entrega — Solicitudes de fondo (PR 2)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (pruebas unitarias, de endpoints con el servicio mockeado y de integración
contra una MariaDB 10.4 **desechable**). **No probado manualmente en navegador ni en producción; no aprobado para producción.**
Alcance: **solo Solicitudes de fondo**. Gastos y Compras no se tocan. Sin SQL, sin migraciones, sin backfill.

La base común (tabla `documento_entregas`, servicio, permisos, firmas, idempotencia, concurrencia) es la de la PR #445 y **no se
duplica ni se modifica** aquí: los endpoints solo resuelven sesión/tenant, leen la firma y llaman al servicio.

## Qué hace

- Registrar una entrega **no** autoriza, liquida ni cambia monto, líneas, requirente ni estado del documento.
- «Registrar entrega» (fila de la solicitud) → formulario: destino, modo, observaciones y firma → botón «Emitir entrega».
- Estado visible en la fila: «Entrega pendiente → Tesorería» (o «En Tesorería» si ya hay custodia fuera de Operaciones). Con una
  pendiente no se puede registrar otra.
- «Entregas» abre el historial: estado, área origen/destino, modo, emitido por y fecha, recibido por y fecha, observaciones y
  motivo de rechazo/anulación. Desde ahí: «Anular entrega» y «Registrar recepción presencial».
- Bandeja «Entregas por recibir» (misma pantalla): EMITIDAS, modo SISTEMA, hacia un área por la que el usuario puede actuar y nunca
  emitidas por él. Acciones «Recibir» (firma) y «Rechazar» (motivo). Sin polling: se consulta al abrir y tras cada acción.
- PDF individual: bloque «CONTROL DE ENTREGA» con las RECIBIDAS y la EMITIDA pendiente; RECHAZADA/ANULADA solo como nota. PDF mensual
  consolidado: versión compacta en texto. Sin imágenes de firma de entrega (nombre, fecha/hora y **código de firma**).

## Endpoints (`/api/empresas/[slug]/tms/fondos/…`)

| Método y ruta | Qué hace |
|---|---|
| `GET [id]/entregas` | Historial + custodia + opciones de registro del usuario (404 si el documento no es de la empresa) |
| `POST [id]/entregas` | `registrarEntrega` (multipart: `destino`, `modo`, `observaciones`, `claveIdempotencia`, firma) |
| `GET entregas/por-recibir` | Bandeja (`listarEntregasPorRecibir`, solo FONDOS) |
| `GET entregas/resumen?ids=` | Custodia/pendiente de la página del listado en una consulta |
| `POST entregas/[entregaId]/recibir` | `confirmarRecepcion` (firma obligatoria) |
| `POST entregas/[entregaId]/rechazar` | `rechazarRecepcion` (motivo) |
| `POST entregas/[entregaId]/presencial` | `registrarRecepcionPresencial` (nombre + firma **dibujada**) |
| `POST entregas/[entregaId]/anular` | `anularEntrega` (motivo) |

Empresa, usuario, nombre, rol y permisos salen **siempre** de la sesión (`requireTenantEntregas` → `actorDesdeSesion`); el cliente
no los envía y, si los enviara, se ignoran. Una entrega inexistente, de otra empresa o de otro módulo responde el mismo 404.

## Permisos usados (los de la PR #445; no se asignan a roles)

`fondos_entrega_emitir` (área Operaciones), `entregas_area_tesoreria`, `entregas_area_contabilidad`, `entregas_presencial`,
`entregas_anular`, `documentos_entregas`. Sin ninguno de ellos la funcionalidad queda oculta; Admin conserva el bypass del sistema.
La puerta de los endpoints acepta además «ver Solicitudes de fondo» solo para lectura (historial y resumen).

## Fuera de esta PR

- **Excel** (individual y mensual): no se amplía; follow-up independiente.
- Imagen de la firma de entrega en el PDF.
- Gastos y Compras (PR 3 y PR 4).

## Hallazgo en la base común (PR #445) — CORREGIDO en esta PR

Dos emisiones **simultáneas de documentos distintos** (incluso de empresas distintas) pueden interbloquearse:
`registrarEntrega` hace `SELECT … FOR UPDATE` de las entregas del documento (rango vacío) y luego `INSERT`; con REPEATABLE READ ambos
toman el mismo bloqueo de rango (hueco/supremum de `uq_de_empresa_id`) y al insertar InnoDB revierte uno (`ER_LOCK_DEADLOCK`).

Reproducción mínima (MariaDB 10.4 desechable, 20 rondas de dos transacciones concurrentes con documentos distintos):

| Variante | Rondas con deadlock |
|---|---|
| Actual (`FOR UPDATE`, REPEATABLE READ) | **20 / 20** |
| `READ COMMITTED` | 0 / 20 |
| Lectura sin bloqueo (tras bloquear la fila del documento) | 0 / 20 |

Con el servicio real, en la primera ronda de 6 emisiones simultáneas de documentos distintos fallaban 5 por deadlock.

### Corrección (aprobada) — `src/lib/entregas/entregas.ts`, `registrarEntrega`

Se quitaron los dos `FOR UPDATE` sobre **filas que pueden no existir** de `documento_entregas`, ambos tomaban bloqueos de hueco
compartidos entre documentos y empresas:

1. la lectura del **historial** del documento (`… WHERE empresa_id = ? AND modulo = ? AND entidad_id = ? ORDER BY id`);
2. la **relectura de la clave** de idempotencia (`… WHERE empresa_id = ? AND clave_idempotencia = ?`). La instrucción original
   solo mencionaba el historial; se comprobó que quitar solo ese **no** basta (20/20 rondas seguían interbloqueándose por el hueco de
   `uq_de_empresa_clave`), así que esta lectura también pasa a ser no bloqueante. Sigue releyéndose bajo el bloqueo del documento.

Se **mantiene**: `FOR UPDATE` de la fila del documento origen, los UNIQUE de clave y de pendiente (garantía final), y el
`FOR UPDATE` al cerrar (recibir/rechazar/anular). No se cambió el aislamiento.

**Por qué sigue siendo seguro.** La fila del documento serializa las emisiones del MISMO documento, y la primera lectura no
bloqueante de la transacción (la relectura de la clave) toma su instantánea DESPUÉS de obtener ese bloqueo, así que ve todo lo que
confirmaron emisiones anteriores. Una entrega pendiente siempre aparece en esa lectura (solo las emisiones la crean y están
serializadas), de modo que nunca se emite una segunda ni se calcula una custodia futura: si un cierre concurrente aún no confirmó,
la nueva emisión ve la pendiente y se rechaza (409 «pendiente», o 403 de permiso de área, porque esa validación precede a la de
pendiente); tras la recepción confirmada, un nuevo intento válido emite desde la nueva custodia. Una carrera de la misma clave contra
otro documento termina en `ER_DUP_ENTRY` y se resuelve como antes (original si la huella coincide, 409 si no).

### Evidencia (BD desechable, concurrencia real con Promise.all, `entregas-concurrencia.db.test.ts`, 30 rondas por escenario)

| Escenario | Antes | Después |
|---|---|---|
| A. 6 documentos distintos, misma empresa (180 emisiones) | falla desde la ronda 0 (5/6 por deadlock) | 0 deadlocks, 180/180 creadas |
| B. 3+3 documentos, dos empresas (180 emisiones) | falla desde la ronda 0 | 0 deadlocks, 180/180 creadas |
| C. mismo documento, claves distintas (6 por ronda) | — | una gana, 5 × 409; 1 EMITIDA, 1 firma |
| D. misma clave (6 por ronda) | — | 1 entrega, 1 firma, las 6 devuelven la original |
| E. recibir vs nueva emisión del mismo documento | — | nunca dos pendientes ni custodia incorrecta; Operaciones nunca emite |
| F. misma clave en documentos distintos | — | una gana, la otra 409 |

### Reintento HTTP

`conReintentoPorDeadlock` se conserva como **defensa** ante deadlocks transitorios del motor (máx. 3 intentos, solo
`ER_LOCK_DEADLOCK`/1213, con pausa aleatoria). Ya no es la solución del deadlock conocido.

## Verificación

| Nivel | Resultado |
|---|---|
| `tsc --noEmit`, ESLint (archivos tocados), `git diff --check` | ver reporte de la PR |
| Pruebas unitarias / de endpoints / PDF / cableado de UI | ver reporte de la PR |
| Integración de endpoints + servicio contra MariaDB 10.4 desechable | ver reporte de la PR |
| Probado en navegador / producción | ❌ No |
