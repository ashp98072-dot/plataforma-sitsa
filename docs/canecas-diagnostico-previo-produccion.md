# Diagnóstico previo de producción para la simplificación de Canecas (#688) — solo lectura

Objetivo: obtener evidencia de que el esquema **actual** de Hostinger coincide con lo que espera el instalador, **sin modificar nada** y sin ejecutar la
migración. Lo ejecuta el propietario (el entorno de Claude no tiene acceso de red a `srv1918.hstgr.io:3306` ni credenciales). No usar `main` ni desplegar.

## Qué comprueba (todo de solo lectura)
| Comprobación | Fuente |
|---|---|
| Versión `11.8.9-MariaDB` | `VERSION()` |
| Privilegios directos de la cuenta: SELECT, CREATE, ALTER, INDEX, REFERENCES, TRIGGER (acepta el nombre de base con `\_` escapado) | `SHOW GRANTS` + `privilegios.mjs` |
| `foreign_key_checks` y `check_constraint_checks` activos | variables de sesión |
| Las **17** tablas de Canecas de las migraciones anteriores | nombres leídos de las 6 migraciones |
| Estado de la simplificación (ausente / completa / parcial) | mismo método que el instalador |
| Contrato de **redistribución** (tablas, columnas, índices, FK, CHECK, triggers) | `verificarContratoRedistribucion` |
| Criterio **FIFO** ejecutable | `verificarCriterioFifo` |
| Contrato de **catálogos** | `verificarContratoCatalogos` |
| Contrato de **ventas** anterior (2 tablas, 4 triggers) | `verificarContratoVentas` |
| Compras históricas sin proveedor de Canecas mapeado (informativo) | `verificarMapeoProveedoresCompleto` |
| Preflight de la simplificación (22 comprobaciones; con la simplificación ya instalada, el postcheck de 15 y el contrato nuevo) | `sql/preflight-…` / `sql/postcheck-…` |

Con la simplificación **ya instalada**, los contratos anteriores de catálogos y ventas se marcan `OMITIDA` (la simplificación modifica `canecas_compras` y `canecas_ventas`, y sus instaladores la rechazan a propósito) y los reemplaza el contrato de simplificación.

Cada contrato se informa por separado: una falla **no** detiene las demás. La sesión se fuerza a `SET SESSION TRANSACTION READ ONLY` y el diagnóstico
**se detiene sin consultar nada** si el servidor no lo confirma; el servidor rechaza cualquier escritura de esa sesión (probado en MariaDB 11.8.9).

## Procedimiento seguro (desde un equipo con acceso autorizado a la base)
1. Habilitar Remote MySQL en hPanel solo para su IP y obtener la **CA** del servidor con TLS verificable (nunca desactivar la verificación). Alternativa sin acceso remoto:
   ejecutarlo por SSH en el propio servidor con host `127.0.0.1` (si el servidor MySQL no ofrece TLS en local, indicarlo: es un bloqueo a resolver, no se omite).
2. Obtener el código **sin cambiar de rama de trabajo** y sin instalar nada en producción:
   ```bash
   git clone --depth 1 --branch feat/canecas-simplificacion-688 https://github.com/ashp98072-dot/plataforma-sitsa.git diag-simplificacion
   cd diag-simplificacion && npm ci
   ```
3. Variables en la sesión (la contraseña se lee sin eco y no se guarda en archivos ni en Git; ideal: una cuenta de solo lectura con SELECT):
   ```bash
   export CANECAS_SQL_HOST=srv1918.hstgr.io CANECAS_SQL_PORT=3306 CANECAS_SQL_DATABASE=u611730801_Plataforma
   export CANECAS_SQL_USER=<usuario> CANECAS_SQL_CA=<ruta/ca.pem>
   read -rs CANECAS_SQL_PASSWORD && export CANECAS_SQL_PASSWORD
   ```
4. Ejecutar (no escribe nada):
   ```bash
   node scripts/ci/canecas/diagnostico-previo-simplificacion.mjs --solo-lectura | tee diagnostico-previo.txt
   ```
   Código de salida: `0` sin bloqueos, `2` hay comprobaciones en FALLO, `1` no se pudo completar (conexión, TLS, solo lectura).
5. Entregar `diagnostico-previo.txt` (no contiene credenciales ni cadenas de conexión; revisarlo antes de compartirlo). Se interpreta así:
   - `RESULTADO: SIN BLOQUEOS` y todos los contratos en `OK` → el esquema previo coincide; el preflight no detiene.
   - Un contrato en `FALLO` → el mensaje nombra la sección que difiere (columnas, índices, FK, CHECK o trigger). No instalar; enviar la salida para revisarla.
   - Preflight en `FALLO` por «más de una caneca activa», referencias duplicadas o sufijos de más de 15 dígitos → decisión del propietario (qué desactivar o corregir); el script nunca elige.
6. Complemento opcional **solo SQL** (phpMyAdmin, solo `SELECT`): `sql/contrato-base-canecas-solo-lectura.sql` y los `sql/recuperacion-canecas-*-solo-lectura.sql` ya existentes.

## Lo que este diagnóstico NO hace
No instala, no corrige, no modifica datos ni configuración, no valida el respaldo ni sustituye la autorización expresa. El respaldo restaurable y la ventana
sin escrituras siguen siendo requisitos de la instalación (`docs/canecas-simplificacion-instalacion.md`).
