# Facturación de viajes — Fase 1: viaje cerrado → viaje facturable → borrador de factura

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (tsc, ESLint, build, pruebas con base simulada y pruebas contra MariaDB 11.8.9 y 10.4 reales y desechables — ver §14 — y validación manual de la interfaz en navegador con datos de desarrollo — ver §15). NO probado en la base de producción/Hostinger ni con usuarios reales. NO aprobado para producción.**

Esta fase **no emite FEL**: no conecta con INFILE ni con la SAT, no usa credenciales FEL, no genera UUID/serie/número FEL, no crea pólizas ni cuentas por cobrar. Un test de arquitectura (`src/lib/facturacion/sin-fel-fase1.test.ts`) lo exige sobre el código del flujo.

Contexto: la auditoría de Milenium (`docs/AUDITORIA-MILENIUM-CONTABILIDAD-FACTURACION.md`) concluye que Milenium no conoce el concepto de «viaje» y que se factura a mano con texto libre. Esta fase conecta el viaje de la plataforma con un borrador de factura estructurado.

---

## 1. Hallazgo del discovery: ya existía FACT-1, se REUTILIZÓ

Antes de escribir código se inspeccionó el repositorio. **`fact_facturas`, `fact_factura_viajes` y `fact_pagos` ya existen y están en uso** (`sql/migrate-2026-08-fact-1-facturas-pagos.sql`; confirmadas como aplicadas en `docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md`), junto con su API, su pantalla (Operaciones → Facturación clientes), permisos granulares y auditoría. Por eso **no se creó ninguna entidad «documento por facturar»**: el borrador de factura de FACT-1 (`estado_admin = 'Borrador'`) **es** el documento por facturar. Crear otra tabla habría sido un segundo sistema de facturación paralelo.

| Pedido de la fase | Ya existía (FACT-1) | Se agregó (FACT-2) |
|---|---|---|
| Viaje facturable = Cerrado, del cliente, sin factura viva | `condicionesViajesPendientes`, `UNIQUE(plan_id)`, bridge `clientes.tms_cliente_id` | + tarifa comercial > 0, + ruta/destino identificable, + **solo GTQ** |
| Pantalla «Viajes por facturar» | pestaña «Viajes pendientes» | + columnas ruta, origen → destino, piloto, estado; + filtro por ruta |
| Selección de varios viajes del mismo cliente | `evaluarSeleccion` (UI) + validación en servidor | + misma moneda |
| Borrador de factura | `crearFactura` / `actualizarFacturaBorrador` | + líneas estructuradas, IVA desglosado **por línea** (incluido o agregado), snapshots |
| Anti doble facturación | `FOR UPDATE` + `UNIQUE(plan_id)` | + bloqueo en orden estable, + defensa ante el duplicado en el INSERT, + conflicto de concurrencia como 409 |
| Cancelar borrador / liberar viajes | `anularFactura` (borra los vínculos) | etiqueta «Cancelar borrador» en la UI |
| Permisos | `requireTenantFacturacion` con `ver`/`crear`/`editar`/`emitir`/`anular`/`pagos` | endpoint de preview con `crear` |
| Auditoría | `registrarAuditoriaTx` | + totales, IVA, moneda y viajes en el detalle |
| Preview sin escritura | — | `previsualizarFactura` + `POST …/facturas/preview` |
| Cálculo de IVA | — | `src/lib/facturacion/impuestos.ts` |

## 2. Qué se creó

**Código**
- `src/lib/facturacion/impuestos.ts` — cálculo de IVA con `decimal.js`; la política (incluido / agregado) se recibe por línea.
- `src/lib/facturacion/borrador-calculo.ts` — lógica **pura** (sin DB): elegibilidad de un viaje, descripción de línea, totales. La comparten crear, editar y la vista previa, así que **no pueden divergir**.
- `previsualizarFactura` y la validación compartida en `src/lib/facturacion/facturas.ts`.
- `POST /api/empresas/[slug]/facturacion/facturas/preview`.
- UI: columnas y filtro de ruta en «Viajes pendientes»; paso «Previsualizar» antes de «Guardar borrador»; detalle del borrador con base/IVA/total por línea y resumen.

**SQL (solo propuesto, NO ejecutado)** — ver §9
- `sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql`
- `sql/preflight-2026-10-fact-2-borrador-snapshots-iva.sql` (solo lectura)

**No se creó**: ninguna tabla nueva, ningún estado nuevo, ninguna columna booleana «facturable».

## 3. «Facturable» se DERIVA, no se guarda

Un viaje es facturable cuando se cumple **todo** lo siguiente (una sola definición en SQL para el listado, el contador y el KPI, y su equivalente en `evaluarPlanFacturable` para el servidor):

| Regla | Dónde |
|---|---|
| Pertenece a la empresa de la sesión | `p.empresa_id = ?` — y en servidor el viaje se relee con `empresa_id` del actor |
| Está **Cerrado** (cierre administrativo, `viajes_cerrar`) | `p.estado = 'Cerrado'` |
| Su cliente TMS está vinculado a un cliente de Facturación | `cli.id IS NOT NULL` (puente `clientes.tms_cliente_id`) |
| **Tarifa comercial válida** (> 0) | `p.tarifa_comercial > 0` — *nuevo* |
| **Ruta válida**: código de ruta, destino congelado en el viaje, **o un destino de catálogo que realmente existe** (un `tms_lugares` de la MISMA empresa con nombre no vacío) | *nuevo* — mismo criterio en SQL (`EXISTS` correlacionado por `empresa_id`) y en servidor |
| Sin factura viva (Borrador o Emitida) | `NOT EXISTS` sobre `fact_factura_viajes` |
| **Moneda GTQ** (única soportada en la Fase 1; ver más abajo) | `p.tarifa_moneda_historico` vacío/NULL, `Q`, `QTZ` o `GTQ` |

