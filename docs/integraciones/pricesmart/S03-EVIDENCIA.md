# S03: evidencia para auditoria independiente

Fecha: 2026-10-31 (America/Guatemala). Base actualizada desde origin/main: `492dd7c3dc83e434b504f3827652cc6a5785be49`, merge del PR #542. Head de S02 incorporado: `137f4815` (SHA completo en JSON). El SHA y numero de PR de S03 se publican en la entrega/PR, sin referencia circular dentro del commit.

**Resultado: PASS estatico/offline; NO acredita despliegue ni aislamiento operativo Linux.** El sandbox debe seguir privado hasta revision posterior. D01-D16 pendientes de ratificacion. No se modifica PR #541 ni se autoriza merge.

Receta, recursos, matriz de conexiones, aprovisionamiento/reversion, backup y restauracion: [S03-INFRAESTRUCTURA-PRIVADA.md](S03-INFRAESTRUCTURA-PRIVADA.md). Resultados sanitizados por prueba: [S03-EVIDENCIA.json](S03-EVIDENCIA.json).

## Matriz de validaciones

| Control | Resultado | Metodo y evidencia | Limite |
|---|---|---|---|
| Sincronizacion origin/main y presencia de S02 | PASS | fetch main, log de merge #542 y merge-base ancestor | Lecturas Git; sin cambios en main remoto |
| Compatibilidad sin duplicar guards S02 | PASS | Los 26 archivos incorporados por S02 tienen el mismo blob Git; import del validador existente | Se respetan filtros CRLF al comparar |
| Configuracion propuesta completa y cerrada | PASS estatico | `pricesmart-plan.mjs`, seis servicios, destinos externos=0 | Validador del perfil fijo, no parser nativo general |
| Materializacion sintetica de env/manifiesto | PASS | Secretos efimeros CSPRNG en fixture temporal, mismo validateSandboxConfig S02 | No se aprovisionan secretos persistentes ni DB |
| Placeholders incompletos y manifiesto cruzado | PASS negativa | Fallan en S02, sin iniciar Next | No simula grants/DB real |
| Egress/public ingress/PriceSmart/D01-D16 indebidos | PASS negativa | Mutaciones rechazadas por plan | Sin paquetes de red reales |
| Usuario root runtime, arranque alternativo, comando extra | PASS negativa | Mutaciones de unidad rechazadas | No aplica configuracion a systemd |
| Padre de manifiesto escribible y ruptura del loopback compartido | PASS negativa | Mutaciones de unidad rechazadas | Permisos reales de VM NO verificados |
| Firewall permisivo/DNS/stop que elimina reglas | PASS negativa | Mutaciones rechazadas; no nft/spawn/red | No acredita soporte BPF, sintaxis nft o counters |
| MariaDB/TLS publicos, grants amplios/marcador escribible/adopcion de DB | PASS negativa | Inspeccion local de plantillas mutadas | No ejecuta SQL, MariaDB o nginx |
| Build con variables/archivos/ancestros operativos | PASS negativa | Rechazo previo a spawn | No se ejecuto build de Next |
| Bateria S03 | PASS | **42/42**, nombres/resultados en JSON | Tests estaticos + fixtures locales |
| Regresion completa S02 | PASS | **195/195**, 8 archivos, sin omisiones | Usa los dobles/no-network de S02 |
| Total | PASS | **237/237**, 9 archivos, cero FAIL/omitidas | No confundir con aceptacion Linux |
| Inventario runtime | PASS estatico | 1298 archivos; unico driver/constructor src/lib/db.ts; cero subprocesses en src | Builder S03 es herramienta administrativa fuera del runtime |
| TypeScript | PASS | `--noEmit --incremental false`, exit 0 | Dependencias locales indicadas abajo |
| ESLint del alcance | PASS | scripts/infra y vitest.s03.config.mts, exit 0 | No se repite ni se oculta deuda global ajena a S03 |
| Shell backup | PASS sintaxis | Git Bash `bash -n`, exit 0 | No ejecuta backup ni acredita comportamiento GNU/Linux |
| Diferencias | PASS | git diff --check y cached --check | Solo infraestructura, herramientas de revision/build y docs S03 |
| systemd-analyze verify/security | NO EJECUTADA | Herramientas Linux no disponibles en host Windows | Ejecutar en imagen aprobada antes de instalar/habilitar |
| nft --check, paquetes, IPv6, TLS nginx -t | NO EJECUTADA | No hay VM ni herramientas nativas del perfil | Requiere laboratorio Linux aislado y consola |
| MariaDB nueva, SQL, grants, marcador y schema/fixtures | NO EJECUTADA | Prohibido provisionar infraestructura en S03 | Aprovisionar solo tras autorizacion/revision |
| Build Linux, allowlist reducida, permisos y lifecycle real | NO EJECUTADA | No se ejecuto builder ni servicios | Verificar cache necesaria, notify y KillMode real |
| Backup/restore/cifrado y RPO/RTO | NO EJECUTADA | Solo plantilla y sintaxis Bash | Requiere clave de prueba, nueva VM y simulacro autorizado |
| Acceso privado operador | NO EJECUTADA | No SSH/VPN/firewall publico configurado | Monaco debe aprobar transporte y origen |

