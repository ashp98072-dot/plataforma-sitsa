# RRHH · Vacaciones — Reparación administrada de series de períodos inconsistentes

Nivel: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (base de datos simulada en memoria). No probado en navegador ni contra la base real. **No** aprobado para producción.
Sin SQL, sin migraciones, sin limpieza de datos, sin tocar producción.

## 1. Problema
El rebase de #421 (cambio de `empleados.fecha_alta`) retorna de inmediato cuando `fechaAnterior === fechaNueva`. Los colaboradores cuya serie de
`saldos_vacaciones` se creó **antes** de #421 con otra base (o quedó traslapada/duplicada) pero cuya `fecha_alta` actual ya es la correcta no se
pueden arreglar guardando otra vez la misma fecha. La sincronización (#417) los **congela** («Sincronización congelada para este colaborador…»).

Ejemplo (datos sintéticos): `fecha_alta = 13/04/2023`, pero la BD tiene `01/06/2023→31/05/2024`, `31/05/2024→30/05/2025`, `13/04/2025→12/04/2026`,
`13/04/2026→12/04/2027` (bases distintas y traslapes). Debe ser `13/04/2023→12/04/2024`, `13/04/2024→12/04/2025`, `13/04/2025→12/04/2026`, `13/04/2026→12/04/2027`.

No es un caso de una persona: la herramienta es general (sin IDs, nombres ni empresas fijos).

## 2. Regla
Los períodos se derivan **siempre** de `empleados.fecha_alta`. La serie guardada **no** es fuente de verdad. Las fuentes válidas son: `fecha_alta`,
las incidencias `Vacaciones` / `A cuenta de Vacaciones` y los días realmente consumidos según el detalle FIFO verificable.

## 3. Diseño
| Pieza | Archivo | Qué hace |
|---|---|---|
| Diagnóstico (puro) | `src/lib/rrhh/vacaciones-reparacion.ts` → `diagnosticarSerie` | Decide si la serie guardada **no coincide estructuralmente** con `fecha_alta`. Reutiliza `planificarSincronizacion` (congelación #417) y suma la comprobación fila por fila contra `periodoLaboral(fecha_alta, anio_laboral)`. |
| Plan (puro) | `planificarReparacion` | Si requiere reparación, reutiliza el **motor del rebase** (`planificarReconstruccion`, extraído de `planificarRebase` sin cambiar su comportamiento) con la fecha de alta **actual** como única base. |
| Ejecutor compartido | `vacaciones-rebase-db.ts` → `reemplazarSerieEnConexion` | Pasos de escritura + invariantes + auditoría, extraídos del rebase y compartidos. El rebase de `fecha_alta` conserva su semántica (`fechaAnterior === fechaNueva` sigue siendo no-op). |
| Capa BD | `src/lib/rrhh/vacaciones-reparacion-db.ts` | `previsualizarReparacion` (solo lectura), `repararSerieVacaciones` (transacción propia) / `repararSerieVacacionesEnConexion`, `listarPendientesReparacion` (solo lectura). |
| API | ver §5 | Preview, reparación y pendientes. |
| UI | `reparacion-serie-vacaciones.tsx`, `pendientes-reparacion-vacaciones.tsx` | «Reparar períodos» (modal con vista previa + «Confirmar reparación») y el indicador de pendientes. |

Se eligió una **función separada** (`repararSerieVacacionesEnConexion`) y no una opción `forzarMismaFecha` en el rebase, para que el cambio de
`fecha_alta` y la reparación no se puedan mezclar por accidente.

### 3.1 Qué se considera «requiere reparación»
Hay saldos (sin saldos nunca se requiere reparación) y ocurre **cualquiera** de:
- un período cuyo inicio/fin no es `periodoLaboral(fecha_alta, anio_laboral)` (otra fecha base / mezcla de series) → `PERIODO_FUERA_DE_BASE`;
- un `anio_laboral` fuera de la serie esperada (`< 1` o `> años completos + 1`) → `ANIO_FUERA_DE_SERIE`;
- un año laboral duplicado → `ANIO_LABORAL_DUPLICADO`;
- **períodos faltantes o intercalados**: deben existir los años `1..N` (N = año vigente a hoy); cada hueco → `PERIODO_FALTANTE` indicando qué años faltan. No se exigen períodos futuros, ni el año en curso mientras todavía no acumuló días (p. ej. aniversario en domingo, que la sincronización tampoco crea);
- un saldo sin año laboral que se superpone con la serie esperada o tiene consumo → `ANIO_LABORAL_NULO_EN_SERIE`;
- un traslape **real** (más de un día) → `TRASLAPE_REAL` (el borde de un día es normal);
- la sincronización normal ya lo congela (#417) → `ESTRUCTURA_CONGELADA`;
- **saldos pero sin fecha de alta** (null, vacía) → `FECHA_ALTA_AUSENTE`: la serie no se puede validar sin base, sea corrupta o aparentemente correcta; sale en pendientes y la reparación queda **bloqueada** («RRHH debe completar o corregir la fecha de contratación primero»). Esta herramienta no inventa ni corrige la fecha;
- fecha de alta sospechosa (<1980/inválida) o futura **con** saldos → `FECHA_ALTA_SOSPECHOSA` / `FECHA_ALTA_FUTURA` (la reparación queda **bloqueada**).

**No** es un error: tener períodos `Vencido`s ni un saldo sin año laboral fuera de la serie y sin consumo. Un colaborador **sin saldos** no tiene nada que diagnosticar (tenga o no fecha de alta).

### 3.2 Reparación
Todo en **una transacción** (`BEGIN … COMMIT`, cualquier error ⇒ `ROLLBACK`):
1. Bloquea `empleados` (`FOR UPDATE`) y lee la `fecha_alta` **actual** (jamás del cliente).
2. Vuelve a cargar y **vuelve a diagnosticar y planificar** bajo bloqueo (no confía en el preview).
3. Si la serie ya es correcta ⇒ no escribe nada (`aplicado:false`).
4. Hard blockers (sin escribir, sin corregir, sin reasignar): `DETALLE_AJENO`, `DETALLE_SALDO_AJENO` (otro empleado, otra empresa **o saldo inexistente**), vacación anterior a `fecha_alta`, déficit al reconstruir, `fecha_alta` inválida/sospechosa/futura.
5. Exige que la **huella** enviada coincida con la que se previsualizó (fecha de alta, serie actual, serie propuesta, líneas FIFO, consumo, bloqueos). Si algo cambió ⇒ aborta (`409 CAMBIO_DESDE_PREVIEW`) y la UI recarga la vista previa.
6. Reemplaza **solo** los `saldos_vacaciones` y el `detalle_consumo_vacaciones` de ese colaborador/empresa; reaplica cronológicamente los consumos con las reglas del registro histórico (FIFO por año laboral, vencimiento y tope).
7. Verifica invariantes y audita `vacaciones_reparacion_serie`.

**No modifica:** `empleados.fecha_alta`, incidencias, `vacaciones`, evidencias, otros colaboradores ni otras empresas.

### 3.2b La serie reconstruida es el HISTORIAL COMPLETO desde `fecha_alta` (cobertura explícita)
La reparación **no** parte de los períodos hoy utilizables: construye los años `1..N` completos (N = año laboral vigente a hoy) con `periodoLaboral`
(aniversario calendario: inicio N = alta + (N−1) años; fin N = alta + N años − 1 día; los domingos no desplazan fechas), 15 días por año completo y, para el año
en curso, `calcularDiasAcumuladosProporcional` (la fórmula existente, que excluye domingos) dentro de `avanzarPeriodos`. Los años ya vencidos permanecen en el historial
con su estado y saldo según las reglas existentes (vencimiento, tope de 30, FIFO). No existe ni se agregó ninguna regla o motor nuevo; el ajuste solo añadió pruebas
(`vacaciones-reparacion-serie-historica.test.ts`) que fijan este comportamiento, con verificación independiente de la exclusión de domingos y mutaciones que las hacen fallar.

### 3.3 Invariantes (cualquier diferencia ⇒ ROLLBACK)
Sin traslapes · un solo período por `anio_laboral` · todos derivados de la misma `fecha_alta` · total consumido antes = después · total por incidencia antes = después ·
ningún consumo reaparece como disponible · saldo utilizable ≤ 30 · sin consumo que no pertenezca a sus vacaciones · sin líneas duplicadas ·
**contenido** (no solo conteos) de incidencias, `vacaciones`, evidencias y `fecha_alta` idéntico antes/después · conteos de saldos de otros colaboradores y de otras empresas sin cambio.
(El contenido idéntico también se verifica ahora en el rebase de `fecha_alta`, porque comparten el ejecutor.)

### 3.4 Auditoría `vacaciones_reparacion_serie`
`empresaId`, `empleadoId`, `fechaAlta`, `usuario`, `fecha`, `periodosAnteriores`, `periodosNuevos`, `defectos`, `traslapesAnteriores`, `aniosDuplicados`,
`consumidoPreservado`, `saldoAntes`, `saldoDespues`, `lineasFifoAnteriores`, `lineasFifoReconstruidas`.

## 4. Cómo se identifica a los afectados (sin reparar masivamente)
`GET …/rrhh/vacaciones/reparacion/pendientes` (solo lectura) lista a los colaboradores de la empresa que requieren reparación y sus motivos; la pantalla
RRHH → Vacaciones muestra un indicador «N colaborador(es) requieren reparar sus períodos» con «Revisar» (selecciona al colaborador). **No hay reparación masiva ni automática**:
se repara uno por uno, con vista previa y confirmación explícita.

## 5. API
Permiso en los tres: **RRHH · Vacaciones · editar**. La empresa, el usuario y el colaborador salen del slug/sesión; el cuerpo/consulta del cliente nunca aporta `empresa_id`, fecha de alta ni usuario.
| Método y ruta | Descripción |
|---|---|
| `GET /api/empresas/[slug]/empleados/[id]/vacaciones/reparacion/preview` | **Solo lectura.** `requiereReparacion`, `puedeReparar`, `fechaAltaActual`, `periodosActuales`, `periodosPropuestos`, `traslapesActuales`, `aniosLaboralesDuplicados`, `periodosFueraDeBase`, `defectos`, `vacacionesRegistradas`, `consumidoPreservado`, `saldoAntes`, `saldoDespues`, `lineasFifoAntes/Despues`, `bloqueos`, `advertencias`, `huella`. |
| `POST /api/empresas/[slug]/empleados/[id]/vacaciones/reparacion` | Cuerpo: `{ huella }`. `200 {aplicado}`; `409 REPARACION_BLOQUEADA`; `409 CAMBIO_DESDE_PREVIEW`; `404`; `400`; `500` genérico. |
| `GET /api/empresas/[slug]/rrhh/vacaciones/reparacion/pendientes` | **Solo lectura.** `{ total, empleados: [{ empleadoId, codigo, nombre, estado, fechaAlta, motivos }] }`. |

## 6. Pruebas (sintéticas; sin DPI, nombres ni IDs reales)
- `vacaciones-reparacion.test.ts` (41, BD en memoria transaccional): diagnóstico puro; caso del ticket sin y con consumo (A/B/C); duplicada (D), traslapada (E), años incorrectos (F), desplazada sin traslape; `DETALLE_AJENO` (G); `DETALLE_SALDO_AJENO` incl. otra empresa y saldo inexistente (H); vacación anterior a `fecha_alta` (I); déficit (J); fecha futura/sospechosa; otro empleado y otra empresa intactos (K/L); evidencias, incidencias y `vacaciones` idénticas (M/N); sincronización posterior sin congelarse (O); nueva vacación después (P); eliminar después restaura al período de la serie nueva (Q); serie ya correcta ⇒ sin escrituras (R); huella distinta, cambio entre preview y POST, bloqueo sobrevenido; rollback ante fallo en cada paso; transacción única con `FOR UPDATE` antes de escribir; auditoría; listado de pendientes de solo lectura; **sin fecha de alta** (con saldos corruptos o correctos ⇒ requiere reparación, bloqueada, en pendientes, POST bloquea sin escribir; sin saldos ⇒ no requiere); **períodos faltantes** (años 1,3,4 y 2,3,4; serie completa sin falsos positivos; futuros y año en curso con 0 días no se exigen).
- Rutas: preview (3), POST (6), pendientes (3).
- UI (`reparacion-serie-vacaciones.test.ts`, 7): la acción solo aparece para RRHH con permiso y serie congelada; nada se ejecuta al renderizar; texto aprobado; confirmar deshabilitado con bloqueos; solo el botón confirmar hace POST y solo envía la huella; cableado de la página.
- Verificado por mutación: quitar el chequeo de huella o los bloqueos de detalle hace fallar las pruebas.
- Las 32 pruebas del rebase de #421 y su cableado siguen verdes.

## 7. Riesgos y límites
- La huella incluye la serie propuesta, que depende del día (acumulación proporcional del período en curso): si la vista previa se confirma otro día, el servidor aborta y hay que volver a revisarla. Es intencional.
- Una serie con fecha de alta equivocada **no** se repara con esta herramienta: primero hay que corregir la ficha (que dispara el rebase de #421).
- Cuando no hay consumo ni bloqueos, la reparación elimina también saldos sin año laboral fuera de la serie (se avisa en la vista previa).
- La reparación recalcula el saldo con las reglas vigentes (vencimiento, tope de 30): el «saldo después» puede diferir del actual y se muestra antes de confirmar.
- Probado solo con BD en memoria: falta una prueba manual con datos reales de un colaborador afectado **antes** de aprobar para producción (ver §8).

## 8. Pendiente
- Revisión independiente y prueba manual en un entorno de pruebas con una copia de un caso real (solo vista previa primero).
- No se ejecutó ninguna reparación sobre datos reales ni SQL.
