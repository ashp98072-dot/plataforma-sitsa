# Propuesta técnica: una identidad maestra por vehículo físico, operación desde Mónaco, sistema multiempresa

Estado: **PROPUESTA para revisión y autorización. No se implementa nada.** No hay bajas, `DELETE`, `UPDATE`, migraciones, merge ni despliegue. No se elimina `empresa_id` ni ninguna clave foránea, no se modifican referencias históricas (FONDO-000135 y demás) y se conserva el sistema multiempresa de las cinco empresas.
Premisa del propietario (no verificada en producción): Flota está habilitado solo para Mónaco; Fresco Fresh no tiene acceso operativo a Flota.

## 1. Recomendación
**Reutilizar la identidad física existente (M3), no crear una tercera ficha.** La «identidad maestra» ya existe como tabla propia: `flota_identidades_fisicas` (identificador propio) con sus miembros (`flota_identidad_miembros`: la relación explícita con #602, #1296, etc.), las empresas implicadas y la aprobación de cada una (`flota_identidad_aprobaciones`, con administrador y evidencia). Los catálogos ya muestran **una sola opción** por identidad aprobada y resuelven los ID históricos a un representante sin reasignar nada. Crear un tercer registro en `flota_vehiculos` **sería un tercer duplicado** en los catálogos (requisito 7).
Lo que falta no es el modelo sino **cuatro cambios de código, un dato (chasis) y una migración pequeña y reversible** (secciones 3 y 7).

## 2. Qué cubre hoy la arquitectura frente a tus requisitos
| # | Requisito | Estado con M3 |
|---|---|---|
| 1 | Conservar IDs históricos y relaciones | **Cubierto**: no mueve claves; los miembros guardan una instantánea de cada ficha. |
| 2 | Identidad maestra con identificador propio y relación explícita | **Cubierto**: `FISICA:<id>` + miembros. |
| 3 | Una sola unidad en Flota, Combustibles, Shell, rutas, TMS y fondos | **Parcial**: cubierto en todos salvo **las pantallas de Flota** (sección 5). |
| 4 | Mónaco opera sin que todas las fichas sean suyas | **Cubierto para parejas con ficha de Mónaco** (representante propio); para una unidad **sin** ficha de Mónaco falta una autorización explícita (sección 7, M4). |
| 5 | Multiempresa de cinco empresas | **Cubierto**: no cambia `empresa_id` ni el aislamiento. |
| 6 | Trazabilidad de qué empresa registró y operó | **Cubierto**: la ficha conserva `empresa_id`; cada operación conserva el suyo; las aprobaciones guardan empresa, administrador y evidencia. |
| 7 | No crear un tercer duplicado | **Cubierto** si no se crea otra ficha (esta propuesta). |
| 8 | Evitar nuevas fichas duplicadas con identidad vinculada | **Falta**: la guarda de alta no mira identidades de otras empresas (sección 3, C5). |
| 9 | No modificar FONDO-000135 ni otros históricos | **Cubierto** (no se toca ninguna referencia; se verifica con la huella). |
| 10 | Controles de autorización entre empresas | **Cubierto** y a reforzar con C1/M4. |

## 3. Hallazgos que bloquean hoy (verificados en el código de `main`)
- **C1. La aprobación exige el módulo Flota de cada empresa.** `identidadFisicaHttp` llama a `requireTenantFlota(slug, …)` y cada empresa implicada debe aprobar. **Fresco Fresh no tiene Flota → no puede aprobar.** *Cambio propuesto:* permitir que un **administrador global con acceso a esa empresa** registre su aprobación (con evidencia obligatoria y auditoría) **sin** habilitar el módulo; validado en el servidor (no se acepta una empresa a la que el usuario no tenga acceso).
- **C2. `sinOperacionesAbiertas` bloquea la propuesta si cualquier miembro tiene operaciones abiertas.** #1296 tiene 18 planes TMS programados y #1297 tiene 3: **hoy no se podrían vincular.** *Cambio propuesto:* permitir operaciones abiertas **solo en el miembro designado como representante** (siguen apuntando a su mismo ID, sin riesgo de doble reserva) y bloquear si hay abiertas en **más de un** miembro.
- **C3. El chasis no se puede registrar en fichas existentes desde la aplicación.** El PATCH de vehículos no admite `chasis` (solo el alta y la importación de Excel, esta última solo por la empresa propietaria). #602/#603 (Fresco Fresh) **no pueden** recibir chasis. *Cambio propuesto:* aceptar `chasis` en el PATCH para la propietaria o con permiso transversal, con auditoría y **solo mientras la ficha no sea miembro de una identidad**. Para estas dos fichas, alternativamente, una actualización puntual aprobada y respaldada.
- **C4. Las pantallas de Flota no colapsan identidades** (lista de vehículos, viajes, reportes y los selectores de servicio/lectura usan la lista completa). *Cambio:* aplicar el mismo colapso que ya usan los demás módulos (`catalogoSinAlias`) y mostrar la insignia «unidad vinculada».
- **C5. El alta no mira identidades de otras empresas.** *Cambio:* si la placa comparable pertenece a una identidad **aprobada** (o a una ficha activa de otra empresa), no crear otra ficha: se responde «unidad ya registrada; solicita la autorización» sin revelar datos de la otra empresa.
- **C6. La identidad es irreversible** (no existe estado «anulada»; los miembros son inmutables). Para que el cambio sea **reversible** hace falta M4 (sección 7).

## 4. Qué identificador guardan las operaciones y cómo se resuelven los históricos
- **Operaciones nuevas** guardan el **ID de la ficha representante** de la empresa que opera (hoy: la propia ficha activa; si no hay, la accesible de menor ID): para Mónaco, #1296 y #1297. Así **no se cambia ninguna clave foránea** ni tabla operativa, y cada operación conserva su `empresa_id`.
- **La identidad se obtiene al leer**: `resolverUnidadCanonica` devuelve `identidadCanonica = FISICA:<id>`, el representante y `idsHistoricos` (todas las fichas vinculadas). Los reportes e históricos filtran por ese conjunto de IDs **bajo el `empresa_id` de la operación**, sin ver datos de otras empresas.
- **Históricos** (FONDO-000135 → #602, planes → #1296): **no se tocan**; siguen apuntando a su ficha y se leen por equivalencia.
- *Alternativa descartada por ahora:* una columna `identidad_fisica_id` en cada tabla operativa (fondos, gastos, compras, planes, consumos, viajes). Implica migrar muchas tablas con datos reales; se podría añadir después como columna nula derivable y reversible (fase 3), sin cambiar las claves existentes.

## 5. Cómo se muestra una sola unidad en cada módulo
| Módulo | Mecanismo | Estado |
|---|---|---|
| Combustibles (Staff, importador Shell, historial CB2) | `catalogosCombustible` + `resolverUnidadCanonica` | **Hecho** (en `main`; #656 cubre la ambigüedad sin identidad). |
| Rutas, TMS planes y programación, importaciones | `listarVehiculosActivosAccesibles`, `resolverUnidadTms*` | **Hecho**; revisar con pruebas las consultas directas de disponibilidad (`disponibilidad-programacion-*`). |
| Solicitudes de fondo, gastos, compras, viáticos | `listarVehiculosActivosAccesibles` + `combustible-fondos` (equivalencia aprobada) | **Hecho**. |
| Operaciones/Disponibilidad | `catalogoSinAlias` | **Hecho**. |
| **Flota (pantallas)** | aplicar `catalogoSinAlias` + insignia | **Falta (C4)**. |
Regla común: **una opción por identidad aprobada**, preferir la ficha de la empresa que opera; **sin identidad aprobada no se oculta nada** (misma placa no equivale a misma unidad): se muestra la advertencia y la elección explícita (#656).

## 6. Cómo se acredita que dos fichas son el mismo vehículo físico (la placa no basta)
El sistema ya exige placa comparable, tipo y **chasis real** idénticos y ambas fichas activas. Procedimiento propuesto por pareja:
1. **Chasis** (VIN) copiado de la **tarjeta de circulación** a cada ficha (C3), con foto/escaneo guardado como evidencia.
2. **Coherencia** de marca, modelo, año y tipo entre las dos fichas (p. ej. Fuso 2024) y, si existe, motor.
3. **Verificación independiente** por un administrador (no quien registró las fichas): compara documento físico/digital con las fichas.
4. **Aprobación de cada empresa** (Mónaco y Fresco Fresh, esta última por C1), cada una con su evidencia escrita (dónde está el documento y quién lo verificó).
5. **Sin chasis válido o con chasis distinto → no se vincula**: son unidades distintas o falta evidencia. Las cuatro fichas actuales tienen chasis `NULL`: **hoy ninguna pareja está acreditada**.

## 7. Propuesta técnica por fases (cada fase se autoriza por separado)
**Fase 0 — datos (sin esquema):** chasis y evidencias de las cuatro fichas (C3). Huella y respaldo previos (ya preparados en #661).
**Fase 1 — solo código, sin migración:** C1 (aprobación delegada), C2 (operaciones abiertas solo en el representante), C3 (chasis por PATCH con auditoría), C4 (colapso en Flota), C5 (guarda de alta). Cada cambio con pruebas y interruptores.
**Fase 2 — migración M4, compatible y reversible:**
- `flota_identidades_fisicas.estado` admite `ANULADA` (+ `anulada_por`, `anulada_en`, `motivo_anulacion`) y los disparadores se ajustan para permitir **solo** esa transición; los catálogos ya filtran por `APROBADA`, así que anular devuelve las fichas a sus catálogos sin tocar históricos.
- `flota_vehiculo_autorizaciones` (nueva): `empresa_operadora_id`, `vehiculo_id` o `identidad_id`, alcance (rutas, fondos, combustible, mantenimiento), vigencia, quién autorizó y evidencia; claves foráneas `RESTRICT`; sustituye el uso informal de `flota_vehiculo_acceso` para operar unidades ajenas.
- Entrega con **preflight, migración, postcheck y rollback** versionados; el rollback elimina solo lo nuevo (si está vacío) y restablece las definiciones previas respaldadas, igual que el patrón de M2. Probada en MariaDB desechable (aplicar, verificar, revertir, comparar el esquema).
**Fase 3 (opcional, posterior):** columnas `identidad_fisica_id` nulas y derivadas en tablas operativas, sin cambiar claves existentes.

## 8. Pruebas de regresión previstas
- Una sola opción por identidad en **cada** catálogo (Flota, Combustibles, Shell, rutas, TMS, fondos, gastos, compras) y sin ocultar nada sin identidad aprobada.
- Operaciones nuevas guardan el ID del representante; históricos (FONDO-000135, planes) intactos: la huella de #661 debe ser idéntica.
- Aprobación delegada: solo administradores con acceso a esa empresa, evidencia obligatoria, no se puede aprobar por otra empresa ni sin chasis válido.
- Operaciones abiertas: permitidas solo en el representante; bloqueadas si hay en dos miembros.
- Guarda de alta: bloquea el duplicado de una unidad con identidad, no bloquea unidades legítimas ni otras placas.
- Concurrencia (propuesta, aprobación y alta) contra MariaDB aislada, con `REPEATABLE READ` y `READ COMMITTED`, como en #659.
- Migración M4: aplicar, postcheck, **rollback** y comparación exacta del esquema y de los datos.

## 9. Relación con los PR existentes
- **#652 / #654:** diagnósticos de solo lectura de las parejas (siguen válidos para evidencias y chasis).
- **#656:** selección explícita cuando hay placa repetida **sin** identidad aprobada (queda como red de seguridad).
- **#659 / #660:** guarda al compartir y su riesgo de bloqueos; el compartir deja de ser la vía para operar unidades ajenas (M4 + autorizaciones). El bloqueo ordenado de empresas de #659 se reutiliza en C1/C5.
- **#661:** la **baja de #602 y la eliminación de #603 quedan sustituidas** por la vinculación; el preflight, la huella y el respaldo se reutilizan como evidencia.

## 10. Pareja por pareja (estado actual)
| Pareja | Prerrequisitos | Bloqueos |
|---|---|---|
| #602 (Fresco Fresh) ↔ #1296 (Mónaco), C-034BXR | chasis y documento; aprobación de ambas empresas | Falta chasis; C1; C2 (18 planes programados en #1296); C3 para #602. Histórico: FONDO-000135 liquidada en #602 (se conserva). |
| #603 (Fresco Fresh) ↔ #1297 (Mónaco), C-035BXR | ídem | Falta chasis; C1; C2 (3 planes en #1297); C3 para #603. Sin historia propia. |
| Otras (#651↔#1300, #684↔#1301, #638↔#1299) | ídem y diagnóstico por pareja | Se evalúan con los scripts de #652/#654/#659. |

## 11. Decisiones que se piden
1. ¿Se reutiliza M3 (identidad existente) como identidad maestra, sin crear una tercera ficha?
2. ¿Se aprueba la **aprobación delegada** por administrador global (C1) en lugar de habilitar Flota en Fresco Fresh?
3. ¿Se aprueba relajar C2 (operaciones abiertas solo en el representante)?
4. ¿Chasis de #602/#603 vía PATCH con auditoría (C3) o mediante una actualización puntual aprobada?
5. ¿Se autoriza preparar la **Fase 1** en Draft PR (sin migración) y, después, el diseño detallado de **M4** con su rollback?
