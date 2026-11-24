import { describe, expect, it } from 'vitest';
import { checksEquivalentes } from '../../../scripts/ci/canecas/check-equivalente.mjs';

describe('equivalencia conservadora de CHECK', () => {
  it.each([
    ['`cantidad` > 0', ' ((( CANTIDAD>0 ))) '],
    ['`capacidad` > 0', 'CAPACIDAD>0'],
    ['`cantidad` <> 0', 'CANTIDAD<>0'],
    ['`fisico` >= 0 and `reservado` >= 0 and `reservado` <= `fisico`', 'FISICO>=0 AND RESERVADO>=0 AND RESERVADO<=FISICO'],
    ["`estado` = 'BORRADOR' and `confirmado_por` is null and `confirmado_en` is null or `estado` = 'CONFIRMADA' and `confirmado_por` is not null and `confirmado_en` is not null", "ESTADO='BORRADOR' AND CONFIRMADO_POR IS NULL AND CONFIRMADO_EN IS NULL OR ESTADO='CONFIRMADA' AND CONFIRMADO_POR IS NOT NULL AND CONFIRMADO_EN IS NOT NULL"],
    ['json_valid(`modulos_json`)', 'JSON_VALID( MODULOS_JSON )'],
  ])('acepta formato equivalente', (a, b) => expect(checksEquivalentes(a, b)).toBe(true));
  it.each([
    ['cantidad > 0', 'cantidad >= 0'],
    ['fisico >= reservado', 'fisico > reservado'],
    ["estado = 'BORRADOR'", "estado = 'borrador'"],
    ['fisico >= 0 AND reservado >= 0', 'fisico >= 0 OR reservado >= 0'],
    ['(fisico >= 0 OR reservado >= 0) AND cantidad > 0', 'fisico >= 0 OR (reservado >= 0 AND cantidad > 0)'],
    ['cantidad > 0', 'cantidad > 0 -- comentario'],
    ['`otro` > 0', 'OTRO > 0'],
    ['cantidad > 1e2', 'cantidad > 1 e2'],
    ["estado = 'a\\b'", "estado='a\\b'"],
    ['(cantidad > 0', 'cantidad > 0'],
  ])('rechaza diferencias semánticas o sintaxis ambigua', (a, b) => expect(checksEquivalentes(a, b)).toBe(false));
});
