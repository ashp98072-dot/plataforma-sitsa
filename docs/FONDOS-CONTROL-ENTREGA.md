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

## Hallazgo en la base común (PR #445) — requiere decisión

Dos emisiones **simultáneas de documentos distintos** (incluso de empresas distintas) pueden interbloquearse:
`registrarEntrega` hace `SELECT … FOR UPDATE` de las entregas del documento (rango vacío) y luego `INSERT`; con REPEATABLE READ ambos
toman el mismo bloqueo de rango (hueco/supremum de `uq_de_empresa_id`) y al insertar InnoDB revierte uno (`ER_LOCK_DEADLOCK`).

Reproducción mínima (MariaDB 10.4 desechable, 20 rondas de dos transacciones concurrentes con documentos distintos):

| Variante | Rondas con deadlock |
|---|---|
| Actual (`FOR UPDATE`, REPEATABLE READ) | **20 / 20** |
| `READ COMMITTED` | 0 / 20 |
| Lectura sin bloqueo (tras bloquear la fila del documento) | 0 / 20 |

Impacto: poco frecuente (ventana de milisegundos entre la lectura y el INSERT), pero real; el usuario vería un error y reintentaría.

**No se cambió el servicio común** (la instrucción es reportar antes de tocar la arquitectura común). En esta PR solo hay una
mitigación en la capa HTTP de Fondos: `conReintentoPorDeadlock` reintenta hasta 3 veces (seguro: emitir es idempotente por clave y
las demás acciones reconocen su repetición). Corrección de raíz propuesta, en una PR aparte: en `registrarEntrega` y `cerrarEntrega`,
leer las entregas del documento **sin** `FOR UPDATE` (la fila del documento ya serializa a los emisores) y/o ejecutar la transacción
en `READ COMMITTED`.

## Verificación

| Nivel | Resultado |
|---|---|
| `tsc --noEmit`, ESLint (archivos tocados), `git diff --check` | ver reporte de la PR |
| Pruebas unitarias / de endpoints / PDF / cableado de UI | ver reporte de la PR |
| Integración de endpoints + servicio contra MariaDB 10.4 desechable | ver reporte de la PR |
| Probado en navegador / producción | ❌ No |
