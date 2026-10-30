# C3C-15 — Validación de usuario final pendiente

**Dictamen: NO APROBADO FUNCIONALMENTE.** Las pruebas obligatorias de navegador autenticado y presentación visual en Microsoft Excel permanecen **NO EJECUTADA**. La regresión técnica aprobada no sustituye esas pruebas.

Base: `5d58a69036151b318c8c42c030cb1dcd5ef7f8ff`, merge del PR #539. Fecha: 30 de octubre de 2026, America/Guatemala. Rama: `test/c3c15-validacion-usuario`. Desarrollo en worktree aislado, conservando los cambios previos del directorio original.

## Intentos y diagnóstico del entorno

Se leyó y aplicó la skill Computer Use. Se intentaron las entradas documentadas:

1. `mcp__cua_repl`: `await cua.getState();`
2. `mcp__node_repl`: inicialización `await import('@oai/sky')`.

Ambas devolvieron exactamente: `failed to start Node runtime: El sistema no puede encontrar la ruta especificada. (os error 3)`. Ocurre antes del inventario de superficies, importación ejecutada o selección de ventanas. No se llegó a abrir una página, iniciar sesión, descargar un archivo ni capturar una ventana.

Se añadió [un diagnóstico de solo lectura](../../../scripts/ci/c3c15/diagnose-runtime.mjs). Ejecución reproducible desde la raíz:

```powershell
node scripts/ci/c3c15/diagnose-runtime.mjs --output=docs/qa/c3c15/diagnostico-runtime.json
```

Resultados en [diagnostico-runtime.json](diagnostico-runtime.json): Windows x64; Node del sistema v24.18.0 y Node empaquetado v24.22.1 existen y ejecutan `--version` correctamente desde el workspace. El paquete declara plataforma win32/x64 y versión 26.1029.11837. Chrome, Edge y EXCEL.EXE están presentes. Las versiones de archivo observadas fueron Chrome 156.0.8078.48, Edge 156.0.4314.50 y Excel 16.0.20527.20088. La mera presencia de esos archivos no prueba automatización ni apertura visual.

**Causa inmediata:** el lanzador de las herramientas no puede resolver una ruta necesaria para iniciar su runtime. **Causa raíz exacta no confirmada:** la respuesta no identifica si falta una ruta de ejecutable, directorio de trabajo u otro recurso configurado por el host. La prueba de ambos Node descarta su ausencia en las rutas inspeccionadas, pero no valida la configuración interna del lanzador MCP. No es evidencia de un defecto del ERP, JWT, MariaDB o Excel. Para reparar la herramienta se necesita revisar su configuración/log de arranque desde el host; no se inventó una ruta ni se modificó PATH, permisos, antivirus, sandbox o políticas de seguridad.

Se intentó además un test de eventos en DOM simulado: falló antes de ejecutar casos por `ERR_MODULE_NOT_FOUND: happy-dom`. El paquete aparece declarado pero no está presente en el `node_modules` disponible. La inspección de caché npm devolvió EPERM; no se alteraron sus permisos ni se instaló software. El archivo experimental fue retirado y no forma parte de la entrega. Este intento no cuenta como prueba de navegador ni como caso aprobado.

## Flujo inspeccionado en código

| Etapa | Implementación y comportamiento observado en fuente |
| --- | --- |
| Login | `src/app/login/page.tsx` envía `POST /api/auth/login`, muestra errores y sigue el redirect devuelto. La ruta verifica credenciales, crea JWT y escribe cookie HttpOnly de sesión. |
| Empresa | `/select-empresa`; `SelectEmpresaClient` usa `POST /api/auth/select-empresa`, valida redirect `/e/` y ejecuta `window.location.replace`. Con una empresa permitida puede seleccionarla automáticamente. |
| Calendario | `/e/[slug]/contabilidad/calendario`, protegido por `requireTenantCalendario`. El selector carga entidades desde `ejercicios/opciones`, preselecciona un único libro activo y permite elegir ejercicio mediante su botón. |
| Evaluación | `PrecontablePanel`: consulta explícita, petición sin caché, cancelación por AbortController, comparación de componentes y retirada del informe mostrado ante error. |
| Constancia | El formulario depende de `puedeRegistrar`; justificación mínima de 15 caracteres, casilla requerida, versión, huella, UUID idempotente y confirmación exclusivamente técnica. La autorización efectiva la vuelve a comprobar el servicio transaccional. |
| JSON | Blob local del informe mostrado, con aviso de instantánea. La constancia histórica exporta su vigencia observada y componentes cambiados. |
| XLSX | Enlace del mismo origen a `validacion-precontable?entidad=...&formato=xlsx&solicitud=...`; la API reevalúa fuentes, requiere guard y genera cinco hojas con ExcelJS existente. |

Esta revisión es **estática**, no ejecución de navegación, validación nativa, hidratación o descarga. No se demostró un defecto funcional/visual que justificara cambiar estos módulos.

## Matriz de aceptación

