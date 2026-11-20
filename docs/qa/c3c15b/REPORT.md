> Informe historico de 2026-10-30. Para la revision del bloqueo NTFS y resultados vigentes, consultar [CLOSURE.md](CLOSURE.md). La evidencia JSON adjunta fue reemplazada por la ejecucion del 2026-10-31.

# C3C-15B — Evidencia técnica del bootstrap

Fecha: 2026-10-30. Base: `3737a5891e33b1349ce867cce816f1cc0e1925e3`. Alcance: preparación local persistente y arranque seguro para aceptación manual. **C3C-15 continúa pendiente de aprobación funcional.** No se usó Hostinger, MySQL80, una base existente ni el laboratorio C3C-8.

## Resultado verificable

| Prueba | Estado | Evidencia |
|---|---|---|
| MariaDB 11.8.9 nueva, TCP loopback y puerto efímero propio | APROBADA | [integration-evidence.json](integration-evidence.json) |
| DDL y dependencias C1–13, preflight/postcheck y FK/CHECK activos | APROBADA | 101 controles, todos con errores=0, incluidos postchecks posteriores a la semilla |
| Rechazo de base no vacía y segunda inicialización | APROBADA | Sentinel propio y repetición rechazados antes de escribir |
| PID/nonce inesperados, red externa, MySQL80, `.env`, conexión mysql directa | APROBADA | Sondas reales, códigos esperados |
| Escenarios completo, pendiente y desactualizado mediante servicios C9–13 | APROBADA | Assertions de semilla: resultado 60, vigencia, estado formal PENDIENTE, contabilizado=false |
| Login real de los cuatro roles, selección de empresa y página Calendario | APROBADA | Peticiones HTTP reales contra Next, login por contraseña y cookie real en memoria |
| Constancia: revisor 200; preparador, resolutor y lector 403 | APROBADA | API real con evaluación vigente y control de versión |
| XLSX servido por la API | APROBADA | HTTP 200 y firma ZIP; no equivale a descarga por navegador ni inspección en Excel |
| Ruta de contabilización denegada; cantidad de asientos inalterada tras las pruebas HTTP | APROBADA | 403 y recuento antes/después |
| Parada y reinicio de Next sin cerrar MariaDB | APROBADA | Handshake propio; SELECT 1 posterior a ambas paradas |
| Tests de aislamiento y ACL nativa en PowerShell 5.1 | APROBADA | 5/5 tests Node; ACL protegida, solo SID operador y SYSTEM |
| Parser de Lab.ps1 en Windows PowerShell 5.1.26100.9711 | APROBADA | Cero errores del parser |
| Regresión precontable, expediente, HTTP y tenant-calendario | APROBADA | 43/43 tests, cuatro archivos |
| TypeScript y ESLint del alcance | APROBADA | `npx.cmd tsc --noEmit`, `npx.cmd eslint scripts/ci/c3c15b` |
| `git diff --check` | APROBADA | Sin errores |
| Prepare interactivo contra la instancia manual 43306 y su contraseña privada | NO EJECUTADA | Se preservó la instancia preparada; la contraseña la introduce su operador local |
| Interacción completa de Lab.ps1 y prompt oculto de lab.mjs en consola del operador | NO EJECUTADA | Política actual bloquea scripts PS sin firmar; se ofrece entrada Node sin cambiarla |
| Navegador real, confirmaciones, descargas mediante botones y capturas | NO EJECUTADA | La ejecución HTTP/SSR no acredita aceptación visual |
| Apertura visual en Microsoft Excel e impresión | NO EJECUTADA | No se declara inspección visual |

## Secuencia reutilizada y aislamiento

Se reutilizó la secuencia DDL comprobada de C3C-14: DDL mínimo de fixture C2, C1 preflight/migrate/postcheck, C2 preflight/migrate/postcheck, columnas de soporte, tabla de roles y migración C7, permisos explícitos, C9 a C13 preflight/migrate/postcheck; después columnas mínimas de autenticación/lectura, usuarios y semilla. C3–6 y C8 no requieren nuevas migraciones en esta secuencia. Se adapta explícitamente el selector de base del control C1 a `c3c15_lab`; no se omiten sus controles. No se importa el cierre C14 desde el inicializador persistente, no se ejecuta `schema.sql` completo ni el init general.

La semilla usa SQL exclusivamente para cargar el estado contable inicial sintético; no ejecuta regularización ni altera históricos existentes. El resto del expediente se construye con servicios vigentes y actores separados. Cada consulta/escritura posterior comprueba identidad y marca privada. El arranque vuelve a comprobar archivos candidatos de entorno y rechaza configuraciones operativas antes de ejecutar Next. El preload se limita al proceso hijo y no cambia código ni configuración de producción.

El runner de integración es **distinto**: solo crea/cierra la instancia que acaba de iniciar con un handle propio y un directorio nuevo de 32 hex, comprueba el hash del binario MariaDB y usa puertos efímeros. Revoca los grants PUBLIC de test únicamente en ese servidor recién creado. La instancia manual no se toca. Los intentos fallidos de desarrollo se conservaron; la evidencia adjunta corresponde a la ejecución final aprobada, no a una reutilización.

## Limitaciones y siguiente aceptación

No se modificaron módulos de negocio ni esquema productivo; no hay SQL nuevo de migración. El proceso requiere cuenta dedicada realmente limitada y configuración local conforme; ante discrepancias se detiene sin corregir permisos, borrar tablas o rescatar automáticamente una carga parcial. La ACL y el preload son defensas del laboratorio bajo una cuenta local confiable, no aislamiento frente a un administrador hostil.

El archivo privado contiene secretos locales y no debe publicarse. Los logs privados tampoco son evidencia compartible. El JSON adjunto contiene solo controles, IDs, rutas sintéticas y resultados, sin contraseñas, cookies o JWT. Para repetir, seguir [README](README.md); para la aceptación visual pendiente, [MANUAL-WINDOWS](../c3c15/MANUAL-WINDOWS.md). La copia manual debe recibir este cambio antes de usar esos comandos. No se declara equivalencia con Milenium 2000, aprobación contable, merge ni despliegue.
