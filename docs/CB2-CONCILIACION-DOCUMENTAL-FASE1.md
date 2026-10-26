# CB2: conciliación documental informativa, fase 1

Base auditada: `main` en `31d9a517`, posterior a la fusión del PR #519.

## Auditoría previa

- `flota_cb2_facturas`: identidad única empresa/proveedor/serie/número;
  `fecha_factura` y `total_documental` opcionales, total `DECIMAL(18,6)`.
- `flota_cb2_consumos`: asociación vigente en `factura_id`, FK compuesta por
  empresa/proveedor/factura, índice `idx_cb2c_factura`; importes y galones
  `DECIMAL(18,6)`. `estado_factura` se deriva de la existencia del vínculo.
- `service.ts::asociarFactura`: transacción, moneda/proveedor compatibles,
  revisiones, eventos e idempotencia. Una factura admite varias importaciones.
- `repository.ts::factura`: crea/reutiliza documentos y rechaza incompatibilidades;
  `rows` es el adaptador de consulta compartido.
- `consumos.tsx`, `tabla-consumos.tsx` y `listados.tsx`: consulta, selección y
  asociación existentes. No ofrecían un balance de factura con sus consumos.
- `http.ts`: las lecturas usan `requireTenantFlotaCombustible(slug, "ver",
  { soloLectura: true })`; las escrituras validan origen y capacidad `conciliar`.
- Los campos e índices existentes bastan. No se necesitan migraciones.

## Fuentes de verdad y cálculo

Se consultan exclusivamente las facturas existentes y la asociación vigente de
`flota_cb2_consumos`. No se reconstruyen vínculos desde evidencia, eventos,
archivos, recibos o hashes. No hay persistencia de saldos ni estados nuevos.

La unión exige coincidencia de **empresa, proveedor, factura y moneda**. El
proveedor se obtiene del catálogo dentro de la misma empresa, incluyendo los
inactivos que tengan documentos históricos. No hay conversiones GTQ/USD.

La base agrupa una sola vez por factura y calcula `COUNT(c.id)`, `SUM(c.galones)`
y `SUM(c.monto)`. MariaDB suma columnas DECIMAL en aritmética decimal exacta;
no se introducen FLOAT, DOUBLE ni conversiones de importes a Number. El driver
actual conserva DECIMAL como texto. Decimal con precisión 48 normaliza los
resultados, calcula `total documental − monto asociado` y clasifica el balance.
No se redondea ningún consumo antes de sumar/comparar. El formato de pantalla
conserva hasta seis decimales y expresa explícitamente la moneda.

## Estados y precedencia

1. `SIN_TOTAL_DOCUMENTAL`: total nulo, incluso cuando tampoco hay consumos.
   Diferencia nula, sumas y cantidad disponibles.
2. `SIN_CONSUMOS`: total declarado y cero consumos de la moneda documental,
   incluso si el total es cero. Diferencia = total documental − cero.
3. `CUADRADA`: hay total y consumos; diferencia absoluta **menor o igual a 0.01**
   de la moneda correspondiente, positiva o negativa.
4. `CON_DIFERENCIA`: diferencia absoluta superior a 0.01.

La tolerancia compartida es `TOLERANCIA_DOCUMENTAL`. El predicado de estado en
la consulta usa la misma constante y precedencia para filtrar antes de paginar.
El objeto de respuesta deriva su estado mediante `balanceDocumental` (Decimal).
Una diferencia positiva significa documento mayor; negativa, consumos mayores.

Son estados **informativos**, no cierre ni aprobación. No reemplazan FACTURADO
ni modifican el resumen mensual integrado corregido por #519.

## Lecturas y seguridad

- `GET /api/empresas/[slug]/flota/combustible/cb2/conciliacion-documental`:
  proveedor opcional, búsqueda literal por serie/número, rango documental
  inclusivo, fecha TODAS/CON_FECHA/SIN_FECHA y estado derivado.
- `GET .../conciliacion-documental/[id]/consumos`: proveedor obligatorio,
  factura y cursor. Muestra únicamente consumos actualmente asociados en esa
  empresa/proveedor/factura/moneda, de todas las importaciones y fechas.
- Empresa exclusivamente del guard del servidor. Un empresa_id/empresaId del
  cliente no interviene. Los valores de filtros, IDs y cursores son parámetros.
