# Validación del ticket

2026-11-05, America/Guatemala.

- `node --test scripts/ps-lab-04-a/audit.test.cjs scripts/sandbox-s06a/preflight.test.mjs`: **25/25 PASS**, 13 nuevas y 12 de regresión. Incluye negativos por versión, arquitectura, referencia, dependencia, conflicto, baseline alterado, índice incompleto y promoción indebida; repetibilidad del resultado canónico y ausencia de ejecución/red en el analizador.
- `verify-local.cjs` sobre originales externos: **PASS**, recibo en `verification.local.json`; 41 checksums PS-LAB-04, 4 PS-LAB-03, 690 registros, cero holds registrados, 5 firmas, 7 catálogos y Contents. Ningún original modificado.
- `git diff --cached --check`: **PASS**. Sólo archivos nuevos bajo `docs/integraciones/pricesmart/s06b1/ps-lab-04-a/` y `scripts/ps-lab-04-a/`. Sin cambios a dependencias ni módulos productivos.
- Los JSON copiados conservan bytes mediante `.gitattributes` local para que la normalización Windows/Linux no invalide sus hashes.

No ejecutados: simulación APT, regresiones contra DB/HTTP reales, instalación, build Linux, VM, SQL o despliegue. El test del comparador y las relaciones estáticas no acredita resolución integral ni concurrencia/durabilidad real. La falta de runtime mantiene `PROPOSED_NOT_INSTALLABLE`; S06 no certificada.