**Listado y servidor deben decir lo mismo.** Un viaje que aparece en «Viajes por facturar» nunca debe ser rechazado después por la vista previa o por guardar. La prueba contra MariaDB real (§14) verifica la equivalencia caso por caso (moneda, destino de catálogo válido, inexistente, de otra empresa, con nombre vacío, ruta o destino en blanco, tarifa, estado).

**Moneda**: la Fase 1 solo admite **GTQ**, porque Contabilidad no ha definido el tratamiento de moneda extranjera (IVA, tipo de cambio). `null`/vacío, `Q`, `QTZ` y `GTQ` se normalizan a GTQ; cualquier otra (USD, EUR…) **no aparece** en el listado y el servidor responde **409**: «Esta fase de Facturación solo admite GTQ. La facturación en moneda extranjera está pendiente de definición contable.» La restricción vive en `MONEDA_SOPORTADA` (`borrador-calculo.ts`); se levanta en un solo lugar cuando Contabilidad la defina.

Por qué derivado y no un booleano: anular o cancelar una factura **borra** su fila en `fact_factura_viajes`, así que «no existe fila» ya significa «libre». Un booleano redundante podría quedar desincronizado; la derivación no puede.

«Cancelada/reemplazada que aún bloquee»: no existe ese caso en este modelo, porque anular borra los vínculos. «Marcado como facturado externamente»: ver §8.

El **estado** y la **empresa** no son filtros de la pantalla: el estado siempre es `Cerrado` y la empresa siempre es la de la sesión. Los filtros son cliente, fecha desde/hasta y ruta (código o destino).

## 4. Estados

Se mantienen los de FACT-1; no se introdujo ninguno nuevo.

| Estado | Significado hoy |
|---|---|
| `Borrador` | Documento por facturar. Editable. Sin número, sin fecha de emisión. Reserva sus viajes. |
| `Emitida` | Emisión **interna** de FACT-1 (número y fecha capturados a mano). **No es FEL.** Congelada; admite pagos. |
| `Anulada` | Borrador cancelado o factura anulada. Libera los viajes. Equivale al «CANCELADO» pedido. |

Extensión futura (no implementada, no hay ninguna columna ni lógica para ellos): `LISTO_PARA_EMITIR`, `EMITIDO_EXTERNO` (convivencia con Milenium), `EMITIDO_FEL`. Debe decidirse con Contabilidad si «Emitida» pasa a significar «emitida con certificación» o si se crea un estado aparte.

## 5. Cálculo de IVA — tratamiento POR LÍNEA

**Confirmado por Contabilidad**: la mayoría de las tarifas **ya incluyen** el IVA 12 %, pero hay viajes cuya tarifa **lleva el IVA agregado**, y **una misma factura puede mezclar ambos**. Por eso el tratamiento **no es una política global ni por factura: es de cada línea/viaje**, se elige explícitamente y se **congela por línea**. **Sigue pendiente** la regla de negocio que decide automáticamente cuál corresponde (¿por cliente, ruta, tipo de servicio, cotización?); mientras no se conozca, **nada se infiere**.

`calcularTotalesLinea({ montoLinea, porcentajeIva, precioIncluyeIva })` y `calcularTotalesFactura({ porcentajeIva, lineas: [{ montoLinea, precioIncluyeIva }] })` en `impuestos.ts` (las fórmulas viven solo ahí; `construirBorrador` las reutiliza).

- Aritmética decimal (`decimal.js`), redondeo half-up a 2 decimales. El porcentaje de la fase es 12 % (`PORCENTAJE_IVA_FASE1`).
- **IVA incluido en la tarifa** (`precio_incluye_iva = 1`): `base = round(tarifa / 1.12)` e `IVA = tarifa − base`, así `base + IVA = total` exacto. `112.00 → 100.00 + 12.00`; `100.00 → 89.29 + 10.71`; `1000.00 → 892.86 + 107.14`.
- **IVA agregado a la tarifa** (`precio_incluye_iva = 0`): `base = tarifa`, `IVA = round(base × 12 %)`, `total = base + IVA`. `100.00 → 100.00 + 12.00 = 112.00`; `1000.00 → 1000.00 + 120.00 = 1120.00`.
- **Ejemplo mixto**: línea 1 = Q100 con IVA incluido (89.29 + 10.71 = 100.00) y línea 2 = Q100 con IVA agregado (100.00 + 12.00 = 112.00) → **subtotal 189.29, IVA 22.71, total 212.00**.
- **El documento es la suma de sus líneas ya calculadas**: subtotal = Σ base, IVA = Σ IVA de cada línea, total = Σ total de línea. **Nunca se recalcula el IVA globalmente sobre el total agregado.**
- `monto_total` sigue siendo el **total con IVA**, así que pagos, saldos y KPIs de FACT-1 no cambian.
- **Encabezado de la factura** (`fact_facturas.precio_incluye_iva` / `porcentaje_iva`): es solo un **resumen de compatibilidad**, **no la fuente de verdad** (esa son las líneas). `precio_incluye_iva` = `1` o `0` únicamente si **todas** las líneas coinciden y **`NULL` cuando hay mezcla** (o es una factura anterior): nunca indica una sola política cuando no la hay. `porcentaje_iva` = 12 mientras todas las líneas usen 12 %.
- **Servidor**: cada línea del payload debe traer `precioIncluyeIva` booleano (Zod en las tres rutas y verificación en la capa de servicio); sin valor por defecto. Un campo a nivel de factura se ignora.
- **Pregunta contable abierta**: ¿qué regla decide, por viaje, si la tarifa ya incluye el IVA o si se agrega? (hoy lo elige quien factura).

