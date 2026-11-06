# Validación del ticket

## A. Pruebas históricas del ticket original (2026-11-05, America/Guatemala)

Registradas tal como se reportaron entonces; no se repitieron en esta actualización salvo lo indicado en la sección B.

- `node --test scripts/ps-lab-04-a/audit.test.cjs scripts/sandbox-s06a/preflight.test.mjs`: **25/25 PASS**, 13 nuevas y 12 de regresión. Incluye negativos por versión, arquitectura, referencia, dependencia, conflicto, baseline alterado, índice incompleto y promoción indebida; repetibilidad del resultado canónico y ausencia de ejecución/red en el analizador.
- `verify-local.cjs` sobre originales externos: **PASS**, recibo en `verification.local.json`; 41 checksums PS-LAB-04, 4 PS-LAB-03, 690 registros, cero holds registrados, 5 firmas, 7 catálogos y Contents. Ningún original modificado.
- `git diff --cached --check`: **PASS**. Sólo archivos nuevos bajo `docs/integraciones/pricesmart/s06b1/ps-lab-04-a/` y `scripts/ps-lab-04-a/`. Sin cambios a dependencias ni módulos productivos.
- Los JSON copiados conservan bytes mediante `.gitattributes` local para que la normalización Windows/Linux no invalide sus hashes.

No ejecutados en el ticket del 2026-11-05: simulación APT, regresiones contra DB/HTTP reales, instalación, build Linux, VM, SQL o despliegue. El test del comparador y las relaciones estáticas no acredita resolución integral ni concurrencia/durabilidad real. La falta de runtime mantenía `PROPOSED_NOT_INSTALLABLE`; S06 no certificada.

## B. Actualización 2026-11-06 (laboratorio APT `core`, UTC)

Detalle en [RESULTADOS-LAB-APT-CORE.md](RESULTADOS-LAB-APT-CORE.md).

- **Revisión de evidencias (solo lectura, fuera del repo):** SHA-256 del paquete verificado antes de extraer; 17/17 hashes individuales contra el informe de cierre; dos diagnósticos `core` sin `--no-download` idénticos (10 `Inst`, 10 `Conf`, 0 `Remv`; 20 acciones ordenadas iguales). La prueba formal con `--no-download` se ejecutó una sola vez (`run1`), exit 100: **bloqueada**.
- **Pruebas automatizadas (2026-11-06):** `node --test scripts/ps-lab-04-a/audit.test.cjs scripts/sandbox-s06a/preflight.test.mjs` → **25/25 PASS** (13 de `audit.test.cjs`, 12 de `preflight.test.mjs`). **Estas pruebas no verifican las evidencias APT ni el documento nuevo**; solo confirman que las pruebas existentes no se rompieron.
- `git diff --check` sobre los archivos rastreados modificados: PASS. El archivo nuevo sin rastrear se revisó aparte (espacios finales, CRLF, salto final), porque `git diff --check` no lo cubre.
- Niveles: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (hashes y consistencia con el manifiesto) para el diagnóstico `core`; PROBADO solo el diagnóstico, no la prueba formal; **no** APROBADO PARA PRODUCCIÓN. S06 NOT CERTIFIED. Sin SQL, instalación, descarga, despliegue ni migración.
