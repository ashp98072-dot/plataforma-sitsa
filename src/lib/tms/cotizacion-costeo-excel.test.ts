import { describe, expect, it } from "vitest";
import { calcularCosteoServicio, COTIZACION_COSTEO_EXCEL_VERSION, type InputCosteoServicio } from "./cotizacion-costeo";
import { costeoPayloadSchema } from "./cotizacion-costeo-servicio";
import { construirPayloadCosteo, COSTEO_FORM_VACIO } from "./cotizacion-costeo-ui";
import { decimalCosteoSql } from "./cotizacion-costeo-excel";

// Fixture de fórmulas: ejemplos explícitos del ticket + tasas diarias del fixture
// existente. NO representa un perfil comercial aprobado ni se utiliza como seed.
const entrada = (extra: Partial<InputCosteoServicio> = {}): InputCosteoServicio => ({
 motorVersion: COTIZACION_COSTEO_EXCEL_VERSION,
 perfil: {codigo:"CAMION_5T",nombre:"Fixture 5T",diasOperacionMes:26,viajesMes:20,gpsMensual:100,
 seguroVehiculoMensual:950,costoAceiteServicio:1750,vidaUtilAceiteKm:5000,
 costoJuegoLlantas:3400,precioLlanta:850,cantidadLlantas:4,vidaUtilLlantasKm:50000,
 rendimientoKmGalon:10,depreciacion:{valorBase:150000,anios:5,diasOperacionMes:26},
 costoRefrigeracion:{valorBase:100000,anios:5,diasOperacionMes:26}},
 parametros:{precioCombustibleGalon:49.8,ivaTasa:.12,costoPilotoDia:207.74,costoAuxiliarDia:148.04,
 viaticoPilotoDia:100,viaticoAuxiliarDia:80,viaticoGuiaDia:60,
 seguroMercaderiaAnual:70000,cantidadCamiones:46,viajesAnuales:240,diasGastosMes:20,
 gastosAdministracion:203236.49,gastosMantenimiento:0,gastosSeguridad:0,gastosPredios:0},
 distanciaKm:220,diasServicio:1,cantidadPilotos:1,cantidadAuxiliares:1,
 incluirGps:true,incluirSeguroVehiculo:true,precioCombustibleOverride:43,margenObjetivo:.30,
 ...extra,
});
describe("Paridad de fórmulas Excel 2026 (A–F)",()=>{
 it("A: desglose, único margen, IVA posterior y precio/km",()=>{
  const r=calcularCosteoServicio(entrada());
  expect(r).toMatchObject({gps:5,aceite:77,llantas:14.96,combustible:946,depreciacion:96.15,
   seguroVehiculo:31.67,seguroMercaderia:6.34,piloto:207.74,auxiliares:148.04,
   gastosGenerales:220.91,costoOperativo:1933.81,margenObjetivoMonto:580.14,
   subtotalComercial:2513.95,iva:301.67,precioSugerido:2815.62,precioPorKm:12.80});
 });
 it("B: margen objetivo 45% sobre costo base",()=>{
  const r=calcularCosteoServicio(entrada({margenObjetivo:.45}));
  expect(r.margenObjetivoMonto).toBe(870.21);
  expect(r.subtotalComercial).toBe(2804.02);
 });
 it("C: dos días escalan diarios, no GPS/seguro mercadería/km; Thermo redondea al final",()=>{
  const a=calcularCosteoServicio(entrada({usarRefrigeracion:true}));
  const b=calcularCosteoServicio(entrada({diasServicio:2,usarRefrigeracion:true}));
  expect(b.gps).toBe(a.gps); expect(b.seguroMercaderia).toBe(a.seguroMercaderia);
  for(const k of ["aceite","llantas","combustible"] as const) expect(b[k]).toBe(a[k]);
  expect(b.depreciacion).toBe(192.31); expect(b.seguroVehiculo).toBe(63.33);
  expect(b.piloto).toBe(415.48);expect(b.auxiliares).toBe(296.08);
  expect(b.viaticoPiloto).toBe(200);expect(b.viaticoAuxiliar).toBe(160);
  expect(b.refrigeracion).toBe(128.21);
 });
 it("D: override 43 no modifica global 49.80",()=>{
  const i=entrada();calcularCosteoServicio(i);
  expect(i.parametros.precioCombustibleGalon).toBe(49.8);
  expect(calcularCosteoServicio({...i,precioCombustibleOverride:undefined}).combustible).toBe(1095.6);
 });
 it("E: Thermo solo cuando se habilita; perfil sin equipo no admite refrigeración",()=>{
  expect(calcularCosteoServicio(entrada()).refrigeracion).toBe(0);
  expect(calcularCosteoServicio(entrada({usarRefrigeracion:true})).refrigeracion).toBe(64.1);
  expect(()=>calcularCosteoServicio(entrada({perfil:{...entrada().perfil,costoRefrigeracion:null},usarRefrigeracion:true}))).toThrow();
 });
 it("F: cero km no divide por cero",()=>expect(calcularCosteoServicio(entrada({distanciaKm:0})).precioPorKm).toBeNull());
 it("salarios mensuales y divisor global sustituyen solo los equivalentes configurados",()=>{
  const i=entrada();
  const r=calcularCosteoServicio({...i,diasServicio:2,cantidadPilotos:2,cantidadAuxiliares:3,perfil:{...i.perfil,salarioPilotoMensual:4000,salarioAuxiliarMensual:3000},parametros:{...i.parametros,diasLaboralesMes:20,diasDepreciacionMes:25}});
  expect(r).toMatchObject({piloto:800,auxiliares:900,depreciacion:200});
 });
 it("NULL no se inventa como gasto confirmado; snapshot conserva advertencias y valores usados",()=>{
  const i=entrada(); const p={...i.parametros,seguroMercaderiaAnual:null,gastosAdministracion:null,gastosMantenimiento:null,gastosSeguridad:null,gastosPredios:null};
  const r=calcularCosteoServicio({...i,parametros:p});
  expect(r.advertencias).toHaveLength(2);
  expect(r.valoresUsados).toMatchObject({precioCombustibleGalon:43,rendimientoKmGalon:10,viajesMes:20,costoJuegoLlantas:3400,diasDepreciacionVehiculo:26});
  expect(decimalCosteoSql(r.costoOperativo)).toBe(r.costoOperativo.toFixed(6));
 });
 it("redondeo de un margen sobre ejemplo aislado del ticket",()=>{
  const i=entrada(); const r=calcularCosteoServicio({...i,distanciaKm:0,cantidadPilotos:0,cantidadAuxiliares:0,incluirGps:false,incluirSeguroVehiculo:false,perfil:{...i.perfil,depreciacion:null},seguroMercaderia:0,parametros:{...i.parametros,gastosAdministracion:0},otrosCostos:[{concepto:"Base ejemplo de márgenes",monto:1671.81}]});
  expect(r).toMatchObject({costoOperativo:1671.81,margenObjetivoMonto:501.54,subtotalComercial:2173.35,iva:260.8,precioSugerido:2434.15});
 });
 it("preserva overrides totales aunque cambien días/personas",()=>{
  expect(calcularCosteoServicio(entrada({diasServicio:2,cantidadPilotos:3,viaticoPilotoTotal:17,hotelTotal:120}))).toMatchObject({viaticoPiloto:17,hotel:120});
 });
 it("seguro manual se redondea como concepto; desglose y costo base concilian exactamente",()=>{
  const r=calcularCosteoServicio(entrada({seguroMercaderia:1.239}));
  expect(r.seguroMercaderia).toBe(1.24);
  expect(r.componentes.reduce((s,c)=>s+c.monto,0)).toBeCloseTo(r.costoOperativo,8);
 });
 it("divisores cero/llantas parciales se rechazan, no producen Infinity",()=>{
  expect(()=>calcularCosteoServicio(entrada({perfil:{...entrada().perfil,viajesMes:0}}))).toThrow();
  expect(()=>calcularCosteoServicio(entrada({perfil:{...entrada().perfil,cantidadLlantas:null}}))).toThrow();
 });
 it("payload permite solo override autorizado, no combustible global ni datos de perfil",()=>{
  const payload={perfilId:1,distanciaKm:220,diasServicio:1,cantidadPilotos:1,cantidadAuxiliares:0,incluirGps:true,incluirSeguroVehiculo:true,precioCombustibleOverride:43,margenObjetivo:.45};
  expect(costeoPayloadSchema.safeParse(payload).success).toBe(true);
  expect(costeoPayloadSchema.safeParse({...payload,precioCombustibleGalon:43}).success).toBe(false);
  expect(costeoPayloadSchema.safeParse({...payload,margenObjetivo:-1}).success).toBe(false);
 });
 it("UI captura override y único margen objetivo; huella contiene los valores enviados",()=>{
  const r=construirPayloadCosteo({...COSTEO_FORM_VACIO,perfilId:1,distanciaKm:"220",precioCombustibleOverride:"43",margenObjetivoPct:"30"});
  expect(r.ok&&r.payload).toMatchObject({precioCombustibleOverride:43,margenObjetivo:.3});
 });
 it.each([[.30,1200,5200],[.45,1800,5800]])("base Q4000 y margen %s produce valor %s/subtotal %s", (porcentaje,valor,subtotal)=>{
  const i=entrada();
  const r=calcularCosteoServicio({...i,distanciaKm:0,cantidadPilotos:0,cantidadAuxiliares:0,incluirGps:false,incluirSeguroVehiculo:false,perfil:{...i.perfil,depreciacion:null},seguroMercaderia:0,parametros:{...i.parametros,gastosAdministracion:0},otrosCostos:[{concepto:"Base ejemplo",monto:4000}],margenObjetivo:porcentaje});
  expect(r).toMatchObject({costoOperativo:4000,margenObjetivoAplicado:porcentaje,margenObjetivoMonto:valor,subtotalComercial:subtotal,iva:subtotal*.12});
  expect(Object.keys(r).filter(k=>/^margen/.test(k))).toEqual(["margenObjetivoAplicado","margenObjetivoMonto","margenReal"]);
 });
 it("5T y 10T resuelven salarios diferentes con el mismo divisor global; cambiar 5T no altera 10T",()=>{
  const i=entrada(),parametros={...i.parametros,diasLaboralesMes:20};
  const cinco={...i.perfil,salarioPilotoMensual:4000,salarioAuxiliarMensual:3000};
  const diez={...cinco,codigo:"CAMION_10T",salarioPilotoMensual:6000,salarioAuxiliarMensual:3500};
  expect(calcularCosteoServicio({...i,perfil:cinco,parametros})).toMatchObject({piloto:200,auxiliares:150,valoresUsados:{salarioPilotoMensual:4000,salarioAuxiliarMensual:3000,costoPilotoDia:200,costoAuxiliarDia:150,diasLaboralesMes:20}});
  expect(calcularCosteoServicio({...i,perfil:{...cinco,salarioPilotoMensual:4500},parametros}).piloto).toBe(225);
  expect(calcularCosteoServicio({...i,perfil:diez,parametros})).toMatchObject({piloto:300,auxiliares:175});
  expect(diez.salarioPilotoMensual).toBe(6000);
 });
 it("salarios NULL usan los diarios legados sin exigir divisor; cero configurado NO activa fallback",()=>{
  const i=entrada();
  const r=calcularCosteoServicio({...i,perfil:{...i.perfil,salarioPilotoMensual:null,salarioAuxiliarMensual:null}});
  expect(r).toMatchObject({piloto:207.74,auxiliares:148.04,valoresUsados:{salarioPilotoMensual:null,salarioAuxiliarMensual:null,costoPilotoDia:207.74,costoAuxiliarDia:148.04}});
  expect(calcularCosteoServicio({...i,perfil:{...i.perfil,salarioPilotoMensual:0},parametros:{...i.parametros,diasLaboralesMes:20}}).piloto).toBe(0);
  expect(()=>calcularCosteoServicio({...i,perfil:{...i.perfil,salarioPilotoMensual:4000}})).toThrow("días laborales");
 });
 it("V1 ignora nuevos salarios del perfil y conserva el cálculo diario histórico",()=>{
  const i=entrada(),viejo={...i,motorVersion:"COSTEO_V1"};
  const antes=calcularCosteoServicio(viejo);
  expect(calcularCosteoServicio({...viejo,perfil:{...i.perfil,salarioPilotoMensual:9999,salarioAuxiliarMensual:8888}})).toEqual(antes);
  expect(antes.piloto).toBe(207.74);
 });
});
