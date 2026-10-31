# S05 — candidato de artefacto privado

Estado: preparación revisable; **no apto para instalar ni desplegar**. No existe todavía un artefacto Linux de Novalvion construido y validado. El cierre operativo y la suficiencia final del tracing quedan pendientes de S06. D01–D16 siguen pendientes de ratificación.

Base: `388dd33cc61abcc3dd830b4f3acae93e3ca5b3bc`, merge PR #544. Incluye S02 (#542), S03 (#543) y S04 (#544). Rama independiente `feature/pricesmart-sandbox-s05`; no se modifica #541.

## Auditoría y decisión de empaquetado

Se leyeron las guías instaladas Next 16.4.1 `output.md`, `self-hosting.md` y los controles actuales. S03 permite directorios completos `.next`, `public`, `node_modules`: no es un inventario mínimo ni se utiliza como selección del paquete S05. Se conserva intacta para no invalidar S03.

`next-command.mjs` rechaza builds en modo sandbox; S05 conserva esa regla. La construcción ocurre sin configuración runtime, en una copia descartable. Sólo en esa copia se añade `output: "standalone"` al mismo `next.config.ts`. No se cambia la configuración de negocio. Next genera `server.js` y copia dependencias trazadas; `public` y `.next/static` deben añadirse explícitamente. El generador S05 inspecciona los `.nft.json`, rechaza raíces adicionales y enlaces y exige archivos dinámicos conocidos. Una salida inesperada detiene el empaquetado; no se amplía la allowlist automáticamente.

`start-hostinger.mjs` carga configuración operativa fuera de sandbox y no reenvía explícitamente señales. No se distribuye. `next-command.mjs` sí reenvía señales, pero depende del CLI y de configuración TypeScript. S05 propone una entrada independiente para el servidor standalone: verifica el hash externo del manifiesto, todos los archivos y la configuración S02 **antes** de ejecutar Next. Fija `127.0.0.1:3000`, Node 24 exacto del artefacto, arquitectura y Linux; rechaza NODE_OPTIONS/NODE_PATH. No carga `.env`. Los controles de identidad SQL S02 permanecen en el código compilado y los grants/cuenta bloqueada S04 no cambian.

## Inventario runtime y permisos

| Elemento | Motivo / acceso |
|---|---|
| `server.js`, `.next/server`, manifests de Next, BUILD_ID | Servidor generado y rutas; lectura, nunca escritura de código |
| `.next/static`, `public` | Assets; lectura. `public/brands/monaco/logo.png` se lee desde cwd en `src/lib/tms/cotizacion-pdf-assets.ts` |
| `node_modules` seleccionado por standalone | Next/React y dependencias reales de trazas; no copia del árbol de desarrollo completo |
| ExcelJS, PDFKit | Externos explícitos en next.config; sus transitivas deben estar trazadas. PDFKit lee `js/data/*.afm`; se exige Helvetica.afm |
| sharp y paquetes `@img/*`, SWC | Binarios dependientes de Linux/arquitectura/libc. No reutilizar binarios Windows; carga real pendiente S06 |
| mysql2, jose, zod, pdf-lib, date-fns, decimal.js | Dependencias declaradas; presencia exacta determinada por tracing, no por esta lista orientativa |
| Tres módulos en `scripts/` | Arranque S05, verificador y validador S02 sin cambios |
| `artifact.json` | Lista positiva exacta de cada archivo, tamaño y SHA256; commit, lock, Node, Next, plataforma y arquitectura |
| `.next/cache` | Excluida del paquete. Crear vacía para runtime; escritura de caché técnica propuesta por S03, no datos de negocio |
| uploads, firmas, fotos, adjuntos | No se empaquetan. Lecturas dinámicas detectadas en uploads.ts, usuario-firmas.ts, RRHH, compras y reportes TMS. Directorio vacío y sólo lectura en propuesta S05 |

`package.json` del resultado se reduce a nombre, versión, private y type; no scripts administrativos ni devDependencies. No se incluye CLI de instalación, SQL, CI, documentación, infra, fuentes sueltas, caché de build, sourcemaps, secretos ni uploads. Una dependencia trazada con archivos prohibidos causa rechazo; su resolución necesita revisión explícita, no un filtro silencioso.

S03 conserva `KillMode=control-group`, TimeoutStopSec=45, reinicio limitado y sin capacidades. El drop-in propuesto cambia únicamente ExecStart, ancla del manifiesto y restringe uploads a lectura. No se ejecutó systemctl. El supervisor reenvía SIGTERM/SIGINT al hijo directo; el control de todos los descendientes depende de systemd, aún sin prueba Linux. No declarar ausencia de huérfanos con pruebas Windows.

## Procedimiento reproducible propuesto (no ejecutarlo en producción)

1. Revisar commit/lock y todos los archivos S05. Disponer una VM Linux exclusiva aprobada, Node 24.18.0 y caché npm offline correspondiente a su arquitectura/libc. No crear ni contratarla desde estos scripts.
2. En un checkout limpio del commit auditado, sin `.env` ni configuraciones operativas en ancestros, crear una copia nueva:

   ```sh
   node scripts/sandbox-s05/stage.mjs "$CHECKOUT" /var/lib/novalvion-ps-build/source
   ```

   Stage copia únicamente archivos versionados de src/public y una lista cerrada de configuración/build. Rechaza modificaciones versionadas, enlaces, secretos reconocibles y destinos existentes. No copia `.git`, node_modules, SQL ni archivos privados. Revisar `s05-source-files.json`; no se certifica que una expresión regular detecte todos los secretos.
