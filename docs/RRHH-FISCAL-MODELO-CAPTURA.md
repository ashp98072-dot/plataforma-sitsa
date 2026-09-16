# PR 1 — modelo/captura fiscal, sin motor

Base: `3272465555355508e7c68162dcbf5f64332f9638`. Estado de producción confirmado por el responsable: MariaDB `11.8.9-MariaDB-log`; ambas tablas fiscales InnoDB, utf8mb4, vacías, PK y únicos del diseño presentes; ninguna FK física. Esta rama no consultó ni escribió la BD.

## Schema y propuesta de migración

`schema.sql` no incluía ambas tablas. Ahora documenta su baseline para instalaciones nuevas: columnas económicas/auditoría y los tres únicos reportados, sin FKs. Usa el tipo lógico JSON: MariaDB lo representa físicamente como LONGTEXT, con su collation/validación JSON asociada ([referencia oficial](https://mariadb.com/docs/server/reference/data-types/string-data-types/json)). En aplicación se valida el contrato estricto, sea texto u objeto de mysql2. No alterar tipos, CHECKs existentes ni collation de producción; confirmar su definición exacta con SHOW CREATE TABLE.

La migración histórica `sql/migrate-2026-09-rrhh-fiscal-modelo.sql` hace reproducible el cambio en otras instalaciones existentes/restauraciones: contiene únicamente dos `CREATE TABLE IF NOT EXISTS` con el mismo contrato de `schema.sql`. Producción recibió las tablas manualmente antes de registrar esta migración; allí es **NO-OP**, sin alterar ni validar automáticamente su esquema. No incluye FKs, ALTER, borrado, backfill, seeds ni conversión LONGTEXT/JSON. No fue ejecutada por esta rama/PR. No ejecutar `schema.sql` contra producción. El archivo `preflight-2026-09-rrhh-fiscal-modelo.sql` es una propuesta reejecutable de solo lectura para contrastar VERSION, engines, tipos exactos, índices, FKs y huérfanos; tampoco fue ejecutado por este PR.

FKs quedan para migración aditiva separada y autorización previa. Exigir igualdad exacta de tipo/tamaño/signedness de las claves, InnoDB en padres/hijos y cero huérfanos/tenants incompatibles. Preferir `(empresa_id,id_empleado) -> empleados(empresa_id,id)` más `empresa_id -> empresas(id)` sin cascada: comprobar el índice compuesto real del padre (el repo declara `uq_ruta_personal_empresa_id`). Detectar FK equivalente por columnas/referencias antes de cada ADD para idempotencia, no solo por nombre. Si falta índice compatible, proponer su adición separadamente. No se ofrece ALTER ejecutable hasta validar esos resultados; tablas vacías no prueban compatibilidad de tipos.

## API y permisos

Endpoint: `/api/empresas/[slug]/rrhh/fiscal/empleados/[empleadoId]/[ejercicio]`.

- GET: `configuracion:ver`, devuelve última revisión, última confirmada e historial limitado a 100 revisiones.
- POST: `configuracion:crear`, `{expectedRevision, antecedente}`; crea una revisión nueva, nunca sobreescribe datos. Primera captura usa `expectedRevision: 0`.
- PATCH: `configuracion:editar`, `{accion:"confirmar", revision}`; confirma solo la última revisión completa. Repetir confirmación rechaza con 409.

Reutiliza el guard RRHH existente (sesión, empresa activa, acceso a empresa y permisos; excepción Admin existente). Tener permiso de Planillas/Empleados por sí solo NO habilita esta API. No cambia catálogo/matriz/UI de permisos. Confirmación significa verificación de antecedentes manuales, **no autorización de Planillas ni aceptación jurídica del tratamiento declarado**. El motor posterior revalidará reglas, evidencia y límites.

Empresa y responsable proceden únicamente del guard; cuerpo estricto no admite empresa/usuario/confirmadoEn ni metadatos de auditoría. Empleado debe existir en esa empresa, sin filtrar estado Baja. Cada documento debe existir para ese empleado/empresa; IDs no se convierten en URLs públicas. Respuestas private/no-store; errores internos no exponen SQL, rutas o contenido. No hay logs de antecedentes.

## Contrato y consistencia

`AntecedenteFiscal`: fechas nullable, cuatro acumulados DECIMAL como cadenas con dos decimales (NULL desconocido, no cero), `datos.version:1`. JSON estricto, fechas calendario reales del ejercicio, límites de listas/texto, IDs positivos y sin claves desconocidas. Importes se concilian en centavos BigInt sin redondeo flotante.

`datos`: declaración explícita de antecedentes; constancias; ingresos previos por concepto con monto y partes gravada/exenta, tratamiento declarado, fundamento, período, patrono/constancia/documento y observaciones de límites; ajustes previos explicativos; deducciones solicitadas y evidencia/estado; declaración/remuneraciones de otros patronos. Ajustes ya incluidos en acumulados no se suman de nuevo. No guardar ni derivar aquí acumulados propios de Planillas. Deducciones solicitadas no se aplican automáticamente.

Captura permite incompletos conocidos como borrador; confirmación exige declaración conocida, acumulados completos, constancias/fechas si hay antecedentes, referencias compatibles, desglose y fundamento/observaciones completos, conciliación de totales, multiempleo documentado y evidencias tenant-safe. No inventar datos ausentes. Este PR no decide exenciones, aplica límites ni calcula impuesto. La revisión de cobertura con percepciones propias y la admisibilidad jurídica de documentos corresponden a integración/motor posteriores.

Una fila económica/JSON nunca se edita: corregir crea siguiente revisión. Solo confirmación añade responsable/hora del servidor. La lectura confirmada conserva la anterior aunque haya borrador posterior.

Captura/confirmación bloquean el empleado tenant-safe con FOR UPDATE para serializar revisiones/confirmaciones (incluida primera captura); expectedRevision detecta datos obsoletos. Evidencias se bloquean/revalidan. Inserción/confirmación y auditoría se confirman dentro de una transacción; cualquier error revierte. Auditoría contiene solo identidades/revisión, no importes ni documentos. Verificación de engines falla cerrado si las cuatro tablas operativas no son InnoDB. No se modifica auditoría existente ni se ejecutan liquidaciones.

## Fuera de alcance

Motor ISR, parámetros/tasas, cambios fiscales 2026/2027, IGSS, cálculo/consumo/estado/snapshots de Planillas, UI, scrollbar, liquidaciones ejecutables, backfill e imports propios. `rrhh_fiscal_liquidaciones` solo figura en el baseline; no hay API/helper de ejecución.

## Verificaciones

Typecheck y lint dirigido; tests del contrato JSON/centavos/conciliación, helpers de lectura/captura/confirmación, permisos de ruta, tenant/evidencias, revisiones obsoletas/idempotencia y rollback de auditoría. DB/concurrencia se prueban con mocks de conexiones e interleavings; no es una prueba real contra MariaDB ni de sus constraints. Suite completa ejecutada; mantiene fallos ajenos de app-shell Reportes y test TMS por falta de `unzip`, reproducidos también sin este modelo. Pendiente prueba de integración en entorno autorizado y revisión de FKs/tipos exactos; ninguna consulta SQL real fue ejecutada por esta rama.
