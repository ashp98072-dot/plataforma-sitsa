import { readFileSync } from "node:fs";import { join } from "node:path";import { describe,expect,it } from "vitest";import type { ParametroAjustes, PerfilAjustes } from "@/lib/tms/cotizacion-costeo-ajustes";import { CAMPOS_EXCEL_PARAMETROS } from "@/lib/tms/cotizacion-costeo-excel-campos";import { gruposPerfil,mostrarThermoPerfil,formPerfil,payloadPerfil,decimalAPorcentaje,formularioNuevaVigencia,porcentajeADecimal,ultimaVigencia,OPCIONES_BANDERA_PERFIL,CAMPOS_BANDERA_PERFIL } from "./cotizacion-ajustes-client";
const src=readFileSync(join(__dirname,"cotizacion-ajustes-client.tsx"),"utf8");
describe("UI ajustes de costeo",()=>{
 it("convierte porcentajes de UI a fracción persistida y viceversa",()=>{expect(porcentajeADecimal("12")).toBe(.12);expect(decimalAPorcentaje(.2)).toBe("20");});
 it("crea vigencias por POST y nunca actualiza ni elimina historial",()=>{expect(src).toContain('/ajustes/parametros`');expect(src).toContain('method:"POST"');expect(src).not.toContain('method:"DELETE"');});
 it("presenta advertencia de impacto futuro",()=>expect(src).toContain("Los cambios aplican a nuevos cálculos"));
});

// "Nueva vigencia" se precarga desde la ÚLTIMA vigencia disponible (incluida una futura ya programada),
// nunca desde la "Vigencia actual" del badge: si no, al programar 2026-11-01 se copiaría 2026-09-21 y se
// perdería 2026-10-01.
const vigencia=(id:number,vigenteDesde:string,combustible:number,over:Partial<ParametroAjustes>={}):ParametroAjustes=>({
 id,vigenteDesde,precioCombustibleGalon:combustible,ivaTasa:.12,costoPilotoDia:207.74,costoAuxiliarDia:148.04,viaticoPilotoDia:200,viaticoAuxiliarDia:200,viaticoGuiaDia:125,hotelDia:null,margenObjetivo:.2,
 creadoPor:"admin",creadoEn:"2026-09-21 10:00:00",esVigenciaActual:false,...over});
