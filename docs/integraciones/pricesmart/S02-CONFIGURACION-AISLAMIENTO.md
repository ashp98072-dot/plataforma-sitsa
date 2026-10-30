# PRICESMART-SANDBOX-S02 — configuración privada

Fecha: 2026-10-30. Implementación de controles; no acredita un sandbox desplegado.
Base: `3737a5891e33b1349ce867cce816f1cc0e1925e3` (`origin/main` consultado).
D01–D16 permanecen pendientes. Sin endpoints, worker, DNS, migraciones ni conexiones externas.

## Contrato de arranque

`NOVALVION_ENV=sandbox` selecciona aislamiento independientemente de `NODE_ENV`.
`NOVALVION_ENV` ausente conserva el comportamiento anterior; `production` lo hace explícito.
Valores desconocidos y marcadores `SANDBOX_ROOT`/`SANDBOX_ID` sin modo sandbox fallan.
El supervisor debe fijar el selector en el entorno del proceso, antes de Next.

Usar `npm run start:sandbox` después de un build revisado en checkout limpio.
El comando exige el selector, valida la configuración y arranca Next en `127.0.0.1`.
No inicia otro servicio ni prepara la DB. No ejecutar scripts administrativos o migradores
como sustituto de este arranque. `db:init` queda expresamente bloqueado en sandbox.

En sandbox, `load-env.ts` no lee archivos ni reutiliza una ruta productiva cacheada.
Se rechazan los `.env`, `.env.local`, `.env.production[.local]`,
`.env.development[.local]` y `.env.test[.local]` del directorio de aplicación:
Next tiene carga propia de esos archivos. No copiar archivos de configuración productiva.

