# Canecas · Comprobante de venta imprimible

En **Gestión de Canecas › Ventas**, cada venta ACTIVA tiene el botón **Imprimir comprobante**. Abre una vista previa (media carta, 5.5 × 8.5 in, vertical) y el botón **Imprimir** del navegador usa ese mismo documento.

Contenido: logo y nombre de la empresa activa, «Comprobante de Venta», n.º de documento, fecha, cliente, dirección de entrega, cantidad, precio unitario, subtotal, total, «Quién lleva», «Quién recibe» y dos líneas de firma (quien entrega / quien recibe). Los datos se escapan antes de armar el HTML; el logo solo se admite si es una ruta del propio sitio o `https://`.

## Quién lleva / quién recibe
El formulario de venta tiene dos campos de texto **opcionales** (hasta 160 caracteres). Si se dejan vacíos, el comprobante deja el espacio en blanco para llenarlo a mano. Se guardan en `canecas_ventas.quien_lleva` y `quien_recibe`.

## Migración manual (NO se ejecuta con el despliegue)
`sql/migrate-2026-11-canecas-ventas-comprobante.sql`: `ALTER TABLE canecas_ventas ADD COLUMN IF NOT EXISTS quien_lleva VARCHAR(160) NULL, quien_recibe VARCHAR(160) NULL`. Es aditiva e idempotente; no modifica filas, índices, CHECK ni triggers. Incluye preflight, postcheck y reversión en comentarios.

- **Sin migrar**: todo funciona; el comprobante se imprime con esos dos campos en blanco. Si alguien escribe un valor sin que exista la columna, la venta se rechaza con un mensaje claro (409) en lugar de perder el dato.
- **Orden seguro**: desplegar el código y migrar son independientes, en cualquier orden.
- Esta migración no forma parte del contrato de simplificación; un contrato estructural de `canecas_ventas` verá las dos columnas adicionales una vez aplicada.