3. En esa copia, **antes del build y dentro de aislamiento aprobado**, instalar exclusivamente desde caché verificada: `npm ci --offline --ignore-scripts --no-audit --no-fund`. La falta de caché, binario nativo o dependencia detiene el procedimiento. No usar fallback de red ni herramientas descargadas durante compilación. Verificar hashes del lock y Node/Next instalados. La integridad npm valida paquetes contra el lock; revisar también procedencia de la caché.
4. Revisar S03 build.service y el drop-in S05; sustituir el commit, instalar únicamente tras autorización S06. Mantener PrivateNetwork=yes y rutas inaccesibles. Ejecutar manualmente la unidad. El builder exige Linux y una tabla IPv4 de rutas vacía; esto es defensa adicional y **no acredita por sí solo** el aislamiento. La unidad y su namespace deben auditarse en S06.
5. El builder usa ambiente cerrado, clave AUTH efímera sintética y preload heredado por workers Node. Deniega sockets, TLS, DNS, fetch y createPool/createConnection mysql2; registra sólo `DENIED`, sin argumentos ni secretos. Si el intento es capturado por la aplicación, el journal igualmente invalida el build. Una dependencia de servicios o IPC incompatible detiene el build, no se exceptúa. La clave efímera no puede aparecer en la salida. No hay llamadas a migraciones ni ensureSchema en los scripts S05; su ausencia efectiva durante una compilación real aún no está demostrada.
6. Se genera `source/artifact/artifact.json` y se imprime sólo su SHA256. Archivar manifiesto, logs sanitizados, trazas y revisión de bundles; obtener el hash aprobado por canal independiente. Nunca confiar en un hash que venga únicamente dentro del paquete. Repetir el build en otra copia limpia y comparar: la repetibilidad del **build Next completo no está probada** (BUILD_ID y otros contenidos pueden variar). No falsear igualdad eliminando controles o diferencias.

## Instalación, parada y reversión propuestas para S06

No se ejecutaron. Verificar con una copia confiable del verificador, no con código extraído aún no verificado:

```sh
node "$REVIEWED_TOOLS/scripts/sandbox-s05/artifact.mjs" verify "$RELEASE" "$APPROVED_SHA256"
```

Extraer/copiar en directorio nuevo, privado, sin enlaces, con ancestros propiedad del instalador; nunca sobre una versión existente. El manifiesto rechaza archivos extra, faltantes, alterados, hardlinks y enlaces, incluso en ancestros. El chequeo no reemplaza la revisión de dueño/permisos Linux: instalador dueño del código, runtime sólo lectura, directorios 0750/archivos 0640, scripts invocados mediante Node; secretos externos 0600. Crear `.next/cache` vacía después de verificar. El manifiesto declara únicamente `.next/cache` como ruta mutable técnica ya prevista en S03. La verificación de instalación exige árbol exacto; el arranque permite archivos únicamente dentro de esa caché y sigue rechazando enlaces/junctions en todo el árbol. No autoriza alterar código ni escribir uploads o SQL. Comportamiento real de ISR y permisos pendientes S06; cualquier escritura fuera de caché debe fallar, sin ampliar ReadWritePaths.

Provisionar `isolation.json` y entorno exclusivamente por S02/S03, base nueva y marcador por S04. Mantener ACCOUNT LOCK y SELECT por tabla. No conceder DDL/escrituras para satisfacer ensureSchema; muchas rutas frías pueden fallar legítimamente. MariaDB ausente, cuenta bloqueada o marcador ajeno deben impedir operaciones; un proceso Next escuchando no demuestra disponibilidad funcional.

Tras aprobación S06: detener proxy/app con systemd, comprobar cgroup vacío y puerto cerrado sin parar MariaDB; validar release nueva/ancla y activar con copia controlada, nunca symlink. Arrancar únicamente en loopback. Revertir deteniendo app/proxy, restaurando release y hash previos verificados y volviendo a validar S02. No revertir/alterar base ni desbloquear cuentas. Conservar release fallida y evidencia para auditoría. No ejecutar estos pasos desde S05.

## Riesgos y bloqueos abiertos

- Sin build Linux real no existe inventario final por archivo ni manifiesto de Novalvion liberable. `artifact-metadata.example.json` es una plantilla inválida, no evidencia de artefacto construido.
- Repetibilidad probada sólo del empaquetado de un mismo árbol sintético. Faltan dos builds reales, análisis de trazas, carga de binarios, fuentes, imágenes, bundles y assets completos.
- Dominio `https://novalvion.com` en `src/lib/flota/cb2/origin.ts`. S02 deshabilita CB2 y exige origen loopback; no se modifica negocio ni se autoriza tráfico. Revisar dominios en bundles generados y demostrar bloqueo de red también en navegador en S06. Referencias fiscales documentales no demuestran conexiones.
- Las expresiones de secretos son heurísticas; no certifican ausencia de credenciales arbitrarias. Revisar origen y bundles, sin secretos operativos presentes durante construcción.
- La excepción de caché técnica es explícita en el manifiesto y sólo se aplica al verificador de arranque. Su suficiencia para ISR/reinicio requiere S06. No se amplían permisos S03 ni se habilitan escrituras de negocio.
- Los guardas Node no son un sandbox de seguridad para código hostil o binarios nativos; el aislamiento real depende del namespace, mounts, usuario, firewall y revisión S06. No hay prueba de Linux/systemd/TLS/firewall/DB real/recuperación en esta entrega.

La auditoría independiente debe evaluar este PR como preparación parcial con bloqueos explícitos, no como certificación de aislamiento ni autorización de merge/despliegue.