- Solo se exporta GET. Se mantiene el comportamiento de origen de las lecturas
  CB2 existentes; la protección de origen de las escrituras no se altera.
- Cabeceras `private, no-store` y `nosniff`, errores públicos sin detalles SQL.
- Paginación por ID ascendente: 25 filas en la UI, máximo 100 por respuesta.
  Se lee límite+1 y se devuelve cursor siguiente, sin un COUNT global duplicado.
- El estado se filtra después de agregar todos los consumos de cada factura,
  pero antes de LIMIT. El cursor filtra facturas completas, no sus consumos.
  Un rango documental tampoco recorta consumos asociados por fecha de consumo.
- Una consulta por página del listado; otra solo al abrir/paginar un detalle.
  No hay N+1 ni uniones a evidencia que multipliquen importes.
- SIN_FECHA es una selección independiente del rango; la UI deshabilita las
  fechas y el servidor rechaza combinarlas. Sin rango se incluyen fechas nulas.

## Archivos

- `src/lib/flota/cb2/conciliacion-documental-model.ts`: tipos y cálculo puro.
- `src/lib/flota/cb2/conciliacion-documental.ts`: consultas de lectura, adaptador
  `rows` y pool existentes; agregado y detalle paginados.
- `src/lib/flota/cb2/http.ts`: dos acciones de lectura con el guard existente.
- `src/app/api/empresas/[slug]/flota/combustible/cb2/conciliacion-documental/route.ts`
  y `[id]/consumos/route.ts`: rutas GET con params asíncronos.
- `src/components/flota/cb2/conciliacion-documental.tsx`: filtros, tabla,
  diferencia textual, detalle perezoso y paginación.
- `panel.tsx` y `panel.module.css`: pestaña para lectores y estilos CB2.
- Tres archivos de pruebas nuevos: cálculo/consultas, HTTP y DOM.

## Validación sin bases reales

Las pruebas sustituyen el pool o el servicio con simulaciones; no se ejecuta
SQL ni se crean bases o ambientes. Cubren sumas exactas de varios consumos,
signos de diferencia, ±0.01 y ±0.010001, seis decimales, sin total, sin consumos,
precedencia, GTQ/USD, proveedores distintos, ámbito de dos empresas, asociación
de distintas importaciones, filtros, cursores, permisos y rechazo 401/403/404.
Las pruebas DOM verifican detalle perezoso, navegación, filtros en servidor,
texto de diferencias, pestaña inactiva y errores sin saldos ficticios.

Comprobaciones ejecutadas:

- TypeScript: `tsc --noEmit --incremental false`.
- ESLint de los archivos TypeScript/TSX afectados.
- Vitest 4.1.12: **93 pruebas aprobadas en ocho archivos**, reutilizando
  dependencias ya disponibles del workspace. Pruebas nuevas y regresiones de
  resumen mensual/HTTP, origen CB2 y panel. La primera ejecución con el runner
  de la carpeta raíz no pudo iniciar DOM por falta de happy-dom; se repitió la
  selección completa con el runner existente que sí incluye esa dependencia.
- `git diff --check`.

## Riesgos residuales y límites

No se verificó ejecución ni rendimiento de las consultas contra un motor real
por la restricción de esta tarea. Las simulaciones verifican contratos, ámbitos,
claves de unión, parámetros, filtros y límites, sin sustituir un EXPLAIN futuro.
Una página puede agrupar muchos consumos de una empresa; el índice existente
por empresa/proveedor/factura evita requerir una migración en esta fase.

Listado y detalle son lecturas independientes: una asociación concurrente puede
cambiar el saldo entre ambas. No representan una fotografía cerrada; una nueva
lectura obtiene el estado vigente. No se promete paginación de un snapshot.

La suma excluye asociaciones de otra moneda; las escrituras actuales impiden
crearlas. Esta fase no certifica integridad de datos alterados externamente ni
implementa reparación o validación fiscal del documento. Los estados con total
ausente seguirán presentes hasta una fase independiente de edición documental.

Sin edición, cierre/reapertura de períodos, reasociación, reversión, cambios de
esquema, importación o idempotencia. Sin conexiones a producción o despliegue.
