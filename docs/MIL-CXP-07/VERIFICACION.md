# Verificación y reproducción

## Ejecuciones de esta fase

| Comprobación | Resultado | Qué acredita |
| --- | --- | --- |
| Suite focalizada H-01 | **57 PASS + 1 expected fail, 58 casos, exit 0** | Matriz de permisos, rutas reales en proceso, guard/resolver/mapeo reales con infraestructura sintética; el fallo esperado demuestra incumplimiento de confidencialidad |
| Regresión CxP offline | **357 PASS + 1 expected fail, 358 casos, 21 archivos, exit 0** | 300 pruebas existentes más la suite de 58 casos; no convierte H-01 en aprobado |
| TypeScript global | `--noEmit --incremental false`: exit 0 | Tipado de la base y de la nueva suite |
| ESLint focalizado | `--max-warnings 0`: exit 0 | Nueva suite sin errores/advertencias |
| Alcance Git | Sin archivos rastreados modificados ni staged | Sólo suite nueva y expediente/evidencias nuevos; sin implementación productiva |
| BD, migraciones, servicios | No ejecutados/iniciados | No hay evidencia nueva de motor ni de producción |

Vitest 4.1.12 presenta `it.fails` como fallo esperado. El JSON puede contabilizar ese caso como test aprobado por el framework: **la clasificación de seguridad sigue siendo fallo conocido**, registrado explícitamente en el resumen verbose y en `reproduccion-h01.json`. La suite de caracterización documenta el defecto; no es una aceptación de seguridad de Fase 2.

El caso `KNOWN H-01: desired security contract forbids fiscal configuration for invoices-only` exige que no exista `fiscal.regimenFiscal`; ese requisito falla en el código actual y se marca deliberadamente `it.fails`. Los 57 casos restantes comprueban la respuesta actual y controles de acceso/ámbito. No se ocultaron errores inesperados ni se modificó el código para hacer pasar la auditoría.

## Comandos reproducibles

Desde el worktree MIL-CXP-07 con dependencias propias del lockfile:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts --no-file-parallelism --reporter=verbose --reporter=json --outputFile=docs/MIL-CXP-07/vitest-h01.json
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts' --no-file-parallelism --reporter=verbose --reporter=json --outputFile=docs/MIL-CXP-07/vitest-regresion.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts --max-warnings 0
git diff --check
git status --short --untracked-files=all
```

Las salidas console completas se conservaron mediante redirección a los archivos `.log` respectivos. Los logs vacíos de TypeScript/ESLint indican ausencia de salida; sus exit codes observados fueron cero. La instalación se realizó offline y sin scripts de instalación; no se cambiaron `package.json`, `package-lock.json`, variables de entorno ni configuraciones.

No configurar `LIQ_TEST_DB_PORT` ni ejecutar suites DB para repetir esta reproducción. El módulo `@/lib/db` está reemplazado con un doble de consultas y un `getPool` que lanza error si se intenta abrir el pool. Todo SQL emitido permanece en memoria; no se importa la configuración productiva de BD. `Request`/`Response` se ejecutan dentro de Vitest; no se usa `fetch` contra un servidor, ni un socket HTTP/SQL.

## Datos y oráculos

- Empresas sintéticas: 101/202, slugs `qa-a`/`qa-b`.
- Libros: 11/12 para empresa 101; 21 para 202; 999 inexistente en fixtures.
- Proveedores: 1001 configurado en 11/12; 1002 sin configuración; 2001 de empresa 202.
- Cuentas centinela: 11001–11003, 12001–12003 y 21001–21003. Regímenes distintos entre libros para detectar mezcla.
- Cinco sesiones sintéticas y matrices de permisos efectivas obtenidas por el resolver real a partir de filas V2 del doble de `usuario_modulo`. No son cuentas creadas o importadas en BD.
- El doble exige los predicados de empresa/entidad/proveedor presentes en el SQL real antes de devolver fixtures acotados. Si aparece una consulta no reconocida, falla. **No es un intérprete SQL ni una prueba de ejecución física de sus joins.**

El caso de captura guarda listado HTTP 200, configuración directa HTTP 403, los campos restringidos recibidos y las consultas interceptadas. Proveedor no configurado se conserva con `fiscal:null`. Los IDs sintéticos no corresponden a empresas, personas ni cuentas reales.

## Evidencia y alcance

- `src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts`: única adición de TypeScript, prueba de auditoría, no código funcional.
- `reproduccion-h01.json`: demostración de la respuesta y del incumplimiento.
- `vitest-h01.log` / `.json`: 58 casos focalizados.
- `vitest-regresion.log` / `.json`: 358 casos offline.
- `typescript.log`, `eslint.log`: salida de chequeos.
- `identidad-y-hashes.json`: commit base, SHA de fuentes, contadores y límites.
- `SHA256SUMS.json`: manifiesto de archivos de esta carpeta y de la suite mediante ruta relativa; no se incluye a sí mismo.

Los horarios crudos del runner pueden reflejar reloj/zona del host; la fecha documental usa Guatemala. Los reportes contienen rutas locales al worktree y sólo datos sintéticos; no contienen credenciales. No se afirma que el entorno empresarial se haya inspeccionado.

No se añadieron atributos Git ni se preparó commit. El manifiesto identifica los bytes de trabajo actuales; cualquier integración futura requerirá revisar la política de preservación de evidencia, porque las reglas `-text` de MIL-CXP-06 no abarcan MIL-CXP-07. No normalizar estos archivos silenciosamente si se pretende conservar sus hashes.

## Puerta de salida

Resultado entregado para auditoría independiente. H-01 sigue abierto hasta corrección y aceptación posterior; H-02 y las comprobaciones de migraciones reales/histórico siguen pendientes. La decisión recomendada de Fase 2 y sus límites están en `PROPUESTA-FASE-2.md`. Sin commit, push, PR, merge, SQL, migraciones, importación, despliegue o intervención en otros worktrees.
