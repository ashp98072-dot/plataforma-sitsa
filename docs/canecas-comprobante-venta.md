# Canecas · Comprobante de venta imprimible

En **Gestión de Canecas › Ventas**, cada venta ACTIVA tiene el botón **Imprimir comprobante**. Abre una vista previa (media carta, 5.5 × 8.5 in, vertical) y **Imprimir** usa ese mismo documento (iframe aislado). Antes de imprimir se espera a que el logo termine de descargar o falle (imágenes bloqueadas): en ese caso se imprime igual, sin logo. Las hojas se verificaron en Chromium: 1 sola página de 396 × 612 pt, con logo horizontal (Kuiqtrans) y sin logo.

Contenido: logo y nombre de la empresa activa, «Comprobante de Venta», n.º de documento, fecha, cliente, dirección de entrega, cantidad, precio unitario, subtotal, total, «Quién lleva», «Quién recibe» y dos líneas de firma. **Nunca incluye costo FIFO ni utilidad**, aunque el usuario tenga permiso de costos. Los datos se escapan antes de armar el HTML.

**Logo:** sale del campo `logoUrl` de la empresa (configuración de la empresa en `requireTenant`). Solo se admiten rutas del propio sitio (`/...`) o `https://`. Un logo enviado por chat o adjunto NO se carga solo: hay que configurarlo en la empresa. Sin `logoUrl` se imprime solo el nombre.

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
