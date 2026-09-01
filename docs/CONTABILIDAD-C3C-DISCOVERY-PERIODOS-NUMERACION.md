# C3C — discovery: ejercicios, períodos, numeración, apertura/cierre/reapertura

Fecha: 2026-09-01. Estado: **investigación documental únicamente** — cero
código, cero SQL, cero migraciones, cero producción. Continúa
`docs/CONTABILIDAD-C3B-CONSULTA.md` ("Siguiente entrega" ahí: aprobar reglas
de ejercicio/períodos → numeración → apertura/cierre/reapertura → migración
manual + bloqueo concurrente → reversos).

**Independiente de Milenium**: este documento NO depende de ninguna respuesta
pendiente sobre `TIPO_CTA`/`MULTIP_CTA`/`CTACOM_CTA`
(`docs/MILENIUM-CONTABILIDAD-HOMOLOGACION-CATALOGO.md`, bloqueado en espera
del responsable contable). Períodos/numeración/cierre son un problema del
**libro contable propio de la plataforma** (`cont_asientos` y relacionadas),
no de la importación de Milenium — se puede avanzar en paralelo.

## 1. Estado actual del modelo (`sql/schema.sql`)

### `cont_entidades`
```sql
id INT PK, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL,
nombre VARCHAR(200) NOT NULL, activa TINYINT(1) DEFAULT 1,
creado_en, actualizado_en
UNIQUE (empresa_id, codigo)
UNIQUE (empresa_id, id)              -- permite el patrón FK compuesta (empresa_id, entidad_id) del resto de tablas
FK (empresa_id) -> empresas(id) ON DELETE RESTRICT
```

### `cont_entidad_usuarios`
```sql
empresa_id, entidad_id, usuario_id INT NOT NULL (PK compuesta)
activo TINYINT(1), puede_editar TINYINT(1), actualizado_en
FK (empresa_id, entidad_id) -> cont_entidades(empresa_id, id) ON DELETE RESTRICT
FK (usuario_id) -> usuarios(id) ON DELETE RESTRICT
```

### `cont_cuentas`
```sql
id INT PK, empresa_id INT NOT NULL, entidad_id INT NULL,
codigo VARCHAR(40), nombre VARCHAR(200), tipo VARCHAR(40), nivel INT DEFAULT 1,
activa TINYINT(1) DEFAULT 1
UNIQUE (empresa_id, entidad_id, codigo)
UNIQUE (empresa_id, entidad_id, id)   -- ancla para FKs compuestas del detalle
FK (empresa_id, entidad_id) -> cont_entidades(empresa_id, id) ON DELETE RESTRICT
FK (empresa_id) -> empresas(id) ON DELETE CASCADE
```
`entidad_id` nullable a nivel de columna por compatibilidad con filas
previas a C2 — toda escritura nueva la exige vía el ámbito autorizado (ver
sección 3). `tipo` es `VARCHAR(40)`, sin `ENUM` nativo; el conjunto cerrado
(`Activo/Pasivo/Capital/Ingreso/Gasto`) vive en Zod
(`src/lib/contabilidad/registros.ts:22`). No hay columna de naturaleza
deudora/acreedora ni de cuenta padre/agrupación (ver
`docs/MILENIUM-CONTABILIDAD-HOMOLOGACION-CATALOGO.md` sección 2 — esa
ausencia es del catálogo de cuentas, no de este ticket, se cita solo para no
repetir la investigación).

