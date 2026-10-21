# Viáticos: reporte según pestaña activa

Base de discovery: 3b8999a660bffb947531cfc6bfc1dee0dff3a64e.

## Causa y contrato

Los botones consumían comprobante-autorizacion-pdf/excel, consultas históricas
por autorizado_en independientes del estado actual y de los filtros visibles.
El reporte nuevo usa GET /api/empresas/[slug]/tms/viaticos/reporte con formato
pdf/excel y estado obligatorio validado: PROGRAMADO, AUTORIZADO, RECHAZADO,
ENTREGADO, LIQUIDADO. TODOS conserva la opción existente de desactivar la pestaña.
PROGRAMADO conserva la exclusión de monto asignado <= 0 del listado.

Reutiliza listarViaticosControl, agruparViaticos, PDFKit/ExcelJS y el renderer
compartido dibujarTablaEnDoc sin modificarlo. Los endpoints históricos y sus
pruebas permanecen intactos: siguen siendo comprobantes históricos, no el
reporte de estado. El reporte nuevo no inventa firmas ni reconstruye autorizaciones.

## Filtros y pantalla

Estado, búsqueda Viaje/cliente/empleado, empleado servidor, rol, método de pago,
Desde/Hasta y agrupación Día/Semana/Mes viajan a ambos formatos. Fechas y empleado
se aplican en la consulta existente, búsqueda/rol/método comparten predicado con UI.
No existe otro filtro de cliente/id o mes en este listado. Se retira el selector
de período independiente del comprobante: Desde/Hasta son el único rango visible
y usan fecha_plan, no autorizado_en. Un mes se selecciona con sus límites.
Sin rango se exporta todo lo que coincide con los demás filtros, igual que la tabla.
Grupos colapsados/expandidos y selección de checkboxes no son filtros de datos.
Los errores de descarga quedan asociados a sus filtros para no mostrar un mensaje
de Autorizados al cambiar a Rechazados, incluso si una petición anterior termina tarde.

## Seguridad y datos

Exige los guards existentes viaticos_comprobantes:ver y acceso de lectura a Viáticos.
No cambia catálogo de permisos. Empresa viene exclusivamente del guard.
Banco/cuenta se consultan únicamente con viaticos_pagar:ver; sin ese permiso las
columnas dicen Restringido, aunque se manipule la URL. Cache-Control private, no-store.

Ambos formatos incluyen viaje, fecha, cliente, empleado, rol, sugerido, asignado,
estado, método, banco, cuenta y trazabilidad real de autorización/entrega/liquidación
y observaciones. Fechas ausentes quedan vacías; no se infieren cuentas ni métodos.
Total monetario suma el monto asignado de las filas exportadas en centavos.

## Presentación

PDF A3 horizontal con título dinámico, empresa real del tenant sin recortar su
nombre, filtros, generación, conteo, grupos, subtotales y total. La trazabilidad
va en una tabla complementaria por grupo para no comprimir las once columnas
principales; el renderer existente repite encabezados al paginar.
Excel con hoja/título dinámicos, metadatos, columna Grupo, montos numéricos,
autofiltro, encabezado congelado, anchos y wrapText. No mezcla tenants.

QA local con datos sintéticos: cinco estados y lote de 110 registros, incluyendo
nombres largos y trazabilidad. No se consulta ni modifica producción.
Sin SQL, migraciones, cambios de estados/montos/acciones ni catalogos-nomina.ts.

## Validación local

- Viáticos dirigido: 694/694, incluidos contratos históricos PDF/Excel.
- Suite rama: 8916 aprobados / 21 fallidos / 15 omitidos.
- Baseline exacto: 8901 aprobados / 21 fallidos / 15 omitidos.
- Comparación de fallos por archivo relativo, nombre completo y mensaje principal:
  idénticos. Cero regresiones nuevas. Misma máquina, Node 24.18.0, npm 11.16.0,
  dependencias del mismo lock y comando vitest run.
- Los 21 fallos corresponden a 14 de endpoints Programación, 2 guards históricos
  de Compras, Centro logístico, unzip ausente, contrato de vehículo solicitado,
  wiring de exportación imagen y reporte de Atracción de talento. No se corrigen aquí.
- npx tsc --noEmit (también después del build), ESLint dirigido --max-warnings 0
  y diff-check: limpios.
- npm run build estándar (Turbopack): exitoso, con avisos en archivos no modificados.
  Para ejecutarlo se copiaron dependencias al worktree: Turbopack no admite el
  junction externo de node_modules. No cambió configuración ni package-lock.
  El intento alternativo con Webpack falló en tres exports de páginas ajenas
  (resolverUnidadAnterior, respuestaValidarValida, etiquetaConceptoFiscal),
  reproducidos también en el baseline con ese bundler. No afecta al build estándar.
- QA PDF: cada uno de los cinco estados con una fila, una página; 110 filas con
  trazabilidad, siete páginas. Revisión visual de los estados y paginación.
- No se hizo QA autenticado contra producción ni se ejecutaron consultas reales.
