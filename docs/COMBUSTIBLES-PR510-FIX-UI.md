# Combustibles PR #510: origen de preview y presentación

## Diagnóstico y seguridad

El texto `Origen no permitido.` se emitía exclusivamente en `cb2/http.ts`, después del guard de sesión, permiso y empresa. El cliente usa URLs relativas y `credentials: same-origin`; no define manualmente Origin. El servidor comparaba Origin con `new URL(req.url).origin`. Esto exige que el origen público coincida con la URL interna, lo cual no se sostiene necesariamente detrás de un proxy. Se reprodujo el rechazo con URL interna HTTP y Origin HTTPS de Novalvion. No se capturaron encabezados ni se hicieron peticiones a producción: el valor interno exacto del proxy de Hostinger sigue sin observarse.

La validación nueva usa un origen HTTPS exacto controlado por el servidor: `https://novalvion.com`. Si un entorno necesita otro dominio, puede configurar **en el servidor** `CB2_PUBLIC_ORIGIN=https://dominio-autorizado.example`, sin barra final. Reemplaza el origen predeterminado; no añade una lista. No es una variable NEXT_PUBLIC ni procede de la petición. Una configuración inválida devuelve 503. No se modificó ninguna configuración de Hostinger.

- No se confía en Host, Forwarded, X-Forwarded-Host o X-Forwarded-Proto para autorizar un origen. Así el proxy puede transportar la URL interna sin ampliar la lista de confianza.
- Las cuatro operaciones POST (preview, confirmar, reanudar y asociar) requieren Origin exacto. Si Origin no está presente, se admite Referer del mismo origen como alternativa CSRF. Si faltan ambos, se rechaza; un Origin inválido no puede rescatarse mediante Referer.
- Se rechazan `null`, subdominios no autorizados, otros puertos, HTTP, URLs con credenciales/ruta en Origin, orígenes múltiples y Sec-Fetch-Site cross-site. No existen comodines.
- Solo fuera de producción se admite además el origen exacto de la petición para localhost, 127.0.0.1 o [::1]. No se autoriza cualquier Host en desarrollo.
- Se mantienen el guard central de los nueve endpoints, permisos ver/conciliar, exclusividad Admin para reanudar, proveedor de la empresa, reautorización bajo bloqueo, validaciones de datos, recibos firmados e idempotencia. Las cinco lecturas mantienen el acceso autenticado privado; no se añade CORS.
- Un rechazo explica que se debe abrir Combustibles desde la plataforma. No expone encabezados, SQL ni configuración interna.

## Presentación

Se mantiene la ruta Operaciones → Combustibles, entre Planes / Viajes y Viáticos, sin tocar el menú. El encabezado y las funciones históricas se separan del panel de proveedores. Se conservan vales, estaciones y conciliación histórica.

El panel reutiliza las variables del tema y componentes existentes: navegación agrupada, importación en cuatro pasos con paso actual accesible, campos alineados, archivo destacado, acciones primarias/secundarias, tablas con desplazamiento horizontal, filtros agrupados, etiquetas de estado, estados vacíos, foco de teclado y rejillas adaptables. El CSS es local a CB2. No se añadieron dependencias visuales.

No se modificaron el servicio de negocio, repositorio, contrato de escritura, parser, reconstrucción ORIGEN/RESOLUCION, claves de idempotencia ni esquema SQL.

## Verificación reproducible

Windows PowerShell, desde la raíz de esta rama:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\eslint.cmd src/lib/flota/cb2/origin.ts src/lib/flota/cb2/origin.test.ts src/lib/flota/cb2/http.ts src/lib/flota/cb2/http.test.ts src/lib/flota/cb2/http-origin.test.ts src/components/flota/combustibles-client.tsx src/components/flota/cb2/panel.tsx src/components/flota/cb2/presentacion.tsx src/components/flota/cb2/importar.tsx src/components/flota/cb2/consumos.tsx src/components/flota/cb2/historial.tsx src/components/flota/cb2/listados.tsx src/components/flota/cb2/panel.dom.test.ts --max-warnings=0
.\node_modules\.bin\vitest.cmd run src/components/flota/cb2 src/lib/flota/cb2/model.test.ts src/lib/flota/cb2/originales.test.ts src/lib/flota/cb2/http.test.ts src/lib/flota/cb2/http-origin.test.ts src/lib/flota/cb2/origin.test.ts src/lib/flota/cb2/repository.test.ts src/lib/flota/cb2/storage.test.ts src/components/flota/combustible-preview-v2.test.ts src/lib/flota/combustible-permisos.test.ts src/lib/tenant-combustible.test.ts src/components/app-shell-operaciones.test.ts src/lib/flota/combustible-ux-captura.test.ts src/lib/flota/combustible-importacion-v2.test.ts src/lib/flota/combustible-importacion-v2-resumen.test.ts src/lib/flota/combustible-preview-v2-http.test.ts src/lib/flota/combustible-importaciones.test.ts src/lib/flota/combustible-importacion-parser.test.ts src/lib/flota/combustible-ooxml-v2.test.ts src/lib/flota/combustible-c2c-shared.test.ts src/lib/flota/combustible-c2c-http.test.ts --maxWorkers=2
git diff --check
```

Resultado: **260 pruebas aprobadas en 24 archivos**, TypeScript sin errores, ESLint sin advertencias y diff sin errores de espacios. El preview HTTP usa multipart y un Excel HALEL sintético con parser y firma reales; se sustituye únicamente autorización y conexión de datos con dobles locales. No es una prueba de Hostinger. Se comprueban orígenes legítimos/externos/ausentes, proxy, configuración, guard de los nueve tipos de endpoint y pertenencia del proveedor. Las pruebas DOM cubren los cuatro pasos, mensajes de error, confirmación parcial, filtros/paginación, asociación, reanudación, permisos, historial completo, selección de pendientes y reintentos con la misma clave.

Se intentó inspeccionar el diseño en navegador local con datos ficticios, pero el runtime de automatización falló al inicializar (`failed to write kernel assets`). **No se completó una inspección visual real de escritorio/móvil**; las pruebas DOM no verifican el diseño renderizado ni sustituyen esa revisión.

## Revisión manual pendiente, solo en un entorno de pruebas autorizado

1. Revisar el Draft y la configuración del origen antes de desplegar. Usar datos y credenciales de prueba, sin copiar archivos de producción.
2. Abrir Operaciones → Combustibles y comprobar navegación histórica y nueva a 390 px y 1280 px, foco de teclado, tablas desplazables y estados vacíos.
3. Con proveedor de prueba, cargar Excel HALEL y SHELL sintéticos. En la pestaña Network comprobar Origin público exacto y respuesta preview 200; detrás de proxy la URL interna puede ser distinta. Probar selección, revisión y confirmación parcial únicamente en esa base aislada.
4. Probar facturas, filtros, historial, descarga privada, permisos de lectura y reanudación Admin. Simular un fallo de red y verificar que el reintento conserva la clave y el cuerpo.
5. Una petición POST con sesión de prueba y Origin externo debe devolver 403; sin Origin ni Referer también. No agregar cabeceras reenviadas para intentar autorizar solicitudes externas.

No se ejecutó SQL, migraciones ni operaciones en producción. No se crearon workflows. No se realizó merge.