### `cont_asientos` — LA PARTIDA/ASIENTO
```sql
id INT PK, empresa_id INT NOT NULL, entidad_id INT NULL,
fecha DATE NOT NULL, numero VARCHAR(40) NOT NULL,
glosa VARCHAR(500) NULL, estado VARCHAR(20) DEFAULT 'Borrador',
creado_por VARCHAR(100) NULL, creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
UNIQUE (empresa_id, entidad_id, numero)   -- ÚNICA restricción de numeración hoy
UNIQUE (empresa_id, entidad_id, id)
FK (empresa_id, entidad_id) -> cont_entidades(empresa_id, id) ON DELETE RESTRICT
FK (empresa_id) -> empresas(id) ON DELETE CASCADE
```
**No hay ninguna columna de ejercicio ni de período.** `fecha` es la única
referencia temporal. `estado` acepta cualquier `VARCHAR(20)`; el código
SIEMPRE inserta `'Registrado'` (ver sección 2) — el DEFAULT `'Borrador'`
del schema nunca se usa en la práctica actual (ver sección 12, deuda #1).

### `cont_asiento_detalle` — LAS LÍNEAS
```sql
id INT PK, empresa_id INT NULL, entidad_id INT NULL,
asiento_id INT NOT NULL, cuenta_id INT NOT NULL,
debe DECIMAL(14,2) DEFAULT 0, haber DECIMAL(14,2) DEFAULT 0
FK (empresa_id, entidad_id, asiento_id) -> cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT
FK (empresa_id, entidad_id, cuenta_id)  -> cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT
FK (asiento_id) -> cont_asientos(id) ON DELETE CASCADE      -- FK simple redundante, ver sección 12 deuda #2
FK (cuenta_id)  -> cont_cuentas(id) ON DELETE RESTRICT       -- FK simple redundante
```
Sin `UNIQUE`, sin PK de negocio — cualquier número de líneas por asiento
(validado en aplicación: 2 a 500).

### `cont_cxc` / `cont_cxp`
Mismo patrón `empresa_id, entidad_id NULL, ... estado VARCHAR`. Sin fecha de
período/ejercicio; sin relación con `cont_asientos` (viven aparte, sin
puente contable formal — confirmado, ninguna FK entre CxC/CxP y asientos).

### No existe ninguna tabla `cont_periodos`, `cont_ejercicios`, `cont_correlativos`, `cont_reversos` ni equivalente.
Confirmado por `grep -in "periodo|ejercicio|correlativo|secuencia|reverso|anulad|cierre" sql/schema.sql` — cero resultados dentro de `cont_*`. El único hallazgo son referencias a `rrhh_planilla_periodos` (RRHH, no reutilizable — ver sección 5) y comentarios de cierre operativo de TMS (`tms_planes_viaje.estado`, no contable).

## 2. Numeración actual de partidas — pregunta 1 respondida

**Manual, tipeada por el usuario, sin generación de servidor.**

- `src/lib/contabilidad/asientos.ts:20` — `asientoSchema.numero: z.string().trim().min(1).max(40)` — viene del `body` del POST tal cual.
- `src/lib/contabilidad/captura.ts:29` — `prepararCaptura(numero: string, ...)` — la UI también exige que el usuario lo escriba; solo valida longitud/no vacío, cero generación automática.
- El `INSERT INTO cont_asientos (...) VALUES (..., 'Registrado', ...)` (`asientos.ts:56-59`) usa `d.numero` literal — no hay `MAX(numero)+1`, secuencia, ni contador.
- Único mecanismo que evita colisión: la restricción `UNIQUE (empresa_id, entidad_id, numero)` a nivel de MySQL/MariaDB — si dos usuarios escriben el mismo número para la misma entidad, MySQL rechaza el segundo `INSERT` con `ER_DUP_ENTRY`, y la ruta API (`src/app/api/empresas/[slug]/contabilidad/asientos/route.ts:41`) lo traduce a `409 "Número duplicado..."` — nunca un 500 crudo. Hay test dedicado que confirma esto (`asientos.test.ts:67`, "preserva el error de número duplicado y revierte").
- Ámbito de unicidad actual: **`(empresa_id, entidad_id, numero)`** — nunca por año/período. Dos asientos con el mismo `numero` en fechas de años distintos, dentro de la MISMA entidad, colisionan igual que si fueran del mismo día. No hay reinicio de numeración por ejercicio.

## 3. Concurrencia actual — pregunta 2 respondida

`bloquearAmbito()` (`src/lib/contabilidad/ambito.ts:19`) hace, dentro de la
MISMA transacción de `registrarAsiento`/`consultarLibro`/`consultarPartida`:
```sql
SELECT id FROM empresas WHERE id = ? FOR UPDATE;
SELECT id, activa FROM cont_entidades WHERE empresa_id = ? AND id = ? FOR UPDATE;
```
Esto bloquea la fila de `cont_entidades` de la entidad seleccionada —
**efecto real: dos peticiones concurrentes que escriben en la MISMA
entidad quedan serializadas** (la segunda espera a que la primera haga
`COMMIT`/`ROLLBACK` antes de poder tomar su propio lock). No es un lock
explícito "de numeración" ni "de período" — es un lock de entidad completa,
reusado también para lectura (`consultarLibro`/`consultarPartida` toman el
mismo lock, aunque solo lean — ver deuda #3, sección 12).

**Riesgos reales identificados:**
1. **Duplicado de número**: mitigado en dos capas — el lock de entidad ya serializa la mayoría de los casos, y el `UNIQUE` de MySQL es la red de seguridad final aunque el lock fallara o no se tomara. Riesgo residual: **ninguno de integridad** (la base de datos nunca permite el duplicado), pero SÍ hay riesgo de **experiencia de usuario** — dos personas pueden escribir el mismo número "obvio" (p. ej. el siguiente correlativo mental) y una de las dos recibe un 409 y debe reintentar con otro número, sin ninguna sugerión de cuál usar.
2. **Insertar mientras otro cierra el período**: HOY no existe "cerrar período" como operación, así que este riesgo no existe todavía en código — es exactamente lo que C3C debe prevenir por diseño antes de escribir el cierre.
3. **Cerrar mientras hay una creación concurrente**: mismo caso — no implementado. El lock de entidad YA es el mecanismo natural para extender esto: una futura operación "cerrar período" que tome el mismo `SELECT ... FOR UPDATE` sobre la entidad (o sobre una fila de período dedicada) bloquearía cualquier `registrarAsiento` concurrente hasta que el cierre termine, y viceversa.
4. **Reapertura pisando operaciones simultáneas**: mismo razonamiento — el lock de entidad (o de período, si se separa) es el candado natural a reusar; falta decidir el modelo de datos exacto (ver sección 6/7).

## 4. Qué cambiaría en C3B (consulta/listado) — pregunta 3 respondida

`ambito.ts` (`consultas.asientos`, línea 33): el listado ordena
`fecha DESC, id DESC LIMIT 100`, sin filtro de período ni de estado
abierto/cerrado. Para incorporar C3C sin romper C3B:
- **Filtro por período/ejercicio**: agregar `WHERE ... AND periodo_id = ?` (o `AND fecha BETWEEN periodo.fecha_inicio AND periodo.fecha_fin`, según el modelo elegido — sección 6) al `SELECT` de `consultas.asientos`, opcional (sin filtro = comportamiento actual).
- **Estado abierto/cerrado**: si se agrega un `estado`/`cerrado` a nivel de partida derivado del período (no solo de la partida misma), el listado y el detalle (`consultarPartida`, `consulta-partida.ts:23`) tendrían que exponerlo — ninguno de los dos lo hace hoy.
- **Información de cierre**: nueva columna/join a mostrar (fecha de cierre, usuario, período) — no existe ningún campo así hoy en `cont_asientos`.
- El límite fijo `LIMIT 100` (sin paginación real) es una limitación PREEXISTENTE, no introducida por C3C — se menciona porque un filtro por período probablemente irá acompañado de una necesidad real de paginación, pero es una decisión aparte, no bloqueante para C3C.

## 5. Migraciones revisadas — punto 4

| Archivo | Fase | Estado según documentación |
| --- | --- | --- |
| `sql/migrate-2026-08-contabilidad-entidades.sql` | Fase 2B (crea `cont_entidades`/`cont_entidad_usuarios`) | **Aplicada** (confirmado en `docs/CONTABILIDAD-C3A-CAPTURA.md`: "C2B ... cuyas migraciones el usuario confirmó aplicadas manualmente"). |
| `sql/migrate-2026-08-contabilidad-entidad-preparacion.sql` | C2A (agrega `entidad_id` nullable a las 5 tablas) | **Aplicada** (confirmado explícitamente en `docs/CONTABILIDAD-C2-TRANSICION.md`: "C2A aplicada manualmente por el usuario"). |
| `sql/migrate-2026-08-contabilidad-entidad-integridad.sql` | C2B (UNIQUE/FK compuestas por entidad) | **Aplicada** (misma confirmación de C3A-CAPTURA — `exigirEsquemaC2b()` en `ambito.ts` ya asume que existen, y produce 503 controlado si no). |

**Ninguna de las tres tiene relación con períodos/ejercicios/numeración/cierre** — las tres son exclusivamente sobre la separación KT/Mónaco por entidad. **No hay ninguna migración preparatoria para C3C todavía** — cualquier columna/tabla de período que se decida sería una migración NUEVA, no ejecutada, ni siquiera redactada en este ticket (fuera de alcance, ver "Entrega").

## 6. Conceptos reutilizables dentro de Contabilidad — punto 5

**Ninguno.** Búsqueda exhaustiva (`grep` sobre `src/lib/contabilidad/`, `sql/schema.sql`, migraciones de contabilidad) de "periodo", "ejercicio", "cierre", "reapertura", "secuencia", "correlativo", "reverso", "anulad": cero resultados dentro del módulo Contabilidad.

Dos patrones existen en OTROS módulos — se citan aquí únicamente como
**referencia estructural de cómo el resto del repo modela conceptos
similares**, no como algo a reutilizar (instrucción explícita del ticket):

- `rrhh_planilla_periodos` (RRHH): `empresa_id, codigo, fecha_inicio, fecha_fin, estado VARCHAR DEFAULT 'Borrador', tipo_periodo, numero_quincena, mes, anio`, con `UNIQUE(empresa_id, codigo)` y `UNIQUE(empresa_id, anio, mes, numero_quincena, tipo_periodo)`. Estructuralmente parecido a lo que necesitaría `cont_periodos`, pero es un concepto de **nómina** (quincenas), no de ejercicios contables — mismo nombre de columna (`estado`, `fecha_inicio/fin`) no implica misma semántica de negocio.
- `fact_facturas.estado_admin` (Facturación): `'Borrador' | 'Emitida' | 'Anulada'`, con `UPDATE ... SET estado_admin='Anulada' ... WHERE ... estado_admin <> 'Anulada'` (transición de estado idempotente, nunca DELETE físico). Es un patrón de **transición de estado con guarda idempotente**, útil como referencia de ESTILO para cierre/reapertura (nunca borrar, solo transicionar estado con guarda), pero Facturación no tiene el concepto de "reverso" (una anulación no genera una fila compensatoria, solo cambia el estado) — un reverso contable SÍ necesitaría una fila nueva que compense la original, un concepto que no existe en ningún módulo actual del repo.

## 7. Propuesta técnica de concurrencia futura — punto 6 del alcance (SIN implementar)

Extender, no reinventar, el mecanismo ya probado:

1. **Bloqueo de período** (para impedir "insertar mientras se cierra" y viceversa): igual que `bloquearAmbito` toma `SELECT ... FOR UPDATE` sobre la fila de `cont_entidades`, una futura `cont_periodos` tendría su propia fila por `(empresa_id, entidad_id, periodo)` — `registrarAsiento` tomaría `SELECT ... FOR UPDATE` sobre esa fila de período (además del lock de entidad que ya toma) antes de insertar, y una futura `cerrarPeriodo()` tomaría el MISMO lock antes de cambiar su estado. MySQL/InnoDB serializa automáticamente: quien llegue segundo espera.
2. **Impedir dos números iguales**: ya resuelto en el ámbito actual por el `UNIQUE` existente; si el ámbito de numeración cambia a incluir período/año (sección 8, pregunta 6), el `UNIQUE` se redefine sobre las nuevas columnas — el mecanismo (constraint de base de datos + `ER_DUP_ENTRY` → 409) se mantiene igual, no hace falta inventar nada nuevo.
3. **Reaperturas pisando operaciones simultáneas**: mismo lock de período — reabrir es otra transición de estado que compite por el mismo `FOR UPDATE`; mientras el período está `Cerrado`, `registrarAsiento` debe rechazar (validación de estado, igual que hoy valida cuentas activas) ANTES de intentar el INSERT.
4. **Patrón ya probado, no a inventar**: este es literalmente el mismo esqueleto transaccional (`beginTransaction` → `FOR UPDATE` → validar → escribir → `registrarAuditoriaTx` → `commit`/`rollback` en un solo `finally`) que ya usan `autorizarViatico`/`liquidarViatico`/`registrarAsiento` — C3C no necesita un patrón de concurrencia nuevo, necesita aplicar el mismo patrón a una fila de período en vez de (o además de) la fila de entidad.

## 8. Modelo mínimo propuesto para C3C

### A. Decisiones TÉCNICAS que pueden definirse sin Contabilidad (equipo de desarrollo)

- Estructura de tabla(s) nueva(s) (nombres de columna, tipos, índices) — propuesta en sección 9.
- Mecanismo de lock (reusar `FOR UPDATE` sobre la fila de período, mismo patrón que `bloquearAmbito`).
- Manejo de errores HTTP (409 para duplicado/período cerrado, 503 para esquema pendiente) — mismo patrón que ya existe en `errorAmbito`.
- Estrategia de migración aditiva (columnas nullable primero, igual que C2A) — sin ejecutar.
- Cómo extender `consultas.asientos`/`consultarPartida` para incluir período (sección 4).

### B. Decisiones FUNCIONALES que necesitan aprobación del negocio (no se inventan aquí)

- **¿Existen "ejercicios" (anuales) como concepto separado de "períodos" (mensuales/trimestrales), o es un solo nivel?**
- **¿La numeración de partida se reinicia por ejercicio, por período, o sigue siendo continua para siempre dentro de la entidad (como hoy)?**
- **¿Quién puede cerrar/reabrir un período — mismo permiso de "editar" Contabilidad, o un permiso nuevo más restringido?**
- **¿Reabrir un período cerrado requiere motivo/auditoría reforzada (similar a `motivoCambio` de Programación) o basta con el registro de auditoría estándar?**
- **¿Un período cerrado bloquea SOLO nuevas partidas, o también CxC/CxP (que hoy no tienen relación formal con `cont_asientos`)?**
- **¿Qué pasa con partidas en fecha anterior a la apertura del primer período (datos históricos / transición)?**

Ninguna de estas se responde en este documento — son exactamente el tipo de
decisión que el ticket pide NO inventar.

## 9. Esquema mínimo hipotético (propuesta técnica, NO SQL a ejecutar)

Solo como insumo para que el negocio visualice la forma, no como diseño
final ni migración lista:

```
cont_periodos (empresa_id, entidad_id, codigo, fecha_inicio, fecha_fin,
               estado VARCHAR DEFAULT 'Abierto', cerrado_por, cerrado_en,
               reabierto_por, reabierto_en, creado_por, creado_en)
  UNIQUE (empresa_id, entidad_id, codigo)
  UNIQUE (empresa_id, entidad_id, id)          -- ancla para FK compuesta, mismo patrón que cont_entidades
  FK (empresa_id, entidad_id) -> cont_entidades(empresa_id, id) ON DELETE RESTRICT

cont_asientos
  + periodo_id INT NULL                         -- aditivo, nullable primero (mismo patrón C2A)
  FK (empresa_id, entidad_id, periodo_id) -> cont_periodos(empresa_id, entidad_id, id) ON DELETE RESTRICT
```

Sin decidir todavía si `cont_ejercicios` es una tabla aparte (jerarquía
ejercicio → período) o si "ejercicio" es simplemente un período de tipo
anual dentro de la MISMA tabla (`tipo_periodo` como en `rrhh_planilla_periodos`,
sección 6) — depende de la pregunta funcional de la sección 8B.

## 10. Respuestas directas a las 12 preguntas del ticket

1. **¿Cómo funciona hoy la numeración de partidas?** Manual, el usuario la escribe; sin generación de servidor; protegida solo por `UNIQUE(empresa_id, entidad_id, numero)`. Ver sección 2.
2. **¿Qué riesgo de concurrencia existe actualmente?** Ninguno de integridad de datos (el `UNIQUE` + el lock de entidad lo cubren); el riesgo real es de UX (409 sin sugerencia de número alternativo) y la ausencia total de mecanismo de cierre/reapertura (no aplica hoy porque no existe la función). Ver sección 3.
3. **¿Existe alguna tabla de períodos/ejercicios?** No, ninguna, en ningún módulo relevante. Ver sección 1 y 6.
4. **¿Cuál sería el cambio de esquema mínimo necesario?** Una tabla de períodos (mismo patrón que `cont_entidades`) + una columna `periodo_id` nullable en `cont_asientos`, aditiva. Ver sección 9. (Propuesta técnica, no aprobada ni ejecutada.)
5. **¿`cont_ejercicios`, `cont_periodos`, ambas, o alternativa?** Técnicamente, **una sola tabla `cont_periodos`** basta si "ejercicio" se modela como un período de tipo anual (como hace `rrhh_planilla_periodos` con `tipo_periodo`) — evita una jerarquía de dos tablas sin necesidad demostrada. Separar en dos tablas (`cont_ejercicios` padre, `cont_periodos` hijo) solo se justifica si el negocio confirma que necesita CIERRES independientes en dos niveles (cerrar un mes sin cerrar el año). **Esto es una recomendación técnica, no una decisión — depende de la pregunta funcional de la sección 8B.**
6. **¿Cuál debería ser el ámbito técnico de aislamiento?** `empresa_id + entidad_id` siempre, igual que el resto del módulo — un período pertenece a una entidad específica, nunca compartido entre KT y Mónaco (mismo criterio que ya rige `cont_cuentas`/`cont_asientos`).
7. **¿Qué restricciones UNIQUE/FK serían necesarias?** `UNIQUE(empresa_id, entidad_id, codigo)` en `cont_periodos` (mismo patrón que `cont_entidades`/`cont_cuentas`); `UNIQUE(empresa_id, entidad_id, id)` como ancla; FK compuesta `(empresa_id, entidad_id, periodo_id)` en `cont_asientos` hacia `cont_periodos`. Si la numeración pasa a tener ámbito de período, el `UNIQUE` actual de `numero` se redefine para incluir `periodo_id`.
8. **¿Qué partes de C3A/C3B se verían afectadas?** `asientos.ts` (`registrarAsiento` — validar período abierto antes de insertar, tomar su lock), `captura.ts`/UI de captura (selector de período, o inferido de la fecha), `ambito.ts` (`consultas.asientos`, `consultarPartida` — filtro y exposición de período/estado), la ruta API de asientos (nuevos códigos de error: período cerrado). Ver secciones 2-4.
9. **¿Qué archivos probablemente cambiarían en la futura implementación?** `sql/schema.sql` + nueva migración manual; `src/lib/contabilidad/ambito.ts`, `asientos.ts`, `captura.ts`, `consulta-partida.ts`; `src/app/api/empresas/[slug]/contabilidad/asientos/route.ts`; posible ruta nueva `.../contabilidad/periodos/route.ts`; `src/app/e/[slug]/contabilidad/page.tsx` (UI); tests correspondientes de cada uno.
10. **¿Qué decisiones de negocio necesitamos antes de escribir código?** Las 6 de la sección 8B — ejercicio vs. período como niveles separados o no, reinicio de numeración, permisos de cierre/reapertura, motivo obligatorio o no, alcance del cierre sobre CxC/CxP, tratamiento de partidas anteriores al primer período.
11. **¿Dividir en C3C1 (períodos/numeración) / C3C2 (cierre/reapertura) / C3D (reversos)?** **Sí, se recomienda.** Períodos+numeración es un cambio de esquema aditivo relativamente contenido y sin el que nada más tiene sentido; cierre/reapertura depende de que períodos ya exista y añade su propio candado de concurrencia; reversos depende de que existan asientos ya cerrados que reversar (no tiene sentido antes de que exista cierre). Alinea con el criterio ya usado en este proyecto de entregas pequeñas y revisables (mismo patrón que C2A→C2B→C3A→C3B).
12. **Deuda/inconsistencias de C3A/C3B a resolver antes de C3C:** ver sección 12.

## 11. Deuda técnica / inconsistencias detectadas (no corregidas en este ticket — solo reportadas)

1. `cont_asientos.estado` tiene `DEFAULT 'Borrador'` en el schema, pero `registrarAsiento` SIEMPRE inserta `'Registrado'` — el estado `'Borrador'` es inalcanzable por el código actual. Si C3C introduce estados de período (`Abierto`/`Cerrado`) es buen momento para decidir si `cont_asientos.estado` debería empezar a usarse de verdad (p. ej. para marcar una partida como parte de un período cerrado) o si sigue sin usarse y el DEFAULT es vestigial.
2. `cont_asiento_detalle` tiene DOS pares de FK hacia el mismo destino: la compuesta `(empresa_id, entidad_id, asiento_id/cuenta_id)` (la que realmente aísla por entidad) Y una FK simple redundante (`asiento_id → cont_asientos.id`, `cuenta_id → cont_cuentas.id`, sin `empresa_id/entidad_id`). Técnicamente inofensivo (la compuesta ya es más estricta), pero es ruido de esquema — no se toca en este ticket, solo se reporta.
3. `consultarLibro`/`consultarPartida` (solo lectura) toman el MISMO lock de escritura (`FOR UPDATE` sobre `cont_entidades`) que `registrarAsiento`. Esto significa que una consulta de lectura puede bloquear brevemente una escritura concurrente (y viceversa) aunque no haya conflicto real de datos. No es incorrecto (es conservador), pero si C3C añade un lock de período adicional, vale la pena revisar si las lecturas realmente necesitan tomar el lock de escritura o si podrían usar una lectura no bloqueante — decisión técnica para el propio C3C, no de este documento.
4. `cont_cxc`/`cont_cxp` no tienen ninguna relación (FK) con `cont_asientos` — viven como libros auxiliares completamente aparte. Si el futuro cierre de período debe (o no) incluir CxC/CxP es una pregunta funcional abierta (sección 8B), pero técnicamente hoy no hay forma de saber, para una obligación de CxC/CxP, a qué período "pertenece" salvo por su columna `fecha` suelta.

Ninguno de estos 4 puntos bloquea C3C — se documentan porque el ticket pidió identificarlos explícitamente antes de C3C, no porque impidan avanzar.

## 12. Entrega y validación

Archivo único: `docs/CONTABILIDAD-C3C-DISCOVERY-PERIODOS-NUMERACION.md`. Sin
cambios en `src/`, sin cambios en `sql/`, sin cambios de schema, sin
ejecución de SQL, sin cambios de tests (cero necesidad — es investigación
documental, no verificación de comportamiento nuevo).