// Mismo orden que devuelve el servidor: ORDER BY vigente_desde DESC, id DESC.
const ACTUAL=vigencia(1,"2026-09-21",29.89,{esVigenciaActual:true});
const FUTURA=vigencia(2,"2026-10-01",31.5,{esVigenciaActual:false,ivaTasa:.15,costoPilotoDia:250,hotelDia:300,margenObjetivo:.25});
describe("Nueva vigencia: plantilla = última vigencia disponible",()=>{
 it("con una vigencia actual y una futura, precarga la FUTURA (31.50) y no la actual (29.89)",()=>{
  const parametros=[FUTURA,ACTUAL];
  const form=formularioNuevaVigencia(ultimaVigencia(parametros),"2026-09-25");
  expect(Number(form.precioCombustibleGalon)).toBe(31.5);
  expect(form.precioCombustibleGalon).not.toBe("29.89");
 });
 it("copia TODOS los campos de la última vigencia (no una mezcla con la actual)",()=>{
  const form=formularioNuevaVigencia(ultimaVigencia([FUTURA,ACTUAL]),"2026-11-01");
  expect(form).toMatchObject({vigenteDesde:"2026-11-01",precioCombustibleGalon:"31.5",ivaTasa:"15",costoPilotoDia:"250",costoAuxiliarDia:"148.04",viaticoPilotoDia:"200",viaticoAuxiliarDia:"200",viaticoGuiaDia:"125",hotelDia:"300",margenObjetivo:"25"});
  expect(form.seguroMercaderiaAnual).toBe("");
 });
 it("solo con la vigencia actual, la plantilla es esa misma",()=>{
  expect(Number(formularioNuevaVigencia(ultimaVigencia([ACTUAL]),"2026-11-01").precioCombustibleGalon)).toBe(29.89);
 });
 it("la fecha inicial del formulario es hoy, no la de la plantilla",()=>{
  expect(formularioNuevaVigencia(ultimaVigencia([FUTURA,ACTUAL]),"2026-09-25").vigenteDesde).toBe("2026-09-25");
 });
 it("sin vigencias: no hay plantilla y el formulario queda con valores vacíos/0 (sin error)",()=>{
  expect(ultimaVigencia([])).toBeUndefined();expect(ultimaVigencia(undefined)).toBeUndefined();
  expect(formularioNuevaVigencia(ultimaVigencia([]),"2026-09-25")).toMatchObject({vigenteDesde:"2026-09-25",precioCombustibleGalon:"",ivaTasa:"",costoPilotoDia:"0",costoAuxiliarDia:"0",viaticoPilotoDia:"0",viaticoAuxiliarDia:"0",viaticoGuiaDia:"0",hotelDia:"",margenObjetivo:""});
 });
 it("el componente precarga desde ultimaVigencia y ya no depende de esVigenciaActual para la plantilla",()=>{
  expect(src).toContain("ultimaVigencia(datos?.parametros)");expect(src).toContain("formularioNuevaVigencia(plantillaVigencia");
  expect(src).not.toMatch(/plantillaVigencia\s*=.*find\(p=>p\.esVigenciaActual\)/);
 });
 it("el badge 'Vigencia actual' se sigue determinando por la marca del servidor en cada fila (sin cambios)",()=>{
  expect(src).toContain('{p.esVigenciaActual&&<span className="rounded bg-emerald-800 px-1">Vigencia actual</span>}');
 });
});
describe("Ajustes Excel 2026",()=>{
 it("la nueva plantilla copia también globales y margen objetivo sin alterar la vigencia",()=>{
  const p=vigencia(3,"2026-10-02",49.8,{margenObjetivo:.45,seguroMercaderiaAnual:70000,cantidadCamiones:46});
  expect(formularioNuevaVigencia(p,"2026-10-03")).toMatchObject({margenObjetivo:"45",seguroMercaderiaAnual:"70000",cantidadCamiones:"46",precioCombustibleGalon:"49.8"});
  expect(p.margenObjetivo).toBe(.45);
 });
 it("perfil agrupado y derivados de solo lectura; 1T/12T configurables sin sembrar importes",()=>{
  for(const etiqueta of ["Identificación","Operación","Mantenimiento","Seguro","Depreciación","Personal","Refrigeración / Thermo","GPS/viaje:","Aceite/km:","Llantas/km:","Seguro/día:","Depreciación/día:"]) expect(src).toContain(etiqueta);
  expect(src).toContain('CODIGOS_PERFIL_COSTEO.map');
 });
 it("PERSONAL pertenece al perfil; formulario/payload conservan salarios propios sin mutar otro perfil",()=>{
  const base={id:5,codigo:"CAMION_5T",nombre:"5T",activo:true,creadoPor:null,creadoEn:"",actualizadoEn:"",costoAdquisicion:null,diasOperacionMes:26,gpsMensual:0,seguroVehiculoMensual:0,costoAceiteServicio:0,vidaUtilAceiteKm:5000,costoJuegoLlantas:0,vidaUtilLlantasKm:50000,rendimientoKmGalon:10,deprecValorBase:null,deprecAnios:null,deprecDiasOperacionMes:null,refrigValorBase:null,refrigAnios:null,refrigDiasOperacionMes:null,salarioPilotoMensual:4000,salarioAuxiliarMensual:3000} satisfies PerfilAjustes;
  const otro={...base,id:10,codigo:"CAMION_10T",salarioPilotoMensual:6000};
  const form=formPerfil(base);
  expect(payloadPerfil({...form,salarioPilotoMensual:"4500"})).toMatchObject({salarioPilotoMensual:4500,salarioAuxiliarMensual:3000});
  expect(formPerfil(otro).salarioPilotoMensual).toBe("6000");
  expect(base.salarioPilotoMensual).toBe(4000);
  expect(formularioNuevaVigencia(ACTUAL,"2026-10-03")).not.toHaveProperty("salarioPilotoMensual");
  // Los tres datos de PERSONAL se piden en el propio perfil (grupo «Personal»).
  expect(gruposPerfil(form).find(([g])=>g==="Personal")?.[1]).toEqual(["salarioPilotoMensual","salarioAuxiliarMensual","auxiliarMultiplicaDias","viaticosHotelViaje","viaticosHotelMultiplicaDias"]);
 });
});

