import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn()}));
vi.mock('@/lib/db',()=>({getPool:()=>({getConnection:async()=>h})}));
vi.mock('@/lib/auth-secret',()=>({getAuthSecretBytes:()=>new Uint8Array(32).fill(8)}));
import { previsualizarVencimiento } from './credito';
beforeEach(()=>vi.resetAllMocks());
it('modelo sin FACT4 mantiene compatibilidad explícita sin insertar snapshot',async()=>{
 h.query.mockRejectedValueOnce({code:'ER_BAD_FIELD_ERROR'}).mockResolvedValueOnce([[{id:1,estado_admin:'Borrador'}]]).mockResolvedValueOnce([[{n:0}]]);
 expect((await previsualizarVencimiento({empresaId:7,usuarioId:3,usuario:'qa'},1,'2026-07-15')).certificado).toBe(false);
 expect(h.execute).not.toHaveBeenCalled();expect(h.commit).toHaveBeenCalledOnce();
});
it('FACT4 parcial rechaza sin clasificación silenciosa de legado',async()=>{
 h.query.mockRejectedValueOnce({code:'ER_BAD_FIELD_ERROR'}).mockResolvedValueOnce([[{id:1,estado_admin:'Borrador'}]]).mockResolvedValueOnce([[{n:1}]]);
 await expect(previsualizarVencimiento({empresaId:7,usuarioId:3,usuario:'qa'},1,'2026-07-15')).rejects.toMatchObject({status:503});
 expect(h.rollback).toHaveBeenCalledOnce();expect(h.execute).not.toHaveBeenCalled();
});
it('el fallback anterior a FACT4 también verifica existencia bajo empresa',async()=>{
 h.query.mockRejectedValueOnce({code:'ER_BAD_FIELD_ERROR'}).mockResolvedValueOnce([[]]);
 await expect(previsualizarVencimiento({empresaId:8,usuarioId:3,usuario:'qa'},1,'2026-07-15')).rejects.toMatchObject({status:404});
});
