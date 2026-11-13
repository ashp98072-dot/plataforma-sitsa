# PriceSmart API-16 — suite de conformidad de puertos

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE (pruebas unitarias, tsc, ESLint). Probado contra MariaDB 11.8.9 real desechable (loopback, datos sintéticos): laboratorio API-11 PASS 13 / FAIL 0 / SKIP 0. NO aprobado para producción.** El runtime sigue cerrado (503 `DISABLED`); nada en la aplicación invoca esta suite.

## Qué es
`src/lib/integrations/pricesmart/port-conformance.ts` — `runPortConformance(ports, { required })`. Verifica el **comportamiento observable** de los puertos que una composición productiva debe aportar, para convertir «puerto presente» en «puerto demostrablemente conforme», que es lo que API-15 reporta hoy como `PORTS_NOT_WIRED` / `PORTS_UNVERIFIED`.

| Puerto | Comprobaciones |
|---|---|
| Cifrado de cargas | ida y vuelta, sin texto claro, atado al contexto, detección de alteración, aleatorizado, clave desconocida y datos truncados rechazados |
| Reloj de confianza | entero plausible, monótono |
| Contador atómico | límite exacto, identidades independientes, reinicio de ventana, assurance `DISTRIBUTED_ATOMIC` (no `SIMULATED`), concurrencia exacta |
| Replay atómico | reclamo/reuso, colisión, aislado por identidad, assurance `DURABLE_ATOMIC`, un único reclamo concurrente |
| Catálogo | credencial desconocida → sin coincidencias |
| Verificador de evidencia | vacío, aleatorio y sobredimensionado → denegado (null o excepción) |

El informe contiene solo `{ port, id, pass }`, `missing` y `conformant`: nunca valores, claves ni mensajes de error. Un puerto que lanza una excepción es «no conforme»; sin comprobaciones o con puertos requeridos ausentes, el conjunto no es conforme.

## Qué NO hace (no inventa nada)
No define ni valida el mecanismo M2M de PriceSmart (D02), el contrato de órdenes (D06), endpoints, certificados ni ninguna otra decisión: el verificador solo se comprueba de forma **negativa** (no acepta basura). No ratifica decisiones. No lee el entorno, no abre conexiones propias ni toca el TMS.

## Pruebas
- Referencias en memoria que superan la suite y **mutantes** que deben fallar (contexto ignorado, texto claro, reloj que retrocede, contador/replay no atómicos, identidades compartidas, colisión sin detectar, assurance `SIMULATED`, catálogo con falsos positivos, verificador que acepta basura).
- Ningún código de la aplicación importa la suite (prueba estática).
- Laboratorio API-11: caso `API11.13` ejecuta la suite contra los puertos MariaDB reales (contador, replay, catálogo, reloj) más el cifrado y verificador de laboratorio.
- Se corrigió además `api11-static.test.ts`, que quedó desactualizado tras mover el estado del handler a `runtime-state.ts` (API-15).

## Siguiente paso (no incluido)
Una composición administrativa real aportaría los puertos y ejecutaría esta suite como parte de su verificación antes de instalar el handler; el diagnóstico de API-15 podría entonces consumir una atestación. Requiere decisiones (D02/D06, gestión de claves) que siguen pendientes.
