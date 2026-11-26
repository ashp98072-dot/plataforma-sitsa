# PriceSmart API-27 — lo que ya podemos probar sin respuestas de PriceSmart

Todo sigue **desactivado**: runtime `DISABLED`, `ready=false`, autorización no concedida, `REVIEWED_KMS_ADAPTERS` vacío, endpoints 503. Nada se conecta a sistemas de PriceSmart ni se inventa un contrato, credencial, estado de entrega o regla de cancelación.

## Separación (ver `PAQUETE-PREGUNTAS-PRICESMART.md`, generado desde `decision-registry.ts`)
| Dependencia | Depende de PriceSmart | Ya implementado y probado sin ellos |
|---|---|---|
| D02 autenticación | mecanismo, ancla de confianza, audiencia, rotación, anti-reenvío, IPs | puerto de verificador/evidencia con conformidad, revocación inmediata, cuotas, anti-reenvío (API-11…26) |
| D06 contrato de la orden | diccionario de datos definitivo | **compilador de diccionarios** (`order-contract-dictionary.ts`): validador estricto + identidad de contenido; `lab-demo-1` como datos; límites, Unicode, fechas, arreglos |
| D09 cancelación | método, estados, política | evaluación pura por estado real del TMS; nunca automática |
| D13 entrega confirmada | evidencia, actor, parciales | evaluación informativa; `confirmsDelivery:false` siempre |
| KMS/HSM | proveedor y requisitos | **kit de conformidad** (`kms-client-conformance.ts`) que todo adaptador debe pasar antes de revisarse |

## Incremento de API-27
1. **Kit de conformidad KMS**: 12 comprobaciones (ida y vuelta, sin texto claro, no determinista, ligadura a contexto y alias, manipulación, truncamiento, alias desconocido, errores sin fugas, entradas no mutadas, aborto, salud). Se prueba contra el cliente de laboratorio y contra 10 clientes defectuosos (uno por defecto) que el kit debe detectar. Pasar el kit **no aprueba** un proveedor.
2. **Diccionario del contrato (D06)**: mecanismo declarativo; un diccionario `RATIFIED` solo compila con `D06` ratificada; equivalencia demostrada con el esquema de laboratorio; probado con MariaDB real (circuito completo, idempotencia normalizada, límites en el borde, aislamiento).
3. **Defecto corregido en `parseBody`** (`contracts.ts`): la detección de claves duplicadas era global y rechazaba como «duplicado» un arreglo de objetos con los mismos nombres de campo (p. ej. varias entregas). Ahora es por objeto; las claves repetidas dentro de un mismo objeto (incluso con escapes) siguen rechazándose.
4. **Registro de decisiones** y **paquete de preguntas** con 30 preguntas concretas; una prueba falla si el documento no coincide con el registro o si un punto de enchufe deja de existir.

## Ajustes tras la auditoría de #628
- **Patrones (ReDoS):** se eliminó la heurística. Un patrón ahora debe pertenecer a un **lenguaje restringido** (`analyzePattern`): `^` + átomos con cuantificador + `$`; **sin grupos, alternancias, referencias hacia atrás, anticipaciones ni perezosos** (para alternativas fijas se usa `enum`). Sin grupos no hay cuantificadores anidados ni alternativas ambiguas; el costo restante es el producto de las elecciones de repetición de los cuantificadores variables, acotado por `MAX_PATTERN_COST` (5000) usando `max` del campo (la cadena se longitud-valida ANTES del patrón). Pruebas: lista positiva y negativa por estructura (sin ejecutar los peligrosos) y 400 patrones aleatorios cuyos admitidos se ejecutan contra cadenas adversarias en un hilo con límite de tiempo.
- **Cancelación en el kit KMS:** con señal ya abortada, `ABORT_SETTLES` exige que la llamada **termine** (no se cuelgue). Si el cliente **rechaza** → `cancellation: HONORED`; si la **completa** → `IGNORED`, que **no valida** la cancelación (informativo, no bloquea `conformant`). El kit solo ejercita una señal abortada *antes* de la llamada; la cancelación a mitad de vuelo hay que revisarla en el adaptador concreto. `createKmsKeyProvider` no envía nada tras abortar aunque el cliente ignore la señal (probado con un contador de llamadas). El cliente de laboratorio ahora respeta la señal (`HONORED`).

## Bloqueos y fallos documentados (no resueltos aquí)
- **Build (actualizado):** ya no se reproduce en `main` con Next 16.4.6; ver `../auditoria-homologacion/README.md` § Compilación. Registro original: falla en HEAD y en `origin/main` limpio con `SecurityFatalError` (aviso del registro sobre Next.js 16.4.1) tras compilar y pasar TypeScript; requiere decisión sobre dependencias, fuera de este alcance.
- **Suite completa:** 5 fallos solo en HEAD frente a `main` (4 DOM de `flota/cb2` con timeouts de 5 s que también ocurren en `main` al correr ese directorio, y `http-transport` «keeps Next HTTP disabled…» que pasa 95/95 aislado y tardó 5,07 s vs 3,14 s en `main` bajo carga). No se demostró la causa de los timeouts.

## No hecho (depende de terceros)
Verificador externo (D02), diccionario definitivo (D06), método de cancelación (D09), evidencia de entrega (D13), proveedor y adaptador KMS aprobados, infraestructura (host, TLS, allowlist) y autorización humana de despliegue.
