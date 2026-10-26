# Revisión técnica del retiro 603 — BLOQUEADO

Esta revisión sustituye las instrucciones de activación anteriores. Se retiró
`sql/retiro-603-02-eliminacion-pendiente.sql` de la rama actual. **No recuperar ni
armar su copia del commit 0a6f3035.** El paso 02 ahora es un diseño no ejecutable,
sin sentencias DML ni ejecutor. No se ha ejecutado SQL, creado una base de pruebas
ni accedido a producción; no se autoriza retiro, merge o deploy.

**Seguimiento posterior a fd8fb2df:** el solicitante confirmó 15 columnas de 13
restricciones y una fila operativa `(603,1)` en accesos. Se propone únicamente
**APTO PARA PREFLIGHT ADICIONAL**, manteniendo el retiro bloqueado. El contraste
de evidencia, tratamiento propuesto del acceso y criterios de nueva autorización
están en [FLOTA-RETIRO-603-CIERRE-AUDITORIA.md](./FLOTA-RETIRO-603-CIERRE-AUDITORIA.md).

Invariantes: conservar 1297/KT/empresa 1/C-035BXR, sus 13 referencias de fondos,
su unidad TMS y todos los históricos. Solo 603/FRESCOFRESH/empresa 4 es candidato
a un retiro futuro. No se alteran propietarios, permisos, CB2, asociaciones ni
las correcciones previas de vehículos externos y selector.

## 1. La propia fila no es una referencia externa

En el bloque anterior, la columna numérica `flota_vehiculos.id` normalmente no
entraba en el cursor: no contiene “vehicul” ni referencia por FK al propio padre.
Pero **sí entraban los campos de texto de esa fila**, por lo que sus notas o
descripción podían mencionar 603 y bloquearla como si fuera evidencia externa.
No era correcto tratar todos esos positivos del mismo modo.

El preflight conserva la exportación completa de 603 y 1297. En las consultas que
genera para contar referencias externas añade únicamente, cuando tanto esquema
como tabla corresponden a la tabla objetivo, la exclusión de la PK 603. Aplica
al barrido numérico y de texto/JSON/binarios. Esto no excluye toda la tabla: la
fila 1297 y cualquier otra fila siguen siendo examinadas, aunque mencionen 603.
Tampoco excluye la fila 603 de una tabla homónima en otro esquema.

No hay excepciones para accesos, documentos, filtros, CB2 o auditoría; sus filas
con referencia al 603 siguen siendo externas. Se incluyen columnas FK hacia
Flota desde otros esquemas y el texto de esas tablas; si la metadata no es visible
o hay integraciones externas desconocidas, la ausencia de resultados no certifica
ausencia de referencias. Las búsquedas sin FK fuera del esquema objetivo requieren
inventario humano adicional: no se supone que todos los IDs 603 del servidor
pertenezcan al mismo espacio de identidad.

## 2. Históricos legítimos: conservar, clasificar y revisar por registro

Una coincidencia del token 603 puede ser una referencia operativa, una mención
histórica legítima o un número ajeno (importe, ID de otra entidad). El patrón
de texto solo produce **candidatos**, no decide su significado.

| Clase | Tratamiento propuesto |
|---|---|
| Referencia operativa, FK, acceso, filtro, documento o decisión reutilizable | Bloquea. No se borra, nulifica o reasocia para facilitar el retiro. |
| Auditoría/JSON histórico inmutable que describe un hecho pasado | Conservar íntegro. Puede proponerse aceptación específica tras demostrar que no tiene función operativa ni depende de una fila viva para ser legible. |
| Falso positivo de otra entidad o importe | Documentar la evidencia por fila/contenido y someter a revisión; no excluir columnas o tablas por ese motivo. |
| Candidato sin PK, ilegible, mutable o ambiguo | Bloquea; no puede aceptarse sin una identificación y validación suficientes. |

**No hay ninguna excepción aprobada ni implementada en este PR.** Para proponer
una, se necesita un manifiesto revisable con:

- esquema, tabla, PK completa, columna y ruta JSON exacta si aplica;
- hash SHA-256 de bytes exportados sin reserializar ni normalizar el histórico,
  identificación del archivo/exportación y contenido necesario para revisión;
- clase, motivo concreto y prueba de por qué no es dependencia operativa;
- revisión de los lectores/exportadores/reintentos que consumen ese registro;
- revisor, aprobación explícita, fecha y referencia de la decisión;
- evidencia de que el registro seguirá visible e interpretable después del retiro.

