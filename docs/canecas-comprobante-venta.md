# Canecas · Comprobante de venta imprimible

En **Gestión de Canecas › Ventas**, cada venta ACTIVA tiene **Imprimir comprobante**. La vista previa (iframe aislado, el mismo HTML que se imprime) permite elegir el papel:

- **Hoja carta (8.5 × 11 in)**: el comprobante ocupa la **mitad superior** (8.5 × 5.5 in, horizontal) y la inferior queda en blanco, para doblar o cortar la hoja.
- **Papel media carta (8.5 × 5.5 in)**: el mismo comprobante llena el papel directamente.

`@page` fija el tamaño con margen 0 (sin encabezados ni pies del navegador: fecha, URL, paginación). La hoja tiene alto fijo, sin alturas mínimas ni márgenes automáticos: no hay segunda página ni firmas aisladas. En el cuadro de impresión, escala al 100 % (y desactive «Encabezados y pies de página» si el navegador los muestra). Verificado en Chromium: 1 página de 612 × 792 pt (carta) y de 612 × 396 pt (media carta), con la mitad inferior en blanco, también con direcciones largas.

Contenido: **solo el logotipo** (sin escribir el nombre de la empresa), COMPROBANTE DE VENTA, n.º de documento, fecha, cliente, **Sale de** (bodega real de la venta, `canecas_ubicaciones` por `ubicacion_id` de la misma empresa), **Va hacia** (`direccion_entrega`; no se repite como «Dirección de entrega» porque es el mismo dato), descripción, cantidad, precio unitario, subtotal, total (Q), quién lleva, quién recibe y dos firmas. **Nunca incluye costo FIFO ni utilidad.** Los datos se escapan antes de armar el HTML. Esta versión no requiere SQL.

**Datos largos: nunca se recorta información.** No hay alto fijo ni `overflow: hidden`. Un script del propio documento mide el contenido y, si no cabe en 5.4 in, lo **reduce** (hasta el 60 %) para que quepa completo en la media hoja; la vista previa avisa («se redujo al X %»). Si ni así cabe, no lo oculta: continúa hacia abajo (en hoja carta, dentro de la misma página; en media carta, en una segunda hoja) y la vista previa muestra una alerta roja. Los límites reales del sistema (cliente 200, bodega 160, dirección 500, producto 200, quién lleva/recibe 160, documento 250, importes de 14 cifras) caben completos reducidos a ≈ 80 %; con 6000 caracteres en la dirección se activa la alerta.

Verificación reproducible en Chromium real (se omite si no hay Playwright/Chromium o `pdftotext`):

```bash
npx vitest run src/components/canecas/comprobante-chromium.test.ts
```

Para 4 conjuntos de datos (normal, límites con espacios, límites sin espacios, fuera de límites) × 2 papeles × con/sin logo comprueba, en diseño de impresión: todo el texto presente, ningún elemento recortado ni fuera de la hoja, totales y las dos firmas dentro de la media hoja, el PDF (612 × 792 pt o 612 × 396 pt, 1 página) y el texto completo extraído del propio PDF.

**Logo:** se resuelve en el servidor (`src/lib/canecas/logo-comprobante.ts`) y viaja incrustado (data URI PNG/JPEG), así que ya está cargado al imprimir. `empresas.logo_url` es una ruta relativa a uploads (la de los PDF de la plataforma; la de otra empresa se ignora); si falta, se usa el logo de marca de ESA empresa por su slug (`kt-monaco` → `public/brands/monaco/logo.png`, Logiservicios Mónaco). Sin ninguno, el comprobante muestra el nombre de la empresa como texto; nunca el logo de otra empresa ni el de Novalvion. Para otra empresa: configurar su `logo_url` o añadirla a `LOGOS_DE_MARCA`.

## Quién lleva / quién recibe
Dos campos de texto **opcionales** (hasta 160 caracteres) en el formulario de venta; vacíos, el comprobante deja el espacio en blanco para llenarlo a mano. Se guardan en `canecas_ventas.quien_lleva` y `quien_recibe`. Quedan **inmutables**: el trigger `trg_can_venta_bu` los protege como al resto de la venta (la anulación sigue funcionando y las ventas anuladas siguen congeladas).

## Instalación manual (phpMyAdmin) — NO se ejecuta con el despliegue
Archivos en `sql/instalacion-comprobante-phpmyadmin/` (esquema explícito `u611730801_Plataforma`; sin `USE` ni `DATABASE()`: funcionan con `information_schema`, `mysql` o sin base seleccionada). Orden:

1. `01-preflight-solo-lectura.sql` — todo `OK` (informativas aparte).
2. `02-etapa1-columnas.sql` — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` ×2 (aditiva e idempotente).
3. `03-verificar-etapa1-solo-lectura.sql` — todo `OK`.
4. `04-etapa2-trigger.sql` — poner **Delimitador `//`** en phpMyAdmin. `CREATE OR REPLACE TRIGGER trg_can_venta_bu` = trigger de la simplificación (#689) + dos comparaciones `NEW/OLD`; guarda intrínseca (`PREPARE`): sin las columnas o sin el trigger de la simplificación no hace nada (error 1242).
5. `05-postcheck-solo-lectura.sql` — todo `OK` (compara el trigger exacto).

Ejecute la etapa 2 enseguida de la 1: entre ambas las columnas existen pero aún no están protegidas. **No use las huellas estructurales de la simplificación como postcheck de este cambio**: `canecas_ventas` tiene ahora dos columnas más.

- **Sin migrar** el código funciona (comprobante con esos campos en blanco); si alguien escribe un valor sin que exista la columna, la venta se rechaza con 409 y mensaje claro, sin perder el dato en silencio.
- **Orden seguro**: desplegar y migrar son independientes, en cualquier orden; el respaldo y la pausa de escrituras de Canecas son previos a la etapa 1.
- Reversión (solo con autorización): restaurar el trigger de la simplificación con su `CREATE OR REPLACE TRIGGER` calificado; las columnas solo se eliminan si no hay datos que conservar.
