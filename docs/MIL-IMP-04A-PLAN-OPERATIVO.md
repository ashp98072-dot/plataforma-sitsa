# MIL-IMP-04A — propuesta de preparación operativa

Fecha: 2026-11-10, America/Guatemala. Fuente: `1ad9fab801ee4bb1dc3ba890733d3ab9f59d4877`, rama `feature/mil-imp04a-vencimiento-congelado`, [PR #581](https://github.com/ashp98072-dot/plataforma-sitsa/pull/581).

**BORRADOR LOCAL PARA AUDITORÍA. Sin commit ni push de este documento. No autoriza merge, acceso productivo, preflight real, respaldo, restauración, migración, cambio de infraestructura ni despliegue.** Ninguna instrucción operativa de este documento se ha ejecutado. AUD-10 no se implementa. Las auditorías AUD-01–09 tienen dictamen favorable comunicado por el usuario; ello no certifica preparación operativa.

## 1. Autoridad, responsables y decisiones pendientes

Codex implementa/prueba en ramas aisladas; Claude Code atiende sus tickets; ChatGPT audita y coordina. El usuario autoriza y ejecuta merges normales, migraciones y despliegues. Ningún actor debe actualizar `main` directamente, hacer rebase/squash/force push ni interpretar este plan como autorización de producción.

Los responsables siguientes son **roles propuestos, sin personas asignadas todavía**. Registrar nombre, suplente y aceptación antes de planificar una ventana.

| Rol | Responsabilidad y evidencia de aceptación |
| --- | --- |
| Usuario / responsable de cambio | Autoriza alcance, publicación documental, merge normal, ventana y cada operación productiva. Decide GO/NO-GO y reapertura con los responsables |
| ChatGPT / auditor | Revisa este plan, scripts exactos, evidencia, desviaciones y condiciones de aceptación; no sustituye la ejecución autorizada |
| DBA / responsable de datos | Confirma identidad y contrato efectivo; revisa SQL, capacidad, respaldo/restauración y reconciliación; entrega informe verificable |
| Operación / administrador del hosting | Inventaría instancias, cron y accesos; demuestra cierre/drenaje y versión homogénea; custodia artefactos/configuración y evidencia de parada/arranque |
| Facturación / dueño comercial | Clasifica borradores y confirma cliente, libro, líneas, importes y condición contra documentos fuente; acepta los bloqueos operativos |
| Contabilidad / dueño del libro | Confirma entidades/cuentas activas y moneda, impacto CxC y tratamiento de pendientes. No inventa términos comerciales |
| Administrador de crédito autorizado | Configura/aprueba perfiles mediante capacidad granular existente, con motivo y revisión; incluso Admin necesita concesión explícita |
| Responsable de cada integración | Declara proceso, versión, cuenta técnica, destino, reintentos y forma de detenerlo; acredita compatibilidad y ausencia de escritor alternativo |

Campos obligatorios pendientes: servidor/base/entornos exactos y sus propietarios; inventario firmado; SHA del futuro release; herramienta real de mantenimiento; inicio/fin de ventana; duración máxima y límite de espera de locks; responsables nominales; RPO/RTO; custodia/retención de respaldo; alertas y frecuencia de observación. **No se inventan valores.**

## 2. Inventario de escritores y frontera de evidencia

La búsqueda estática del SHA fuente encontró una única transición operativa a Emitida en el código revisado. No se consultó el host, sus procesos, cuentas DB ni integraciones reales.

| ID | Escritor/camino | Evidencia local y control necesario |
| --- | --- | --- |
| W01 | UI `FacturasPanel` → POST `.../facturas/[id]/emitir` | `src/components/facturacion/facturas-panel.tsx`; la confirmación envía token. Detener ingreso y drenar solicitudes; exigir recarga del cliente tras reapertura |
| W02 | Consumidores HTTP externos de la misma ruta | Ruta real `src/app/api/empresas/[slug]/facturacion/facturas/[id]/emitir/route.ts`; guard tenant/emitir y delegación al servicio. Existencia de consumidores externos no verificada; deben obtener preview/token del mismo actor/fecha/contexto |
| W03 | `emitirFactura()` y llamadores internos futuros | `src/lib/facturacion/facturas.ts:1517`; llama `congelarVencimientoTx` antes del UPDATE a Emitida, en la misma transacción. La única llamada operativa encontrada es W02; inventariar cualquier binario divergente |
| W04 | Instancias antiguas, réplicas web, procesos Node persistentes, despliegues de prueba conectados a la misma DB | No enumerables desde el repositorio. El código anterior puede emitir sin snapshot incluso con esquema FINAL; detener todas y verificar sus conexiones |
| W05 | Cron, workers, colas, importadores, ETL, scripts administrativos y automatizaciones de terceros | No se identificó otro escritor de emisión en `src`, `scripts`, `infra` revisados; su ausencia desplegada no está demostrada. Registrar horario, credencial por alias, repositorio/SHA y reintentos retenidos |
| W06 | Acceso SQL directo de operadores, soporte, integraciones u otras aplicaciones | Puede saltarse completamente el servicio y su auditoría. Revisar cuentas/privilegios y procedimiento de suspensión, sin publicar secretos ni alterar grants ahora |
| W07 | Eventos, triggers y rutinas almacenadas del servidor | No se ha inventariado su estado efectivo. Revisar metadatos, dependencias e intervención de DBA; no inferir ausencia por no existir en Git |
| W08 | Scripts de laboratorio y fixtures | `*.test.ts`, `aud09.test-support.ts`, runner MIL04A: emiten o siembran datos sintéticos exclusivamente en laboratorio verificado. Nunca ejecutarlos contra producción; no son procedimientos para reparar históricos |

FEL/certificación y contabilización no son caminos alternativos de esta transición administrativa en el SHA inspeccionado. Crear/editar borrador tampoco emite. Deben verificarse conectores y versiones desplegados antes de extender esta conclusión al entorno real.

Ficha obligatoria por instancia o proceso: ID Wxx; propietario; entorno y host por alias; servicio/PID o recurso del panel; ruta de arranque; versión y digest del artefacto; DB destino y cuenta técnica por alias; capacidad HTTP/SQL; horario/cola/reintentos; mecanismo probado de pausa/drenaje; control de reinicio automático; evidencia de parada; autorización de reanudación. No escribir contraseñas/tokens en la ficha.

**Condición de cierre:** todos los escritores están identificados y detenibles. Cualquier escritor desconocido, no controlable o que siga accediendo a la DB implica NO-GO. Ocultar el botón o cortar únicamente el frontend no cumple esta condición.

## 3. Checklist de preflight de solo lectura — propuesta para revisar

No ejecutar todavía. Usar una sesión independiente con cuenta de lectura autorizada, sin lanzar la aplicación, `db:init`, seeders, aseguradores de esquema ni herramientas de reparación. No usar el procedimiento de instalación inicial de `DEPLOY-HOSTINGER.md` como migración de una base existente: este cambio no requiere importar `schema.sql` completo ni semillas de usuarios.

Guardar salida, código de terminación, fecha/zona, versión del cliente, identificación de entorno revisada y hash del SQL. Los resultados sensibles quedan en custodia privada; el expediente de Git solo debe contener evidencia agregada/redactada. Si falta visibilidad de metadatos, declarar NO VERIFICADO; no solicitar ni ampliar privilegios automáticamente.

- [ ] PF01. Autorización futura separada de ejecución de lectura; cuenta, host, base, alcance y responsable nominales.
- [ ] PF02. Identidad confirmada por dos evidencias: selección de entorno del operador e identidad devuelta por el servidor. Discrepancia = STOP.
- [ ] PF03. Motor MariaDB 11.8 compatible, InnoDB y FK/CHECK activos; registrar timezone/sql_mode y collation efectiva. No cambiar parámetros para forzar compatibilidad.
- [ ] PF04. Contrato SQL exacto revisado por auditor/DBA, integridad por hash y cliente capaz de procesarlo. Ningún DDL se incluye en esta sesión de preflight.
- [ ] PF05. Ejecutar posteriormente únicamente `sql/mil-imp04a/preflight.sql`, sin modificarlo; registrar CLEAN/FINAL/DIVERGENTE. DIVERGENTE, error o resultado ausente = STOP.
- [ ] PF06. Validar FACT-4 completo y sus relaciones, tablas base de auditoría/CxC, tipos/índices y objetos reales. CLEAN MIL04A no certifica todo FACT-4.
- [ ] PF07. Inventariar rutinas, eventos, triggers, cuentas técnicas y procesos activos con los permisos autorizados; contrastar W01–W08.
- [ ] PF08. Evaluar tamaño, espacio libre, sesiones largas y locks mediante herramientas de lectura aprobadas. Acordar presupuesto de consultas, tiempo de DDL y umbrales de aborto. Un SELECT también puede consumir recursos.
- [ ] PF09. Inventariar borradores por empresa/libro y causa de bloqueo; custodiar IDs en privado. No aplicar defaults automáticamente.
- [ ] PF10. Preparar baseline de documentos históricos sin snapshot y de emisiones/auditoría existentes; distinguirlo de nuevas transiciones. Conteos solos no son suficientes.
- [ ] PF11. Confirmar respaldo recuperable y ensayo de restauración; RPO/RTO y ventana aceptados.
- [ ] PF12. Firmar revisión y decisión. Repetir identidad, contrato y controles de escritores dentro de la ventana, porque el preflight previo puede quedar obsoleto.

Consultas complementarias propuestas, **no ejecutadas**. El DBA debe revisar compatibilidad, permisos y coste antes de autorizar el lote. No contienen DDL/DML ni llamadas a funciones de aplicación. Usar límites y alcance revisados para el entorno; no añadir `FOR UPDATE`, `LOCK TABLES`, `INTO OUTFILE` ni instrucciones de modificación.

```sql
-- Identidad/contexto de la sesión; conservar internamente, redactar al compartir.
SELECT DATABASE() AS base, @@hostname AS servidor, @@port AS puerto,
       VERSION() AS version, NOW() AS hora_servidor, UTC_TIMESTAMP() AS hora_utc,
       @@session.time_zone AS zona_sesion, @@global.time_zone AS zona_global,
       @@session.sql_mode AS sql_mode,
       @@foreign_key_checks AS fk_activas, @@check_constraint_checks AS checks_activos;

-- Inventario de estructura, sin leer datos comerciales.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empresas','usuarios','clientes','cont_entidades','cont_cuentas',
    'fact_facturas','fact_factura_viajes','fact_factura_lineas','fact_factura_linea_viajes',
    'fact_cliente_perfil','cont_cuentas_bancarias','auditoria','fact_cobros',
    'fact_cobro_aplicaciones','fact_credito_perfiles','fact_vencimientos')
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('clientes','cont_entidades','fact_facturas','fact_cliente_perfil',
                    'fact_factura_lineas','fact_factura_linea_viajes')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE();
SELECT EVENT_NAME, STATUS, EVENT_TYPE
FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE();
SELECT ROUTINE_NAME, ROUTINE_TYPE, SECURITY_TYPE
FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE();
```

Estos metadatos no bastan para probar que un evento/rutina no llama indirectamente a un escritor: el DBA revisará definiciones y dependencias en custodia privada. La visibilidad parcial no equivale a inventario vacío. No se diseñó ni ejecutó una búsqueda automática de cuentas o secretos.

Después de confirmar que las columnas/tablas existen, comprobar el acceso FACT-4 sin filas mediante las cuatro lecturas de `fact4Disponible()` (`src/lib/facturacion/contexto-factura.ts`):

```sql
SELECT modelo_lineas, condicion_pago, cuenta_bancaria_id, retencion_iva_pct, retencion_iva_monto
FROM fact_facturas LIMIT 0;
SELECT id, factura_id, cantidad FROM fact_factura_lineas LIMIT 0;
SELECT linea_id, plan_id FROM fact_factura_linea_viajes LIMIT 0;
SELECT retencion_iva_pct FROM fact_cliente_perfil LIMIT 0;

-- Solo tras verificar entidad_id y condicion_pago; lectura agregada, revisar coste.
SELECT empresa_id, entidad_id, COUNT(*) AS borradores,
       SUM(entidad_id IS NULL) AS sin_entidad,
       SUM(condicion_pago IS NULL OR condicion_pago NOT IN ('CONTADO','CREDITO')) AS sin_condicion
FROM fact_facturas WHERE estado_admin = 'Borrador'
GROUP BY empresa_id, entidad_id;

SELECT f.empresa_id, f.entidad_id, COUNT(*) AS borradores_con_viajes_sin_lineas
FROM fact_facturas f
WHERE f.estado_admin = 'Borrador'
  AND EXISTS (SELECT 1 FROM fact_factura_viajes v WHERE v.factura_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM fact_factura_lineas l WHERE l.factura_id = f.id)
GROUP BY f.empresa_id, f.entidad_id;
```

LIMIT 0 verifica presencia/acceso, **no** sustituye la revisión del contrato FACT-4, FKs, campos complementarios o estado del libro. Si FACT-4 está ausente/parcial, detener esta secuencia; la preparación de ese esquema requiere otra revisión/autorización. No ejecutar las consultas agregadas sobre columnas ausentes ni tratar su error como cero incidencias.

Interpretación del preflight MIL04A: CLEAN = objetos del ticket ausentes y prerrequisitos que ese script valida compatibles; FINAL = contrato coincidente; DIVERGENTE = incompatible o parcial. CLEAN no autoriza escritura con código nuevo; FINAL no acredita perfiles aprobados, permisos humanos ni borradores completos. Si ya es FINAL, comprobar procedencia y datos existentes y revisar si hace falta DDL; no reaplicar automáticamente.

## 4. Baseline y detección de emisiones sin snapshot

Durante la ventana, **tras drenar todos los escritores**, registrar un corte común T0 (hora UTC y Guatemala), versión anterior, conteos por empresa, máximo ID de auditoría y conjunto privado de documentos ya Emitidos/Anulados sin snapshot. Registrar también borradores pendientes. No publicar datos identificables en Git. Con CLEAN no existe `fact_vencimientos`: el conjunto tolerado son los Emitidos/Anulados previos; con FINAL, obtener los que carecen de snapshot mediante anti-join. Revisar DIVERGENTE antes de cualquier lectura que dependa de su estructura.

Después del cambio, comparar los documentos Emitidos/Anulados sin snapshot con ese conjunto autorizado anterior. **Cualquier nueva ausencia, o cualquier borrador de T0 que pase a Emitida sin snapshot, es NO-GO/STOP.** No usar `factura.id > MAX(id en T0)` como único criterio: un borrador antiguo conserva su ID al emitirse. Tampoco usar solo `actualizado_en`, que cambia por otras operaciones.

Corroborar cada evento nuevo `emitir_factura` con un snapshot de la misma empresa, entidad, cliente y factura. Un corte por ID de auditoría solo es válido si no quedaron transacciones en vuelo. La comparación de conjuntos detecta nuevos documentos sin snapshot aunque un escritor externo omita la auditoría; no certifica ausencia de toda manipulación de una fila histórica ya tolerada. Esa garantía requiere controlar los escritores y sus privilegios.

Los históricos tolerados permanecen indeterminados: no se completan mediante el perfil vigente ni se hace backfill. Un importador que pretenda incorporar históricos después de T0 necesita su propia política y autorización; no se exceptúa automáticamente de las comprobaciones.

## 5. Respaldo y recuperación verificables

Plan pendiente de capacidad real del proveedor. No se han consultado ni probado backups del hosting.

1. Definir RPO/RTO, alcance y responsable. Incluir la base de aplicación consistente, tablas padre, auditoría, perfiles/snapshots si existen, vistas, triggers, rutinas y eventos; además artefacto anterior/nuevo, lockfile, configuración y uploads necesarios. Credenciales/configuración sensible se custodian cifradas fuera de Git y de logs públicos.
2. Seleccionar mecanismo compatible con MariaDB y permisos del proveedor; registrar versión/herramienta/opciones exactas antes de aprobarlo. Si se usa dump lógico InnoDB, revisar `--single-transaction --quick`, inclusión de rutinas/eventos/triggers y definers; no asumir que un ZIP o exportación parcial del panel contiene todo. No poner contraseñas en argumentos, chat ni historial.
3. Ensayar sobre copia autorizada y protegida o fixtures representativos, en **otra instancia nueva** con destino verificado. Nunca restaurar encima de producción para probar. Desactivar egress, jobs y eventos restaurados hasta revisarlos, sin cambiar los objetos del respaldo original.
4. Verificar exit/log del backup, tamaño esperado, SHA256, fecha, cifrado, accesibilidad y segunda copia independiente. Un archivo existente no demuestra un backup válido.
5. Restaurar en el destino aislado; medir tiempo real y verificar tablas, motores, índices/FKs/CHECK, triggers/rutinas/eventos, conteos e integridad referencial por ámbito, importes, snapshots y auditoría. Comprobar integridad de archivos adjuntos referenciados. Guardar informe sin datos sensibles.
6. En la ventana, con escritores detenidos y sin DDL concurrente, obtener respaldo final/corte coherente y retener evidencia. La restauración ensayada debe corresponder al método/formato final; documentar cualquier diferencia. Si su frescura o recuperabilidad no cumplen RPO/RTO, NO-GO.
7. Si se propone recuperación a un punto en el tiempo, confirmar disponibilidad, retención y ensayo de logs necesarios. No asumir que el proveedor ofrece binlogs/PITR. Si no existe esa capacidad, aceptar expresamente el RPO alcanzable o posponer.

`--single-transaction` no asegura consistencia de motores no transaccionales ni protege contra DDL concurrente. La documentación de MariaDB especifica estas limitaciones y opciones de objetos adicionales. La verificación del método es responsabilidad del DBA: [mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump). No se entrega aquí un comando de backup listo para un destino real desconocido.

## 6. Secuencia propuesta sin versiones mixtas

Cada fase futura requiere autorización del usuario; no hay acciones ejecutadas por este documento.

| Paso | Acción futura del responsable autorizado | Evidencia / condición para avanzar |
| --- | --- | --- |
| S0 | Revisar plan, asignar roles, cerrar pendientes y aprobar publicación documental | Auditoría y alcance aceptados; publicar este archivo solo si se autoriza |
| S1 | Usuario decide merge normal y release; preparar artefacto inmutable fuera del tráfico | SHA de merge/release, comparación con SHA auditado y digest. Si integra otros cambios, evaluar sus diferencias; no equiparar automáticamente el nuevo SHA con el auditado |
| S2 | Revalidar en staging aislado motor/configuración/artefacto que se usarán | Resultado y diferencias de Node, MariaDB, build y configuración. Node local validado 24.18.0 no certifica el runtime del hosting |
| S3 | Abrir ventana aprobada; bloquear ingreso de escrituras y detener cron/colas/integraciones y todas las instancias capaces de escribir | Mecanismo de mantenimiento real probado. No hay interruptor de mantenimiento verificado en esta entrega; si no se dispone de una barrera fiable, NO-GO |
| S4 | Drenar solicitudes/transacciones y neutralizar reinicios automáticos/reintentos antiguos | Inventario W01–W08 detenido, sesiones y trabajos identificados; no matar transacciones desconocidas automáticamente. Si no se drena en el límite acordado, abortar |
| S5 | Tomar T0, respaldo final y repetir preflight de lectura | Identidad, baseline, backup y contrato válidos. Cambios respecto a revisión previa requieren explicación |
| S6 | Usuario ejecuta únicamente migración aprobada si corresponde, con cliente que procese DELIMITER y detenga errores | Hash exacto y log/exit. No usar modo continuar/force; no `db:init`, esquema completo ni seeds. DIVERGENTE/fallo = detener y conservar escritores cerrados |
| S7 | Usuario/DBA realiza postcheck de lectura y revisión del DDL efectivo | FINAL obligatorio, objetos/constraints/triggers coincidentes; ausencia de cambios no esperados y de mutaciones históricas |
| S8 | Sustituir todos los artefactos/instancias por la versión homogénea; iniciar con ingreso aún cerrado | Todos los procesos y destinos DB coinciden con ficha; no queda proceso antiguo ni URL alternativa. Configuración efectiva verificada por alias/digest, nunca mostrando secretos |
| S9 | Verificaciones de lectura y preparación de perfiles/borradores por responsables autorizados | Sin emisión productiva de prueba implícita. Configurar perfiles o corregir borradores son escrituras separadas y requieren autorización. Repetir preview antes de toda emisión legítima |
| S10 | Usuario decide reapertura controlada y observación | Lista GO firmada; integraciones compatibles reanudadas por orden aprobado; colas antiguas revisadas; cliente recargado; monitoreo de primeras emisiones legítimas |

El secreto de autenticación utilizado para tokens debe ser coherente entre instancias y no exponerse. Cambios de perfil/fecha y tokens previos a la ventana exigen una nueva revisión; no reenviar a ciegas peticiones retenidas. No ejecutar un rolling deploy con instancias antiguas escribiendo: el DDL no impone snapshot a cada factura emitida y no cierra esa ventana.

Verificar la configuración **efectiva**, no solo el panel: `scripts/start-hostinger.mjs` y `src/lib/load-env.ts` contemplan archivos persistentes fuera del release y prioridades distintas. Identificar ruta efectiva, destino DB y custodio sin leer/publicar secretos en este expediente. No editar esos archivos ni cambiar configuración ahora. La documentación genérica de hosting también advierte diferencias de workers de build según Node; no forzar mecanismos que eviten controles de runtime.

## 7. Borradores legados y responsables de regularización

| Caso | Tratamiento operativo | Responsable / condición de salida |
| --- | --- | --- |
| Líneas válidas, falta entidad/condición | Mantener Borrador. Edición existente permite completar contexto si FACT-4 está listo. Contrastar valores con soporte comercial antes de guardar | Facturación confirma datos; Contabilidad confirma libro/banco. Usuario autoriza la escritura futura |
| Condición nula al abrir formulario | La UI ofrece CREDITO por defecto; una sola entidad también puede aparecer preseleccionada. No son prueba histórica ni aceptación automática | Dueño comercial valida condición real y libro antes de guardar |
| CREDITO sin perfil aprobado | No emitir; plazo explícito aprobado del cliente/libro y motivo, luego preview nuevo | Administrador de crédito con grant existente autorizado. No convertir a CONTADO para eludir aprobación |
| CONTADO sin banco válido | No emitir; revisar cuenta activa, entidad y moneda correctas | Contabilidad valida configuración; cambios de configuración requieren autorización separada |
| Viajes existentes pero cero líneas FACT-4 | No prometer regularización por la UI actual: inicializa líneas vacías y Guardar se bloquea; agregar otro viaje no reconstruye los existentes | Mantener pendiente. Dueño comercial aporta cantidades/descripciones/precios/IVA documentados; solicitar ticket separado para solución explícita. AUD-10 no autorizado |
| FACT-4 ausente/parcial | UI de creación/edición bloqueada; no hacer correcciones SQL ad hoc | DBA prepara diagnóstico y propuesta separada |
| Emitida/Anulada histórica sin snapshot | Lectura indeterminada; no reemitir ni calcular retrospectivamente con perfil vivo | Facturación/Contabilidad mantienen clasificación histórica y baseline |

Registrar en expediente privado: ID de factura, empresa/libro, viajes, causa, propietario, documentos fuente, decisión y estado pendiente. La ausencia de soporte suficiente mantiene el bloqueo. No inventar líneas, precios, condición ni vencimiento. No reutilizar las semillas sintéticas de AUD-09 como procedimiento operativo. No anular/recrear ni liberar viajes automáticamente; cualquier reemplazo requiere análisis, trazabilidad y autorización independiente para evitar duplicación.

Un subconjunto legítimamente pendiente puede permanecer bloqueado tras el despliegue si el dueño funcional acepta explícitamente ese impacto, dispone de responsable y no se anuncia regularización universal. Si el proceso exige emitir inmediatamente esos documentos y no existe vía autorizada, NO-GO.

## 8. Matriz de riesgos y recuperación

| Riesgo / señal | Prevención y decisión | Recuperación propuesta, siempre autorizada |
| --- | --- | --- |
| Código nuevo con CLEAN/DIVERGENTE | Bloquea emisiones/perfiles; no abrir escritores antes de FINAL | Mantener mantenimiento; completar diagnóstico. No rebajar validaciones |
| SQL FINAL con código antiguo o versiones mixtas | Puede emitir sin snapshot; exigir cierre/drenaje y versión homogénea | Detener todos los escritores, delimitar ventana y comparar baseline; no rellenar faltantes usando perfil actual |
| DDL parcial/interrumpido | DDL puede confirmar implícitamente; error o DIVERGENTE = STOP | Preservar metadatos/logs; reparar mediante propuesta específica auditada o restaurar en destino verificado. No hay rollback automático por transacción |
| Restore incompleto o backup corrupto | Ensayo real, objetos adicionales, hashes y segunda copia | No iniciar migración si no cumple; reconstruir respaldo verificable antes de otra ventana |
| Problema de artefacto antes de reabrir | Ingreso aún cerrado; conservar release anterior y validado | Valorar versión anterior solo con circuito de emisión cerrado y contrato DB compatible. No revertir SQL destructivamente |
| Problema después de emisiones nuevas confirmadas | Conservar snapshots/auditoría y monitorear diferencias | Detener escrituras; preservar cambios posteriores al backup y reconciliar. No restaurar sobre ellas sin decisión explícita de pérdida/reaplicación válida conforme a RPO |
| Escritor externo no inventariado / emisión sin snapshot | NO-GO si se conoce antes; STOP inmediato si se detecta después | Aislar escritor autorizado por operación, preservar huellas y abrir incidente; no fabricar snapshots ni borrar evidencia |
| Borradores o perfiles no preparados | Inventario y aceptación comercial previa; 409 esperado no se trata como emisión exitosa | Mantenerlos Borrador y regularización independiente; no relajar contrato |
| Locks, espacio o duración fuera de presupuesto | Evaluación de tamaño, ensayo y umbrales explícitos | Mantener cierre; DBA decide cancelación/espera/recuperación según estado real del DDL, sin relanzar a ciegas |
| Configuración persistente apunta a DB equivocada | Verificar identidad antes de lectura/backup/DDL y destino efectivo por instancia | STOP; no corregir variables automáticamente ni continuar sobre otro servidor |

MariaDB documenta confirmaciones implícitas para DDL; un error no demuestra ausencia de cambios anteriores: [SQL statements causing an implicit commit](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit). Conservar tablas, índices y snapshots confirmados; no se ofrece un DROP como recuperación general.

## 9. GO/NO-GO y comprobaciones posteriores

**GO para iniciar la ventana**, no para abrir emisión, requiere todos los siguientes: autorización específica del usuario; plan auditado; responsables nominales; inventario completo y pausa probada; esquema/versiones compatibles; preflight aceptable; rollback/recuperación ensayados; backup y RPO/RTO verificables; artefacto y scripts identificados; presupuesto de impacto y tratamiento de pendientes aceptados. Cualquier casilla sin evidencia queda pendiente y equivale a NO-GO para ejecutar.

**GO para reabrir** requiere además:

- [ ] Postcheck exacto devuelve FINAL sin errores; DBA verifica objetos efectivos y no solo salida de un comando.
- [ ] Conteos/conjuntos e integridad por empresa/libro concuerdan con T0; no backfill ni cambios históricos no previstos. Si ya había datos MIL04A, perfiles/snapshots anteriores se conservan.
- [ ] Todas las instancias tienen el release correcto; ninguna antigua, cola o integración incompatible puede escribir. Las barreras y reanudaciones tienen responsable.
- [ ] Configuración/destino DB, AUTH coherente, entidades/cuentas y permisos se han verificado sin publicar secretos. No se conceden permisos de crédito implícitos por rol.
- [ ] Lecturas de detalle, listado y CxC funcionan; históricos sin snapshot siguen indeterminados. Estas lecturas futuras necesitan autorización y control de cualquier inicializador incidental; preferir SQL revisado para verificar esquema.
- [ ] Se acepta el impacto sobre borradores incompletos y se conserva la lista de pendientes. No se exige emitirlos como prueba.
- [ ] Plan de observación y contacto de incidente activos; usuario registra decisión de reapertura y condiciones de aborto.

**Observación posterior**, sobre emisiones comerciales legítimas autorizadas: correspondencia 1:1 de factura/snapshot y ámbitos; fechas y días coherentes con regla; auditoría consistente; ausencia de nuevos documentos sin snapshot respecto a baseline; conflictos 409 y esquema 503 revisados; latencia/locks bajo límites aprobados. No provocar UPDATE/DELETE de snapshots productivos para probar triggers; esa prueba destructiva solo pertenece al laboratorio. No crear facturas de prueba ni configurar perfiles como parte implícita de este plan.

STOP tras reapertura: nueva emisión sin snapshot, esquema deja de ser FINAL, versión antigua detectada, identidad dudosa, inconsistencia monetaria/ámbito, backup irrecuperable o umbral operativo excedido. Operación mantiene evidencia y cierra escritores conforme al procedimiento aprobado; usuario decide recuperación, auditor revisa. No se continúa para obtener un resultado verde.

## 10. Evidencias disponibles, límites y publicación futura

Evidencia local previa del SHA fuente (no se reejecutó en esta fase documental): checkout limpio, lockfile intacto; npm ci, TypeScript completo, ESLint y build PASS; focal 345/0/0; integración 100/0/0 (99 originales y una comprobación nueva); bitácora 13/0/0; laboratorio MIL04A 11/0/0. Las 112 antes omitidas sí se ejecutaron. Baseline y fallos anteriores se conservaron. Son ejecuciones locales, no GitHub Actions ni E2E.

Informe y JSON originales conservados en el equipo: `C:/Users/Admin/AppData/Local/Temp/mil04a-aud09-b7e70816c98242329c7c1e001329fb4c/INFORME-AUD09.md`, `metadata.json`, `SHA256SUMS.json`, `baseline/`, `final-sha/`. Las rutas temporales no garantizan retención: antes de una ventana, el custodio debe trasladar y verificar la evidencia necesaria a almacenamiento aprobado, sin publicar datos/secretos ni datadirs en Git.

Referencias versionadas: [implementación](MIL-IMP-04A-IMPLEMENTACION.md), [revisión técnica](MIL-IMP-04A-REVISION-A243F7F9.md), `sql/mil-imp04a/{preflight,migrate,postcheck}.sql`, `contract.json`, runtime `credito.ts`/`credito-esquema.ts`, `facturas.ts` y ruta emitir. La propuesta SQL existente no fue alterada ni ejecutada en esta fase.

Hashes SHA256 observados del checkout local (revalidar contra bytes del artefacto aprobado; una conversión de finales de línea cambia SHA256 y debe explicarse):

| Archivo | SHA256 |
| --- | --- |
| `sql/mil-imp04a/preflight.sql` | `42d7e874001b8fb4447e93da13321a81daf6af0ee7eef58a9b7f3e218e425345` |
| `sql/mil-imp04a/postcheck.sql` | `42d7e874001b8fb4447e93da13321a81daf6af0ee7eef58a9b7f3e218e425345` |
| `sql/mil-imp04a/migrate.sql` | `a6d6b5aa2750cff5a5a22604fd121b199850a9b73caba3e7fe6635c7bad8090a` |
| `sql/mil-imp04a/contract.json` | `2a60b5ce6678b9af1a2aae7bc107b429aaa1fed5de60e952dc8d3b112fb037b1` |
| `package-lock.json` | `d596b08bff058c8f5a4a86ee1f1bb5cbb605f55baeadf11402b691c89ebceee2` |

No se ha verificado el inventario desplegado, el esquema/versión productivos, capacidad del hosting, backup/restauración/PITR, RPO/RTO, mantenimiento efectivo, Node efectivo ni perfiles/borradores reales. No se declara GO operativo. La siguiente decisión solicitada es **revisión del alcance de esta propuesta documental**; cualquier publicación requerirá autorización expresa para commit/push incremental en la rama del ticket. #581 debe mantenerse Draft; el usuario conserva la decisión de merge normal y de toda operación productiva.
