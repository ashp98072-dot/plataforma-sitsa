import { describe,expect,it } from "vitest";
import { parametrosAjustesSchema,perfilAjustesCrearSchema } from "./cotizacion-costeo-ajustes";
const perfil={codigo:"CAMION_5T",nombre:"Camión 5T",activo:true,costoAdquisicion:null,diasOperacionMes:26,gpsMensual:0,seguroVehiculoMensual:0,costoAceiteServicio:0,vidaUtilAceiteKm:5000,costoJuegoLlantas:0,vidaUtilLlantasKm:50000,rendimientoKmGalon:10,deprecValorBase:null,deprecAnios:null,deprecDiasOperacionMes:null,refrigValorBase:null,refrigAnios:null,refrigDiasOperacionMes:null};
describe("validación ajustes de costeo",()=>{
 it("acepta vigencia completa y porcentajes decimales",()=>expect(parametrosAjustesSchema.safeParse({vigenteDesde:"2026-09-21",precioCombustibleGalon:32,ivaTasa:.12,costoPilotoDia:1,costoAuxiliarDia:0,viaticoPilotoDia:0,viaticoAuxiliarDia:0,viaticoGuiaDia:0,hotelDia:null,margenObjetivo:.2}).success).toBe(true));
 it("rechaza fechas reales inválidas, combustible no positivo y tasas fuera de rango",()=>{expect(parametrosAjustesSchema.safeParse({vigenteDesde:"2026-02-31",precioCombustibleGalon:0,ivaTasa:12}).success).toBe(false);});
 it("exige código canónico",()=>expect(perfilAjustesCrearSchema.safeParse({...perfil,codigo:"camión 5t"}).success).toBe(false));
 it("acepta tríos vacíos y exige los tres datos cuando se inicia depreciación",()=>{expect(perfilAjustesCrearSchema.safeParse(perfil).success).toBe(true);expect(perfilAjustesCrearSchema.safeParse({...perfil,deprecValorBase:100}).success).toBe(false);});
 it("exige rendimientos y vidas útiles positivos",()=>expect(perfilAjustesCrearSchema.safeParse({...perfil,rendimientoKmGalon:0}).success).toBe(false));
});
describe("Configuración aditiva Excel",()=>{
 const base={vigenteDesde:"2026-10-03",precioCombustibleGalon:49.8,ivaTasa:.12,costoPilotoDia:200,costoAuxiliarDia:150,viaticoPilotoDia:0,viaticoAuxiliarDia:0,viaticoGuiaDia:0,hotelDia:null,margenObjetivo:.15};
 it("rechaza gastos parciales, salario sin divisor y seguro anual sin flota",()=>{
  for(const extra of [{gastosAdministracion:100},{salarioPilotoMensual:4000},{seguroMercaderiaAnual:70000},{cantidadCamiones:1.5},{margen2:6},{viajesAnuales:1e10}]) expect(parametrosAjustesSchema.safeParse({...base,...extra}).success).toBe(false);
 });
 it("acepta valores conocidos completos y nunca inventa costos al faltar campos nuevos",()=>{
  expect(parametrosAjustesSchema.safeParse({...base,gastosAdministracion:100,gastosMantenimiento:0,gastosSeguridad:0,gastosPredios:0,cantidadCamiones:46,diasGastosMes:20,seguroMercaderiaAnual:70000,viajesAnuales:240,salarioPilotoMensual:4000,diasLaboralesMes:20,margen2:.15}).success).toBe(true);
  const r=parametrosAjustesSchema.parse(base);expect(r.seguroMercaderiaAnual).toBeUndefined();
 });
 it("llantas desglosadas requieren precio/cantidad entera; admite nuevos códigos sin seeds",()=>{
  expect(perfilAjustesCrearSchema.safeParse({...perfil,precioLlanta:850}).success).toBe(false);
  expect(perfilAjustesCrearSchema.safeParse({...perfil,precioLlanta:850,cantidadLlantas:4.5}).success).toBe(false);
  for(const codigo of ["CAMION_1T","CAMION_12T"]) expect(perfilAjustesCrearSchema.safeParse({...perfil,codigo,precioLlanta:850,cantidadLlantas:4,viajesMes:20}).success).toBe(true);
 });
});