## Reproduccion offline

Desde checkout limpio del SHA del PR, con dependencias locales del lockfile ya disponibles:

```powershell
node scripts/infra/pricesmart-plan.mjs
node node_modules/vitest/vitest.mjs run --config vitest.s03.config.mts
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js scripts/infra vitest.s03.config.mts
# Sintaxis solamente, tambien disponible en Linux:
bash -n infra/pricesmart-sandbox/backup.sh
node scripts/ci/sandbox-inventory.mjs --output .lab-runtime/s03-inventory.json
git diff --check
git diff --cached --check
git diff 492dd7c3dc83e434b504f3827652cc6a5785be49 HEAD
```

Crear `.lab-runtime` local si se quiere guardar reportes, sin versionar los logs crudos. En Windows se uso `C:/Program Files/Git/bin/bash.exe -n ...` exclusivamente para sintaxis. Los tests reutilizan `scripts/ci/sandbox-no-network.ts`; los fixtures secretos se generan en memoria/temporales, se destruyen al terminar y no aparecen en evidencia. No se importan init-db, migradores ni el servidor para validar el plan.

Dependencias de esta ejecucion: Node 24.18.0, Vitest 4.1.12, Next 16.4.1. Se reutilizo por junction ignorada el node_modules local de S02, previamente instalado; **no se ejecuta npm ci ni se descarga nada en S03**. Lockfile identico en ambos worktrees: SHA256 `d41410a952adfd432b3f2ee7de20a9ef161c4d0554e532e2a28245082965c3e9`. Esto permite verificar el codigo offline; una instalacion Linux nueva y su build siguen pendientes y no se presentan como probados. package.json y lockfile no cambian.

## Pendientes antes de cualquier ejecucion real

- Monaco debe aprobar imagen/versiones/hashes/proveedor/region/capacidad, consola y almacenamiento, custodios de backup/TLS y acceso privado de operadores. No hay presupuesto ni contratacion ejecutados.
- Un administrador debe revisar las seis unidades y ejecutar los validadores nativos en una VM nueva sin datos. No usar el host de produccion ni instalar servicios S03 en la estacion actual.
- El responsable de datos debe aprobar secuencia DDL/fixtures sinteticos, matriz tabla-privilegio y lista de hojas de uploads. La plantilla no da DML de negocio ni DDL al runtime para ocultar dependencias.
- Ensayar rechazo de marcador/grants, permisos de padres/enlaces, egress y ausencia de listeners externos, arranque/parada de hijos, build sin red, artefacto reducido, TLS, backup cifrado y restore en OTRA VM nueva. Fallos deben registrarse, sin ampliar permisos o abrir red para eludirlos.
- Cualquier endpoint, credencial M2M, worker o destino PriceSmart necesita un cambio/revision posterior y la ratificacion pendiente D01-D16. Nada de eso se activa en S03.

Los placeholders y gates impiden considerar las plantillas como un despliegue listo para produccion. Los riesgos residuales son la falta de ensayo Linux, compatibilidad exacta de paquetes/kernel, dependencia de ACL/grants efectivos, cache runtime y recuperabilidad no medida. Mantener el PR Draft hasta auditoria independiente; no hacer merge automatico.
