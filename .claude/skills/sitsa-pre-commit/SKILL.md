---
name: sitsa-pre-commit
description: Auditoría previa a commit para el repo de la Plataforma SITSA. Revisa git status/diff, TypeScript, lint, cambios de SQL/esquema/migraciones, configuración/dependencias/secretos, seguridad, aislamiento multiempresa y concurrencia sobre los archivos modificados/nuevos, y entrega un reporte estructurado. NO corrige nada automáticamente, NO hace commit ni push. Invocar manualmente con /sitsa-pre-commit antes de pedir al usuario que haga commit.
disable-model-invocation: true
---

# Auditoría pre-commit — Plataforma SITSA

Esta skill es de **solo lectura y diagnóstico**. Nunca modifiques código, nunca
corrijas automáticamente lo que encuentres, nunca ejecutes `git commit`,
`git push` ni ninguna migración/SQL. Si algo requiere una decisión de negocio
o de arquitectura, repórtalo en el veredicto en vez de resolverlo tú.

Antes de empezar, ten presentes y respeta las reglas de `CLAUDE.md` y
`AGENTS.md` de este repo (alcance acotado, cambios pequeños y reversibles,
cuidado especial con base de datos/multiempresa/seguridad, git controlado
por el usuario, distinguir compilación/lint/prueba manual/prueba real).

## Pasos

1. **Estado de git**
   - `git status`
   - `git diff --stat`
   - `git diff --check` (detecta marcas de conflicto sin resolver y errores
     de espacio en blanco)

2. **Inventario de archivos**
   - Lista exacta de archivos modificados (`M` en `git status`) y archivos
     nuevos (untracked, `??`).
   - Para cada archivo, identifica a qué área pertenece (RRHH, TMS, Flota,
     Portal, Contabilidad, CMS, documentación, configuración, SQL, etc.).

3. **Alcance / archivos fuera de lugar**
   - Compara el conjunto de archivos tocados contra lo que razonablemente se
     esperaría de la tarea en curso (usa el contexto de la conversación y los
     `PLAN-*.md` si aplican).
   - Marca como "fuera de alcance" cualquier archivo sin relación evidente
     con el trabajo esperado.

4. **TypeScript**
   - Si hay archivos `.ts`/`.tsx` modificados o nuevos, ejecuta
     `npx tsc --noEmit`.
   - Si no hay archivos TypeScript tocados, repórtalo como `N/A` en vez de
     PASS/FAIL.

5. **Lint**
   - Ejecuta `npm run lint`.
   - El repo tiene deuda técnica preexistente de lint en archivos no
     relacionados con este cambio — **no la corrijas**. Compara qué archivos
     aparecen en la salida de lint contra la lista de archivos
     modificados/nuevos de este cambio:
     - Si ningún archivo tocado aparece en la salida → `DEUDA PREEXISTENTE`
       (el lint global falla, pero no por este cambio).
     - Si algún archivo tocado aparece con un error o warning nuevo →
       `FAIL`, y detállalo.
     - Si el lint completo pasa sin problemas → `PASS`.

6. **Base de datos / SQL / migraciones**
   - Revisa el diff completo y los archivos nuevos en busca de: `ALTER
     TABLE`, `CREATE TABLE`, `DROP`, `TRUNCATE`, cambios dentro de `sql/`,
     cambios de esquema, o queries nuevas que toquen tablas sensibles.
   - No ejecutes ningún SQL. Solo repórtalo para revisión humana.

7. **Configuración / dependencias / secretos**
   - Revisa si cambiaron `package.json`, `package-lock.json`, `.env*`,
     `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, archivos de
     despliegue (`DEPLOY-HOSTINGER.md`, `env.hostinger.example`,
     `scripts/*`), o cualquier archivo con credenciales/tokens.
   - Si encuentras algo que parezca un secreto real, **no lo muestres en el
     reporte** — indica solo el archivo (y línea si aplica) y advierte.

8. **Seguridad**
   - En los archivos modificados/nuevos, revisa si tocan autenticación,
     sesiones (`colaborador-session.ts`, `sitsa_session`, JWT), autorización,
     `requireTenant*`, permisos por rol, o validación de identidad.
   - Verifica que identidad/empresa/empleado sigan viniendo de la sesión del
     servidor y no de datos enviados por el cliente sin validar.

9. **Multiempresa**
   - En cada query SQL tocada, confirma que filtra por `empresa_id` (o el
     tenant equivalente) cuando corresponde.
   - Señala cualquier caso donde un registro se acceda solo por `id` sin
     confirmar que pertenece a la empresa de la sesión — es una posible fuga
     de datos entre empresas.

10. **Concurrencia e integridad**
    - En las queries/updates tocadas, revisa: transacciones, locks
      (`GET_LOCK`/`RELEASE_LOCK`), condiciones de carrera, `WHERE`
      insuficientes en updates/deletes, posibilidad de escrituras parciales
      o registros duplicados.

11. **Pruebas realizadas vs. pendientes**
    - Enumera qué verificaste realmente (tsc, lint, lectura de código) y qué
      queda pendiente (prueba manual en el navegador, prueba contra base de
      datos real, prueba automatizada). Nunca afirmes que algo "funciona"
      solo porque compiló.

## Reporte final

Entrega el resultado usando EXACTAMENTE esta estructura (sin añadir ni quitar
secciones):

```
PRE-COMMIT SITSA

Alcance detectado:
...

Archivos modificados:
...

Archivos nuevos:
...

TypeScript:
PASS / FAIL

Lint:
PASS / FAIL / DEUDA PREEXISTENTE

git diff --check:
PASS / FAIL

Base de datos:
SIN CAMBIOS / REVISAR

Migraciones:
NINGUNA / REVISAR

Seguridad:
PASS / REVISAR

Multiempresa:
PASS / REVISAR

Archivos fuera de alcance:
NINGUNO / lista

Pruebas realizadas:
...

Pruebas pendientes:
...

Riesgos:
...

VEREDICTO:
APTO PARA REVISIÓN
o
NO APTO PARA COMMIT
```

Reglas para el veredicto:
- "APTO PARA REVISIÓN" **nunca** significa autorización para hacer commit —
  solo que el diagnóstico no encontró bloqueantes. El commit lo decide y
  ejecuta el usuario.
- Usa "NO APTO PARA COMMIT" si TypeScript falla, si hay lint nuevo en
  archivos tocados, si hay cambios de esquema/migración sin revisar, si hay
  una posible fuga multiempresa, o si hay archivos fuera de alcance sin
  explicación.

## Prohibido durante esta skill

- Modificar código de la aplicación.
- Corregir automáticamente cualquier problema encontrado.
- Ejecutar `git add`, `git commit`, `git push`, o cualquier comando de git
  que modifique el repositorio.
- Ejecutar migraciones, `ALTER TABLE`, o cualquier SQL de escritura.
- Modificar `CLAUDE.md` o `AGENTS.md`.
