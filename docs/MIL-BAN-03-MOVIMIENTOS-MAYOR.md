# MIL-BAN-03 — Movimientos del Mayor en cuentas bancarias

Fecha: 2026-11-06 (America/Guatemala). Base: `d4efd59d4caed140c9811a20f3911062c03a74c6`, confirmada tanto en `origin/main` local como en GitHub antes de empezar. Rama propia `feature/mil-ban03-mayor`, worktree `.worktrees/mil-ban03`. Entrega para auditoría independiente; sin merge ni despliegue.

## Decisión y matriz heredada

Se leyó íntegramente el informe local `docs/MIL-BAN-02-DESCUBRIMIENTO.md` del checkout principal. No se repitió la lectura de Milenium ni se importaron sus datos. Este encargo autoriza expresamente el alcance parcial que había quedado pendiente en MIL-BAN-02: consultar operaciones del Mayor con identificación explícita de su procedencia.

| Funcionalidad / regla | Confirmación para este incremento | Resultado |
| --- | --- | --- |
| Catálogo bancario por empresa/entidad | MIL-BAN-01 y `bancos.ts`: cuenta contable vinculada, estado y selección de entidad | Se reutilizan catálogo, selector, saneamiento y navegación existentes. |
| Fuente económica | `reportes/reportes.ts`, `libroMayor`: asientos/detalle/cuenta | Una sola consulta compartida de líneas; no se agrega feed de CxC/CxP/Facturación. |
| Semántica | Partidas de asientos con estado `Registrado` | Se muestran fecha contable, número e ID del asiento, ID de detalle, estado, debe y haber. No se clasifican como depósitos, cheques o movimientos reales. |
| Cuenta y período | Cuenta enlazada actualmente al banco seleccionado, rango inclusivo; `resolverPeriodoReporte` existente | UI exige elegir cuenta y fechas. API admite alternativamente `periodo` scoped, igual que Mayor, sin combinarlo con fechas. |
| Precisión y orden | DECIMAL(14,2), utilidades BigInt del Mayor; fecha/asiento/detalle | CAST SQL a texto y formato exacto existente. Sin Number/parseFloat, redondeo ni conversión monetaria. |
| b03 tipos y autorizaciones | BAN-Q01/02/03/05/07 siguen pendientes para operación bancaria | No se inventan equivalencias TIPOTR, responsables, fecha efectiva bancaria ni reversión bancaria. No bloquean esta consulta contable explícitamente parcial. |
| b06 saldos y conciliación | No equivalencia validada a disponibilidad bancaria | Sin saldos en el DTO/pantalla. No se alteran cálculos del Mayor ni se importan aperturas. |

La cobertura del Mayor es suficiente para este producto parcial y no demuestra que todos los cobros/pagos administrativos estén contabilizados. La UI lo advierte antes de consultar. No afirma vigencia ni identidad histórica de un banco: consulta la cuenta contable **actualmente vinculada**. Un cambio de configuración puede cambiar qué historia se muestra bajo ese banco.

## Comportamiento y archivos

- En la pantalla existente `/e/[slug]/contabilidad/bancos`, cada banco con cuenta enlazada ofrece «Consultar Mayor de [código]». La selección es explícita, incluso si sólo hay un banco. Catálogo y cuentas inactivas siguen visibles según MIL-BAN-01.
- `src/components/contabilidad/bancos-mayor-panel.tsx`: rango de fecha contable obligatorio en UI, sin petición automática; estados de carga, vacío y error; conserva cada línea sin agrupar ni deduplicar. Cambiar entidad/cuenta desmonta la vista y aborta respuestas anteriores. Reintentar con filtros iguales genera una nueva petición. Durante la carga se bloquean las fechas para no asociar una respuesta a filtros editados.
- `src/app/api/empresas/[slug]/contabilidad/bancos/[bancoId]/mayor/route.ts`: sólo GET. `bancos-mayor-http.ts` valida parámetros, fechas reales y orden del rango, banco y entidad obligatorios, duplicados y parámetros extra. No acepta empresa, actor o privilegios del cliente.
- `src/lib/contabilidad/bancos-mayor.ts`: en la misma transacción del reporte valida entidad y resuelve banco/cuenta por empresa + entidad + ID. Proyecta sólo datos del Mayor; no expone glosa, referencias, usuarios, adjuntos ni datos de confirmaciones. Número/nombre de presentación usan saneamiento de MIL-BAN-01; el ID del asiento permite trazabilidad incluso si el número se oculta parcialmente.
- `src/lib/contabilidad/reportes/reportes.ts`: se extraen y exportan `enSolicitudDeLectura` y `lineasMayor` para reutilizarlas en ambas vistas. La consulta compartida conserva filtros, orden y límite del Mayor y agrega explícitamente igualdad del ámbito de detalle y cabecera. `libroMayor` conserva su DTO y sus cálculos existentes. Sólo líneas con ámbito consistente se consideran; no se recuperan detalles legados sin entidad mediante fallback.