## 6. Prevención de doble facturación

Capas, de la más débil a la más fuerte:
1. **UI**: no ofrece viajes ya facturados ni mezcla clientes/monedas (no es una defensa; solo ayuda).
2. **Servidor, siempre**: crear y editar **releen** cada viaje de la base (nunca confían en el payload) y revalidan cliente, empresa, estado, tarifa, ruta, moneda y vínculo.
3. **Transacción con `FOR UPDATE`** sobre cada viaje, en **orden ascendente de id** (dos usuarios con viajes en común toman los bloqueos en el mismo orden). La fila del viaje es el punto de serialización: el segundo usuario espera al primero y luego ve el vínculo. **Crear y editar usan `READ COMMITTED`** (solo para esa transacción): con el aislamiento por defecto (REPEATABLE READ) el `SELECT … FOR UPDATE` sobre un vínculo que aún no existe toma un bloqueo de hueco en el índice UNIQUE y dos usuarios —incluso con viajes distintos o solo traslapados— se interbloqueaban al insertar. Se reprodujo contra MariaDB real y se corrigió (§14).
4. **`UNIQUE(plan_id)` en `fact_factura_viajes`** (ya existente): si algo se colara entre validar e insertar, la base rechaza el duplicado y la aplicación lo devuelve como **409**, con rollback completo (no queda factura a medias).
5. Un deadlock o `lock wait timeout` se devuelve como **409 reintentable**, no como error 500.

La **vista previa no reserva nada**: no abre transacción, no usa `FOR UPDATE`, no audita, no llama a `asegurarVinculosTmsClientes` (que escribe). Una preview correcta **no garantiza** que el viaje siga libre al guardar; por eso guardar revalida todo.

## 7. Snapshots («congelar datos»)

Al crear el borrador se guardan (columnas nuevas, ver §9):

- **Cliente** (en `fact_facturas`): nombre fiscal (razón social, o nombre comercial si no hay), NIT y dirección.
- **Por línea** (en `fact_factura_viajes`): código del viaje, fecha del viaje, código de ruta, origen, destino, descripción, cantidad (1), monto capturado, **tratamiento de IVA (`precio_incluye_iva`) y `porcentaje_iva`**, base, IVA, total. El snapshot fiscal es **autosuficiente por línea**: una factura histórica conserva exactamente cómo se calculó cada línea aunque las reglas futuras cambien.
- **Documento**: moneda, subtotal, IVA, porcentaje de IVA y el resumen del tratamiento (1 / 0 / NULL con mezcla, ver §5).

Lectura: el detalle prefiere **siempre** lo congelado (`COALESCE(snapshot, dato vivo)`); el dato vivo solo rellena filas anteriores a FACT-2. El listado también muestra el nombre congelado del cliente.

Edición del borrador: **no refresca lo congelado**. Las líneas que siguen en el borrador conservan su fotografía y el cliente conserva la suya si no cambió de cliente. Se re-fotografía únicamente lo nuevo (viaje agregado, cliente cambiado, o filas anteriores a FACT-2 que no tenían snapshot).

Descripción de línea: `Servicio de transporte – {origen} → {destino} – {dd/mm/aaaa}`. El destino congelado del viaje (`lugar_descarga_historico`) manda sobre el catálogo vivo; lo desconocido se muestra como «—». Hay una línea por viaje y `viaje_id` se conserva como referencia estructurada (`plan_id`).

## 8. Convivencia futura con Milenium — «Facturado externamente» (NO implementado)

Hoy no existe nada equivalente en el repositorio. Se **documenta, no se implementa**, porque exige una tabla nueva y decisiones de Contabilidad. Diseño propuesto:

- Tabla aparte `fact_viaje_facturado_externo` (`empresa_id`, `plan_id` **UNIQUE**, `origen` — `MILENIUM`/otro —, `referencia`, `fecha_factura`, `observacion`, `registrado_por`, `creado_en`, y baja lógica con motivo).
- La condición de «facturable» (§3) agregaría un `NOT EXISTS` contra esa tabla; así sigue derivado.
- **No** modelarlo como una `fact_facturas` en estado `Emitida` con número externo: contaminaría KPIs, pagos y cobranza con documentos que viven en otro sistema.
- Preguntas para Contabilidad: ¿quién puede marcar/desmarcar?, ¿se permite deshacer?, ¿se carga la historia en bloque (con revisión previa) o viaje por viaje?, ¿cómo se concilia con el riesgo de doble facturación entre sistemas?

## 9. SQL que habría que aplicar (NO ejecutado)

**El código FACT-2 lee y escribe las columnas nuevas: el SQL debe aplicarse ANTES de desplegar.** Si se despliega sin aplicarlo, crear/editar borradores y leer facturas fallarán con «Unknown column». (No se agregó un modo degradado a propósito: guardar una factura sin su snapshot sería un fallo silencioso sobre datos financieros.)

