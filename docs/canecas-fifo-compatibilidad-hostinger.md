# Canecas FIFO: evidencia comunicada del servidor previsto

Evidencia proporcionada por el operador, no observada directamente desde este entorno. El diagnóstico fue de solo lectura; ninguna entrada autoriza instalación o merge.

| Comprobación | Evidencia | Interpretación |
| --- | --- | --- |
| Versión | `11.8.9-MariaDB-log` | Coincide con el patrón de versión del preflight; no prueba compatibilidad completa del contrato. |
| Motor | InnoDB predeterminado; tablas base comunicadas InnoDB | Alineado con las FK y transacciones; comprobar las ocho tablas exigidas y sus columnas e índices. |
| Integridad | `foreign_key_checks=ON`, `check_constraint_checks=ON` | Alineado si esos valores corresponden a la sesión del instalador. |
| Modo SQL | `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` | No contiene `STRICT_TRANS_TABLES` ni `STRICT_ALL_TABLES`: el preflight actual ordena DETENER para esa sesión. La sesión real del instalador debe comprobarse por separado. |
| InnoDB estricto | `OFF` | No es lo mismo que SQL estricto. Con OFF algunos problemas de opciones de tabla pueden ser advertencias; el preflight actual no lo exige ON. Evaluar en laboratorio representativo, sin cambiar configuración productiva. |
| Charset y collation | `utf8mb4`; Canecas `utf8mb4_unicode_ci`; empresas/usuarios `utf8mb4_uca1400_ai_ci` | Las FK nuevas declaradas usan columnas numéricas, por lo que el cotejamiento de tabla no decide su compatibilidad. Deben comprobarse tipos, signos e índices reales; comparaciones de texto requieren revisión específica. |
| Objetos FIFO | Tablas y triggers nuevos reportados ausentes | Compatible con una instalación nueva solo si la visibilidad es completa y no existen columnas u otros objetos parciales. |
| Metadatos | COLUMNS, STATISTICS y KEY_COLUMN_USAGE devolvieron 0 | NO CONCLUYENTE. Distinguir sesión/base, filtros, privilegios/visibilidad y ejecución del cliente; KEY_COLUMN_USAGE filtrada solo a FK puede estar vacía si no hay FK. |
| Permisos | phpMyAdmin muestra ALL PRIVILEGES sobre la base | Aplica a esa cuenta efectiva; no demuestra permisos de la conexión del instalador ni de la aplicación. No compartir credenciales. |

El archivo `sql/diagnostico-canecas-metadatos-auxiliar.sql` permite contrastar identidad de sesión, `DATABASE()`, conteos sin filtrar tablas, filtro binario exacto, y `SHOW CREATE TABLE`. Ejecutar los bloques de forma individual en la misma conexión, sin pegar credenciales ni información de cuentas sin redactar. Que `SHOW CREATE TABLE` funcione y `information_schema` siga vacío debe tratarse como anomalía de visibilidad o filtrado pendiente de diagnóstico, no como prueba de que faltan objetos.

El usuario de aplicación puede identificarse de forma segura desde la configuración de despliegue o mediante `USER()` y `CURRENT_USER()` en una sesión de lectura autenticada como esa cuenta; no exponer la contraseña. Una consulta desde phpMyAdmin identifica exclusivamente su propia conexión. Comparar también la cuenta del instalador, que puede ser distinta de ambas.

**NO APTO PARA MERGE ni instalación:** faltan metadatos confiables, comprobación del modo SQL de la sesión real del instalador, validación del esquema/cotejamientos y privilegios efectivos, revisión del impacto de InnoDB estricto y aprobación independiente. Hostinger despliega automáticamente al fusionar; merge y despliegue siguen sin autorización.
