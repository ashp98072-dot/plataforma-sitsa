# Programación — PlanForm y Edición rápida bajo demanda

## Base y alcance

BASE: `bdd06d2c35c3d9a839f5af27ff5bcd088f2ee0dc`.
Rama: `codex/programacion-carga-diferida`.

Solo cambia la carga de módulos en `programacion-client.tsx`:
- PlanForm: `dynamic(() => import("./plan-form"))` (export default).
- EdicionRapida: `dynamic(() => import("./edicion-rapida").then(m => m.EdicionRapida))`.
- FilaEdicionRapidaEntrada: import exclusivamente de tipo.
- Ambas declaraciones viven fuera del render: identidad estable.
- Se conserva SSR por defecto. No preload manual, timers ni efectos nuevos.
- Fallbacks simples: «Cargando formulario…» y «Cargando edición rápida…».

No se modificaron PlanForm, EdicionRapida, APIs, permisos, validaciones,
payloads, borradores, disponibilidad, vehículo solicitado, recursos, terceros,
importación/exportación, SQL, esquema, datos, dependencias ni configuración.

## Discovery y comportamiento

PlanForm se monta únicamente al abrir creación, edición inline o edición de
un plan fuera del rango. Recibe slug, hoy, fechaSugerida al crear, plan al
editar, onSaved y onCancel. Edición mantiene key por plan.
Sus catálogos (planes, TMS, personal-ops, configuración de viáticos), consulta
de disponibilidad y precargas de ruta/contacto continúan en sus efectos
originales, después del montaje real; no existían cargas de estos hijos
cuando estaban cerrados. Abrir por deep-link sigue usando el plan obtenido
por el padre, no una nueva fuente de datos.

EdicionRapida se monta solo con modoRapido. Conserva key=versionRapida y
las mismas filas, disponibilidadPorFecha, vehiculos, tarifasPorRuta,
onPendientesChange, onGuardado y permiso de cargos.
Catálogo/resumen de cargos y estado del borrador siguen dentro del hijo.
Cancelar la confirmación de salida conserva el montaje/key; aceptar
descarte conserva el incremento de versión y el remontaje anterior.
Cerrar/reabrir no añade persistencia nueva: se conserva la semántica BASE.

No hay autoFocus inicial ni API imperativa del hijo hacia el padre.
El foco de PlanForm pertenece a la validación de vehículo solicitado
obligatorio (vehiculoRef.current.focus), y permanece intacto.
Los exports auxiliares de PlanForm siguen disponibles sin cambios.

Las dos funciones hijas son byte a byte iguales a BASE (normalizando CRLF).
El JS del padre es idéntico al de BASE después de excluir únicamente
imports y las dos declaraciones dynamic permitidas.
SHA-256 de ese JS normalizado:
`b296366a921847ece83f57f43a7a40dcbe47a2d1f08af84bf7b40ea986334ef0`.

## Bundle local BASE / HEAD

Node 24.18.0, npm 11.16.0, Next 16.3.6, mismas dependencias.
Se ejecutó build BASE antes de editar, se registraron sus métricas y luego
se ejecutó build HEAD. Sin .env productivo.
La medida usa entryJSFiles de Programación menos los del layout compartido
en page_client-reference-manifest.js, con gzip local por archivo.
No incluye runtime/layout compartidos, CSS, RSC ni payloads API.

| Medida | BASE | HEAD | Reducción |
| --- | ---: | ---: | ---: |
| JS específico inicial (bytes) | 489679 | 340127 | 30,54 % |
| Gzip aproximado (bytes) | 124813 | 83138 | 33,39 % |
| Chunks específicos iniciales | 4 | 3 | — |

BASE: `39p25kyes17lz.js` contenía ambos componentes;
`15y0-wxo59i8p.js` también estaba en la entrada.
HEAD no contiene los bloques de PlanForm/EdicionRapida en la entrada.
Los loaders compilados referencian grupos separados:
- PlanForm: `3kmxlntzxc5pg.js` + `3lukyq2cq5vjs.js`,
  94989 bytes / 25657 gzip.
- EdicionRapida: `0wzfihp4lt90x.js` + `15y0-wxo59i8p.js`,
  61985 bytes / 21288 gzip.

Los imports se solicitan cuando la rama correspondiente se monta, no al
declarar dynamic ni al entrar con ambas herramientas cerradas.
El módulo resuelto se reutiliza al reabrir; no se cachea el estado de la UI.
Al usar ambas herramientas se descargan sus grupos: el splitting puede
añadir una pequeña sobrecarga acumulada. La mejora medida es de entrada.

**Zod permanece inicialmente**: `3m0g799rg5szc.js` (283465 bytes).
El padre aún usa utilidades compartidas, incluido textoCuadrilla desde el
contrato con schemas. Separarlos sería otro refactor y no se hizo aquí.
Los bytes son evidencia de build, NO latencias ni Network de producción.

## Pruebas y validaciones

- Nuevas: 12/12. Harness de ramas JSX/handlers REALES y módulos de carga
  controlados; no es un navegador ni reemplaza pruebas del negocio hijo.
- Cerrados sin imports de herramientas; fallbacks; creación; edición inline
  Propio/Tercerizado; edición fuera de rango; props/keys/callbacks;
  cerrar antes de resolver y reabrir; edición rápida; descarte confirmado
  y cancelado del borrador; validación real de vehículo y llamada de foco
  para Propio/Tercerizado, sin fetch cuando falta vehículo.
- Dirigida Programación/formulario/edición rápida/recursos/vehículo:
  BASE (mismos archivos ejecutados en la suite completa) 1000 pass / 16 fail;
  HEAD 1012 pass / 16 fail. Ningún fallo nuevo por identidad.
- Completa BASE: 10840 pass / 22 fail / 599 skip.
- Completa HEAD: 10852 pass / 22 fail / 599 skip.
- Comparación archivo + fullName + primera línea del mensaje:
  mismos 22 fallos, cero nuevos/eliminados.
- Comando completo: `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json`.
- ESLint dirigido BASE/HEAD: limpio.
- TypeScript independiente BASE/HEAD: exit 0.
- Build BASE/HEAD: exit 0; cuatro warnings de tracing existentes fuera del alcance.
- Diff-check: OK.

## Riesgos y QA manual posterior

La primera apertura fría espera el chunk antes de montar y cargar los datos
del hijo; es el diferimiento solicitado, no una promesa de apertura más rápida.
No se midió una sesión autenticada en navegador.
Verificar manualmente con caché fría: entrada sin abrir herramientas, nuevo,
Ajustar inline/deep-link, cerrar durante carga y reabrir, Propio/Tercerizado,
validación de vehículo/foco, borrador y cancelar/confirmar salida de rápida.
Comprobar Network: grupos de herramientas solo al abrir; requests de negocio
del padre intactos. No se implementó manejo especial de fallos de descarga:
continúan las fronteras de error existentes de Next.

Sin SQL productivo, datos reales ni merge.
