# C3C-14: QA funcional y conciliación precontable

Ejecutar desde la raíz del repositorio en Windows, con `node_modules` instalado y la distribución MariaDB 11.8.9 existente en `.lab-runtime/mariadb-11.8.9-winx64`. No instala binarios ni usa servicios del sistema. No se necesita configuración de BD operativa.

```powershell
node scripts/ci/c3c14/run-windows.mjs --run-isolated --engine=mariadb
```

El ejecutor reutiliza la infraestructura comprobada de C3C-13, verifica SHA-256 del binario y distribución, crea un datadir y un named pipe nuevos sin red, carga solo fixtures sintéticos y las migraciones existentes C3C-1 a C3C-13. Verifica identidad antes de operar. No toca el laboratorio C3C-8. No añadir `.env`, DB_HOST, DB_USER ni contraseñas; el entorno de las pruebas se construye sin configuración de BD operativa y los tests rechazan cargarla.

Las siguientes opciones ejecutan cada suite anterior en otra instancia nueva:

| Opción | Suite |
| --- | --- |
| `--run-c5-isolated` | Diagnóstico de cierre |
| `--run-c6-isolated` | Simulación de regularización |
| `--run-c7-isolated` | Cuenta de resultado |
| `--run-c8-isolated` | Propuesta simulada, sin usar el laboratorio C3C-8 |
| `--run-c9-isolated` | Preparación y procedencia |
| `--run-compat-isolated` | Revisiones C3C-10 |
| `--run-c11-isolated` | Políticas, solicitudes y decisiones |
| `--run-c12-isolated` | Evidencias |
| `--run-c13-isolated` | Informe y constancias |

Sustituir `--run-isolated` por la opción deseada y conservar `--engine=mariadb`. Se exige que todas las pruebas de la suite aprueben, sin pruebas omitidas. No ejecutar estas suites con una conexión creada manualmente.

Cada ejecución imprime su directorio `%TEMP%/novalvion-c3c2-<uuid>` y conserva:

- `results.json`, `tests.log`: resultados Vitest.
- `postcheck-c13.json`: cinco controles SQL después de la suite.
- `qa-execution.json`: suite, versión Node/MariaDB, base Git y hashes de fuentes.
- `shutdown.jsonl`, `server.log`: salida ordenada confirmada.
- `manifest.json`: identidad privada del laboratorio; **no publicarlo**.

El recorrido C3C-14 añade `c3c14-journey.json`, informe JSON sintético, XLSX original y render SSR HTML. El informe formal permanece pendiente. El render SSR no es un navegador ni una captura de pantalla. El JWT de la prueba API se firma realmente con un secreto efímero; el almacén de cookies de `next/headers` está simulado. No hay servidor HTTP ni login real en esa prueba.

Para repetir las 216 pruebas unitarias/contratos/API/render:

```powershell
node_modules/.bin/vitest.cmd run src/lib/contabilidad/cierre-diagnostico.test.ts src/lib/contabilidad/regularizacion.test.ts src/lib/contabilidad/cuenta-resultado.test.ts src/lib/contabilidad/propuesta-regularizacion.test.ts src/lib/contabilidad/regularizacion-control.test.ts src/lib/contabilidad/origen-revisiones.test.ts src/lib/contabilidad/politicas-autorizacion.test.ts src/lib/contabilidad/expediente.test.ts src/lib/contabilidad/expediente-http.test.ts src/lib/contabilidad/precontable.test.ts --reporter=json --outputFile=scripts/ci/c3c14/unit-results.local.json
```

Recopilar las diez ejecuciones completas y las unitarias, usando los nombres de directorio que haya producido la nueva ejecución:

```powershell
node scripts/ci/c3c14/collect-evidence.mjs --unit=scripts/ci/c3c14/unit-results.local.json --output=docs/qa/c3c14/evidencia.json novalvion-c3c2-<uuid-C5> novalvion-c3c2-<uuid-C6> novalvion-c3c2-<uuid-C7> novalvion-c3c2-<uuid-C8> novalvion-c3c2-<uuid-C9> novalvion-c3c2-<uuid-C10> novalvion-c3c2-<uuid-C11> novalvion-c3c2-<uuid-C12> novalvion-c3c2-<uuid-C13> novalvion-c3c2-<uuid-C14>
```

El recopilador rechaza suites incompletas, pruebas omitidas/fallidas, postcheck incorrecto o cierre no confirmado. Solo lee evidencias; no abre conexiones SQL. No copiar datadirs, manifiestos privados ni tokens al repositorio.
