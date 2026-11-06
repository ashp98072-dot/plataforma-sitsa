# PS-LAB-04-B — Resolución del bloqueo formal APT: investigación y diseño

Fase 1 (auditoría y diseño). Fecha: 2026-11-06. Base documental: commit `fb5769f53aa41a7d7eab8ba16294abdcd7a5831d` (PS-LAB-04-A, sin modificar).

**Estado: PROPUESTA DOCUMENTAL. Nada ejecutado. S06 NOT CERTIFIED. `core` sin aprobación formal; `hybrid` y `full` sin autorización.** No se ejecutó APT ni simulaciones nuevas, no se descargó ni instaló nada, no se tocaron VM, repositorios APT, producción, SQL ni TMS.

## Documentos

| Documento | Contenido |
|---|---|
| [DIAGNOSTICO-APT.md](DIAGNOSTICO-APT.md) | Hechos frente a hipótesis, análisis del código de APT, matriz de causas, diferencias formal/diagnóstico, nombres de caché esperados, evidencias faltantes |
| [PLAN-PRUEBA-OFFLINE.md](PLAN-PRUEBA-OFFLINE.md) | Plan por fases (F2-F5), comandos propuestos no ejecutados, aislamiento, criterios de parada, aceptación y rechazo, diseño de la fase de obtención de `.deb`, riesgos, bloqueantes |

## Hallazgos principales

1. **Demostrado por las evidencias:** la prueba formal y el diagnóstico difieren solo en `--no-download`; en la formal el resolvedor termina bien y el error aparece después, sin plan.
2. **Demostrado por el código de APT de Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1`** (idénticos entre sí en todos los archivos relevantes): con `--no-download`, APT comprueba **antes de simular** que cada `.deb` exista en `Dir::Cache::Archives` con **nombre y tamaño exactos**; el mensaje observado aparece si algún ítem no lo cumple. El diagnóstico sin la opción no hace esa comprobación, por lo que "plan resoluble" no equivale a "archivos disponibles". **El código de `2.8.3` no pudo leerse directamente** (ya no está en el pool público); se infiere por acotamiento entre las dos versiones vecinas y su changelog. Es alta confianza, no confirmación directa.
3. **La causa de la ejecución histórica sigue siendo hipótesis no confirmada.** Reproducir el fallo con caché vacía demostraría el mecanismo, no qué había en la caché de `run1`. La ausencia de `.deb` es la explicación más consistente, pero el paquete de evidencias no contiene el listado de la caché ni la versión real de APT del laboratorio. La matriz distingue siete subcausas posibles (A1-A7).
4. **Riesgos descubiertos:** cuatro de los diez `.deb` llevan epoch y su nombre en caché (`%3a`) difiere del nombre en el repositorio; y APT **borra, incluso en simulación**, un archivo de caché (o de `partial/`) cuyo tamaño no coincide. Por eso las cachés existentes solo se usan como evidencia de lectura y cada corrida usa una caché nueva, protegida y sin privilegios elevados.
5. **Solo hay una ejecución formal** (N=1). El plan propone reproducirla y capturar las evidencias que faltan antes de decidir si hacen falta `.deb`.

## Recomendación de siguiente fase

Solicitar autorización **solo para F2a y F2**: inventario de solo lectura de las cachés existentes y dos corridas formales con una caché **nueva** y vacía en la VM aislada, más capturas pasivas. Es la fase más barata, no descarga nada y puede mostrar si el listado de caché confirma A1 o apunta a otra causa. F3 (obtención de `.deb`) solo se plantea si F2 la justifica y requiere autorización expresa aparte.

## Decisión propuesta

- **Propuesta documental: APTO PARA AUDITORÍA.**
- **Diagnóstico de la causa: REQUIERE MÁS EVIDENCIA** (E1-E10 del diagnóstico).
- **Avance de S06: BLOQUEADO**; permanece `S06 NOT CERTIFIED`.

## Límites

- La lectura del código de APT se hizo sobre los paquetes fuente oficiales de Ubuntu `2.7.14build2` y `2.8.4ubuntu0.1` (hashes en el diagnóstico). **`2.8.3` no se leyó directamente** (no disponible en los archivos públicos accesibles) y tampoco se inspeccionó el binario instalado en el laboratorio.
- Los comandos del plan son plantillas: su sintaxis y las opciones de APT deben validarse en la fase autorizada antes de usarlas como evidencia.
- Las evidencias originales permanecen fuera del repositorio; este ticket no las incorpora.
- Ningún resultado de este ticket autoriza instalar, descargar, desplegar, migrar ni modificar producción.