| Variable | Requisito sandbox |
|---|---|
| `NOVALVION_ENV` | `sandbox`, definido por supervisor |
| `SANDBOX_ID` | Identidad estable de 3–48 caracteres, minúsculas, dígitos y guiones |
| `SANDBOX_ROOT` | Ruta absoluta existente, exclusiva, sin symlinks/junctions en sus ancestros |
| `DB_HOST` | Exclusivamente `127.0.0.1`; DB en la máquina aislada |
| `DB_PORT` | Explícito, 1–65535, igual al manifiesto |
| `DB_NAME`, `DB_USER` | `sandbox_` seguido de minúsculas, dígitos o `_`; iguales al manifiesto |
| `AUTH_SECRET`, `DB_PASSWORD`, `PORTAL_CREDENTIALS_KEY` | Tres valores distintos, nuevos, exclusivos; formato `sandbox:<SANDBOX_ID>:<64 caracteres hex aleatorios>`; SHA-256 igual al manifiesto |
| `UPLOAD_DIR` | Exactamente `<SANDBOX_ROOT>/uploads`, directorio existente exclusivo |
| `CB2_PUBLIC_ORIGIN` | Origen HTTPS explícito con host loopback, igual al manifiesto; sin credenciales, path o query |
| `EMPRESA_DOMINIOS` | JSON explícito; solo hosts loopback hacia `kt-monaco`; `{}` permite no mapear hosts |
| `NEXT_TELEMETRY_DISABLED` | `1` |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` y variantes minúsculas | Ausentes o vacíos |
| `FEL_CREDENTIALS_KEY` | Ausente o vacío |
| `CB2_DOCUMENTOS_FASE2`, `FLOTA_PROPIEDAD_EXTERNA` | Ausentes o `0` |

No se agregaron secretos al repositorio. Los valores aleatorios utilizados en tests
se generan durante la prueba y se descartan. La preparación real de credenciales
corresponde al aprovisionamiento aprobado, no a este PR.

## Manifiesto privado y límite de confianza

El administrador debe preparar `<SANDBOX_ROOT>/isolation.json` fuera del repositorio.
Estructura ilustrativa; los placeholders siguientes NO constituyen configuración válida:

```json
{
  "environment": "sandbox",
  "id": "pricesmart-qa",
  "database": {
    "DB_HOST": "127.0.0.1",
    "DB_PORT": "43306",
    "DB_NAME": "sandbox_pricesmart",
    "DB_USER": "sandbox_pricesmart"
  },
  "origin": "https://localhost:4316",
  "secretSha256": {
    "AUTH_SECRET": "<sha256-del-secreto-exclusivo>",
    "DB_PASSWORD": "<sha256-del-password-exclusivo>",
    "PORTAL_CREDENTIALS_KEY": "<sha256-de-la-clave-exclusiva>"
  }
}
```

El manifiesto debe provenir de un inventario aprobado, no generarse automáticamente
desde variables arbitrarias al arrancar. El usuario runtime solo debe poder leerlo;
solo `uploads` debe ser escribible. Impedir que usuarios ajenos modifiquen raíz,
ancestros, directorios y enlaces. No montar rutas, secretos ni backups productivos.
El código verifica formato e igualdad; no puede demostrar por sí solo que un
administrador nunca reutilizó un recurso o secreto. El manifiesto es una ancla de
confianza operativa, no un descubrimiento automático del entorno productivo.

## Identidad DB antes de operaciones

El futuro aprovisionamiento aislado debe preparar una tabla
`novalvion_environment` con `id` único y una fila `id=1`, `environment='sandbox'`
y `sandbox_id` igual al manifiesto. Este PR no crea esa tabla ni ejecuta SQL.
El usuario runtime necesita SELECT sobre el marcador y no debe poder modificarlo;
conceder permisos de aplicación tabla por tabla, no permisos globales al esquema.

Cada checkout de conexión ejecuta primero, en la misma conexión:

```sql
SELECT DATABASE() AS db, environment, sandbox_id
FROM novalvion_environment WHERE id = 1
```

Solo después se entrega la conexión a transacciones o se ejecuta la consulta
solicitada mediante `query`/`execute`. Marcador ausente, error de lectura, otra
DB/identidad/entorno destruyen la conexión y bloquean la operación. El error es
fijo y no contiene el error del driver, SQL, usuario o contraseña. Cambiar el
entorno de un pool activo o sus coordenadas DB requiere reiniciar el proceso.

Es una lectura de verificación, no una garantía de ausencia de conexión TCP al
destino mal aprovisionado. Por ello, usar una VM/DB dedicada y firewall de salida
es obligatorio antes del despliegue. No se probó ningún destino real en S02.

## Archivos y orígenes

El sandbox no usa la autodetección `.builds/uploads` ni los dominios corporativos
predeterminados. Se comprueban rutas canónicas, límites de directorio y enlaces
existentes antes de crear directorios, resolver archivos o escribir uploads.
También se rechazan enlaces internos, aunque su destino permanezca en la raíz.
Producción conserva las heurísticas y defaults existentes.

El perfil S02 solo permite loopback: no configura el subdominio propuesto en la
auditoría. Cualquier ampliación a hosts privados o externos requiere otra revisión.
La terminación TLS privada y la supervisión se prepararán en infraestructura;
estos scripts no emiten certificados ni configuran un proxy.

## Validación y evidencia

Comandos reproducibles con dependencias instaladas:

```text
npm run test:sandbox
npx tsc --noEmit --incremental false
npx eslint <archivos TypeScript/MJS modificados y nuevos>
npm run lint -- --format json --output-file <ruta-local-de-evidencia>
git diff --check
git diff --cached --check
git diff --cached
```

Ejecución local con herramientas ya instaladas, sin instalación ni cambios de
lockfile: Node 24.18.0, Vitest 4.1.11, TypeScript 5.9.3, ESLint 9.39.5.
El manifiesto de paquetes solicita Vitest `4.1.12`; repetir en CI con `npm ci`
es una comprobación pendiente del entorno exacto del lockfile.

- Suite dedicada: **151 aprobadas, 2 omitidas, 6 archivos aprobados**.
- Las dos omisiones pertenecen a pruebas existentes de symlinks de archivo en
  Windows; las nuevas pruebas de escape con junction real sí se ejecutaron.
- Regresión: carga/relectura de configuración persistente productiva, opciones
  del pool, argumentos de arranque, autenticación, uploads y orígenes CB2.
- Pruebas negativas: selector, configuración faltante/cruzada, manifiesto,
  huellas de secretos, dominios/origen productivos, proxy/telemetría, `.env`,
  rutas compartidas/traversal/junctions y marcador DB ausente/ajeno/con error.
- MySQL usa dobles; no se abre una DB. `spawn` del arranque está sustituido;
  no se inicia Next. `sandbox-no-network.ts` bloquea sockets TCP/TLS, HTTP(S),
  UDP, DNS y fetch durante esta suite. No ejecuta Postman ni comandos externos.
- TypeScript: aprobado. ESLint de archivos del cambio: aprobado.
- ESLint global: **40 errores preexistentes en 23 archivos**, 34 de
  `react-hooks/set-state-in-effect` y 6 de `react-hooks/refs`. Se comprobó por
  hashes Git que los 23 archivos con errores son idénticos a la base citada.
  No se modifica ni se oculta esa deuda en este PR.

## Límites y aprobación posterior

No sustituye firewall, ACL de filesystem, supervisión, backups ni inventario real.
Las comprobaciones de rutas no eliminan carreras frente a un actor con permiso
para cambiar directorios entre validación y acceso; las ACL son parte del perímetro.
Otros scripts administrativos del repositorio no forman parte del runtime sandbox
autorizado y no deben ejecutarse con sus credenciales.

La DB y su marcador aún no están aprovisionados; el arranque debe fallar si falta
configuración y la primera operación DB debe fallar si falta el marcador. No se
verificaron grants, firewall, TLS, restauración ni integración con MySQL real.
No hay worker, recepción de órdenes ni controles M2M nuevos en S02.
Se conserva la autenticación existente. No se aprobó ninguna decisión D01–D16,
merge, despliegue o acceso externo.