Una futura implementación deberá aceptar solamente la misma PK y contenido
exactos revisados. Nuevo candidato, cambio de contenido, falta de aprobación o
regla incompleta bloquean. No basta aceptar una tabla, acción, rango de IDs o
patrón de texto. Los históricos no se cambian para ajustar su hash. El evento
nuevo de un eventual retiro sería otra evidencia explícita, no motivo para ignorar
globalmente auditoría. Si eliminar el padre oculta o rompe un histórico, el retiro
físico sigue bloqueado: debe presentarse otro diseño, no forzar una excepción.

En el estado actual todo candidato externo sigue requiriendo resolución previa;
la clasificación propuesta no introduce un bypass ni habilita la eliminación.

## 3. Columnas FK, restricciones y huella v2

La comprobación anterior agrupaba restricciones y exigía 15, aunque el dato
comunicado eran **15 filas de KEY_COLUMN_USAGE**. Era un error. Una FK de dos
columnas ocupa dos filas; por ejemplo, 13 simples y una compuesta son 15 filas
pero 14 restricciones. Este ejemplo es sintético, no el inventario productivo.
KEY_COLUMN_USAGE describe columnas y sus posiciones dentro de las claves.
[Referencia oficial](https://mariadb.com/docs/server/reference/system-tables/information-schema/information-schema-tables/information-schema-key_column_usage-table).

El preflight devuelve por separado:

1. número de filas/columnas FK que apuntan a Flota;
2. número de restricciones, agrupadas por esquema de restricción, esquema/tabla
   hija y nombre de restricción;
3. filas completas, sin agregarlas, con posiciones de origen y destino, nombres
   de esquema/tabla/columnas, clave referenciada y reglas de actualización/borrado.

El LEFT JOIN conserva filas incluso cuando no es visible la regla referencial;
esa metadata incompleta debe bloquear el análisis, no desaparecer del inventario.
Debe compararse el número de filas exportadas contra el conteo crudo y revisarse
visibilidad completa. No se deduce una cantidad concreta de FK a partir del 15.

`scripts/retiro-603-inventario.ts` analiza exclusivamente un JSON exportado en
memoria, sin conexiones ni acceso a archivos. Requiere posiciones enteras y reglas
visibles; rechaza duplicados, huecos de orden y destinos inesperados. Valida el
inventario recibido, no que la exportación sea completa frente a producción.

Huella v2: SHA-256 UTF-8 de una serialización explícita versionada que incluye el
esquema objetivo y tuplas ordenadas por identidad de restricción y ordinal numérico.
Cada tupla contiene los dos esquemas de origen, tabla, restricción, ordinal,
columna, posición en la clave referenciada, esquema/tabla/columna destino, esquema
y nombre de la clave referenciada, MATCH, UPDATE y DELETE. Sin lower-case, recortes
de nombres ni dependencia del orden de propiedades del exportador. Los campos
NULL permitidos se conservan explícitamente. La huella anterior no es intercambiable.

Dos FK con igual nombre en tablas/esquemas distintos no se fusionan. Reordenar la
exportación no cambia la huella; cambiar emparejamiento, posición o regla sí.
La comparación requiere ambas cantidades y la huella; se informaron después
15 columnas/13 restricciones, pero no se aportó el manifiesto completo con huella
revisada. El helper siempre devuelve `retiroHabilitado: false`, incluso
si los manifiestos coinciden. No toma decisiones sobre históricos o permisos.

## 4. MariaDB 11.8: soporte documentado no equivale a prueba de ejecución

Se revisaron fuentes primarias; no se ejecutó parser, PREPARE ni sentencia SQL.
No se puede afirmar que el bloque anterior ejecuta/aborta correctamente en el
motor y cliente efectivos. Por eso fue retirado, en lugar de dejarlo armable.

| Construcción anterior | Análisis documental y límite pendiente |
|---|---|
| BEGIN NOT ATOMIC y delimitador | MariaDB admite bloques externos con NOT ATOMIC; no es una transacción atómica. El cliente debe transmitir todo el bloque. No se ha comprobado el tratamiento de delimitadores/autocommit por Hostinger ni su fragmentación/continuación tras errores. |
| Cursor sobre metadata | El cursor anterior era un SELECT estático y las declaraciones seguían variables → cursor → handlers. Eso es compatible con la forma documentada; no valida apertura, FETCH, cierre ni limpieza tras cada fallo. No adoptar ejemplos de cursores dinámicos preparados introducidos en MariaDB 12.3. |
| PREPARE / EXECUTE | En 11.8 se dispone de sentencias preparadas y variables de sesión; no acceden a variables locales del procedimiento. El bloque usaba variables de sesión para el SQL/resultados. Falta verificar cada SELECT dinámico, quoting, warnings, deallocation en errores y aislamiento de estado entre reintentos. No usar PREPARE LOCAL de versiones posteriores. |
| JSON_ARRAYAGG / GROUP_CONCAT | Admiten ordenación; dependen de group_concat_max_len. JSON_ARRAYAGG puede devolver NULL ante error o ausencia de filas. El bloque no exigía explícitamente snapshots no nulos y completos: comparar dos hashes NULL con igualdad null-safe puede aceptar falta de evidencia. Un handler de warnings por sí solo no prueba integridad. |
| Handlers | SQLWARNING, NOT FOUND y SQLEXCEPTION son clases diferentes. NOT FOUND también ocurre en SELECT INTO sin filas, no solo al agotar un cursor. El handler global compartía señal de fin con búsquedas de identidad; se requiere alcance local para FETCH y tratamiento explícito de otras ausencias. EXIT/RESIGNAL no prueban que se haya revertido todo. |
| Transacciones / rollback | START TRANSACTION puede confirmar una transacción previa; requiere sesión dedicada y chequeos antes de iniciarla. ROLLBACK solo protege cambios transaccionales y no deshace un COMMIT consumado. Faltan pruebas de autocommit, motores, errores, warnings, timeout, desconexión y resultado incierto del commit. |
| Snapshots / concurrencia | Comparar dos SELECT normales en REPEATABLE READ puede releer la misma instantánea y no detectar una modificación concurrente. Bloquear solo los vehículos no protege cada campo de las 13 líneas/TMS, ni referencias sin FK. Se necesitarán locks apropiados, verificación actual y ventana sin escritores/DDL, no una afirmación basada solo en hashes. |

Fuentes oficiales de la matriz:
[BEGIN/END](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/begin-end),
[DECLARE CURSOR](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/programmatic-compound-statements-cursors/declare-cursor),
[PREPARE](https://mariadb.com/docs/server/reference/sql-statements/prepared-statements/prepare-statement),
[JSON_ARRAYAGG](https://mariadb.com/docs/server/reference/sql-functions/aggregate-functions/json_arrayagg),
[GROUP_CONCAT](https://mariadb.com/docs/server/reference/sql-functions/aggregate-functions/group_concat),
[handlers](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/declare-handler),
[transacciones](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction),
[aislamiento](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/set-commands/set-transaction).

## Entrega actual y condiciones pendientes

- Solo quedan `retiro-603-01-preflight.sql` y `retiro-603-03-postcheck.sql` como
  lecturas preparadas, no ejecutadas. Generar un SELECT no lo ejecuta.
- `retiro-603-02-diseno-no-ejecutable.md` describe un contrato futuro sin DML.
- Se conserva el inventario de dependencias en FLOTA-RETIRO-603-AUDITORIA.md,
  con la corrección de 15 columnas y el dato posterior de 13 restricciones, aún
  pendientes de contraste con el manifiesto físico completo.
- Ningún archivo habilita retiro; tampoco basta con una huella coincidente.

Pendientes: inventario productivo completo y ambos conteos aprobados; candidatos
de JSON/auditoría clasificados y excepciones por registro aprobadas, si las hubiera;
revisión de archivos/integraciones; snapshots/exportaciones completas y backup;
ventana y herramienta compatibles; diseño corregido del ejecutor; y validación
real autorizada en MariaDB 11.8 de sintaxis, límites, concurrencia y fallos/rollback.
Las restricciones actuales impiden esa validación y **mantienen el bloqueo**.

Las pruebas actuales son cálculos puros del manifiesto y contratos estáticos de
los archivos de lectura/ausencia de DML. No certifican motor, cliente, transacción
ni rollback. No se implementa ni ejecuta una eliminación en esta revisión.

Resultados de esta revisión: 17 pruebas del retiro aprobadas (contratos estáticos
de archivos y cálculo puro del manifiesto). Suite del PR con `--maxWorkers=2`:
**577 aprobadas, 20 omitidas**, 55 archivos aprobados y uno omitido. TypeScript
`tsc --noEmit --incremental false`, ESLint del helper/pruebas modificados y
`git diff --check` aprobados. No se modificó código de aplicación; permanecen
los ocho errores preexistentes del cliente general ya documentados en el PR.
