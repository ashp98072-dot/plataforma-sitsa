import { describe, expect, it } from 'vitest';
import { checksEquivalentes } from '../../../scripts/ci/canecas/check-equivalente.mjs';

describe('equivalencia conservadora de CHECK', () => {
  it.each([
    ['`cantidad` > 0', ' ((( CANTIDAD>0 ))) '],
    ['json_valid(`modulos_json`)', 'JSON_VALID( MODULOS_JSON )'],
    ["(`estado` = 'BORRADOR' AND `confirmado_por` IS NULL)", "( ESTADO='BORRADOR' and confirmado_por is null )"],
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