No se añadió estructura SQL ni migración. No hay segundo motor de movimientos, asientos o saldos. Una transferencia puede producir líneas en varias cuentas; una póliza puede repetir cuenta. Cada detalle conserva identidad y no se toma como un nuevo cobro/pago.

API:

```text
GET /api/empresas/[slug]/contabilidad/bancos/[bancoId]/mayor?entidad=5&desde=2026-01-01&hasta=2026-01-31
GET /api/empresas/[slug]/contabilidad/bancos/[bancoId]/mayor?entidad=5&periodo=12
```

La API también admite fechas abiertas como Mayor. La UI usa rango cerrado. Máximo 5.000 líneas: superar el límite devuelve 422 y pide acotar fechas; no hay truncamiento silencioso ni otro esquema de paginación. DTO con `procedencia: LIBRO_MAYOR`, cuenta/banco/entidad, fechas resueltas, líneas y metadatos existentes de período. No devuelve saldo, totales de disponibilidad, tipo bancario o conciliado. La moneda actual del catálogo no se presenta como moneda histórica de cada línea.

## Permisos y aislamiento

El catálogo/página conserva `requireTenantModulo(..., 'contabilidad')`. La API de movimientos exige **`requireTenantContReporte(..., 'contabilidad_mayor')`**, sin fallback al permiso general del catálogo. El permiso de ver el catálogo no basta para ver el Mayor; en ese caso la consulta muestra error controlado. Se conserva la política existente de Admin. No se crean permisos nuevos ni se saltan restricciones de Facturación.

La entidad debe pertenecer a la empresa autenticada; usuarios no Admin consultan entidades activas, Admin también inactivas (MIL-BAN-01). Cuenta/banco inactivos siguen consultables para historia. No se introduce asignación individual usuario/entidad: se mantiene la política vigente por módulo/empresa. Todas las respuestas de esta API, incluidas denegaciones y errores, llevan `private, no-store`. SQL parametrizado, sin SQL/rutas privadas en errores o logs. Esquema ausente devuelve 503; no ejecuta DDL automático.

## Validación ejecutada

