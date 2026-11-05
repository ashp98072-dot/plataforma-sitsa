import type { RowDataPacket } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ connection: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.connection }) }));
import { consultasIntegridad, filaIntegridad, obtenerIntegridadCxp } from "./integridad";
import { filtrosIntegridadDesdeParams, LIMITE_LINEAS } from "./integridad-shared";

export const datoFactura = (extra: Record<string, unknown> = {}) => ({
  codigo: "SOBREAPLICACION", factura_id: 1, proveedor_id: 3, proveedor: "Proveedor QA", documento: "A-1", estado_admin: "REGISTRADA",
  total_documento: "112.00", isr_monto: "5.00", monto_pagadero: "107.00", pagado: "107.01", pago_id: null, estado_pago: null,
  monto_total: null, suma_aplicaciones: null, monto_aplicado: null, ...extra,
}) as unknown as RowDataPacket;

describe("filtros estrictos de integridad", () => {
  it("proveedor opcional y filtros válidos preservados", () => {
    expect(filtrosIntegridadDesdeParams(new URLSearchParams("entidad=5"))).toEqual({ ok: true, filtros: {} });
    expect(filtrosIntegridadDesdeParams(new URLSearchParams("entidad=5&proveedorId=3&codigo=SOBREAPLICACION&estado=ANULADA&page=2&pageSize=100"))).toEqual({ ok: true, filtros: { proveedorId: 3, codigo: "SOBREAPLICACION", estado: "ANULADA", page: 2, pageSize: 100 } });
  });
  it.each(["proveedorId=", "proveedorId=abc", "proveedorId=0", "proveedorId=1&proveedorId=2", "proveedorId=%203", "codigo=NO", "codigo=", "estado=PAGADA", "page=0", "page=1.5", "page=1000001", "pageSize=101", "pageSize=", "empresaId=9", "entidad=5&entidad=6", "entidad=2147483648"])("rechaza %s", query => {
    expect(filtrosIntegridadDesdeParams(new URLSearchParams(query)).ok).toBe(false);
  });
});

describe("planes SQL de sólo lectura y paginación", () => {
  it.each([true,false])("scope y parámetros exactos en todas las ramas (permiso pagos=%s)", verPagos => {
    const q = consultasIntegridad(7,5,{proveedorId:3,estado:"ANULADA"},true,verPagos);
    expect((q.sql.match(/\?/g)||[])).toHaveLength(q.params.length);
    expect((q.reviewedSql.match(/\?/g)||[])).toHaveLength(q.reviewedParams.length);
    expect(q.sql).toContain("g.estado = 'REGISTRADO'");
    expect(q.sql).toContain("x.empresa_id = ? AND x.entidad_id = ? AND x.proveedor_id = ? AND x.estado_admin = ?");
    expect(q.params.filter(p=>p===7).length).toBeGreaterThan(1);
    if(verPagos) {
      expect(q.sql).toContain("g.empresa_id = ? AND g.entidad_id = ? AND g.proveedor_id = ?");
      expect(q.sql).toContain("AND xf.estado_admin = ?");
      expect(q.sql).toContain("GROUP BY a.pago_id");
      expect(q.sql).not.toContain("g.estado = 'REGISTRADO' AND g.monto_total");
    } else {
      for(const detail of ["g.id AS pago_id", "g.estado AS estado_pago", "g.monto_total", "g.proveedor_id <> x.proveedor_id", "g.referencia", "g.medio_pago", "g.reversado_en"]) expect(q.sql).not.toContain(detail);
    }
    expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  });
  it("filtrar tipo no altera el universo de facturas revisadas ni usa una página para totales", () => {
    const q=consultasIntegridad(7,5,{codigo:"SOBREAPLICACION",page:2,pageSize:1},true,true);
    expect(q.sql).not.toContain("UNION ALL"); expect(q.sql).not.toContain("LIMIT");
    expect(q.sql).not.toContain("'PAGO_DESCUADRADO' AS codigo");
    expect(q.reviewedSql).not.toContain("pg."); expect(q.reviewedParams).toEqual([7,5]);
  });
  it("sin tablas de pagos nunca consulta detalles ni oculta la limitación con una suma falsa", () => {
    const q=consultasIntegridad(7,5,{},false,true);
    expect(q.sql).not.toContain("cxp_pagos"); expect(q.sql).not.toContain("cxp_pago_aplicaciones");
  });
});

