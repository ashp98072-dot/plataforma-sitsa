# RRHH — Listado de cumpleaños por mes

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en local.** No probado manualmente en navegador contra datos reales; no aprobado para
producción. **Sin SQL, sin migración, sin índice, sin columna nueva.** Solo lectura.

## Discovery

- **Fuente exacta de la fecha de nacimiento:** `empleados.fecha_nacimiento` (`DATE NULL`), columna de la ficha del empleado
  (`sql/migrate-2026-08-rrhh-ficha-monaco.sql`; la app la asegura vía `asegurarSchemaEmpleados` en `src/lib/rrhh/empleados-schema.ts`).
  Se captura/edita en la ficha (`empleados.ts`) y ya se exporta en `empleados-export.ts`. **No existe otra estructura**, así que no se
  creó nada.
- **Estados del empleado:** `Activo` / `Baja` (la pantalla de empleados ya filtra «Activos / Bajas / Todos»), lo que justifica la opción
  «Incluir bajas». Por defecto solo `Activo`.
- **Puesto y área:** `empleados.puesto` y `empleados.categoria_ops` (la exportación de empleados ya llama «área» a `categoria_ops`).
- **Dashboard de Talento Humano:** `src/app/e/[slug]/dashboard-rrhh/page.tsx`, alimentado por `GET /rrhh/dashboard`
  (guard `empleados:ver`).
- **Reportes:** `GET /rrhh/reportes` con guard `reportes:ver` y exportador reutilizable `tablaAExcel` (`export-files.ts`), que se reutilizó.

## Qué se implementó

| Pieza | Archivo |
|---|---|
| Reglas puras (mes, año, edad, nombre de archivo, filas de Excel) | `src/lib/rrhh/cumpleanios-shared.ts` (seguro para cliente) |
| Consultas (listado y resumen) | `src/lib/rrhh/cumpleanios.ts` |
| Endpoint JSON/Excel | `GET /api/empresas/[slug]/rrhh/cumpleanios` |
| Tarjeta del dashboard («Cumpleaños de octubre · X empleados · próximos») | `dashboard-rrhh/page.tsx` + `GET /rrhh/dashboard` (campo aditivo `cumpleanios`) |
| Vista completa | `/e/[slug]/rrhh/reportes/cumpleanios` (enlace desde la tarjeta y desde Reportes) |

### Query usada (listado)

```sql
SELECT id, codigo, nombre, puesto, categoria_ops AS area, estado,
       DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento
  FROM empleados
 WHERE empresa_id = ? AND fecha_nacimiento IS NOT NULL AND MONTH(fecha_nacimiento) = ?
   AND estado = 'Activo'               -- se omite solo con incluirInactivos=1
 ORDER BY DAY(fecha_nacimiento) ASC, nombre ASC, id ASC
 LIMIT 2001;                           -- tope defensivo (2000) + 1 para marcar truncado
```

Resumen del dashboard: un `COUNT(*)` con el mismo filtro (solo Activos) y como máximo 5 filas desde hoy; nunca la lista completa.

### Reglas

- Filtra por **MES** de `fecha_nacimiento`, no por año. La fecha de cumpleaños se arma con el **año consultado**.
- **Edad que cumple** = año consultado − año de nacimiento (`null` si el dato es incoherente, < 1).
- **29 de febrero (regla final):** quien nació un 29/02 **pertenece a febrero** y se muestra con su **fecha real, 29 de febrero**, en
  cualquier año (también en años no bisiestos). **No se convierte a 28/02 ni a 01/03**: el listado identifica cumpleaños del mes, no
  fija una fecha legal/operativa de celebración. La edad sigue siendo año consultado − año de nacimiento y `fecha_nacimiento` no se
  modifica. En un febrero no bisiesto el listado puede mostrar «29/02/2026»: es la fecha real de nacimiento (día y mes) con el año
  consultado, no una fecha de calendario existente.
- **Orden:** `DAY(fecha_nacimiento)` real ASC, luego nombre (SQL; tanto en el listado como en el dashboard).
- **Botón Excel:** solo se renderiza como enlace de descarga cuando el listado ya cargó, sin error y con al menos un empleado; en los
  demás casos es un `<button disabled>` real (no inicia ninguna descarga).

### Datos que NO se exponen

Ni en JSON, ni en pantalla ni en Excel: DPI, NIT, IGSS, IRTRA, dirección, teléfono, email, sueldos, cuentas bancarias. La consulta no
los selecciona (hay una prueba de arquitectura) y la fila devuelta tiene solo 10 campos.

### Excel

`Cumpleanios_Octubre_2026.xlsx` (sin tildes). Columnas: **Código, Empleado, Fecha de cumpleaños, Edad que cumple, Puesto, Área**.

### Permisos y tenant

- Listado y Excel: `reportes:ver` de RRHH (`requireTenantRrhh(slug, "reportes", "ver")`), igual que el resto de reportes. **No se creó
  permiso nuevo.**
- Tarjeta del dashboard: `empleados:ver` (el guard existente del dashboard); expone solo nombre y día, menos que la propia lista de
  empleados.
- La empresa sale **siempre** del tenant/sesión; el cliente solo elige mes, año, «incluir bajas» y formato (el resto se ignora).

## Rendimiento (sin índice)

- La consulta se acota por `empresa_id` (la tabla ya se consulta así en todo RRHH) y `MONTH(fecha_nacimiento)` se evalúa sobre las filas
  de esa empresa. `MONTH()` sobre la columna **no usa índice**, pero el conjunto ya está acotado por empresa (cientos de filas, no
  millones) y se pide a lo sumo una vez por vista/día.
- **No se midió volumen real** (no hay acceso a la base de producción desde esta sesión). Para que RRHH/DBA lo verifique, solo lectura:

```sql
SELECT empresa_id, COUNT(*) AS empleados, SUM(fecha_nacimiento IS NOT NULL) AS con_fecha
  FROM empleados GROUP BY empresa_id ORDER BY empleados DESC;
```

- **No se agrega índice.** Si algún día el volumen lo justificara, la propuesta sería una columna generada `MONTH(fecha_nacimiento)` con
  índice `(empresa_id, estado, mes_nac)`; queda **solo documentada**, sin SQL ejecutable.

## Pruebas

- Unitarias/endpoint (`cumpleanios.test.ts`): edad, 29 de febrero (fecha real, sin conversión), parámetros inválidos, mes/año por defecto, tenant de la
  sesión, permiso, Excel (nombre y columnas exactas leyendo el libro), sin datos sensibles, arquitectura (consulta, sin migración,
  dashboard solo con resumen, página de cliente sin código de BD).
- BD (`cumpleanios.db.test.ts`, MariaDB 11.8.9 desechable, datos sintéticos con DPI/NIT/IGSS de relleno que no deben aparecer): mes
  actual y otro mes, orden por día y nombre, solo activos/incluir bajas, aislamiento por empresa, 29 de febrero (bisiesto y no: siempre día 29), edad,
  resumen del dashboard (próximos, límite, mes distinto). Verificado con mutación (sin filtro de estado ni de empresa fallan 4 pruebas).
- `dashboard/route.test.ts` se actualizó para mockear la sección nueva y cubrir que su falla no oculta el resto.