| Validación | Resultado y evidencia |
| --- | --- |
| Unitarias, HTTP con guard real y fuentes de sesión/permisos simuladas, DOM y regresión | **93 PASS, 0 FAIL, 0 SKIP**, diez archivos. [tests.json](evidence/mil-ban03/tests.json). |
| MariaDB real, consulta nueva y regresión original del Mayor/Diario/Balance | **14 PASS, 0 FAIL, 0 SKIP**, dos archivos. [mariadb-tests.json](evidence/mil-ban03/mariadb-tests.json). |
| TypeScript global | `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS. |
| ESLint de diez archivos afectados de código/pruebas | `--max-warnings 0`: PASS. |
| Diff y alcance | `git diff --check`: PASS; revisión manual de archivos nuevos y rutas. |

Casos cubiertos: permiso Mayor vs catálogo, revocación efectiva, empresa no autorizada, sesión ausente, módulo ausente, entidad/banco ajenos, entidad inactiva según rol, cuenta inactiva, fecha inválida/invertida/duplicada, combinación período/fechas rechazada, resolución scoped del período, límites inclusivos, orden por detalle, líneas repetidas sin colapso, importe máximo DECIMAL, centavos, vacío, ausencia de saldos/glosas, errores privados y límite de 5.000 líneas. Resolución de período cubierta en unidad; laboratorio real cubre rangos de fechas sin calendario instalado, con metadatos `SIN_ESQUEMA_C3C2` previstos por el reporte existente.

Laboratorio nuevo propio `qa-desechable-ban03`, MariaDB 11.8.9 portable existente (hash binario `de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5`), datadir exclusivo, 127.0.0.1:3399, buffer InnoDB 64 MB. No se inició el datadir de BAN-01/CxP ni se conectó a MySQL80. Aproximadamente 2.6 GiB de RAM disponibles tras el arranque corregido. FK y CHECK activos. Tablas contables originales de schema.sql y bloque original bancario FACT-4; padre `empresas` mínimo sintético. No se aplicó la migración completa de Facturación. La suite verifica versión/puerto/huella del datadir antes de crear una base nueva con marcador privado.

MariaDB rechazó por FK cruces de entidad en banco y detalle (1452), y una escritura dentro de la transacción del reporte (1792). Lectura nueva comparada línea por línea contra el Mayor; conteos e importes de tablas sin cambios tras consultar. La base nueva se eliminó sólo después de comprobar propiedad; el suite original de reportes creó/eliminó su propia base dentro del mismo runtime identificado. Cero esquemas de pruebas residuales antes de SHUTDOWN normal; pools cerrados, PID terminado, puerto libre, configuración deshabilitada y datadir conservado apagado. MySQL80 observado Running/PID 5796, sin conexión ni intervención. [Identidad/limpieza](evidence/mil-ban03/mariadb.json), [cierre](evidence/mil-ban03/cierre.json).

Reproducción dirigida:

```text
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/bancos-mayor.test.ts src/lib/contabilidad/bancos-mayor-http.test.ts src/lib/contabilidad/bancos-mayor.dom.test.ts src/lib/contabilidad/bancos.test.ts src/lib/contabilidad/bancos-http.test.ts src/lib/contabilidad/bancos.dom.test.ts src/lib/contabilidad/reportes/reportes.test.ts src/lib/contabilidad/periodos-reportes.test.ts src/lib/contabilidad/permisos.test.ts src/lib/facturacion/confirmaciones-bancarias.test.ts --no-file-parallelism
```

La suite DB sólo se habilita con `MIL_BAN03_LAB_ID=qa-desechable-ban03` y `MIL_BAN03_DATADIR_SHA256` del runtime previamente identificado; no usa puertos/credenciales productivos ni se activa por variables heredadas. Para regresión original `reportes.db.test.ts`, se proporcionó `LIQ_TEST_DB_PORT=3399` únicamente al proceso hijo después de verificar datadir propio y PID/bind. No iniciar automáticamente el datadir conservado ni probar servidores para descubrir sus identidades.

Incidencias corregidas durante el trabajo: separación inicial insuficiente del adaptador bancario y reportes detectada por el test arquitectónico; se movió el adaptador fuera del motor y la regresión pasa sin relajar tests existentes. Un script intermedio de extracción por texto acentuado falló y duplicó contenido local; se restauró el archivo desde HEAD y se aplicó sólo la extracción necesaria, comprobada con diff y TypeScript. Dependencias del checkout principal incompletas para DOM: se usaron las dependencias ya instaladas del worktree BAN-01 mediante junction local (sin cambios en package/lock). Primer arranque del runtime abortó por opción no soportada, quitada antes de conectar. No quedan fallos ocultos ni se presentan mocks como pruebas SQL.

## Riesgos residuales y pendientes Milenium

Sin prueba de navegador autenticado ni verificación de datos/esquema productivos; DOM se probó con happy-dom. Los reportes de prueba adjuntos se resumen con nombres de casos/estado/duración y rutas relativas, sin rutas privadas ni tokens.

Quedan pendientes: tipos bancarios operativos, cheques, depósitos, notas, autorizaciones y segregación, fecha efectiva bancaria, anulación/contrapartida, conciliación y disponibilidad, cobertura contable de CxC/CxP, identidad histórica de cuentas y saldos de apertura. No se certifica una partida por movimiento bancario real ni cobertura total del banco. La migración futura requiere fuente actualizada y procedimiento manual auditado propio.

No se modificaron PriceSmart, Compras, BORR-1g o trabajos de Claude Code. No hubo SQL en Hostinger, carga histórica ni efectos contables nuevos. Detención para auditoría independiente de ChatGPT; PR exclusivamente Draft.
