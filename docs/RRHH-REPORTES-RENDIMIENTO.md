# RRHH: imports diferidos y filtro temprano de horario

Base: `418191094a85ca4ffcb6af6f8c1f913316ae6ece`.

## Alcance y equivalencia

Únicamente `GET /api/empresas/[slug]/rrhh/reportes` y la construcción del reporte de asistencias. La ruta importa `export-files` mediante `await import()` exclusivamente en sus cuatro ramas PDF/XLSX (asistencias e incidencias). JSON y una denegación de permisos no evalúan ese módulo pesado. El generador compartido, sus opciones, encabezados, filas, formatos y respuestas permanecen intactos.

El horario procede del empleado y es constante en todas sus filas. Se aplica antes del bucle de días usando exactamente el criterio anterior: fallback `Fijo`, `includes('Variable')` sensible a mayúsculas, `Todos`/vacío/ausente sin filtro y cualquier otro valor no vacío selecciona no variables. El filtro de estado/motivo y el orden fecha descendente/nombre español permanecen iguales. No cambia ninguna consulta ni parámetro SQL, permiso, total o regla de vacaciones. Incidencias conserva su comportamiento existente (no se le añade filtro de horario).

## Medición reproducible BASE vs HEAD

Windows, Node 24.18.0, npm 11.16.0; mismas dependencias locales. El mismo archivo `src/lib/rrhh/reportes-benchmark.test.ts` se ejecutó en un checkout separado de la base y en la rama. BD completamente mockeada; ningún dato real. Cinco ejecuciones después de calentamiento por caso; mediana de construcción y de serialización por separado. Contador temporal de `Array.push` en una ejecución adicional, fuera de las mediciones de tiempo, restaurado en `finally`.

```powershell
$env:RRHH_REPORTES_BENCH='1'
npx vitest run src/lib/rrhh/reportes-benchmark.test.ts
Remove-Item Env:RRHH_REPORTES_BENCH
```

Dataset: empleados activos desde 2020, año 2026 completo, 313 días laborables sin feriados en el mock, sin sesiones/incidencias/en-ruta. Mezcla: 50% Fijo y 50% Variable. Cada salida publica SHA-256 del JSON: los cuatro hashes de BASE y HEAD coincidieron exactamente.

| Caso | Construcción BASE → HEAD | Reducción | Filas construidas BASE → HEAD | Filas devueltas | Bytes JSON, iguales | SELECT por pasada, iguales |
|---|---:|---:|---:|---:|---:|---:|
| 104, mezcla, Variable | 16.62 → 8.17 ms | 50.8% | 32.552 → 16.276 | 16.276 | 4.539.127 | 5 |
| 1.000, mezcla, Variable | 219.07 → 93.57 ms | 57.3% | 313.000 → 156.500 | 156.500 | 43.942.071 | 5 |
| 1.000 Fijo, Variable | 298.96 → 0.16 ms | 99.95% | 313.000 → 0 | 0 | 2 | 5 |
| 1.000, mezcla, Todos | 318.87 → 281.37 ms | No atribuible al cambio | 313.000 → 313.000 | 313.000 | 87.258.141 | 5 |

Serialización BASE → HEAD, respectivamente: 15.06 → 15.90; 210.11 → 174.33; 0.0084 → 0.0008; 512.96 → 392.17 ms. No se optimizó serialización: diferencias de tiempo con salida idéntica son ruido de ejecución/GC/carga local. No se promete mejora para `Todos`. Las cinco consultas corresponden al helper caliente con configuración cacheada; excluyen guard/periodos de la ruta. No se reducen viajes a BD.

### Imports/bundle

Antes: una dependencia estática desde la ruta a `export-files`, que importa ExcelJS y PDFKit. Después: ninguna importación estática de exportación en esa ruta; cuatro puntos de carga condicional, reutilizando el caché normal del módulo. Prueba de wiring: JSON evalúa el módulo 0 veces; PDF/XLSX siguen invocando el generador correspondiente. No se cambian bundles de cliente ni se afirma una reducción de bytes transferidos.

Medición auxiliar en proceso Node nuevo: `require('exceljs')` 1.482 ms y `require('pdfkit')` 317 ms adicionales. Es costo local de carga de dependencias, NO latencia de una ruta Next ni ahorro garantizado de producción. El runtime/bundler puede mantener módulos calientes; el primer export asume el costo diferido. No se separan las dos librerías dentro del generador compartido para evitar cambios a exportaciones de otros módulos.

## Pruebas y riesgos

- 30 combinaciones horario/estado comparan el resultado temprano con el filtro histórico aplicado a las mismas filas completas, incluido orden y JSON exacto.
- Cobertura de horario con mayúsculas distintas, nulo, alta tardía, feriado, domingo, sesión multidía, fotos, incidencias y en-ruta.
- JSON, permiso denegado y cuatro variantes de exportación verifican carga diferida, filtros, headers, contenido y nombre de archivo.
- Smoke real: genera y abre Excel; genera y abre PDF. Los generadores no se modifican.
- Benchmark opt-in para no introducir umbrales temporales frágiles ni stress anual en CI.

Comparación dirigida RRHH: BASE 1.827 aprobadas / 1 fallo / 11 omitidas; HEAD 1.865 aprobadas / 1 fallo / 11 omitidas (incluye 38 pruebas nuevas; benchmark omitido por defecto en ambos). Mismo fallo en `vacaciones-sync-invalida.test.ts`, test `contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta`; comparación textual CRLF del esquema/migración en Windows. No se corrige un test ni SQL ajeno. No hay fallos nuevos.

Validación: `npx tsc --noEmit`, ESLint de los seis archivos TypeScript y `git diff --check` limpios; `npm run build` exitoso. El build conserva avisos en archivos no modificados sobre middleware, Cache-Control y cuatro accesos dinámicos al filesystem; no se amplía alcance para corregirlos.

Riesgos restantes: los reportes sin filtro siguen construyendo el historial completo; SQL/red/guard y exportación CPU no se aceleran con este cambio. Validar manualmente JSON, filtros Variable/Fijo y ambos exports de asistencia/incidencias tras un despliegue aprobado. Los números anteriores NO son latencias de producción.

Sin SQL, índices, datos reales, workers, paginación, Operaciones/TMS/Liquidación ni merge.
