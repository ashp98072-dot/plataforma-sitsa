# RRHH Planillas — aportes patronales (IGSS / IRTRA / INTECAP): hallazgo pendiente

Estado: **HALLAZGO DOCUMENTADO — sin cambios de cálculo.** Ningún porcentaje ni base fue modificado.

## Qué hace hoy el sistema
- `IGSS_LABORAL_PCT = 0.0483` (cuota laboral, se descuenta al trabajador) sobre el **sueldo ordinario** devengado.
- `IGSS_PATRONAL_PCT = 0.1267` (`src/lib/rrhh/contratos-pago.ts`): una sola cifra que en realidad es
  **IGSS patronal 10.67% + IRTRA 1% + INTECAP 1%**. No es solo "IGSS patronal".
- La base es el sueldo ordinario; **no** incluye horas extra (salario extraordinario) ni comisiones.

## Qué se cambió en este commit (solo texto/etiquetas)
Donde se leía "IGSS patronal 12.67%" ahora dice "Aporte patronal estimado IGSS + IRTRA + INTECAP" (tabla de Planillas,
Excel de planilla, cuadre y dashboard RRHH). Los importes no cambian.

## Fuentes oficiales consultadas
- IGSS — cuota laboral 4.83% y patronal 10.67% (distribución por programa: accidentes 3.00%+1.00%, enfermedad y maternidad
  4.00%+2.00%, IVS 3.67%+1.83%): <https://www.igssgt.org/noticias/2022/10/03/el-igss-fija-cuota-minima-de-contribuciones-a-la-seguridad-social/>
  y Acuerdo 1124 de Junta Directiva: <https://www.igssgt.org/wp-content/uploads/2021/12/Acuerdo-1124-Junta-Directiva-IGSS-Rev-2021.pdf>
- IRTRA — Decreto 1528: tasa equivalente al **1% sobre los salarios ordinarios y extraordinarios** de los trabajadores de
  empresas privadas, recaudada por el IGSS: <https://irtra.org.gt/wp-content/uploads/2019/04/ley-de-creacion-del-instituto-de-decreto-del-congreso-1528-1554192065-490230464.pdf>
- INTECAP — Ley Orgánica, Decreto 17-72: tasa patronal sobre la totalidad de las planillas de sueldos y salarios (sujetas a IGSS):
  <https://intecap.edu.gt/informacionpublica/pdf/ley_organica.pdf> y reglamento de recaudación:
  <https://intecap.edu.gt/legislacion/files/Reglam.recaudaci%C3%B3n%20tasa%20patronal%20(Tasas%20y%20licencias%20varias).pdf>
  **Nota:** el texto original del decreto fija 0.50% desde 1972; el 1% vigente debe confirmarse contra la reforma/convenio de
  recaudación aplicable antes de usarlo como referencia normativa.

## Pendientes (PR separado, requiere revisión y decisión)
1. La base patronal actual puede requerir incorporar el **salario extraordinario** (horas extra) — al menos para IRTRA
   (Decreto 1528 lo dice expresamente) y, según su normativa, para IGSS/INTECAP.
2. Desglosar el 12.67% en sus tres componentes (IGSS 10.67%, IRTRA 1%, INTECAP 1%) en vez de una sola constante.
3. Confirmar la base legal vigente del 1% de INTECAP.
