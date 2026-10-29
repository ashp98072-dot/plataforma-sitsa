# C3C-4: continuidad calculada

Base: origin/main 5406f45cb6304fc401a2942d3e080f13dafba7bc.

## Contrato

Mayor: saldoInicial = SUM(Debe - Haber) de asientos Registrados con fecha estrictamente anterior a desde. Debe y Haber del periodo mantienen limites inclusivos. saldoRango conserva el neto exclusivo del rango. saldoFinal = saldoInicial + Debe - Haber del rango; cada movimiento parte del saldo inicial. Un rango vacio mantiene el saldo anterior. Sin desde, inicial cero y acumulacion desde el primer asiento existente.

Positivo significa deudor y negativo acreedor para cualquier tipo de cuenta. No se invierte el signo por naturaleza: un activo puede tener saldo acreedor. El catalogo actual usa tipo, sin politica adicional de naturaleza. No hay regularizacion implicita al cambiar ejercicio.

Balance conserva debito, credito, saldoDeudor, saldoAcreedor y totales del rango. Agrega saldoInicial, saldoFinal, debeAnterior, haberAnterior, saldoFinalDeudor y saldoFinalAcreedor por cuenta; totalesContinuidad separa los saldos finales del cuadre del rango. Incluye cuentas con historia anterior aunque no tengan movimiento actual. Excel y pantalla distinguen ambos alcances.

calculoSaldo del Mayor desglosa Debe/Haber anteriores, cantidad de lineas, limite exclusivo, empresa, entidad, cuenta y formula. periodoSeleccionado identifica ejercicio y periodo cuando se usa C3C-3. trazabilidadPeriodo mantiene fecha de generacion y revisiones en la misma instantanea.

## Limite contable

La consulta muestra toda la historia registrada, incluso entre ejercicios. No certifica arrastres ni genera asientos de apertura. Para ingresos, gastos y resultados puede mostrar historia de ejercicios anteriores: se advierte en pantalla, API y Excel. Sigue pendiente aprobar regularizacion de resultados, cierre definitivo y politica de apertura; no se deriva ninguna de estas operaciones del cambio de ejercicio. Los asientos formales ya existentes se incluyen como cualquier otro Registrado, sin sintetizar otros.

## Seguridad

Solo lectura REPEATABLE READ, limites por empresa y entidad y cuenta validada. Permisos HTTP existentes intactos. No se modifican estados ni se eluden restricciones de registro en periodos cerrados. Importes SQL DECIMAL y operaciones en BigInt; Number se mantiene unicamente para presentacion y serializacion numerica Excel, sin sumar dinero. No hay migracion de aplicacion ni cambios a schema.sql o .env.

## Verificacion

46 pruebas unitarias/contrato de reportes y periodos; 11 pruebas de integracion MariaDB 11.8.9 desechable, pipe unico y red deshabilitada. El ejecutor verifica binario, directorio, proceso y token, y confirma apagado. Solo admite --engine=mariadb. Reutiliza fixture C3C2 y agrega columnas de reportes en la instancia temporal; no es migracion de aplicacion.

Comandos desde el worktree:

- node node_modules/vitest/vitest.mjs run src/lib/contabilidad/reportes/reportes.test.ts src/lib/contabilidad/reportes/reportes-periodos.test.ts src/lib/contabilidad/periodos-reportes.test.ts
- node scripts/ci/c3c4/run-windows.mjs --run-isolated --engine=mariadb
- node node_modules/typescript/bin/tsc --noEmit --pretty false

El laboratorio requiere distribucion MariaDB verificada en .lab-runtime y dependencias instaladas. Los enlaces locales a dependencias y distribucion no son archivos para commit. No se realizo prueba visual en navegador.
