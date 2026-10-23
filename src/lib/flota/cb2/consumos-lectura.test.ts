import { describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { consultarConsumos } from "./consumos-lectura";
describe("lectura enriquecida y filtros tenant",()=>{
    it("parametriza todos los filtros y mantiene origen, empleado y factura en el ámbito del consumo",async()=>{
        const query=vi.fn().mockResolvedValue([[],[]]);const c={query} as unknown as PoolConnection;
        await consultarConsumos(c,7,50,10,{proveedorId:3,vehiculoId:1,empleadoId:77,importacionId:5,producto:"NO_DETERMINADO",estado:"PENDIENTE_FACTURA",desde:"2026-10-01",hasta:"2026-10-31",buscar:"' OR 1=1"});
        const [sql,args]=query.mock.calls[0];expect(sql).toContain("c.empresa_id=? AND c.id>?");expect(sql).toContain("e.empresa_id=c.empresa_id");expect(sql).toContain("f.empresa_id=c.empresa_id");expect(sql).toContain("o.empresa_id=c.empresa_id");expect(sql).toContain("a.empresa_id=c.empresa_id");expect(sql).toContain("ORDER BY c.id LIMIT ?");expect(sql).not.toContain("' OR 1=1");
        expect(args).toEqual([7,10,3,1,77,5,"NO_DETERMINADO","PENDIENTE_FACTURA","2026-10-01","2026-10-31","' OR 1=1","' OR 1=1","' OR 1=1",50]);
        expect(sql).toMatch(/^SELECT/);expect(sql).toContain("i.perfil");expect(sql).toContain("archivo_nombre");expect(sql).toContain("fila_excel");expect(sql).toContain("$.lote");
    });
});
