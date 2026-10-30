# C3C-15B — Bootstrap local de aceptación

Base de desarrollo: `3737a5891e33b1349ce867cce816f1cc0e1925e3`. No cambia módulos contables ni añade migraciones. El bootstrap prepara una base **vacía**, exclusivamente sintética, y mantiene MariaDB abierta. No ejecutar el runner C3C-14 sobre esta instancia.

## Requisitos y comprobaciones

- Windows PowerShell **5.1**, Node compatible con `package.json`, dependencias del lockfile (`npm.cmd ci`) en una copia limpia que contenga este cambio.
- Copia prevista: `C:\Users\Admin\Documents\novalvion-c3c15-qa`. No copiar archivos de entorno, uploads ni datos reales desde otros checkouts.
- MariaDB **11.8.9**, ya aprovisionada por el operador: enlace `127.0.0.1`, puerto **43306**, datadir físico `%TEMP%\novalvion-c3c15-manual\data`, PID file bajo `%TEMP%\novalvion-c3c15-manual`, base **c3c15_lab**, usuario **c3c15_app**, contraseña aleatoria de al menos 12 caracteres. No se instala ni se toca ningún servicio Windows.
- Cuenta sin privilegios globales, roles adicionales, GRANT OPTION ni acceso a otras bases. El bootstrap comprueba `SHOW GRANTS`; los grants `PUBLIC` por defecto sobre `test` también provocan rechazo. No los corrige automáticamente: cualquier ajuste pertenece al aprovisionamiento de esa instancia nueva por su propietario.
- Base sin tablas, vistas, rutinas ni eventos. Si hay objetos, **se rechaza**; no se borran ni se reutilizan.
- No deben existir candidatos de `load-env.ts` ni de Next: `.env*` de la copia (salvo `.env.example`), `config/.env` y `config/app.env` en los tres ancestros. No deben heredarse variables `DB_*`, `MYSQL_*`, `MARIADB_*`, `AUTH_SECRET`, `SMTP_*`, `FEL_*`, `NODE_OPTIONS` o `NODE_PATH`. El control informa un código, sin leer ni imprimir esos secretos. Usar una consola limpia y una ubicación limpia; no renombrar configuraciones operativas para superar el control.

La identidad se consulta antes de escribir: versión, puerto, datadir físico sin junction, bind, base, usuario efectivo/de conexión, PID file y restricciones FK/CHECK activas. Se fija el PID observado y se comprueba nuevamente con cada operación SQL junto con un identificador y nonce privados de laboratorio. Un bloqueo `GET_LOCK` y una segunda comprobación de vacío impiden inicializaciones simultáneas. Los errores interrumpen el proceso; no se desactivan FK ni CHECK.

## Preparar, verificar y arrancar

En la copia limpia, con este PR ya aplicado, abrir **Windows PowerShell** sin transcript:

```powershell
Set-Location 'C:\Users\Admin\Documents\novalvion-c3c15-qa'
git rev-parse HEAD
npm.cmd ci
$lab = Join-Path $PWD 'scripts\ci\c3c15b\Lab.ps1'
& $lab -Action Prepare -RepoRoot $PWD.Path
```

`Prepare` pide la contraseña de `c3c15_app` con `Read-Host -AsSecureString`; no pasarla en argumentos, variables persistentes ni `.env`. Se entrega a Node por stdin. La contraseña de BD, AUTH_SECRET, nonce y claves aleatorias de los usuarios quedan **solamente** en `%TEMP%\novalvion-c3c15-manual\acceptance-private\private.json`, con ACL de la carpeta restringida al usuario actual y SYSTEM. No subir esa carpeta, logs privados, cookies ni JWT al PR.

```powershell
& $lab -Action Verify -RepoRoot $PWD.Path
& $lab -Action Start -RepoRoot $PWD.Path
& $lab -Action Credentials -RepoRoot $PWD.Path
Start-Process 'http://127.0.0.1:4315/login'
```

`Credentials` muestra las claves sintéticas al operador local: no capturar esa salida ni usar `Start-Transcript`. `Start` comprueba de nuevo identidad, estado READY y candidatos de entorno. Arranca un Next real en loopback, con entorno filtrado y preload local; no modifica configuración global. La caché `.next-c3c15b` queda ignorada. Usa el servidor personalizado de Next para restringir rutas al login, selección y contabilidad QA: las escrituras de asientos, cierres y módulos ajenos quedan rechazadas. Las conexiones de aplicación se limitan a este puerto SQL y al HTTP local, se impiden lecturas de configuración operativa y conexiones mysql inesperadas. Estos controles son defensas del laboratorio, no una sandbox contra código deliberadamente hostil ni sustituyen los permisos del servidor.

Si la política vigente impide ejecutar `Lab.ps1`, **no cambiarla ni usar ExecutionPolicy Bypass**. La entrada Node siguiente usa el mismo inicializador y control, solicita la contraseña sin eco en una consola interactiva y aplica la misma ACL mediante cmdlets nativos de PowerShell 5.1. Elegir una sola entrada para Prepare:

