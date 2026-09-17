# Compras — encargado y método habitual

Base: `25dc97661ad1d75e8fafff1274e138fa3faf6b58`. PR separado de adjuntos. No SQL ejecutado por esta rama.

## Expansión antes del deploy

Producción verificada previamente: MariaDB 11.8.9, InnoDB; Compras usa utf8mb4_unicode_ci y usuarios INT signed/globales. Antes de desplegar esta UI/API, ejecutar manualmente `sql/preflight-2026-09-compras-encargado.sql`. Base objetivo explícita: no depende de la vista activa de phpMyAdmin.

Solo continuar con APLICAR/NOOP, nunca DETENER. Migración `sql/migrate-2026-09-compras-encargado.sql`: bloque anónimo MariaDB, revalida dependencias/columnas existentes y lanza SIGNAL ante divergencia antes del ALTER. Añade al final con IF NOT EXISTS:

- `encargado_compras_usuario_id INT NULL DEFAULT NULL`.
- `encargado_compras_nombre VARCHAR(200) NULL DEFAULT NULL` (utf8mb4_unicode_ci).

Reejecutable y admite expansión parcial compatible. Si ambas existen compatibles no ejecuta ALTER. Sin recrear tablas, MODIFY/DROP/backfill/seeds ni cambios en columnas/índices anteriores. No agrega FK: el cambio mínimo agrega datos nullable; usuarios globales y acceso al tenant se comprueban en aplicación, como la selección de requirente. No promete rollback transaccional del DDL; se ejecuta fuera de operaciones de negocio.

El preflight histórico de Fase 1 conserva su contrato anterior (conteo exacto de columnas). Tras esta expansión debe usarse el preflight incremental nuevo; no reinterpretar el histórico ni modificar aquella migración.

El encargado es un usuario independiente conceptualmente de requirente/solicitante/autorizante. Puede ser la misma persona real si corresponde, sin reutilizar campos. Selector usa catálogo tenant-safe existente; server resuelve usuario activo con acceso al tenant y toma su nombre de BD. Cliente no puede mandar nombre snapshot. Campos opcionales/nullable: no se impone una nueva obligatoriedad ni se inventa responsable para históricos. PATCH omitido preserva ID/snapshot, ID explícito revalida y cambia snapshot, null desasigna. UI omite el campo si no fue cambiado, preservando también encargados históricos inactivos al editar otros datos.

## Método habitual

Consulta manual de producción compartida por el usuario: único valor distinto no vacío `TARJETA DE CREDITO`, 16 proveedores. No se consultó ni modificó producción desde esta rama.

Normalización compartida cliente/servidor: trim, comparación sin acentos, mayúsculas ni espacios repetidos. TARJETA DE CREDITO, Tarjeta de Crédito, Tarjeta crédito y TARJETA → `Tarjeta de crédito`. Conservar Efectivo, Transferencia, Transferencia móvil, Cheque y Otro. Los desconocidos conservan texto (VARCHAR(80)), con opción visible dinámica; nunca se descartan ni se convierten silenciosamente a Otro.

Autocompletado solo en evento explícito de cambio de proveedor, nuevo o existente. Habitual vacío conserva método actual. Cargar catálogo/abrir edición no modifica método histórico. Usuario puede cambiarlo manualmente después. El servidor valida longitud/texto sin controles y normaliza los métodos nuevos/modificados; PATCH sin cambiar proveedor/método conserva el valor histórico original. No se modifica el maestro de proveedores ni se agregan campos auxiliares.

No se autoselecciona Crédito a partir de días_credito: el crédito habitual del proveedor no demuestra las condiciones de esta compra. Banco/cuenta siguen siendo snapshots del proveedor resuelto en servidor. Sin cambios de permisos, estados, autorizaciones, total/cálculos, Fondos/Gastos, RRHH, adjuntos ni PDF.

Sintaxis del bloque anónimo y ALTER aditivo conforme a documentación oficial MariaDB: [bloques fuera de procedimientos](https://mariadb.com/kb/en/using-compound-statements-outside-of-stored-programs/) y [ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table). Verificaciones SQL son contratos estáticos; no sustituyen ejecutar el preflight manual antes de aprobar/aplicar en producción.
