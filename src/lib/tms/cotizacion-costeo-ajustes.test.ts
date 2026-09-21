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