```powershell
node scripts/ci/c3c15b/lab.mjs prepare
node scripts/ci/c3c15b/lab.mjs verify
node scripts/ci/c3c15b/lab.mjs start
node scripts/ci/c3c15b/lab.mjs credentials
# Al finalizar:
node scripts/ci/c3c15b/lab.mjs stop
```

No acepta contraseñas como argumentos ni por entrada redirigida; `prepare` exige TTY. La ejecución interactiva del prompt debe confirmarla el operador local. Los servicios internos de inicialización/arranque y la ACL sí se probaron automáticamente.

## Escenarios y autenticación

Se usa el login y las cookies reales de la aplicación; no se inyectan JWT. Los cuatro usuarios son Contabilidad, nunca Admin: `qa-preparador` (41), `qa-revisor` (42), `qa-resolutor` (44), `qa-lector` (45). Todos tienen acceso explícito a las empresas QA; el lector carece de edición y creación. Solo el revisor designado puede emitir constancias; no equivalen a aprobación formal.

| Empresa | Libro | Ejercicio | Caso |
|---|---|---|---|
| qa-a (7) | COMPLETO (9) | QA2035 | Evidencias técnicas completas, constancia vigente inicial |
| qa-a (7) | PENDIENTE (10) | QA2035 | Evidencias obligatorias pendientes |
| qa-b (8) | DESACTUALIZADO (11) | QA2035 | Constancia histórica invalidada por revisión documental posterior |

`scenarios.json` registra los IDs efectivos de ejercicio y solicitud. Cada libro tiene ingreso 100, gasto 40, resultado preliminar 60, historia anterior 900, borrador excluido 777 y movimiento posterior al corte 888. Son registros iniciales sintéticos, no ejecución de una regularización. Política, borrador, solicitud, decisiones, evidencias y constancias se generan mediante los servicios existentes. El estado formal permanece PENDIENTE y `contabilizado=false`.

Abrir `/e/qa-a/contabilidad/calendario`, elegir libro y ejercicio. Seguir [la matriz y guía C3C-15](../c3c15/MANUAL-WINDOWS.md), incluidos bloqueantes, actualización, historial, confirmaciones, cambios de empresa, descargas JSON/XLSX y **apertura visual en Microsoft Excel**. Registrar por caso APROBADA/FALLIDA/NO EJECUTADA. Una respuesta HTTP o HTML SSR no sustituye esas pruebas.

## Detener y conservar evidencia

```powershell
& $lab -Action Stop -RepoRoot $PWD.Path
# Devuelve NEXT_STOPPED / MariaDB UNTOUCHED.
& $lab -Action Verify -RepoRoot $PWD.Path
# Un siguiente Start admite el manifiesto de Next STOPPED de este mismo laboratorio.
```

La parada requiere handshake autenticado con el identificador propio; no mata procesos por nombre, no emite SHUTDOWN y no usa el cierre C3C-14. MariaDB es persistente y se conserva; su eventual parada corresponde a su propietario mediante la consola original, tras verificar PID/datadir. No detener `MySQL80` ni otra instancia. No borrar datadirs ni manifiestos para repetir Prepare.

Evidencia compartible: `bootstrap-evidence.json` (controles SQL sin secretos), `scenarios.json` y hashes de los artefactos descargados. `private.json` y `next-private.log` **no son compartibles**. Redactar capturas antes de publicarlas. Una preparación parcial queda `INCOMPLETE_DO_NOT_REUSE`: conservarla para diagnóstico, no reintentar ni resetear automáticamente.

## Reproducir pruebas técnicas

```powershell
node --test scripts/ci/c3c15b/safety.test.mjs
node scripts/ci/c3c15b/integration.mjs --run-owned-instance
npx.cmd tsc --noEmit
npx.cmd eslint scripts/ci/c3c15b
git diff --check
```

La integración requiere binarios portables ya verificados en `.lab-runtime/mariadb-11.8.9-winx64`; comprueba el SHA256 de `mariadbd.exe`. Crea **otro** directorio `novalvion-c3c15b-test-<32hex>` y puertos libres, nunca 43306; solo ese runner cierra su propia instancia temporal con el handle original. No reutiliza ni modifica la instancia manual. No publicar sus archivos privados. Ver [informe y evidencia](REPORT.md).

## Errores que requieren detenerse

`C15B_TARGET`, `C15B_IDENTITY`, `C15B_GRANTS`, `C15B_SERVER_PID`: identidad o aislamiento no conforme; ninguna relajación automática. `C15B_ENV_FILE` / `C15B_INHERITED_ENV`: ubicación/consola no aislada. `C15B_DATABASE_NOT_EMPTY` / `C15B_STATE_EXISTS`: preservar, no resetear. `C15B_SEED_FAILED`: evidencia parcial; no iniciar. `C15B_START_ALREADY_ATTEMPTED` / `C15B_STOP_UNCONFIRMED`: no borrar manifiestos ni matar PID arbitrarios; revisar solo el proceso propio. Los errores se comunican mediante códigos, sin mensajes SQL con credenciales.
