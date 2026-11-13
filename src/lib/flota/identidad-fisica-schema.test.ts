import {expect,it,vi} from 'vitest';
import type {RowDataPacket} from 'mysql2/promise';
import {estadoEsquemaFisico,guardasFisicas} from './identidad-fisica-schema';
it('ausente conserva catalogo anterior; cualquier instalacion parcial o motor incompatible bloquea',async()=>{
 const q=vi.fn<(...args:unknown[])=>Promise<RowDataPacket[]>>();
 q.mockResolvedValueOnce([]);expect(await estadoEsquemaFisico(q)).toBe('AUSENTE');
 q.mockResolvedValueOnce([{ENGINE:'InnoDB'}] as RowDataPacket[]).mockResolvedValueOnce([]);expect(await estadoEsquemaFisico(q)).toBe('PARCIAL');
 q.mockResolvedValueOnce(Array.from({length:4},()=>({ENGINE:'MyISAM'})) as RowDataPacket[]).mockResolvedValueOnce(guardasFisicas.map(TRIGGER_NAME=>({TRIGGER_NAME})) as RowDataPacket[]);expect(await estadoEsquemaFisico(q)).toBe('PARCIAL');
 q.mockResolvedValueOnce(Array.from({length:4},()=>({ENGINE:'InnoDB'})) as RowDataPacket[]).mockResolvedValueOnce(guardasFisicas.map(TRIGGER_NAME=>({TRIGGER_NAME})) as RowDataPacket[]);expect(await estadoEsquemaFisico(q)).toBe('COMPLETO');
});
