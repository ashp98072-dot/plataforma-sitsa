# C3C-3: reportes por período contable

Base: main `5a636434` (PR #523, #524 y #525 integrados). Desarrollo en el worktree y rama separados `feature/c3c3-reportes-periodos`; la carpeta original y su laboratorio visual no se modifican.

## Entrega

El catálogo, registro manual/eventos, Diario, Mayor y Balance de comprobación ya existen. Esta entrega completa la selección de períodos del calendario en esos reportes, evitando duplicar módulos o pedir al usuario que transcriba fechas. No implementa cierre de ejercicio, asientos de regularización ni saldos iniciales: sus políticas requieren aprobación contable. No afirma equivalencia verificada con Milenium 2000.

Pantalla existente: `/e/[slug]/contabilidad/reportes`. Elegir libro, período y pestaña; el Mayor sigue exigiendo una cuenta. «Fechas manuales» conserva el comportamiento anterior. Seleccionar un período fija ambas fechas inclusivas; cambiar libro o empresa descarta la selección y los resultados antiguos. Los campos usan fondo, texto y borde del tema; el resumen admite pantallas pequeñas.

APIs existentes, con parámetro opcional nuevo `periodo=<id>`:

- `/api/empresas/[slug]/contabilidad/reportes/diario?entidad=9&periodo=3`
- `/api/empresas/[slug]/contabilidad/reportes/mayor?entidad=9&periodo=3&cuentaId=1`
- `/api/empresas/[slug]/contabilidad/reportes/balance?entidad=9&periodo=3`
- Agregar `formato=xlsx` conserva la exportación y añade período, fechas, estado, versión y revisión de cierre.
- `/reportes/opciones?entidad=9` devuelve también períodos del mismo ámbito y disponibilidad del calendario. Si falta el esquema de calendario se ofrecen únicamente fechas manuales; un reporte solicitado por período falla explícitamente, sin ignorar el filtro.

Rechaza ID inválido/repetido o la combinación de período y fechas manuales (400), y período de otro libro/empresa o inexistente (404). Reutiliza los permisos de lectura independientes `contabilidad_diario`, `contabilidad_mayor`, `contabilidad_balance`; no exige conceder apertura, cierre o administración para consultar ni agrega grants por defecto.

## Integridad y alcance

La resolución del período, los movimientos y sus revisiones se leen en una misma transacción REPEATABLE READ READ ONLY. No toma locks de escritura, no actualiza auditoría ni asigna períodos a asientos históricos. Los escritores siguen usando el control central de períodos de C3C-2. Consultar un período CERRADO no habilita su contabilización.

El filtro incluye únicamente asientos `Registrado` cuya fecha está dentro del rango. Un período CONFIGURADO también puede consultarse; esto no lo abre ni activa el libro. La revisión mostrada corresponde a la instantánea, no reproduce el contenido certificado de una evidencia anterior. El saldo del Mayor continúa siendo acumulado **solo dentro del rango**, sin inferir un saldo inicial. No se cambia esa política ni la aritmética existente.

## Validación aislada

Pruebas seleccionadas sin `.env`:

```powershell
node node_modules/vitest/vitest.mjs run --config scripts/ci/c3c1/vitest.config.mts src/lib/contabilidad/reportes/reportes-periodos.test.ts src/lib/contabilidad/reportes/reportes.test.ts src/lib/contabilidad/periodos-reportes.test.ts src/lib/contabilidad/asientos.test.ts src/lib/contabilidad/periodos.test.ts src/lib/contabilidad/periodos-http.test.ts
```

El laboratorio específico requiere autorización para cada ejecución; usa el contrato C3C-2 de identidad por PID, datadir, pipe y token, TCP deshabilitado, binarios locales de hash fijado y datos ficticios. Nunca usa MySQL80 ni la conexión configurada de la aplicación. No instala dependencias. En este trabajo se ensayó MariaDB 11.8.9; la nueva selección de reportes no se ha vuelto a ensayar en MySQL.

```powershell
node scripts/ci/c3c3/run-windows.mjs --run-isolated --engine=mariadb
```

El fixture exclusivo añade las columnas que necesitan los reportes a las tablas sintéticas del ensayo; no es una migración ni debe utilizarse sobre bases existentes. Se ejecutan ocho pruebas reales: límites de fechas, cuadre Diario/Mayor/Balance, ámbitos ajenos, filtros incompatibles, solo lectura/Excel, cierre concurrente y bloqueo de nuevos asientos, reapertura sin alterar evidencia y regresión de fechas manuales. El runner conserva resultados y confirmación de apagado en TEMP; no publicar manifiestos privados.

No hay SQL de migración operativa, tablas ni índices nuevos. Requiere el esquema ya aprobado C3C-1/C3C-2 para usar selección por período. No se aplicaron migraciones operativas, no se importaron históricos y no se inició otra aplicación ni navegador. La UI se verificó mediante render estático; quedan por comprobar interacción DOM y presentación visual de esta nueva selección. Las pruebas seleccionadas no certifican toda la plataforma.

Resultado local del 2026-10-28: 80/80 unitarias y regresiones seleccionadas; 8/8 integraciones MariaDB 11.8.9, sin fallidas ni omitidas. Evidencia privada en `TEMP/novalvion-c3c2-150e03ac1c9e42c1a111edc09d8d938a`, con results.json y shutdown.jsonl confirmando código 0 y Shutdown complete. TypeScript del alcance sin emisión, ESLint (incluidos runners nuevos) y comprobación de espacios aprobaron. No hubo commit, staging ni publicación.
