# RRHH Planillas — aportes patronales (IGSS / IRTRA / INTECAP): hallazgo pendiente

Estado: **HALLAZGO DOCUMENTADO — sin cambios de cálculo.** Ningún porcentaje ni base fue modificado.

## Qué hace hoy el sistema
- `IGSS_LABORAL_PCT = 0.0483` (cuota laboral, se descuenta al trabajador) sobre el **sueldo ordinario** devengado.
- `IGSS_PATRONAL_PCT = 0.1267` (`src/lib/rrhh/contratos-pago.ts`): una sola cifra que en realidad es
  **IGSS patronal 10.67% + IRTRA 1% + INTECAP 1%**. No es solo "IGSS patronal".
- La base es el sueldo ordinario; **no** incluye horas extra (salario extraordinario) ni comisiones.

## Qué se cambió (solo texto/etiquetas)
Donde se leía "IGSS patronal 12.67%" ahora dice "Aporte patronal estimado IGSS + IRTRA + INTECAP" (tabla de Planillas,
Excel de planilla, cuadre y dashboard RRHH). Los importes no cambian.

## Porcentajes CONFIRMADOS con fuente oficial
| Concepto | Porcentaje | Fuente |
|---|---|---|
| IGSS cuota laboral | 4.83% | IGSS |
| IGSS cuota patronal | 10.67% | IGSS |
| IRTRA (patronal) | 1% | Decreto 1528 |
| INTECAP (patronal) | 1% | Reglamento de Recaudación INTECAP (art. 9) y Convenio IGSS–INTECAP |

Total aporte patronal estimado usado por el sistema: 10.67% + 1% + 1% = **12.67%**.

## Fuentes oficiales
- **IGSS** — cuota laboral 4.83% y patronal 10.67% (distribución por programa: accidentes 3.00%+1.00%, enfermedad y
  maternidad 4.00%+2.00%, IVS 3.67%+1.83%):
  <https://www.igssgt.org/noticias/2022/10/03/el-igss-fija-cuota-minima-de-contribuciones-a-la-seguridad-social/>
  y Acuerdo 1124 de Junta Directiva: <https://www.igssgt.org/wp-content/uploads/2021/12/Acuerdo-1124-Junta-Directiva-IGSS-Rev-2021.pdf>
- **IRTRA** — Decreto 1528: tasa equivalente al **1% sobre los salarios ordinarios y extraordinarios** de los trabajadores de
  empresas privadas, recaudada por el IGSS:
  <https://irtra.org.gt/wp-content/uploads/2019/04/ley-de-creacion-del-instituto-de-decreto-del-congreso-1528-1554192065-490230464.pdf>
- **INTECAP** — tasa patronal vigente de **1%** del valor de los salarios mensuales:
  - Reglamento de Recaudación de la Tasa Patronal (artículo 9):
    <https://www.intecap.edu.gt/legislacion/files/Reglam.recaudaci%C3%B3n%20tasa%20patronal%20%28Tasas%20y%20licencias%20varias%29.pdf>
  - Convenio IGSS–INTECAP (aportes patronales): 1% sobre la totalidad de las planillas de sueldos y salarios, con las
    excepciones legales aplicables:
    <https://intecap.edu.gt/legislacion/files/Convenio%20entre%20IGSS%20e%20INTECAP.%20Aportes%20Patronales.pdf>
  - Ley Orgánica, Decreto 17-72: <https://intecap.edu.gt/informacionpublica/pdf/ley_organica.pdf>

## Pendientes (PR separado, requieren revisión y decisión)
1. Revisar y desglosar correctamente las **bases de cálculo** de cada aporte (IGSS, IRTRA, INTECAP).
2. Revisar la incorporación del **salario extraordinario / horas extra** a la base según corresponda a cada aporte
   (el Decreto 1528 de IRTRA lo menciona expresamente).
3. **Separar técnicamente los tres componentes** (IGSS 10.67%, IRTRA 1%, INTECAP 1%) en lugar de mantener 12.67% en una sola
   constante.
