# Importaciones de combustible: preview HALEL / SHELL (PR 1)

## Alcance

Preview de solo lectura. No guarda Excel, filas, consumos, facturas ni adjuntos.
No cambia SQL, HALEL v1 persistido, conciliación C2C, aprobaciones o movimientos financieros.
El selector de flujo conserva la importación histórica HALEL v1, cuyo contrato y confirmación permanecen intactos.

## Contrato

`PreviewProveedorV2`: `versionContrato: 2`, `versionParser: 1`, perfil explícito HALEL/SHELL,
filas originales con hoja/fila/celdas, textos originales y valores normalizados.
Fecha significa consumo exclusivamente en v2. Identificadores son texto; los números seguros
con formato `000...` conservan padding. Un identificador numérico fuera del rango seguro
se señala como inválido: el lector no reconstruye dígitos perdidos en el archivo de origen.

Encabezados detectados por contenido dentro de las primeras 25 filas. Columnas mínimas:
fecha, vale, placa, galones, precio y monto. Encabezados ambiguos se rechazan.
Se conservan títulos, subtotales y notas como evidencia IGNORADA. Una fila con vale o placa y
datos operativos incompletos se muestra como INVALIDA. Una anotación con solo fecha e importe
en la columna de placa, sin vale ni galones/monto en sus columnas, no se trata como consumo.

Fechas fuera del mes de la hoja se advierten sin corregirlas. Piloto, producto, km y factura
pueden faltar; no se crean empleados, vehículos ni facturas. Kilometraje textual queda en evidencia.
Números usan Decimal y strings: seis decimales para cantidades/precios/montos, tres para km.
Solo residuos binarios de valores numéricos dentro de tolerancia relativa 1e-15 pueden
normalizarse a esa escala. Texto de precisión excesiva no se redondea silenciosamente.
Galones × precio contra monto usa aviso de diferencia superior a Q0.01, sin alterar el monto.

## Fórmulas

HALEL v2 no acepta fórmulas operativas. SHELL admite:

- GLS = monto/precio de la misma fila, incluidas referencias absolutas y fórmulas compartidas.
- MONTO = suma de dos a veinte literales decimales positivos.

No se ejecutan funciones de Excel, vínculos externos ni expresiones arbitrarias. El cálculo
permitido se comprueba con Decimal contra el resultado numérico almacenado (tolerancia relativa
1e-12). Cache ausente/divergente, fórmulas ajenas a esa lista o fórmulas en identificadores
bloquean la fila. Los cocientes verificados se expresan a seis decimales con el redondeo de Decimal
y se marcan calculados. El valor, fórmula y cache originales siguen disponibles en evidencia.

## Duplicados y totales

Identidad candidata provisional: empresa + proveedor + vale normalizado. No impone unicidad
en BD ni afirma que el proveedor no reutilice vales. La huella compara fecha, placa, cantidades,
precio, monto, serie/factura, producto, km y piloto; lote/hoja no cambian la identidad.

Se conservan todas las apariciones. Huellas iguales apuntan a la primera aparición. Variantes
contradictorias o una aparición no verificable en el grupo bloquean todas las apariciones de
ese candidato. No se elige automáticamente entre consolidado y lotes.

Los totales elegibles incluyen una sola aparición por candidato y excluyen conflictos,
inválidas y posibles previos. Son cantidades para revisión, no aprobación ni asiento financiero.
Si un grupo tiene una repetición exacta y otra contradictoria, queda bloqueado completo.

## API y permisos

`POST /api/empresas/[slug]/flota/combustible/importaciones/preview-v2`
recibe multipart `file`, `perfil` y `proveedorId`. Requiere el guard existente
`requireTenantFlotaCombustible(slug, "conciliar")` y proveedor activo de la empresa.
Devuelve `private, no-store` y no emite token de confirmación.

La consulta de previos usa exclusivamente claves existentes de evidencia HALEL C2B del mismo
tenant/proveedor, en lotes de 200. Es una advertencia, no una equivalencia certificada.
No se inventan identidades para históricos legacy. Falta de tablas/columnas C2B se informa como
cobertura no disponible; otros errores de BD hacen fallar el análisis. No hay bootstrap de esquema.

