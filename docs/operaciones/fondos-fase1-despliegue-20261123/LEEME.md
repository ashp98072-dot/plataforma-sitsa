# Fondos — Fase 1 (PR #668): preparación de despliegue, postcheck y reversión

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE.** No probado en producción ni aprobado para producción. El PR sigue en Draft; este documento no autoriza el merge.

## 1. Estado del PR respecto de `main` (comprobado)
- `main` = `9b6575626` = base del PR (no hay commits posteriores en `main`). Ningún archivo coincidente. `git merge-tree` sin conflictos; GitHub: `MERGEABLE / CLEAN`.
- El repositorio **no tiene checks de CI configurados** (`statusCheckRollup` vacío): la verificación es la local descrita en §6.
- El PR no incluye SQL ni migraciones; no toca Programación, Viáticos, Canecas ni copiar programación. Un solo cambio compartido, de tipos: `indicesLlenos` en `src/lib/validacion-formulario.ts`.

## 2. Producción según la comprobación en Hostinger (informada, no verificada por este PR)
`tms_solicitudes_fondo`, `tms_solicitud_fondo_lineas` y `flota_combustible_cargas` existen (InnoDB) y la cuenta de phpMyAdmin lee las columnas de Combustible; `flota_cb2_fondos_vinculos` responde **1146** y no está en el catálogo; `DB_USER` coincide por nombre con el usuario de phpMyAdmin.

**Manejo de la tabla CB2 ausente (`lineasConVinculosTx`, `src/lib/tms/fondos.ts`):** la sonda real sobre cada tabla decide. Para CB2: error 1146 → se acepta «módulo no instalado» **solo si** `information_schema` ve `tms_solicitudes_fondo` y `tms_solicitud_fondo_lineas` y tampoco lista la tabla CB2 (se cumple con lo informado). Combustible responde con datos reales y **sigue protegiendo** sus líneas. Probado con el escenario exacto (Combustible presente + CB2 ausente) en pruebas unitarias y en MariaDB 11.8.9 desechable, además de usuario restringido, tabla incompatible y módulos ausentes. Si CB2 se instala más adelante, la detección lo recoge sola (sin cambios de código).

**Matiz:** «mismo nombre» de usuario no garantiza los mismos permisos (los privilegios dependen de usuario **y** host). Lo concluyente es el postcheck funcional del §4 con la propia conexión de la aplicación.

## 3. Checklist de despliegue (Hostinger despliega automáticamente cada merge a `main`)
Antes (todo de solo lectura):
1. Autorización explícita del responsable para sacar el PR de Draft y hacer merge. Elegir una ventana de poco uso.
2. Anotar el SHA de `main` actual (`9b6575626`) y confirmar que sigue siendo el de GitHub (si avanzó, volver a verificar conflictos).
3. Exportar (phpMyAdmin → Exportar, solo estructura+datos, sin borrar nada) `tms_solicitudes_fondo`, `tms_solicitud_fondo_lineas` y `flota_combustible_cargas`. Es un respaldo forense: **no se restaura** tras un rollback (perdería datos creados después).
4. Con la cuenta real de la aplicación, ejecutar las dos sondas del §4-A: sin error y 0 filas (y 1146 esperado para CB2).
5. Lista de solicitudes Pendientes que quedarán bloqueadas al **autorizar** por falta de empresa requirente/requirente (§4-D): avisar a Operaciones para corregirlas desde «Editar».

Despliegue:
6. Merge (solo con autorización) → esperar el build automático de Hostinger. Confirmar con el conector de Hostinger (solo lectura): despliegue = SHA del merge, build correcto y sin errores en logs de runtime.

## 4. Postcheck (después del despliegue)
**A. Sondas de permisos (SQL, solo lectura, cuenta de la aplicación):**
```sql
SELECT DISTINCT solicitud_fondo_linea_id AS linea_id FROM flota_combustible_cargas WHERE empresa_id = 0 AND solicitud_fondo_linea_id IN (0);   -- esperado: 0 filas, sin error
SELECT DISTINCT linea_id FROM flota_cb2_fondos_vinculos WHERE empresa_id = 0 AND linea_id IN (0);                                           -- esperado hoy: error 1146
```
**B. Humo funcional (requiere autorización: escribe una fila de auditoría y puede tocar `actualizado_en`):** en una solicitud Pendiente con líneas, anotar antes `SELECT id, categoria, monto, orden FROM tms_solicitud_fondo_lineas WHERE empresa_id = ? AND solicitud_id = ? ORDER BY orden, id;`, abrir «Editar», **guardar sin cambios** y repetir la consulta: los **ids deben ser idénticos**. Después, editar solo una descripción/monto de una línea libre: mismo id, monto nuevo, total de la solicitud = suma de líneas.
**C. Integridad (solo lectura):**
```sql
SELECT COUNT(*) AS lineas_huerfanas FROM tms_solicitud_fondo_lineas l LEFT JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id WHERE s.id IS NULL;   -- 0
SELECT s.id, s.codigo, s.total, SUM(l.cantidad * l.monto) AS suma FROM tms_solicitudes_fondo s JOIN tms_solicitud_fondo_lineas l ON l.empresa_id = s.empresa_id AND l.solicitud_id = s.id
  WHERE s.estado = 'Pendiente' GROUP BY s.id, s.codigo, s.total HAVING ABS(s.total - SUM(l.cantidad * l.monto)) > 0.005;   -- sin filas en las solicitudes editadas tras el despliegue
SELECT COUNT(*) AS cargas_con_linea_inexistente FROM flota_combustible_cargas c LEFT JOIN tms_solicitud_fondo_lineas l ON l.empresa_id = c.empresa_id AND l.id = c.solicitud_fondo_linea_id WHERE c.solicitud_fondo_linea_id IS NOT NULL AND l.id IS NULL;   -- 0
```
**D. Pendientes que no se podrán autorizar hasta corregirlas (informativo):**
```sql
SELECT id, codigo, fecha_requerimiento, entidad_requirente_id IS NULL AS sin_empresa_requirente, requirente_usuario_id IS NULL AS sin_requirente_usuario FROM tms_solicitudes_fondo WHERE estado = 'Pendiente' AND (entidad_requirente_id IS NULL OR requirente_usuario_id IS NULL);
```
**E. Logs de runtime (conector, solo lectura):** sin 500 en `PATCH /tms/fondos/[id]` y sin mensajes «No se puede verificar los vínculos…» (409). Un 409 «Recarga la pantalla» aislado es esperado en pestañas abiertas antes del despliegue.