Orden: (1) correr `preflight-2026-10-fact-2-borrador-snapshots-iva.sql` (solo lectura) y revisar; (2) aplicar `migrate-2026-10-fact-2-borrador-snapshots-iva.sql`; (3) desplegar.

La migración es aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`, MariaDB), todo `NULL`/`DEFAULT`, sin backfill, sin tocar índices ni FKs:
- `fact_facturas`: `moneda` (default `GTQ`), `subtotal`, `iva_monto`, `porcentaje_iva` y `precio_incluye_iva` (**resumen**: NULL con mezcla), `cliente_nombre_snapshot`, `cliente_nit_snapshot`, `cliente_direccion_snapshot`.
- `fact_factura_viajes`: `codigo_viaje_snapshot`, `fecha_viaje_snapshot`, `ruta_codigo_snapshot`, `origen_snapshot`, `destino_snapshot`, `descripcion`, `cantidad` (default 1), **`precio_incluye_iva`, `porcentaje_iva`** (política fiscal congelada de la línea), `base_monto`, `iva_monto`, `total_linea`.

Facturas y borradores anteriores quedan con snapshot `NULL` (incluido el tratamiento de IVA de sus líneas) y se muestran como siempre (solo `monto_total` / `monto_asignado`); al editar un borrador así se elige el tratamiento de cada línea (la pantalla muestra «IVA incluido» preseleccionado). El preflight verifica ANTES de migrar que las columnas nuevas no existan. Reversión: las columnas son opcionales; basta desplegar la versión anterior del código y, si se quisiera, `DROP COLUMN` (acción destructiva: solo con autorización).

## 10. Permisos y auditoría

Se reutilizan los permisos granulares de `facturacion` (no se creó ninguno):

| Acción pedida | Permiso | Endpoint |
|---|---|---|
| Ver viajes por facturar | `facturacion:ver` | `GET …/facturacion/viajes-pendientes` |
| Previsualizar / crear borrador | `facturacion:crear` | `POST …/facturas/preview`, `POST …/facturas` |
| Editar borrador | `facturacion:editar` | `PATCH …/facturas/[id]` |
| Cancelar borrador | `facturacion:anular` (el mismo permiso que anula una factura) | `POST …/facturas/[id]/anular` |

Si se quiere un permiso distinto para «cancelar borrador» frente a «anular factura emitida» hay que ampliar el catálogo de permisos: no se hizo en esta fase.

Auditoría (`auditoria`, módulo `facturacion`): crear y editar registran usuario, empresa, cantidad de viajes, moneda, subtotal, IVA, el resumen del tratamiento de cada línea («2 con IVA incluido y 1 con IVA agregado»), total y los códigos de los viajes con su tratamiento; anular registra la cancelación. No se guardan NIT ni dirección del cliente en la bitácora.

## 11. Decisiones tomadas y puntos para Contabilidad

1. **Tratamiento de IVA — confirmado por Contabilidad**: existen tarifas con IVA incluido (la mayoría) y tarifas a las que se agrega el IVA, y **una misma factura puede mezclar ambas**. La política se elige **por línea/viaje** y se congela por línea (§5). **Sigue abierta**: la regla de negocio que decida automáticamente cuál corresponde (hoy lo elige quien factura, con «IVA incluido» preseleccionado y visible).
2. **Tarifa comercial obligatoria.** Antes un viaje sin tarifa podía facturarse en cero (había una prueba que lo exigía); ahora **no es facturable** hasta que tenga tarifa > 0. Aún se puede ajustar el monto de una línea, pero la tarifa de base debe existir. Cambio de comportamiento respecto de FACT-1: confirmar que no hay viajes legítimos sin tarifa que hoy se facturen a mano.
3. **Ruta válida = código de ruta o destino identificable.** Se eligió ese criterio porque un viaje armado a mano en Programación puede no tener ruta de catálogo; exigir ruta de catálogo ocultaría viajes facturables. Si Contabilidad exige ruta de catálogo, se endurece en `evaluarPlanFacturable` y en la condición SQL.
4. **Moneda**: la Fase 1 solo admite **GTQ** (se toma de `tarifa_moneda_historico`; vacío/`Q`/`QTZ`/`GTQ` = GTQ). Otra moneda se bloquea en servidor y no se lista. Falta que Contabilidad defina el tratamiento de moneda extranjera. (Los KPI de `facturacion-client.tsx` suman en quetzales; no se tocó ese archivo.)
5. **Piloto visible** en «Viajes pendientes»: solo el **nombre**, a pedido de esta fase. FACT-1 lo había excluido a propósito (Facturación «no necesita ni debe ver» datos operativos) y una prueba lo verificaba; se reemplazó por una que permite únicamente el nombre y sigue excluyendo auxiliares, evidencias, paradas y GPS. Si el criterio de privacidad prevalece, es quitar un campo.
6. **Emisor legal**: aún no existe como dato (la configuración fiscal de la empresa está en el cuestionario `fact_empresa_perfil`, sin campos estructurados). Dentro de una empresa el emisor es la propia empresa, por lo que la regla «mismo emisor» se cumple por construcción; cuando haya varios emisores por empresa habrá que añadirla.
7. **Cancelar = anular** (mismo estado, mismo endpoint, mismo permiso). Ver §10.
8. **Rutas de API**: se adaptaron al patrón real del repositorio (`/api/empresas/[slug]/facturacion/…`), no a las rutas conceptuales del ticket; no se duplicó `GET/POST borradores` porque `facturas` ya es el recurso del borrador.

## 12. Qué queda pendiente para FEL (fuera de esta fase)

Sin FEL todavía: emisión/certificación con INFILE (endpoint, autenticación, sandbox e idempotencia oficial **sin confirmar**), serie/número/UUID, XML certificado, anulación fiscal, notas de crédito, almacenamiento seguro de credenciales (nunca en texto claro), proveedor FEL simulado para pruebas, pólizas contables, cuentas por cobrar, y la convivencia con Milenium (§8). Ver `docs/FEL-INFILE-*` y la auditoría de Milenium.

## 13. Verificación y límites

- **Hecho**: `tsc --noEmit`, ESLint, `git diff --check`, `npm run build` y toda la suite de vitest (resultado y comparación con `origin/main` en el PR).
- **Pruebas nuevas**: IVA y redondeo; elegibilidad del viaje; preview sin escritura; creación con snapshot; doble uso del mismo viaje (secuencial y por carrera en el INSERT); deadlock → 409; orden de bloqueo; cancelar libera viajes; snapshots no cambian al editar cliente/ruta; permisos; multiempresa; arquitectura sin FEL.
- **Limitaciones restantes**: el esquema de las pruebas es el de `sql/schema.sql` + la migración FACT-1 (no una copia de producción) y el volumen es de pruebas. La interfaz se validó manualmente solo con datos sintéticos de desarrollo (§15). Hace falta repetir §14 y §15 en un ambiente de pruebas con datos representativos antes de considerarlo **PROBADO**. (La validación en MariaDB 11.8.9 —la versión del servidor objetivo— ya se hizo; no está pendiente.)

## 14. Validación contra una MariaDB real y desechable

`src/lib/facturacion/integracion-mariadb.test.ts` ejecuta el **código real** de `facturas.ts` (sin mocks) y los **archivos SQL reales** (`migrate-2026-08-fact-1…`, preflight y migración FACT-2) contra una base creada solo para la prueba. Es **opt-in**: se omite salvo que exista `FACT_TEST_DB_PORT`, y su `vi.mock("@/lib/db")` apunta fijo a `127.0.0.1` / base `fact_test_fase1` / `root` sin contraseña, sin leer ningún `.env` (no puede conectarse a Hostinger ni a producción). Cada corrida borra y recrea esa base.

Cómo correrla (instancia MariaDB desechable en el puerto 3399 con un `--datadir` temporal; se validó con **MariaDB 11.8.9** —zip oficial de archive.mariadb.org, SHA-256 verificado— y con 10.4.32):

```bash
FACT_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/integracion-mariadb.test.ts
```

Qué cubre (47 pruebas): A preflight · B migración · C idempotencia (2.ª ejecución) y datos anteriores intactos · D crear · E leer · F editar (lo congelado no se refresca) · G cancelar y liberar · H snapshots tras cambiar cliente/ruta/destino/tarifa · I `subtotal + IVA = total` verificado en SQL · fechas DATE y `emitirFactura` · **IVA por línea: incluido, agregado, factura MIXTA (Q100 + Q100 → 189.29 / 22.71 / 212.00), encabezado NULL con mezcla, vista previa = guardado, editar conservando/cambiando una sola línea, snapshot fiscal estable, factura emitida inmodificable, líneas anteriores con NULL, sesiones concurrentes con tratamientos distintos y selecciones mixtas traslapadas** · J dos sesiones con el mismo viaje (20 rondas) · J2 serialización por bloqueo · J3 `UNIQUE(plan_id)` ante INSERT directos · K tres viajes en orden opuesto (10 rondas) · K2 selecciones traslapadas (10 rondas) · L viajes distintos y contiguos (30 rondas) · control de que un orden de bloqueo opuesto SÍ produce deadlock · listado ⇔ servidor (18 casos) · multiempresa · filtro de ruta/destino.

**Defectos que solo aparecieron contra la base real** (la simulación en memoria los ocultaba) y que ya están corregidos:
1. **Deadlock** con selecciones traslapadas o contiguas (bloqueos de hueco en REPEATABLE READ) → crear/editar usan `READ COMMITTED`. Con ese cambio desactivado las pruebas K2 y L fallan siempre; con él, pasan.
2. **Editar un borrador** leía `fecha_viaje_snapshot` como objeto `Date` y lo reinsertaba como texto inválido («Thu Aug 27») → ahora se lee con `DATE_FORMAT`.
3. **Filtro «ruta o destino»**: `NOT (NULL REGEXP …)` es `NULL` y ocultaba los viajes sin destino congelado → se usa `COALESCE`.

**Hallazgo preexistente de FACT-1, ya corregido**: `mapFactura` convertía `fecha_emision` con `String(valor).slice(0, 10)`, pero el driver devuelve un objeto `Date` para una columna `DATE`; con una factura que ya tenía fecha, el listado, el detalle y el formulario de edición mostraban «Thu Aug 27». Ahora `FACTURA_SELECT` **y la consulta de bloqueo de `emitirFactura`** formatean en SQL (`DATE_FORMAT(…, '%Y-%m-%d') AS fecha_emision`), sin depender de la zona horaria; `mapFactura` no cambió y los filtros por rango siguen comparando la columna. Cubierto por pruebas unitarias y por la prueba opt-in contra MariaDB real (que además demuestra que el driver SÍ entrega un `Date`).

## 15. Validación manual de la interfaz (navegador, datos de desarrollo)

Se levantó la aplicación en desarrollo (`next dev`) contra una **base MariaDB 10.4 desechable local** (puerto 3399, creada con `sql/schema.sql`, el seed de usuarios del proyecto, la migración FACT-1 y el preflight + migración FACT-2) y **datos sintéticos** («Cliente Demo Uno/Dos», viajes `DEMO-*`, `PAG-*` y casos negativos `NO-*`). Sin Hostinger, sin producción, sin FEL/INFILE/SAT. Se probó en escritorio (1440×900) y se revisó el ancho a 1024 px.

| # | Caso | Resultado |
|---|---|---|
| 1 | Una línea, **IVA incluido**, Q100 | Vista previa **89.29 + 10.71 = 100.00**. Guardado y reabierto tras recargar: conserva «IVA incluido en la tarifa» y los mismos importes. |
| 2 | Una línea, **Agregar IVA**, Q100 | Vista previa **100.00 + 12.00 = 112.00**. Guardado y reabierto: conserva «IVA agregado a la tarifa». |
| 3 | **Factura mixta** (A: Q100 incluido, B: Q100 agregado) | Vista previa: A 89.29 + 10.71 = 100.00; B 100.00 + 12.00 = 112.00; **subtotal 189.29, IVA 22.71, TOTAL 212.00**. El detalle guardado muestra el tratamiento de cada viaje y el resumen dice **«Mixto: varía por viaje»**; en la base el encabezado `precio_incluye_iva` es `NULL` y cada línea guarda el suyo. |
| 4 | Invalidación de la vista previa | «Guardar borrador» queda deshabilitado y aparece el aviso «vuelve a previsualizar» al cambiar el tratamiento de una línea, un monto, **quitar** un viaje o **agregar** un viaje. Volver exactamente a la selección previsualizada la vuelve a validar (misma huella). |
| 5 | Edición del borrador mixto | Los selectores cargan lo almacenado (A «IVA incluido», B «Agregar IVA»). Al cambiar solo una línea y guardar, solo esa línea cambia fiscalmente, los totales se recalculan (200.00 + 24.00 = 224.00) y las descripciones/ruta/fecha congeladas no cambian; devolverla a «IVA incluido» restituye 189.29 / 22.71 / 212.00 y el encabezado vuelve a `NULL`. |
| 6 | Emitida no editable | Tras emitir (número y fecha de prueba), el detalle ya no ofrece «Editar borrador», ni campos de monto/viajes, ni selectores de IVA; solo «Registrar pago» y «Anular factura». Un `PATCH` directo a la API responde **409** y nada cambia en la base. |
| 7 | Cancelar borrador | Queda **Anulada**, se borran sus vínculos, el contador de «Viajes pendientes» sube y el viaje vuelve a aparecer en «Viajes por facturar» y se puede seleccionar de nuevo. |
| 8 | «Viajes por facturar» | Columnas ruta, origen → destino, unidad, piloto, tarifa, estado y fecha de cierre correctas; el filtro de ruta/destino encuentra tanto el código como el nombre del destino de catálogo (sin destino congelado); paginación 50 + 14 de 64 con la selección conservada entre páginas; seleccionar viajes de otro cliente se bloquea con explicación. **No aparecen** los viajes sin tarifa (NULL o 0), en ruta/programados, en USD ni sin ruta/destino. |
| 9 | UX / diseño | La columna «Tratamiento IVA (12 %)» se entiende; «IVA incluido» aparece preseleccionado al agregar un viaje y «Agregar IVA» se elige sin ambigüedad. Sin columnas cortadas ni textos superpuestos y sin scroll horizontal a 1440 px (ni en las tablas del formulario y de la vista previa a 1024 px; allí solo «Unidad» baja a dos líneas). Antes de la vista previa el pie dice «Suma de tarifas (el total con IVA se calcula en la vista previa)», no un «Total» engañoso. |

**Defecto encontrado y corregido** (único cambio de código tras la prueba): al **editar** un borrador el pie decía «el total con IVA se calcula en la vista previa», pero la edición no tiene vista previa. Ahora dice «el total con IVA se recalcula al guardar» (`etiquetaSumaTarifas`, con prueba unitaria). Se repitió el caso en el navegador.

**Observaciones sin cambios** (preexistentes de FACT-1 o menores): en la edición las columnas «Unidad» y «Tarifa comercial» muestran «—» (el formulario de edición no las recibe); el botón de confirmación al cancelar un borrador sigue diciendo «Confirmar anulación» (el título de la confirmación sí dice «cancelar borrador»); los endpoints de notificaciones del layout fallan en esta base mínima de desarrollo porque faltan tablas de otros módulos (`rrhh_recordatorios`, `flota_vehiculo_documentos`, `flota_viajes.plan_id`), sin relación con Facturación.

## 16. Columna «Unidad» de «Viajes pendientes» (viajes tercerizados)

**Datos reales** (`tms_planes_viaje`): `tipo_viaje` (`'Propio'` | `'Tercerizado'`, `DEFAULT 'Propio'`) identifica el viaje tercerizado; en ellos `unidad_id` queda **NULL a propósito** y la placa externa se guarda como texto en **`unidad_externa_placa`** (`VARCHAR(40)`, mayúsculas, opcional). No existe una tabla ni un snapshot aparte: esa columna *es* el snapshot. (`tc_externo_placa` es la caja/remolque, otro dato; `unidad_externa_descripcion` y `transportista_externo` no se muestran.)

**Regla** (`src/lib/facturacion/unidad-viaje.ts`, la misma que usan Programación y su reporte: `esTercerizado ? unidad_externa_placa : placa`):
1. Viaje **tercerizado** → su placa externa; si no la capturaron (NULL, vacía o en blanco), **«Tercerizado»**.
2. Viaje **propio** → la placa de su unidad interna (`tms_unidades.placa`); sin unidad, `—`.

No es «placa interna primero» porque en un tercerizado `unidad_id` es NULL por diseño; si apareciera un `unidad_id` huérfano, Programación lo ignora y Facturación debe decir lo mismo. La respuesta sigue llamándose `placa` (compatibilidad) con el valor ya resuelto. Además, la unión con `tms_unidades` ahora filtra por la **misma empresa** del viaje (antes no lo hacía). No cambia la facturabilidad, el IVA, los filtros ni los snapshots.

## 17. PDF DEMO de la factura (NO FISCAL)

Representación visual para que Contabilidad valide el **formato** antes de integrar FEL. **No es un documento fiscal**: no hay FEL, INFILE, SAT, XML ni UUID, no se usan credenciales externas y no escribe nada en la base (solo lee).

**Dónde**: botón **«Ver PDF demo»** en el detalle de una factura (Borrador y Emitida; no en Anuladas) → `GET /api/empresas/[slug]/facturacion/facturas/[id]/pdf-demo` (se abre inline en otra pestaña). Permiso: el mismo `requireTenantFacturacion(slug, "ver")`; la empresa sale de la sesión/guard, nunca del cliente, y `obtenerFactura` filtra por `empresa_id` (la factura de otra empresa → **404**).

**Referencia visual**: la factura que la empresa usa hoy (PDF «FRAIJANES 4855», impreso desde el sistema actual). El PDF demo la reproduce como una evolución, no como una plantilla genérica: marco redondeado, emisor a la izquierda (razón social, logo, dirección, teléfono, NIT), bloque «DOCUMENTO TRIBUTARIO ELECTRÓNICO» a la derecha (tipo, SERIE, NO., NÚMERO DE AUTORIZACIÓN) y fecha en tres casillas **DÍA / MES / AÑO**; bloque de cliente (NOMBRE, DIRECCIÓN, NIT, CONDICIONES, No. INTERNO, CÓDIGO CLIENTE); tabla **CÓDIGO | DESCRIPCIÓN | TOTAL** con un área amplia de detalle; **TOTAL EN LETRAS**, leyenda tributaria, **OBSERVACIONES** y **TOTAL Q.**; recuadro reservado y, al pie, número de autorización, certificador, NIT del certificador y correlativo interno.

**Logo OBLIGATORIO de la empresa emisora**: la factura siempre lleva el logo de la empresa del tenant (`empresas.logo_url` de la empresa que devuelve `requireTenantFacturacion`; nunca una ruta enviada por el cliente ni el logo de otra empresa). Antes de generar se resuelve el archivo con el resolvedor seguro de `uploads` (`absPathFromRelative`), se valida que exista, sea un archivo no vacío (máx. 5 MB) y que PDFKit (PNG o JPEG) pueda leerlo y decodificarlo. **Si falta, no existe, es ilegible o no soportado (SVG, GIF…), o su ruta apunta al directorio de otra empresa (`empresas/<otroId>/…`) → 409 «Esta empresa no tiene un logo válido configurado para la factura.» y no se genera el PDF; ya no hay respaldo silencioso a solo texto.** El orden de los errores no revela el estado del logo: una factura inexistente o de otra empresa sigue siendo 404, y una Anulada o sin snapshot, su 409 propio. El logo se dibuja a la izquierda del encabezado con `fit` (proporcional, nunca se estira): un logo cuadrado o vertical en un recuadro de 132×100 pt con los datos del emisor a su derecha; uno apaisado (relación ≥ 2.2) a todo el ancho del bloque (288×58 pt) con los datos debajo. Nota operativa: `logo_url` es una ruta relativa a `uploads` (igual que en la boleta de vacaciones); los logos de marca de `public/brands/` que usan las cotizaciones **no** se usan aquí. Cada empresa debe tener su `logo_url` configurado para poder generar el PDF demo.

**Base e IVA no se imprimen** (la factura real no los muestra). Se siguen calculando, guardando y **validando** (por línea y en los totales); solo cambia la representación. La descripción es la congelada, impresa como en la factura actual: «SERVICIO DE TRANSPORTE - ORIGEN A DESTINO - FECHA» (el «→» sale como «A»; «—» sigue significando «desconocido»).

**Qué es demo y qué no**: franja superior «DEMO — DOCUMENTO NO FISCAL», marca de agua «DEMO - NO FISCAL» y pie con la leyenda + «Página i de n» + fecha de generación (Guatemala) en **todas** las páginas. Todo lo que en la factura real viene de la certificación (SERIE, NO., NÚMERO DE AUTORIZACIÓN, CERTIFICADOR, NIT del certificador y el recuadro del QR) dice **«PENDIENTE FEL»**: no se simula ningún dato. El «tipo de documento» de la factura real (factura cambiaria u otro) **no está definido** en la plataforma; el demo solo dice «FACTURA DEMO».

**Varias páginas**: cada página repite marco, encabezado, cliente, encabezado de la tabla, recuadro FEL y pie; el total en letras, la leyenda, las observaciones y el TOTAL aparecen solo en la **última** (las demás dicen «Continúa en la página n de N»).

**Librería reutilizada**: PDFKit, igual que el resto del proyecto (no hay un segundo sistema de PDF). Se reutiliza el patrón de ruta de `tms/gastos/[id]/pdf`, el logo vía `empresa.logoUrl` + `absPathFromRelative` (ahora obligatorio, ver arriba), `formatearMonto` y `ahoraLocal/formatearTimestampVisible`. El marco se dibuja con primitivas de PDFKit (la tabla ya no usa `dibujarTablaEnDoc`, porque el formato real no es una tabla con cuadrícula). Código: `src/lib/facturacion/factura-demo-pdf.ts`; total en letras: `src/lib/facturacion/numero-letras.ts` (determinista, sin servicios externos: «UN MIL DOSCIENTOS TREINTA Y NUEVE CON 44/100»).

**Datos**: lo **congelado** (`obtenerFactura`): cliente (nombre/NIT/dirección del snapshot), viaje (código, descripción) y por línea `precio_incluye_iva`, `porcentaje_iva`, base, IVA y total. Nunca se reconstruye con datos vivos. El IVA es **por línea** tal como se congeló (incluido, agregado o mixto); no se recalcula globalmente. Suma de bases = subtotal, suma de IVA = IVA de la factura y suma de totales = total de la factura (centavos).

**Casos que NO generan PDF (409, sin inventar importes)**: factura Anulada; sin viajes; factura anterior al desglose de IVA por línea (sin snapshot); línea con base + IVA ≠ total; totales del encabezado ≠ suma de líneas.

**Campos del formato real: qué existe y qué no** (discovery)

| Campo | ¿Existe en la plataforma? | En el PDF demo |
|---|---|---|
| Razón social, NIT, dirección del emisor | Sí, `fact_empresa_perfil` (`razon_social_factura`, `nit_emisor`, `direccion_fiscal`, `nombre_comercial`) | se usan; si faltan, «pendiente de definir» (la razón social cae al nombre de la empresa) |
| Logo | Sí, `empresas.logo_url` (ruta relativa a `uploads`) | **obligatorio**: se valida y, si falta o no es legible, 409 sin PDF |
| **Teléfono del emisor** | **No** (`empresas` no lo tiene y el cuestionario no lo pregunta; `telefono_cxc` es del contacto de cobro del cliente) | «Teléfono: pendiente de definir» |
| Cliente: nombre, NIT, dirección | Sí, snapshot congelado en la factura | se usan |
| **Código de cliente** | Sí, `clientes.codigo` (opcional, **no congelado**) | se lee con filtro de `empresa_id`; sin código, «Pendiente de definir». Es el único dato vivo que se lee |
| **Condiciones** | **No en la factura.** Existen `dias_credito` (perfil del cliente) y `credito_default_dias` (perfil de la empresa), pero son datos vivos y la regla «contado / crédito N días» no está definida | «Pendiente de definir» |
| **No. interno / correlativo interno** | Sí: `numero_factura` (Emitida) o el id del borrador | «BORRADOR #id (sin número)» o el número de la factura |
| **Leyenda tributaria** (p. ej. «sujeto a pagos trimestrales») | **No** (el cuestionario solo tiene «régimen», sin texto de leyenda) | «Leyenda tributaria: pendiente de definir» |
| **Observaciones** | Sí, `fact_facturas.observaciones` | se imprimen; sin texto, «—» (si es muy larga se recorta con «…» dentro de su recuadro) |
| Serie, número, autorización, certificador, NIT del certificador, QR | No (FEL no está integrado) | «PENDIENTE FEL» |

**Para una fase posterior (sin SQL todavía)**: teléfono del emisor; `condiciones` (y su snapshot) en la factura; texto de leyenda tributaria por empresa/régimen; congelar también el código de cliente; tipo de documento (factura / factura cambiaria); y las reglas de FEL.

**Muestra**: `docs/ejemplos/FACTURA-DEMO-EJEMPLO.pdf` (datos sintéticos, factura mixta de tres viajes, con el logo sintético `docs/ejemplos/logo-demo-empresa.png`: no es la marca de ninguna empresa).

**Verificación**: pruebas unitarias del generador, del total en letras y de la ruta (tabla Código/Descripción/Total, Base e IVA ausentes, total en letras, espacios FEL sin datos simulados, marca NO FISCAL, factura mixta con cálculos internos intactos, varias líneas, observaciones, datos faltantes, multipágina con encabezado y pie en cada página, multiempresa, solo lectura, **logo obligatorio**: válido PNG/JPG, ausente, inexistente, ilegible o no soportado → 409, el logo de una empresa nunca aparece en la factura de otra y se dibuja con `fit`); pruebas opt-in contra MariaDB real (lo congelado no cambia si cambian cliente/ruta/tarifa vivos, multiempresa 404, Emitida, Anulada/legacy 409, código de cliente filtrado por empresa, solo lectura); en el navegador (dev, datos sintéticos) se comprobó que el enlace aparece en el borrador y que el endpoint responde `application/pdf`, `Cache-Control: private, no-store`, y 400/404 para id inválido, inexistente o empresa distinta (comprobación hecha antes de que el logo fuera obligatorio). El **aspecto visual** se revisó sobre renders del PDF de muestra (una y cuatro páginas) comparados con la factura de referencia.