describe("clasificación/precisión con reglas compartidas", () => {
  it("preserva el exceso de un centavo sobre un importe grande", () => {
    const r=filaIntegridad(datoFactura({ total_documento:"9999999999.99",isr_monto:"0.00",monto_pagadero:"9999999999.99",pagado:"10000000000.00" }),5,false);
    expect(r).toMatchObject({montoPagadero:"9999999999.99",pagado:"10000000000.00",excesoAplicado:"0.01",advertencia:{codigo:"SOBREAPLICACION"}});
    expect(r).not.toHaveProperty("saldo"); expect(r).not.toHaveProperty("pago");
  });
  it("anulada con pago vigente usa el mismo código y detalle que lectura de facturas", () => {
    expect(filaIntegridad(datoFactura({codigo:"PAGO_VIGENTE_EN_ANULADA",estado_admin:"ANULADA",pagado:"1.01"}),5,false)).toMatchObject({estadoAdmin:"ANULADA",pagado:"1.01",advertencia:{codigo:"PAGO_VIGENTE_EN_ANULADA"}});
  });
  it("reverso estructural se informa sólo con permiso y no altera el pagado vigente", () => {
    const dato=datoFactura({codigo:"PAGO_DE_OTRO_PROVEEDOR",pago_id:20,estado_pago:"REVERSADO",pagado:"0.00",monto_aplicado:"12.34"});
    expect(filaIntegridad(dato,5,true)).toMatchObject({pagado:"0.00",excesoAplicado:"0.00",pago:{id:20,estado:"REVERSADO",montoAplicado:"12.34"}});
    expect(()=>filaIntegridad(dato,5,false)).toThrow(/no autorizada/);
  });
  it("pago descuadrado sin factura no inventa pagadero, pagado o saldo de factura", () => {
    const dato=datoFactura({codigo:"PAGO_DESCUADRADO",factura_id:null,documento:null,estado_admin:null,pago_id:21,estado_pago:"REGISTRADO",monto_total:"10.01",suma_aplicaciones:"0.00"});
    expect(filaIntegridad(dato,5,true)).toMatchObject({facturaId:null,montoPagadero:null,pagado:null,excesoAplicado:null,pago:{montoTotal:"10.01",sumaAplicaciones:"0.00"},advertencia:{codigo:"PAGO_DESCUADRADO"}});
  });
  it("ni una columna accidental ni advertencias de pagos se exponen sin permiso", () => {
    const r=filaIntegridad(datoFactura({pago_id:99,referencia:"privada",medio_pago:"secreto",motivo_reversion:"privado"}),5,false);
    for(const key of ["pago", "pagoId", "referencia", "medio_pago", "motivo_reversion"]) expect(JSON.stringify(r)).not.toContain(`"${key}"`);
  });
  it("no fabrica una advertencia sin evidencia compatible", () => {
    expect(()=>filaIntegridad(datoFactura({pagado:"0.00"}),5,false)).toThrow(/inconsistente/);
  });
});