## 5. Reversión (compatible con el despliegue automático desde `main`)
No hay esquema ni datos que revertir: el PR no ejecuta SQL ni migraciones y usa solo columnas existentes. **La reversión es de código.**
1. Crear una rama `revert/fondos-fase1` desde `main` y ejecutar `git revert -m 1 <SHA del merge>` (un commit que deshace el merge, sin reescribir historia).
2. PR → merge (con autorización) → Hostinger despliega la versión anterior automáticamente.
3. Confirmar con el conector que el despliegue es el SHA del revert; repetir §4-C (solo lectura).
- **Sin pérdida de datos:** todo lo creado o editado con el código nuevo usa las mismas columnas y conserva sus ids, así que el código anterior lo lee sin problema. Las solicitudes autorizadas bajo la regla nueva siguen siendo válidas.
- **Comportamiento tras revertir** (el de siempre): la edición vuelve a reemplazar todas las líneas con `DELETE`+`INSERT`; si alguna línea tiene vales de Combustible, la FK `RESTRICT` rechaza la edición completa y la transacción se revierte (sin datos perdidos); autorizar vuelve a no exigir empresa requirente/requirente.
- **No restaurar el respaldo de tablas** (borraría lo creado después del despliegue). Úsese solo para comparar.
- **Alternativa más rápida:** si el panel de Hostinger ofrece volver a desplegar el commit anterior, puede ser más rápido, pero **no está verificado**: confirmarlo en el panel antes de depender de ello, y de todos modos dejar el revert en `main` (si no, el siguiente despliegue automático reinstalaría el código nuevo).
- **Cuándo revertir:** 500 sostenidos en `PATCH /tms/fondos/[id]`, 409 masivos «No se puede verificar los vínculos…» que no se resuelvan en minutos otorgando `SELECT`, o totales inconsistentes (§4-C).

## 6. Verificación del PR (reproducible)
- `npx vitest run src/lib/tms/fondos.test.ts src/lib/tms/fondos-edicion-lineas.db.test.ts "src/app/api/empresas/[slug]/tms/fondos" src/lib/tms/fondo-borrador.test.ts src/lib/tms/idempotencia-envio.test.ts` → `fondos.test.ts` 158/158; `fondos-edicion-lineas.db.test.ts` 21/21 en MariaDB 11.8.9 desechable (se omite sin `CB2_587_PIPE`; sus 2 pruebas estáticas corren siempre).
- `npx tsc --noEmit`, ESLint de los archivos tocados y `npm run build`: sin errores.
- Fallos **preexistentes**: `npx vitest run src/lib/tms src/lib/flota src/lib/firmas src/lib/idempotencia "src/app/api/empresas/[slug]/tms" "src/app/api/empresas/[slug]/flota" "src/app/e/[slug]/fondos" src/lib/validacion-formulario --testTimeout=60000` → 17 archivos / 76 pruebas fallan, **idénticos sin los cambios del PR** (`git checkout 9b6575626` y el mismo comando). Son ajenos (mocks de `flota_vehiculos_fusiones`, esquema de identidad física, rutas de `planes`/`flota`, `ENOENT` de preflights y comparaciones de fuentes).

## 7. Riesgos pendientes (ninguno técnico bloquea el merge)
1. Permisos de la cuenta de la aplicación no verificados con su propia conexión (§2 matiz) → cubierto por §3-4 y §4-A/B; el fallo es seguro (409 sin cambios).
2. Sin CI en el repositorio: la verificación es local.
3. Pestañas abiertas antes del despliegue recibirán un aviso de recarga al guardar una edición.
4. Pendientes sin empresa requirente/requirente no se podrán autorizar hasta corregirse (§4-D).
5. La reversión por Hostinger «redeploy» no está verificada; la vía documentada es el revert en `main`.