// Paridad Cotizador 2026: perfil simplificado (§7/§8) y parámetros globales sin los campos del modelo anterior.
const perfilBase={id:5,codigo:"CAMION_5T",nombre:"5T",activo:true,creadoPor:null,creadoEn:"",actualizadoEn:"",costoAdquisicion:182142.86,diasOperacionMes:30,gpsMensual:100,seguroVehiculoMensual:1150,costoAceiteServicio:1750,vidaUtilAceiteKm:5000,costoJuegoLlantas:6900,vidaUtilLlantasKm:50000,rendimientoKmGalon:17,deprecValorBase:182142.86,deprecAnios:5,deprecDiasOperacionMes:26,refrigValorBase:null,refrigAnios:null,refrigDiasOperacionMes:null,salarioPilotoMensual:6787.69,salarioAuxiliarMensual:6039.97,viaticosHotelViaje:300,viajesMes:20,precioLlanta:1150,cantidadLlantas:6} satisfies PerfilAjustes;
const visibles=(f:ReturnType<typeof formPerfil>)=>gruposPerfil(f).flatMap(([,c])=>c);
describe("Perfil de unidad — modelo Cotizador 2026",()=>{
 it("muestra exactamente los datos del libro, agrupados como pide el ticket",()=>{
  const g=gruposPerfil(formPerfil(perfilBase));
  expect(g.map(([n])=>n)).toEqual(["Identificación","Operación","Mantenimiento","Seguro","Depreciación","Personal"]);
  expect(Object.fromEntries(g)).toMatchObject({
   "Identificación":["codigo","nombre"],"Operación":["rendimientoKmGalon","gpsMensual","viajesMes"],
   "Mantenimiento":["costoAceiteServicio","vidaUtilAceiteKm","precioLlanta","cantidadLlantas","vidaUtilLlantasKm"],
   "Seguro":["seguroVehiculoMensual"],"Depreciación":["deprecValorBase","deprecAnios"],"Personal":["salarioPilotoMensual","salarioAuxiliarMensual","auxiliarMultiplicaDias","viaticosHotelViaje","viaticosHotelMultiplicaDias"]});
 });
 it("oculta los campos de respaldo histórico (no se piden ni se duplican)",()=>{
  const v=visibles(formPerfil(perfilBase));
  for(const oculto of ["costoAdquisicion","diasOperacionMes","costoJuegoLlantas","deprecDiasOperacionMes"]) expect(v).not.toContain(oculto);
 });
 it("«Valor del camión (Q)» es UN solo campo y es el que alimenta la depreciación (deprecValorBase)",()=>{
  expect(src).toContain('deprecValorBase:"Valor del camión (Q)"');
  expect(src).not.toContain("Costo adquisición");expect(src).not.toContain("Valor vehículo (Q)");
  const f=formPerfil({...perfilBase,deprecValorBase:150000});
  expect(payloadPerfil(f).deprecValorBase).toBe(150000);
  expect(payloadPerfil(f).costoAdquisicion).toBe(182142.86); // histórico: se conserva, no se vuelve a pedir
 });
 it("Thermo solo aparece en perfiles refrigerados/personalizados; en los normales queda oculto pero se conserva",()=>{
  expect(mostrarThermoPerfil(formPerfil(perfilBase))).toBe(false);
  expect(gruposPerfil(formPerfil(perfilBase)).some(([n])=>n==="Refrigeración / Thermo")).toBe(false);
  expect(mostrarThermoPerfil(formPerfil({...perfilBase,codigo:"CAMION_5T_REFRIGERADO"}))).toBe(true);
  const conThermo=formPerfil({...perfilBase,refrigValorBase:100000,refrigAnios:5,refrigDiasOperacionMes:26});
  expect(gruposPerfil(conThermo).some(([n])=>n==="Refrigeración / Thermo")).toBe(true);
  expect(payloadPerfil(conThermo)).toMatchObject({refrigValorBase:100000,refrigAnios:5,refrigDiasOperacionMes:26});
 });
 it("al guardar, los respaldos internos quedan coherentes: juego = precio × cantidad y divisor de depreciación completo",()=>{
  const f={...formPerfil(perfilBase),precioLlanta:"750",cantidadLlantas:"4",deprecDiasOperacionMes:""};
  expect(payloadPerfil(f)).toMatchObject({precioLlanta:750,cantidadLlantas:4,costoJuegoLlantas:3000,deprecDiasOperacionMes:26});
  // Sin desglose se conserva el juego histórico; sin valor de camión no se inventa un divisor.
  expect(payloadPerfil({...f,precioLlanta:"",cantidadLlantas:"",costoJuegoLlantas:"5500"}).costoJuegoLlantas).toBe(5500);
  expect(payloadPerfil({...f,deprecValorBase:"",deprecAnios:""}).deprecDiasOperacionMes).toBeNull();
 });
 it("«Viáticos y hotel por viaje» viaja al servidor y se lee del perfil (vacío = NULL, no 0)",()=>{
  expect(payloadPerfil(formPerfil(perfilBase)).viaticosHotelViaje).toBe(300);
  expect(formPerfil({...perfilBase,viaticosHotelViaje:null}).viaticosHotelViaje).toBe("");
  expect(payloadPerfil(formPerfil({...perfilBase,viaticosHotelViaje:null})).viaticosHotelViaje).toBeNull();
  expect(payloadPerfil({...formPerfil(perfilBase),viaticosHotelViaje:"0"}).viaticosHotelViaje).toBe(0); // 0 configurado es 0
 });
 it("las banderas por perfil «se cobra por cada día de servicio» se editan, se guardan y distinguen NULL / true / false",()=>{
  const sin=formPerfil(perfilBase);
  expect(sin.auxiliarMultiplicaDias).toBe("");
  expect(sin.viaticosHotelMultiplicaDias).toBe("");
  expect(payloadPerfil(sin)).toMatchObject({auxiliarMultiplicaDias:null,viaticosHotelMultiplicaDias:null});
  const si=formPerfil({...perfilBase,auxiliarMultiplicaDias:true,viaticosHotelMultiplicaDias:false});
  expect([si.auxiliarMultiplicaDias,si.viaticosHotelMultiplicaDias]).toEqual(["1","0"]);
  expect(payloadPerfil(si)).toMatchObject({auxiliarMultiplicaDias:true,viaticosHotelMultiplicaDias:false}); // false es una configuración, no «vacío»
  expect(payloadPerfil({...si,auxiliarMultiplicaDias:"",viaticosHotelMultiplicaDias:"1"})).toMatchObject({auxiliarMultiplicaDias:null,viaticosHotelMultiplicaDias:true});
  expect(OPCIONES_BANDERA_PERFIL).toEqual([["","Sin configurar"],["1","Sí"],["0","No"]]);
  expect(CAMPOS_BANDERA_PERFIL).toEqual(["auxiliarMultiplicaDias","viaticosHotelMultiplicaDias"]);

  expect(src).toContain("Auxiliar se cobra por cada día de servicio");
  expect(src).toContain("Viáticos y hotel se cobran por cada día de servicio");
 });
 it("un perfil NUEVO arranca con defaults válidos en los campos ocultos (el esquema los exige)",()=>{
  const p=payloadPerfil({...formPerfil(perfilBase),codigo:"X",nombre:"X"} as ReturnType<typeof formPerfil>);
  expect(Number.isFinite(p.diasOperacionMes)).toBe(true);
  expect(src).toContain('diasOperacionMes:"30"');
 });
});
describe("Parámetros económicos — solo lo que existe en el Cotizador 2026",()=>{
 it("el formulario de vigencia ya no pide piloto/auxiliar/viáticos/hotel por día, pero los conserva internamente",()=>{
  for(const oculto of ["Piloto/día","Auxiliar/día","Viático piloto/día","Viático auxiliar/día","Viático guía/día","Hotel/persona/día"]) expect(src).not.toContain(oculto);
  for(const visible of ["Precio combustible predeterminado","IVA (%)","Margen objetivo único (%)"]) expect(src).toContain(visible);
  const form=formularioNuevaVigencia(ACTUAL,"2026-10-03");
  expect(form).toMatchObject({costoPilotoDia:"207.74",costoAuxiliarDia:"148.04",viaticoPilotoDia:"200",viaticoAuxiliarDia:"200",viaticoGuiaDia:"125"}); // fallback histórico intacto
  expect(src).toContain("costoPilotoDia:numero(pa.costoPilotoDia)"); // se siguen enviando (el esquema los exige)
 });
 it("sigue exponiendo los globales del libro (seguro anual, flota, viajes, días, gastos)",()=>{
  for(const c of ["seguroMercaderiaAnual","cantidadCamiones","viajesAnuales","diasDepreciacionMes","diasGastosMes","gastosAdministracion","gastosMantenimiento","gastosSeguridad","gastosPredios","diasLaboralesMes"]) expect(CAMPOS_EXCEL_PARAMETROS.map(x=>x.key)).toContain(c);
  expect(src).toContain("<CamposExcel campos={CAMPOS_EXCEL_PARAMETROS}");
 });
});
