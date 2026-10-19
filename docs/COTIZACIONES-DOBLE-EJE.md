# Perfil DOBLE_EJE basado en CABEZAL

## Alcance y fuente

Alta de configuración por empresa, sin cambios de esquema, motor, validaciones, IVA, margen, UI ni snapshots. CABEZAL permanece intacto. El catálogo se obtiene de BD y admite códigos nuevos mediante el contrato existente; no hace falta modificar el motor ni una enumeración para usar DOBLE_EJE.

Fuente leída: Cotizador 2026.xlsx, hoja «Cabezales »: G12 GPS 100; H12 seguro 1250; I12 aceite 2400; J12 precio llanta 1490; L3 camión 275000; L4 cinco años; N3 salario piloto 9388.59. No existe hoja DOBLE_EJE.

La corrección de negocio confirma 18 llantas para DOBLE_EJE, igual que CABEZAL (J13 multiplica por 18). Mantiene salario auxiliar 6046.73 y viáticos/hotel 250 por instrucción expresa; no se atribuyen estos dos valores a Cabezales, donde N4 es 0 y N12 es 200. No se modifica el Excel ni se recalculan sus fórmulas.

## Configuración propuesta

| Campo | DOBLE_EJE | Origen |
|---|---:|---|
| GPS mensual | 100 | Cabezales G12 |
| Seguro vehículo mensual | 1250 | H12 |
| Aceite por servicio | 2400 | I12 |
| Precio llanta | 1490 | J12 |
| Cantidad llantas | 18 | Corrección de negocio: misma cantidad que CABEZAL; J13 |
| Juego de llantas | 26820 | 1490 × 18; compatibilidad con campo histórico |
| Adquisición informativa / valor depreciable | 275000 | L3, sin descontar IVA |
| Años depreciación | 5 | L4 |
| Salario piloto mensual | 9388.59 | N3 |
| Salario auxiliar mensual | 6046.73 | Instrucción de negocio |
| Viáticos/hotel por viaje | 250 | Instrucción de negocio |

Se copian del CABEZAL real del mismo tenant: rendimiento, intervalos de aceite/llantas, viajes mensuales, días operativos/depreciación, refrigeración y ambas banderas por día, incluyendo NULL y false. Ningún default de fixtures o fórmula de Excel sustituye esos valores. El efecto por días de los Q250 y del auxiliar sigue las banderas heredadas, no una regla nueva.

## Procedimiento pendiente de autorización operativa

Estos SQL son propuestas NO ejecutadas. No se crea el perfil productivo al desplegar código: requiere alta manual posterior aprobada.

1. Abrir la BD correspondiente con usuario autorizado; editar solo el slug de empresa en preflight. Ejecutar preflight solo lectura (SET es variable de sesión), revisar SHOW CREATE, resultado y preview.
2. DETENER si falta CABEZAL activo, sus divisores/rendimiento son inválidos, no tiene divisor de depreciación positivo, el slug no corresponde o DOBLE_EJE existente difiere. No inventar divisor ni sobrescribir perfil.
3. APLICAR: revisar el preview con negocio, completar el mismo slug y actor en migrate, cambiar aplicar=1 y ejecutar únicamente con autorización. Esta tarea NO lo ejecuta.
4. Debe insertar una fila. Repetir preflight: NOOP si coincide en los 27 campos. El alta repetida no sobrescribe; UNIQUE por empresa/código aborta una carrera concurrente. Un resultado de 0 filas sin perfil existente requiere investigar guard/slug/base.
5. Verificar desde Ajustes de cotizaciones y probar preview de costeo con el nuevo perfil. CABEZAL y snapshots históricos deben permanecer iguales.

La comparación NOOP es respecto del CABEZAL actual: si después cambia un campo heredado, el preflight devuelve DETENER; nunca resincroniza ni modifica automáticamente DOBLE_EJE.

## Validación y límites

Las pruebas de contrato verifican proyección SQL idéntica, cardinalidad de columnas, valores, preservación de NULL/false/true, tenant y guardas, compatibilidad con el schema Zod existente y ausencia de escrituras ajenas. No sustituyen ejecutar el preflight contra el esquema físico. No se ejecutó SQL de producción ni se dispone aquí de MariaDB local para afirmar un ensayo de integración real.

Además se comprobó localmente la secuencia APLICAR → alta → NOOP, repetición sin duplicados, CABEZAL intacto, discrepancia → DETENER y tenant sin CABEZAL → DETENER/sin alta, usando SQLite en memoria con datos sintéticos y adaptación de sintaxis (`<=>` a `IS`, `CHAR_LENGTH` a `LENGTH`, variables sustituidas). Esto verifica esos escenarios, pero NO certifica el dialecto ni el esquema físico MariaDB.
