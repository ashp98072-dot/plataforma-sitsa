# TMS-COMB-03A — Laboratorio local

Base: `28df1631f6006b3fe51cf6f11fbae12c90ed67c9`. Rama: `feature/tms-comb03a-externos-prototipo`.

No es una ruta Next ni se incorpora al menú o al flujo de importación. `PrototipoExternos` se monta únicamente en el harness DOM; no iniciar un servidor productivo para probarlo. El loader opcional existe para simular demoras/errores en pruebas, no como adaptador de red. Los datos están en memoria y se pierden al desmontar. D1–D5 siguen NO APROBADAS para operación.

## Inventario

- `contratos.ts`: uniones discriminadas estrictas, revisión pura, ámbito sintético y diagnósticos de búsqueda. Empleado solo admite selección MANUAL con motivo en este incremento; no implementa matching automático ni autorización real.
- `fixtures.ts`: empresas A/B, homónimos, inactivos/pendientes, externo verificado y unidad compartida explícita; todos sintéticos.
- `prototipo.tsx`: selección de identidades, consulta de candidatos y resultado simulado; botón de confirmación deshabilitado sin handler. No crea tokens ni registra consumos.
- `contratos.test.ts`: 32 casos unitarios, variantes/campos, revisiones, aislamiento y ausencia de mutaciones.
- `prototipo.dom.test.ts`: 10 casos DOM, cuatro combinaciones, estados, compartidos, cambio A/B/A, éxito/error tardíos y trampas de efectos.
- `aislamiento.test.ts`: 2 controles de frontera de imports y ausencia de incorporación desde módulos operativos.
- Este README: ejecución, evidencia y límites.

## Ejecución y evidencia

Entorno: Node `v24.18.0`, npm `11.16.0`, Next `16.4.1`, Vitest `4.1.12`. Instalación con `npm.cmd ci --ignore-scripts --no-audit --no-fund`, sin cambios de dependencias. SHA-256 del lockfile: `D596B08BFF058C8F5A4A86EE1F1BB5CBB605F55BAEADF11402B691C89EBCEEE2`.

| Control | Comando | Resultado |
|---|---|---|
| Pruebas focales | `npx.cmd vitest run src/experimental/combustibles` | PASS: 44; FAIL: 0; SKIP: 0. |
| TypeScript completo | `npx.cmd tsc --noEmit` | PASS, exit 0; sin exclusiones especiales, repetido tras cambios finales de contratos. |
| ESLint focal | `npx.cmd eslint src/experimental/combustibles --max-warnings 0` | PASS, exit 0, cero advertencias finales. Una advertencia inicial sobre cleanup de ref se corrigió sin suprimir reglas. |
| Build completo | `npm.cmd run build` | PASS, exit 0; 54 páginas estáticas. Advertencias indicadas abajo. |

Build con variables solo del proceso: `DB_HOST=127.0.0.1`, `DB_PORT=1`, `DB_USER=synthetic_build`, `DB_PASSWORD=synthetic_build_only`, `DB_NAME=synthetic_build`, `AUTH_SECRET=synthetic-build-only-not-production-secret-03a`, `NEXT_TELEMETRY_DISABLED=1`. Son valores sintéticos, no credenciales reales. No existen archivos `.env` efectivos en el worktree ni en las rutas ancestrales que examina `loadRuntimeEnv`. No se inicia DB ni se aplica sandbox productivo. Esto no convierte el build general en una prueba instrumentada de ausencia absoluta de conexiones: la evidencia instrumentada de cero efectos corresponde al prototipo.

Advertencias del build: fallback de workerThreads a childProcesses en Node 24.18.0, convención middleware deprecada, Cache-Control personalizado y ocho advertencias Turbopack de patrones dinámicos en código fuera del incremento. No se cambiaron esos archivos ni se ocultaron avisos. El componente experimental no está en el grafo de rutas del build; su UI se ejercita mediante DOM y el código se verifica con TypeScript completo.

Incidencias del entorno: primer intento `npm` bloqueado por política de PowerShell; se utilizó `npm.cmd` sin cambiar esa política. Primer `npm.cmd ci` bloqueado por acceso al cache; la instalación del mismo lockfile terminó con permisos autorizados. No se modificaron dependencias para resolverlo.

## Cero efectos y límites

Las cuatro combinaciones hacen fallar cualquier llamada a fetch, XMLHttpRequest o Storage.setItem; los contadores permanecen en cero después de seleccionar e intentar pulsar el botón deshabilitado. No hay form de envío. La frontera de imports cierra los tres módulos del prototipo a React, Zod y archivos puros propios; rechaza imports dinámicos/require y APIs de red/persistencia. Por tanto no hay camino de importación a DB, CB2, confirmación o escritura. El escaneo de src verifica que ningún módulo operativo importe el laboratorio. Estas garantías se revisan para este grafo concreto; no certifican permisos ni escrituras de toda la aplicación.

Cambiar empresa desmonta la instancia y descarta selección, resultado y búsquedas. Cada efecto invalida su respuesta al limpiar: éxito/error de una instancia anterior no sobrescribe la actual, incluso en A/B/A. No se confía en AbortController para esa garantía.

Los validadores operan sobre catálogos tipados sintéticos. No aceptan catálogos de una red real ni sustituyen validación/locks de servidor. La evidencia y los revisores son demostrativos; no se implementan catálogo externo persistente, comprobación documental real, entidad, numeración, reserva de idempotencia ni alias. La jurisdicción/tenedor y revisión independiente representan propuestas del contrato, no reglas activadas en operaciones. NO_IDENTIFICADO bloqueado solo en simulación; SIN_ASIGNACION permanece intacto.

No hay commit ni push de este incremento. Auditoría independiente requerida antes de publicación o ampliación de alcance.
