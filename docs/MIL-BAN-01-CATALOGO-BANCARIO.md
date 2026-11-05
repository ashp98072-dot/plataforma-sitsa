# MIL-BAN-01 — Catálogo bancario contable por entidad

Base confirmada: `origin/main` en `0862cdcf852a47bc4e4ae9802a38b2f1942d018b` (PR #570). Rama/worktree exclusivos: `feature/mil-ban01-catalogo` / `.worktrees/mil-ban01`. Estado: implementado para auditoría independiente, sin autorización de producción.

## Auditoría previa y decisión

La estructura existente es reutilizable; no se necesita SQL nuevo ni otra arquitectura bancaria.

| Estructura/componente | Hallazgo y reutilización |
| --- | --- |
| `cont_cuentas_bancarias`, FACT-4 | Ya contiene empresa, entidad, cuenta contable, banco, alias, referencia, moneda y activa. UNIQUE por empresa/entidad/cuenta y FK compuestas a entidad y cuenta. Se consulta la tabla existente; no se crean bancos ni registros históricos. |
| `cont_cuentas` / `cont_entidades` | Cuenta vinculada mediante empresa + entidad + ID. Se valida entidad en la empresa antes de consultar; LEFT JOIN scoped permite advertir vínculo ausente/inconsistente sin revelar una cuenta ajena. |
| `requireTenantModulo`, `requireTenant`, permisos efectivos | Guard real de Contabilidad en página y API, incluida revocación y acceso a empresa. No permisos nuevos ni fallback a Facturación. Empresa/actor proceden del contexto autenticado, nunca del query del cliente. |
| `ambitoDesdeRequest`, `AccesoContable` | Parser de entidad, actor y rol existentes; error controlado. Se rechazan parámetros extra, vacíos y duplicados. |
| `listarEntidades`, `libroUnicoActivo` | Catálogo/selección existentes: usuarios consultan entidades activas; Admin también puede consultar las inactivas de su empresa. |
| FACT-4 / contexto y facturas de Facturación | Ya resuelven banco de entidad para contado. No se modifican ni duplican sus servicios de escritura. |
| `confirmaciones-bancarias.ts` / CxC | Ya consumen el catálogo para confirmar cobros y su procedencia. Confirmación de cobro no equivale a libro bancario, conciliación o saldo; no se reinterpretan esos registros. |

Se revisaron `CONTABILIDAD-PARAMETRIZACION-ROLES-BANCOS.md`, `MILENIUM-INVENTARIO-FUNCIONAL.md` y la sección Bancos de `MILENIUM-M1B-CALIBRACION-PROCESOS.md`. El inventario histórico identifica b01/b02 (bancos/cuentas), b03 (movimientos) y b06 (saldos); esta entrega sólo consulta el catálogo configurado en Novalvion. No se abrió ni importó la copia histórica. Las vigencias, alias, monedas y referencias pendientes en la propuesta documental no se inventan ni se cargan aquí.

### Permisos y #555

La política efectiva vigente autoriza Contabilidad por módulo/empresa; no aplica asignación por usuario/entidad. `cont_entidad_usuarios` existe históricamente, pero `ambito.ts`, `entidades.ts` y los tests de permisos explícitamente no lo usan como un segundo sistema de autorización. Este ticket conserva esa política: el permiso efectivo de Contabilidad habilita las entidades activas de la empresa autorizada; Admin puede consultar las inactivas de esa misma empresa. Una entidad ajena/inexistente devuelve 404 sin consultar bancos. No se afirma aislamiento adicional por asignaciones individuales inexistentes ni se modifica #555. Un requisito futuro de asignación individual requiere resolver esa política transversal, no ampliar/restringir permisos aquí de forma paralela.

### Prerrequisitos del esquema

La instalación objetivo debe tener entidades y ámbito contable C2B, además de FACT-4 (catálogo bancario). Se inspeccionaron `migrate-2026-08-contabilidad-entidades.sql`, `migrate-2026-08-contabilidad-entidad-integridad.sql` y `migrate-2026-10-fact-4-lineas-contado-retencion.sql`. La propuesta `cont_cuentas_rol` no condiciona esta consulta y no se aplica. No se verificó el estado de producción: ninguna consulta SQL se envió a Hostinger. Tabla/columna ausente produce 503 privado `MIGRACION_PENDIENTE`; no ejecuta DDL automático ni presenta vacío como esquema válido.

## Comportamiento implementado

- Enlace desde Contabilidad → Consultar cuentas bancarias contables; página `/e/[slug]/contabilidad/bancos`.
- API exclusivamente GET `/api/empresas/[slug]/contabilidad/bancos`: sin entidad devuelve opciones autorizadas; con `?entidad=N` devuelve sólo su catálogo. No acepta empresa, usuario ni privilegios en parámetros.
- Muestra banco, alias, moneda, cuenta contable y estado registrados. Incluye cuentas bancarias inactivas explícitamente; advierte cuenta contable inactiva, incompleta o no disponible y configuración faltante. No sustituye moneda/alias/banco ausentes por valores de negocio supuestos.
- Proyección SQL mínima: nunca selecciona `referencia`, números bancarios ni credenciales. Defensa adicional en textos de presentación: secuencias numéricas largas con separadores se ocultan; el código contable se conserva como identificador contable. React trata los textos como texto, sin HTML arbitrario.
- Respuestas privadas `private, no-store`, incluidos errores de guard y esquema. Sin SQL, datos sensibles ni excepciones crudas en mensajes/logs. Parámetros SQL ligados. Lectura de entidad y catálogo en transacción READ ONLY / REPEATABLE READ.
- Carga, vacío, falta de permisos y errores explícitos. Cancelación y remontaje al cambiar entidad evitan mezclar respuestas tardías. Se conserva apariencia y navegación contables existentes.
- No hay importes ni cálculos monetarios en el DTO; no se introduce conversión de DECIMAL ni saldos. Sin POST/PUT/DELETE, configuración, movimientos, cheques, depósitos, pólizas, conciliación o importaciones.

## Verificación ejecutada

| Comprobación | Resultado |
| --- | --- |
| Tests unitarios/HTTP/DOM dirigidos + permisos, selección y confirmaciones | **48 PASS, 0 FAIL**, seis archivos; guard HTTP real con fuentes de sesión/permisos simuladas. DOM happy-dom, no navegador autenticado. |
| MariaDB real, `bancos.db.test.ts` | **3 PASS, 0 FAIL, 0 SKIP**, una ejecución. No se presentan mocks como SQL real. |
| TypeScript global `tsc --noEmit --incremental false` | PASS |
| ESLint de archivos afectados, `--max-warnings 0` | PASS |
| `git diff --check` y revisión de alcance | PASS; sólo Bancos/Contabilidad, pruebas y documentación/evidencia |

Comando local de regresión:

```text
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/bancos.test.ts src/lib/contabilidad/bancos-http.test.ts src/lib/contabilidad/bancos.dom.test.ts src/lib/contabilidad/permisos.test.ts src/lib/contabilidad/seleccion-libro.test.ts src/lib/facturacion/confirmaciones-bancarias.test.ts --no-file-parallelism
```

El primer pase detectó una parametrización incorrecta de `it.each` en el test nuevo (array vacío expandido como argumentos); se corrigió el fixture de prueba. No hubo fallo productivo ni fallo heredado pendiente que requiriera comparar con main limpio. Después de corregir ese test, TypeScript global y la regresión pasan. No se modificaron pruebas existentes para tolerar fallos.

### Laboratorio propio, real y cerrado

Alias `qa-desechable-ban01`, MariaDB `11.8.9-MariaDB`, Windows portable, únicamente `127.0.0.1:3399`. Datadir nuevo exclusivo, ajeno a los laboratorios PriceSmart/CxP y a MySQL80. RAM disponible antes del arranque 4,49 GiB; disco libre 31,08 GiB. Sin servicio permanente, VM ni datos reales; configuración exclusiva sin defaults globales, feedback/eventos/LOCAL INFILE deshabilitados. FK y CHECK permanecieron activos.

La suite exige identidad específica `MIL_BAN01_LAB_ID=qa-desechable-ban01` y `MIL_BAN01_DATADIR_SHA256` de un expediente previamente autorizado; no se habilita por `LIQ_TEST_DB_PORT` heredado. Reutiliza las guardas de versión/loopback/huella de QA existentes sin modificar CxP. El operador debe autorizar e identificar el runtime antes de definir esas variables; nunca descubrirlo probando conexiones a servidores desconocidos. No iniciar automáticamente el datadir conservado.

Se creó `ban_qa01_7366536dabab48afb2426866b18aa58b` sin IF NOT EXISTS y con marcador secreto de propiedad. Padres contables mínimos sintéticos; se aplicó **únicamente el CREATE TABLE bancario original de FACT-4**, intacto y con sus FK/UNIQUE. No se ejecutaron los ALTER de Facturación ni la migración completa. La prueba confirma rechazo 1452 para cuenta ajena de entidad/empresa o inexistente. La lectura de vínculos rotos se cubre en unidad: las FK reales impiden generar ese estado sin debilitar restricciones; no se deshabilitaron para simularlo.

La suite confirmó token/nombre antes de DROP; base eliminada y cero esquemas residuales. Pool cerrado, SHUTDOWN normal, PID 13056 terminado y puerto 3399 libre. MySQL80 conservó Running/PID 5796, sin conexión ni intervención. Datadir privado conservado apagado con configuración deshabilitada. No hubo incidencias de aislamiento o limpieza.

Evidencia sanitizada: [mariadb.json](evidence/mil-ban01/mariadb.json), [casos SQL](evidence/mil-ban01/mariadb-cases.json), [verificación y hashes de fuentes](evidence/mil-ban01/verificacion.json). No incluye credenciales, token, datadir en claro ni rutas privadas.

## Alcance de la evidencia y riesgos residuales

No se comprobó ni cambió configuración productiva, vigencia bancaria real, moneda correcta de un banco real ni equivalencia completa con Milenium. El catálogo refleja lo registrado y advierte carencias detectables; no certifica integridad bancaria. No hay ensayo visual en navegador real ni migración de históricos. El modelo vigente limita a una fila bancaria por cuenta contable y entidad: no se añadió otro catálogo para permitir múltiples alias.

Las referencias sensibles no se exponen; textos libres heredados pueden necesitar saneamiento en origen. La ocultación de secuencias numéricas largas es una defensa adicional, no validación de autenticidad del dato bancario. Una instalación sin FACT-4 debe resolver su migración manual fuera de este ticket, con autorización propia.

## Diferencias con Milenium y siguiente incremento

Milenium incluye movimientos, cheques/depósitos, conciliación y saldos por período. Esta entrega sólo consulta el catálogo existente de Novalvion y su vínculo contable. No utiliza b03/b06 para construir saldos ni migra datos históricos desactualizados.

Recomendación MIL-BAN-02: calibrar tipos y estados de movimientos (BAN-Q03), fecha efectiva (BAN-Q05) y reversión (BAN-Q07), y preparar una consulta trazable de movimientos con procedencia confirmada, reutilizando confirmaciones bancarias cuando corresponda. No implementar cheques, depósitos o conciliación hasta confirmar esas reglas y evitar duplicar efectos de CxC/CxP. La futura migración requiere una fuente actualizada y autorización formal independiente.

Entrega en un único PR Draft; sin merge, despliegue, cambios en PriceSmart, TMS, Compras o BORR-1g. Detención para auditoría independiente.
