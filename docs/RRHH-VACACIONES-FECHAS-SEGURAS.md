# Hotfix vacaciones — DATE y respuestas obsoletas

Base: e2add53e71ba1c0a0a1116d09896b41e653dbe06, main actual al iniciar.
Rama separada: codex/vacaciones-fechas-seguras. Sin SQL ni reparación histórica.

## Causa demostrada y límite de evidencia

La página RRHH hacía debounce 300 ms. Cleanup cancelaba solo el temporizador,
NO el fetch ya iniciado; una respuesta lenta podía ejecutar setDias después de
que las fechas hubieran cambiado. El valor anterior tampoco se invalidaba al
cambiar las fechas y el campo era editable. POST prefería diasHabiles del body
al cálculo del servidor. Preview histórico tenía el mismo override de días.

El helper backend aceptaba parseISO(String(...).slice(0,10)) sin validación real
de forma/rango; recorría cada día con Date local. No se encontró resta de ms
sin división ni uso de new Date("DD/MM/YYYY") en este cálculo concreto.
Los inputs type=date pueden generar fechas intermedias mientras se edita el año;
una fecha ISO de año antiguo era aceptada y podía disparar un recorrido enorme.

Reproducción aritmética exacta: 0202-01-16 -> 2026-06-01, sin feriados,
produce 571148 días excluyendo domingos. 2026-06-01 -> 2026-06-01 produce 1.
Si llega aquella respuesta después del cambio, la UI anterior podía mostrarla
con las fechas nuevas y POST la trataba como confiable. No tenemos la request
original de producción: NO afirmamos que esas fueron sus fechas exactas ni
que el año intermedio quedó probado allí. El defecto de carrera/contrato sí
está demostrado por código y pruebas; captura original sería necesaria para
certificar la secuencia particular del incidente.

## Cambio

- vacaciones-calendario.ts es puro, comparte contrato frontend/backend.
  ISO YYYY-MM-DD exacto, fecha real, año 0000 rechazado, fin >= inicio.
  UTC es coordenada de calendario, no conversión de instantes; setUTCFullYear
  evita el tratamiento especial de años 0–99 de Date.UTC.
- Cuenta semanas/domingos aritméticamente y feriados configurados por empresa
  con el loader existente. O(feriados), no O(días/años). No agrega feriados
  ni exclusiones; sábado sigue contando, domingo no. Solo domingo = 0.
- Defensa: entero seguro, finito, no negativo y dias <= calendario inclusivo.
  Sin máximo de vacaciones inventado. Un rango largo real se evalúa sin loop
  masivo, pero no adquiere saldo ni evita las restricciones existentes de alta/FIFO.
- GET dias-habiles valida y responde 400 a fecha/rango/cálculo inválido, no-store.
- POST siempre recalcula. diasHabiles legacy puede recibirse para compatibilidad,
  pero nunca determina consumo. Se valida resultado antes de llamar al registro.
  Cero días se rechaza para guardar. NaN/Infinity no atraviesan el sanity check.
- Preview histórico también recalcula, conservando decisiones/huellas existentes.
- UI: cálculo etiquetado por slug/fechas; resultado de otra clave no se utiliza.
  Cambio de fechas limpia cálculo/preview; fetch se aborta y exige vigente.
  Campo readonly, muestra — pendiente/inválido; si excede saldo actual muestra
  — y explicación, no una cifra enorme. Registrar exige cálculo vigente y positivo,
  colaborador y saldo suficiente. Revalida esos requisitos en submit.
  La excepción histórica preexistente usa saldo de la fecha/decisión de su plan,
  NO el saldo actual como barrera nueva; el backend mantiene ese motor intacto.
- Fecha inicial usa hoyLocal Guatemala, no toISOString del instante actual.
- FIFO agrega rechazo explícito de NaN/Infinity antes de leer/descontar saldo.

## Saldo, historia y concurrencia

No modifica acumulación proporcional, períodos, vencimiento, tope, reconstrucción,
sync/dirty/generación ni fórmulas históricas. No actualiza registros existentes.
Helpers históricos de reconstrucción y sus días oficiales se conservan: no se
reinterpreta lo ya importado ni se recalculan saldos por esta corrección.
Registro mantiene transacción y current reads/FOR UPDATE de empleados/saldos;
aprobación de solicitudes conserva lock de solicitud + FIFO transaccional.
No se agrega un mecanismo de concurrencia distinto ni se amplía el scope.
El cálculo HTTP precede al registro; saldo definitivo se lee dentro del FIFO,
no del número disponible mostrado por el navegador.

## Pruebas locales

Node v24.18.0 / npm 11.16.0, mismas dependencias para BASE y HEAD.
45/45 dirigidas: calendario/saldo/API (incluye tests anteriores del endpoint).
35 pruebas adicionales en total: lunes=1, dos días=2, domingos, feriados,
bisiesto, mes/año, ISO inválido/DD/MM, rango invertido, NaN/Infinity/fracción,
bound N, zonas y medianoche, reproducción 571148, respuesta obsoleta y wiring UI,
body manipulado ignorado, saldo 21.62 permite 1, sobreconsumo no escribe,
FOR UPDATE preservado y NaN no entra a FIFO.

Comando comparado: npx vitest run vacaciones solicitudes-vacaciones.
BASE exacto en worktree aparte: 627 pass / 1 fail (628 tests, 47 archivos).
HEAD final: 662 pass / 1 fail (663 tests, 49 archivos).
Único fallo idéntico: src/lib/rrhh/vacaciones-sync-invalida.test.ts,
"migración aditiva coincide exactamente con schema y protege tenant por FK compuesta".
La comparación elimina CR solo de schema, no del fragmento de migración: en
Windows compara LF vs CRLF. Se reprodujo ahora en BASE; no se tocó test ni SQL.
Cero regresiones nuevas en la suite dirigida comparada. No suite completa global.
TypeScript, ESLint dirigido y diff-check limpios; build exitoso (warnings existentes).
No pruebas ni consultas contra la BD productiva. No QA de navegador productivo.

## Archivos (10)

- docs/RRHH-VACACIONES-FECHAS-SEGURAS.md
- src/lib/rrhh/vacaciones-calendario.ts
- src/lib/rrhh/vacaciones-calendario.test.ts
- src/lib/rrhh/vacaciones-calendario-saldo.test.ts
- src/lib/rrhh/vacaciones.ts
- src/app/e/[slug]/rrhh/vacaciones/page.tsx
- src/app/api/empresas/[slug]/rrhh/vacaciones/route.ts
- src/app/api/empresas/[slug]/rrhh/vacaciones/dias-habiles/route.ts
- src/app/api/empresas/[slug]/rrhh/vacaciones/preview-historico/route.ts
- src/app/api/empresas/[slug]/rrhh/vacaciones/registro-historico-api.test.ts

NO SQL producción / NO datos reales / NO backfill / NO merge.
catalogos-nomina.ts y checkout ajeno preservados y excluidos.