describe("servicio en una instantánea, contadores globales y filas limitadas", () => {
  let events: RowDataPacket[];
  let entity: boolean;
  let provider: boolean;
  let missingPayments: boolean;
  let conn: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  beforeEach(()=>{
    vi.resetAllMocks();events=[datoFactura(),datoFactura({factura_id:2,proveedor_id:4,proveedor:"Otro",documento:"B-2"})];
    entity=true;provider=true;missingPayments=false;
    conn={query:vi.fn(async (sql:string,params:unknown[]=[])=>{
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
      if(sql.startsWith("SET ")||sql.startsWith("START ")||sql==="COMMIT") return [[]];
      if(sql.startsWith("SELECT id FROM cont_entidades")){expect(params).toEqual([7,5]);return [entity?[{id:5}]:[]];}
      if(sql.startsWith("SELECT id FROM compras_proveedores")){expect(params).toEqual([7,3]);return [provider?[{id:3}]:[]];}
      if(sql.startsWith("SELECT COUNT(*) AS n FROM cxp_facturas"))return [[{n:9}]];
      if(missingPayments&&sql.includes("cxp_pago"))throw {code:"ER_NO_SUCH_TABLE",sqlMessage:"cxp_pago_aplicaciones no existe"};
      const rows=missingPayments?[]:events;
      if(sql.startsWith("SELECT COUNT(*) AS n, COUNT(DISTINCT")) return [[{n:rows.length,facturas:new Set(rows.map(r=>r.factura_id).filter(Boolean)).size}]];
      if(sql.startsWith("SELECT codigo, COUNT(*)")) return [[...new Set(rows.map(r=>r.codigo))].map(codigo=>({codigo,n:rows.filter(r=>r.codigo===codigo).length}))];
      if(sql.startsWith("SELECT * FROM")){const [limit,offset]=params.slice(-2) as number[];return [rows.slice(offset,offset+limit)];}
      throw Error("Consulta inesperada");
    }),release:vi.fn()};m.connection.mockResolvedValue(conn);
  });
  it("los totales no son los de la página; no hay N+1 ni carga completa en memoria",async()=>{
    const r=await obtenerIntegridadCxp(7,5,{page:2,pageSize:1},{verPagos:false});
    expect(r).toMatchObject({facturasRevisadas:9,totalAdvertencias:2,facturasConAnomalias:2,porCodigo:{SOBREAPLICACION:2},page:2,pageSize:1});
    expect(r.filas.map(f=>f.facturaId)).toEqual([2]);
    expect(m.connection).toHaveBeenCalledOnce();expect(conn.query).toHaveBeenCalledTimes(8);
    expect(conn.query.mock.calls[0][0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(conn.query.mock.calls[1][0]).toBe("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    expect(conn.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");expect(conn.release).toHaveBeenCalledOnce();
    const pageCall=conn.query.mock.calls.find(([s])=>s.startsWith("SELECT * FROM"))!;
    expect(pageCall[0]).toMatch(/ORDER BY codigo, factura_id, pago_id LIMIT \? OFFSET \?$/);expect(pageCall[1].slice(-2)).toEqual([1,1]);
  });
  it("entidad sin anomalías devuelve contadores cero y conjunto completo revisado",async()=>{
    events=[];const r=await obtenerIntegridadCxp(7,5,{}, {verPagos:false});
    expect(r).toMatchObject({facturasRevisadas:9,totalAdvertencias:0,facturasConAnomalias:0,filas:[]});
  });
  it("varias advertencias de la misma factura no duplican el contador de facturas",async()=>{
    events=[datoFactura({estado_admin:"ANULADA"}),datoFactura({codigo:"PAGO_VIGENTE_EN_ANULADA",estado_admin:"ANULADA"})];
    const r=await obtenerIntegridadCxp(7,5,{}, {verPagos:false});
    expect(r).toMatchObject({totalAdvertencias:2,facturasConAnomalias:1,porCodigo:{SOBREAPLICACION:1,PAGO_VIGENTE_EN_ANULADA:1}});
    expect(r.filas.map(f=>f.advertencia.codigo)).toEqual(["SOBREAPLICACION","PAGO_VIGENTE_EN_ANULADA"]);
  });
  it("facturas sin migración devuelven 503 y no se convierten en cero revisadas",async()=>{
    conn.query.mockImplementation(async()=>{throw {code:"ER_NO_SUCH_TABLE",sqlMessage:"cxp_facturas no existe"};});
    await expect(obtenerIntegridadCxp(7,5,{}, {verPagos:false})).rejects.toMatchObject({status:503,codigo:"MIGRACION_PENDIENTE"});
    expect(m.connection).toHaveBeenCalledOnce();
  });
  it("entidad y proveedor ajenos fallan sin leer hallazgos",async()=>{
    entity=false;await expect(obtenerIntegridadCxp(7,5,{}, {verPagos:false})).rejects.toMatchObject({status:404,codigo:"ENTIDAD_NO_DISPONIBLE"});
    entity=true;provider=false;await expect(obtenerIntegridadCxp(7,5,{proveedorId:3}, {verPagos:false})).rejects.toMatchObject({status:404,codigo:"PROVEEDOR_NO_DISPONIBLE"});
    expect(conn.query.mock.calls.some(([s])=>s.includes("hallazgos"))).toBe(false);
  });
  it("pagos ausentes reintentan en otra instantánea y declaran revisión incompleta",async()=>{
    missingPayments=true;const r=await obtenerIntegridadCxp(7,5,{}, {verPagos:true});
    expect(r).toMatchObject({pagosDisponibles:false,facturasRevisadas:0,facturasEnAmbito:9,filas:[]});
    expect(r.limitaciones.join(" ")).toContain("no se completó");expect(m.connection).toHaveBeenCalledTimes(2);
  });
  it("no omite errores SQL desconocidos y libera conexión",async()=>{
    conn.query.mockRejectedValueOnce(Error("fallo"));await expect(obtenerIntegridadCxp(7,5,{}, {verPagos:false})).rejects.toThrow("fallo");expect(conn.release).toHaveBeenCalled();
  });
  it("categorías de pagos denegadas antes de DB; la quinta no se inventa",async()=>{
    await expect(obtenerIntegridadCxp(7,5,{codigo:"PAGO_DESCUADRADO"},{verPagos:false})).rejects.toMatchObject({status:403});
    await expect(obtenerIntegridadCxp(7,5,{codigo:"PAGADO_NO_COINCIDE_CON_LINEAS"},{verPagos:true})).rejects.toMatchObject({status:422,message:LIMITE_LINEAS});
    expect(m.connection).not.toHaveBeenCalled();
  });
});