La vista nueva no ofrece confirmar. La confirmación histórica recibe solo sus tokens v1 y
permanece separada. La futura persistencia de consumos requiere otro PR, revalidación transaccional
e índices aprobados para prevenir carreras; este preview no reserva identidades.

## Validación

Fixtures íntegramente sintéticos: cuatro hojas HALEL con consolidado/lotes y un conflicto de precio;
tres hojas SHELL con fórmulas compartidas, sumas, fechas fuera de mes y datos ausentes.
Pruebas de parser, compatibilidad v1, guard HTTP, aislamiento, cobertura de historial, ausencia de
escrituras/uploads y render del resumen. Ningún test depende de los Excel privados del usuario.
Los archivos originales pueden usarse como comprobación manual de solo lectura y en memoria;
no deben copiarse al repositorio ni incorporarse a pruebas o documentación.

Verificación local de esta entrega, tras auditoría: 126 pruebas dirigidas aprobadas (parser v1/v2,
servicios históricos, UI, permisos, tenant y contratos C2C); TypeScript y ESLint de
todos los archivos afectados aprobados; build de Next.js aprobado con BD deshabilitada
mediante configuración local de proceso. No se consultó ninguna BD real.
El lint global reportó 40 errores en archivos ajenos al cambio; no se corrigieron.
Build conserva advertencias en configuración de Cache-Control, middleware y tracing
de filesystem de rutas existentes. QA autenticada en navegador y contra BD de pruebas
permanece pendiente; esta entrega no certifica despliegue ni funcionamiento productivo.

## Correcciones de auditoría final

- Identificadores numéricos se leen del literal XML antes de usar la interpretación de ExcelJS:
  no se convierten a Number. La evidencia conserva ese literal. Si el número es inseguro,
  se bloquea; no se supone que expandir notación científica recupere la serie original.
  Identificadores almacenados como texto conservan todos sus dígitos y ceros iniciales.
- La serie no verificable del archivo de referencia no tiene una representación textual
  alternativa fiable en su celda. Requiere comprobación documental externa. Las pruebas
  reproducen la clase de defecto con un literal inventado, sin copiar la serie real.
- Guard tenant con opción `soloLectura`, usada en página y endpoints v2: no cambia cookie
  ni objeto de sesión al consultar otra empresa autorizada. El valor por defecto conserva
  el comportamiento histórico y tiene prueba de regresión. El ciclo global de actividad
  de sesión de la aplicación permanece independiente y no se desactiva.
- Catálogo v2 dedicado (GET en la misma ruta), con solo SELECT de proveedores activos.
  Parser y endpoints v2 no llaman a uploads, auditoría, escritura SQL ni creación de esquema.
- El cuerpo multipart se limita realmente a 50 MB + 64 KB de sobrecarga antes de parsearlo.
  Cada archivo mantiene su límite de 50 MB. El lector comprueba tamaño expandido real
  (80 MB), 2,000 entradas ZIP, coordenadas/filas antes de ExcelJS, combinaciones de celdas
  acotadas, entradas duplicadas/cifradas y ausencia de DTD. La lectura XML usa saxes,
  ya incluido por ExcelJS y fijado en el lockfile; no se añadieron dependencias.
- Resumen distingue candidatos bloqueados de filas inválidas y candidatos elegibles.
- Los 40 errores globales se localizaron en 23 archivos sin cambios de contenido respecto
  a HEAD (comparación normalizando CRLF/LF). ESLint de todos los archivos afectados pasó.
- Revisión de cambios: únicamente TypeScript/TSX y esta documentación; sin Excel,
  nombres de pilotos reales, firmas de credenciales ni archivos temporales versionables.

No se certifica unicidad futura de vales ni prevención transaccional de duplicados en registros
definitivos: el preview no persiste ni reserva consumos. Las consultas de historial se validaron
con mocks, no con una base real. Límites del proxy, memoria bajo carga concurrente y QA
autenticada en navegador siguen pendientes de verificación operativa.