[matriz.json](matriz.json) contiene cada ID, estado, causa y evidencias. Los estados permitidos son APROBADA, FALLIDA y NO EJECUTADA; no se cambia un caso de usuario final a APROBADA por aprobar su servicio o su render SSR.

| Casos | Capa | Estado |
| --- | --- | --- |
| M00 | Aprovisionamiento/arranque local completo para login | NO EJECUTADA |
| M01–M05 | Login, empresa, entidad/ejercicio, actualización y bloqueantes | NO EJECUTADA |
| M06–M09 | Lector, separación de actores, revisor y confirmación nativa | NO EJECUTADA |
| M10–M12 | Historial, idempotencia UI, cambios y ausencia de autoridad formal | NO EJECUTADA |
| M13–M14 | Descargas JSON y XLSX por navegador | NO EJECUTADA |
| M15–M17 | Apertura/inspección visual Excel, impresión previa y capturas reales | NO EJECUTADA |
| I01–I02 | Arranque de herramientas de navegador/Windows | FALLIDA |
| I03 | Disponibilidad y ejecución de ambos Node conocidos | APROBADA |
| I04 | Intento adicional de DOM simulado, dependencia ausente | FALLIDA |
| Regresión | Servicios SQL y unitarias/API/render | APROBADA, con incidencias de infraestructura registradas |

No hay capturas de navegador ni de Excel porque no se consiguió ejecutarlos mediante las herramientas. No se crearon capturas artificiales ni se etiquetó SSR como navegador o lectura XLSX como inspección visual.

## Regresión ejecutada de nuevo sobre la base obligatoria

[regresion.json](regresion.json) conserva los nombres y estados de todas las pruebas, directorios temporales, hashes, cierres y cinco controles postcheck por ejecución válida.

| Suite | Aprobadas finales |
| --- | ---: |
| C3C-5 / C3C-6 / C3C-7 / C3C-8 | 9 / 8 / 12 / 10 |
| C3C-9 / C3C-10 / C3C-11 / C3C-12 | 30 / 20 / 31 / 9 |
| C3C-13 / recorrido C3C-14 | 20 / 13 |
| Total integración MariaDB | **162** |
| Unitarias/contratos/API/render | **216** |

Todos los resultados finales tienen cero pruebas fallidas u omitidas. Se reutilizó el ejecutor C3C-14 sin modificarlo: binario MariaDB 11.8.9 verificado, datadir y named pipe nuevos, sin red ni credenciales de BD operativa. Las diez ejecuciones válidas confirman cierre ordenado y cinco postcheck con errores=0. No se intervino el laboratorio C3C-8: su suite se ejecutó en otra instancia nueva.

**No se ocultan los dos intentos fallidos durante ejecución paralela:**

- C3C-6: `EE_DELETE` durante preparación, sin `results.json`; cierre confirmado. Repetición secuencial aprobada 8/8.
- C3C-9: caída de MariaDB antes de tests durante un preflight sobre `information_schema.COLUMNS`; `server.log` registra `ha_maria::drop_table`, código 3221225477, minidump local y `shutdown-failed`. El ejecutor devolvió `C3C1_SHUTDOWN_UNCONFIRMED`. Repetición secuencial aprobada 30/30.

No se ha confirmado si esos incidentes se deben a concurrencia, almacenamiento u otra causa del motor/entorno. La repetición aprobada no prueba su causa raíz. Los datadirs/logs se conservaron y no se reutilizaron. No se modificaron motores, preflight ni restricciones para hacer pasar las pruebas.

TypeScript `--noEmit --incremental false`, ESLint del script nuevo, `node --check` y `git diff --check` aprobados. Los comandos de regresión están en [README C3C-14](../../../scripts/ci/c3c14/README.md); para diagnosticar problemas de infraestructura, ejecutar las suites secuencialmente. La API con JWT y el render de esa suite conservan las limitaciones documentadas de cookies simuladas y ausencia de servidor/navegador real.

## Guía manual y límites de preparación

[MANUAL-WINDOWS.md](MANUAL-WINDOWS.md) describe preparación segura, rutas, perfiles por actor, datos esperados, navegación, validaciones, descargas y apertura visual/vista previa de impresión. Incluye criterios de evidencia y cierre. El aprovisionamiento del servidor completo también permanece pendiente: no se presenta el runner transitorio C3C-14 como servidor utilizable ni se proporcionan contraseñas de navegador inexistentes. Hace falta preparar y verificar primero una copia local sintética con sus usuarios reales de login.

Se puede revisar manualmente offline el XLSX sintético ya entregado en C3C-14, pero esa revisión todavía no fue realizada y no acredita una descarga por navegador. No se ejecutó Next contra una base desconocida para avanzar artificialmente la matriz.

## Entrega para auditoría

Solo documentación/evidencias nuevas y un script diagnóstico de lectura; sin cambios de negocio, sin nuevas migraciones, sin asientos reales, sin aprobación formal, sin modificación de históricos, sin SQL productivo, merge ni despliegue. El PR debe permanecer Draft. La auditoría independiente y las pruebas obligatorias de usuario final siguen pendientes.
