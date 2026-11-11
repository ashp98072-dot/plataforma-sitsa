# Riesgos residuales y relación con D01–D16

## Riesgos residuales (declarados, no resueltos)
1. **TCP en loopback.** Durante los minutos del run, otro proceso local del mismo equipo podría conectarse al puerto. Mitigación: puerto aleatorio, cuenta solo `@'127.0.0.1'` con contraseña de 256 bits, sin `root` por TCP. Es una desviación consciente del patrón C3C-1 (solo pipe), exigida por `validateSandboxConfig`.
2. **Código del laboratorio sin ejecutar.** Ninguna línea de `run-windows.mjs` ni de `mariadb-real.lab.ts` se ha corrido contra un motor. Es probable que la primera ejecución real revele errores del arnés (p. ej. comportamiento de `mariadb-install-db` en Windows, forma de `SHUTDOWN`, `@@socket`/`@@secure_file_priv`, permisos del `SELECT … FOR UPDATE` con `UPDATE` solo a nivel de columna). Un FAIL así se informa tal cual; no se ajustan expectativas en silencio.
3. **Arnés de recuperación (B7).** La caída es un `SIGKILL` del proceso hijo; no demuestra durabilidad ante fallo de disco/SO. El caso «caída durante COMMIT» queda SKIP.
4. **Procedencia del motor.** El ZIP coincide con el SHA-256 registrado en el repositorio (`archiveSHA256` de combustibles-PR2), pero no se recomprobó hoy contra `archive.mariadb.org`; `mariadbd.exe` no lleva firma Authenticode.
5. **Dependencias.** Las pruebas reales usan `node_modules` del checkout principal (el worktree no tiene propias). No se cambió `package.json` ni el lockfile.
6. **El motor no aísla inquilinos.** El aislamiento multiempresa es del adaptador (cláusula `WHERE` con alcance completo); la cuenta de BD es única. B5 verifica el adaptador, no un control del motor.
7. **Grants del laboratorio ≠ grants de producción.** La cuenta de laboratorio no tiene `SELECT` en `ps_api01_scopes` (el adaptador no lo usa), a diferencia de la propuesta de `PERSISTENCIA.md`.
8. **Fragilidad de plataforma.** El ejecutor es solo Windows (PowerShell para PID/puertos). Las consultas CIM/NetTCP se prueban de forma real solo contra el propio proceso de prueba y con fallos inyectados; su comportamiento ante un servidor MariaDB real no se ha observado.
9. **Posible falso positivo de seguridad.** El cierre es deliberadamente conservador: un estado incierto del PID, del puerto o de los descendientes (p. ej. proceso de otro usuario o consulta CIM lenta) conserva el directorio y devuelve INCOMPLETO/FAIL aunque el servidor ya hubiera terminado; en ese caso la limpieza es manual y se informa la ruta.
10. **PASS pleno inalcanzable.** Con `B7.5` como SKIP permanente, el mejor resultado de la suite es `PASS CON LIMITACIONES`.

## Relación B0–B9 ↔ D01–D16 (NO se declaran resueltas)
| Decisión pendiente | Bloques afectados | Tratamiento en API-06A |
|---|---|---|
| D02 mecanismo M2M | B0, B5 | No se prueba autenticación real; la identidad se inyecta como `IdentityPort` de prueba |
| D03 unicidad de `externalOrderId` (cuenta/país/club, mayúsculas, reutilización) | B3, B4, B5 | Se prueba la UNIQUE actual tal cual (binaria, sensible a mayúsculas); cualquier cambio de D03 invalida B3–B5 |
| D04 catálogo de empresas/clientes/clubes | B5 | Alcances sintéticos fijos (`LAB_SCOPES`) |
| D05 una/múltiples entregas | — | Fuera de alcance (TMS no se toca) |
| D06 diccionario de campos | B2 | Solo el DTO mínimo vigente (`api01-draft-1`) |
| D07 zona horaria/ventanas | B2 | El adaptador fija UTC; no se valida política de fechas |
| D08 estados oficiales | B2, B3 | Solo los 4 estados locales de API-01 |
| D09 cancelación (quién/cuándo/método) | B2.2, B3.3, B4 | Se prueba la mecánica local (CAS por versión), no la política |
| D10 idempotencia HTTP (clave, replay, reintentos) | B3, B4 | Se prueba la idempotencia por identidad de orden; la clave HTTP no existe aún |
| D11 cuotas/volumen | B4 | Concurrencia pequeña (≤ 10); no es prueba de carga |
| D12 respuestas/errores | — | Fuera de alcance (transporte) |
| D13 POD | — | Fuera de alcance |
| D14 PII/retención/cifrado | B2 | Cifrador de prueba (AES-GCM); no valida custodia de claves ni retención |
| D15 entornos/aceptación | B0 | Entorno local desechable; no sustituye S06 ni el sandbox Linux |
| D16 KPI/OTD | — | Fuera de alcance |

Conclusión: aun con B0–B9 en PASS, API-06A solo demostraría el comportamiento del adaptador API-02 contra MariaDB 11.8.9 en Windows con datos sintéticos; **no** ratifica D01–D16, no certifica S06 y no autoriza conexión real.
