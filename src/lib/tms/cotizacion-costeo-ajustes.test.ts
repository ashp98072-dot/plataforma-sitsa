import { describe,expect,it,vi } from "vitest";
vi.mock("@/lib/db",()=>({getPool:vi.fn(),query:vi.fn()}));
vi.mock("@/lib/auditoria",()=>({registrarAuditoriaTx:vi.fn()}));
import { getPool } from "@/lib/db";
import { actualizarPerfilAjustes,crearPerfilAjustes,crearParametrosAjustes,parametrosAjustesSchema,perfilAjustesCrearSchema } from "./cotizacion-costeo-ajustes";
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
 it("rechaza gastos parciales, salario global no permitido y seguro anual sin flota",()=>{
  for(const extra of [{gastosAdministracion:100},{salarioPilotoMensual:4000},{seguroMercaderiaAnual:70000},{cantidadCamiones:1.5},{margenObjetivo:6},{viajesAnuales:1e10}]) expect(parametrosAjustesSchema.safeParse({...base,...extra}).success).toBe(false);
 });
 it("acepta valores conocidos completos y nunca inventa costos al faltar campos nuevos",()=>{
  expect(parametrosAjustesSchema.safeParse({...base,gastosAdministracion:100,gastosMantenimiento:0,gastosSeguridad:0,gastosPredios:0,cantidadCamiones:46,diasGastosMes:20,seguroMercaderiaAnual:70000,viajesAnuales:240,diasLaboralesMes:20,margenObjetivo:.45}).success).toBe(true);
  const r=parametrosAjustesSchema.parse(base);expect(r.seguroMercaderiaAnual).toBeUndefined();
 });
 it("llantas desglosadas requieren precio/cantidad entera; admite nuevos códigos sin seeds",()=>{
  expect(perfilAjustesCrearSchema.safeParse({...perfil,precioLlanta:850}).success).toBe(false);
  expect(perfilAjustesCrearSchema.safeParse({...perfil,precioLlanta:850,cantidadLlantas:4.5}).success).toBe(false);
  for(const codigo of ["CAMION_1T","CAMION_12T"]) expect(perfilAjustesCrearSchema.safeParse({...perfil,codigo,precioLlanta:850,cantidadLlantas:4,viajesMes:20}).success).toBe(true);
 });
});

describe("Persistencia de salarios por perfil (DB mock)",()=>{
 function conexion(){
  const conn={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),query:vi.fn(async()=>[[{codigo:"CAMION_5T",activo:1}]]),execute:vi.fn(async(sql:string,valores:unknown[])=>{void sql;void valores;return [{insertId:8}];})};
  vi.mocked(getPool).mockReturnValue({getConnection:async()=>conn} as never);
  return conn;
 }
 it("INSERT del perfil guarda ambos salarios propios y conserva cardinalidad columnas/placeholders/parámetros",async()=>{
  const conn=conexion();
  await crearPerfilAjustes(1,"admin",{...perfil,salarioPilotoMensual:4000,salarioAuxiliarMensual:3000});
  const [sql,values]=conn.execute.mock.calls[0];
  const columnas=sql.match(/\(([^)]+)\)\s*VALUES/)![1].split(",").map(x=>x.trim());
  expect(columnas).toHaveLength(values.length);expect(sql.match(/\?/g)).toHaveLength(values.length);
  expect(values[columnas.indexOf("salario_piloto_mensual")]).toBe("4000.00");
  expect(values[columnas.indexOf("salario_auxiliar_mensual")]).toBe("3000.00");
  expect(values[0]).toBe(1);expect(conn.commit).toHaveBeenCalled();
 });
 it("UPDATE se limita al tenant/id; editar 5T nunca cambia los salarios del 10T",async()=>{
  const conn=conexion(),salarios=new Map([[5,4000],[10,6000]]);
  conn.execute.mockImplementation(async(sql,values)=>{
   expect(sql).toContain("WHERE empresa_id=? AND id=?");
   expect(values.slice(-2)).toEqual([1,5]);
   const columnas=sql.split(" SET ")[1].split(" WHERE ")[0].split(",").map(x=>x.split("=")[0]);
   salarios.set(Number(values.at(-1)),Number(values[columnas.indexOf("salario_piloto_mensual")]));
   return [{insertId:0}];
  });
  const {codigo,...input}=perfil;void codigo;
  await actualizarPerfilAjustes(1,5,"admin",{...input,salarioPilotoMensual:4500,salarioAuxiliarMensual:null});
  expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("empresa_id=? AND id=? FOR UPDATE"),[1,5]);
  expect(salarios.get(5)).toBe(4500);expect(salarios.get(10)).toBe(6000);
 });
 it("vigencia global conserva un margen y ningún salario mensual; INSERT coincide con sus parámetros",async()=>{
  const conn=conexion();
  await crearParametrosAjustes(1,"admin",{vigenteDesde:"2026-10-03",precioCombustibleGalon:49.8,ivaTasa:.12,costoPilotoDia:200,costoAuxiliarDia:150,viaticoPilotoDia:0,viaticoAuxiliarDia:0,viaticoGuiaDia:0,hotelDia:null,margenObjetivo:.45,diasLaboralesMes:20});
  const [sql,values]=conn.execute.mock.calls[0];
  expect(sql.match(/\?/g)).toHaveLength(values.length);
  expect(sql.match(/\(([^)]+)\)\s*VALUES/)![1].split(",")).toHaveLength(values.length);
  expect(sql).not.toMatch(/salario_/);
  expect(sql.match(/margen_objetivo/g)).toHaveLength(1);
 });
 it("salarios del perfil son opcionales/no negativos y no exceden DECIMAL(12,2)",()=>{
  for(const valores of [{salarioPilotoMensual:4000,salarioAuxiliarMensual:3000},{salarioPilotoMensual:null,salarioAuxiliarMensual:null}])expect(perfilAjustesCrearSchema.safeParse({...perfil,...valores}).success).toBe(true);
  for(const valor of [-1,1e10,Infinity])expect(perfilAjustesCrearSchema.safeParse({...perfil,salarioPilotoMensual:valor}).success).toBe(false);
 });
});

describe("viaticos_hotel_viaje del perfil (Cotizador 2026)",()=>{
 function conexion(){
  const conn={beginTransaction:vi.fn(),commit:vi.fn(),rollback:vi.fn(),release:vi.fn(),query:vi.fn(async()=>[[{codigo:"CAMION_5T",activo:1}]]),execute:vi.fn(async(sql:string,valores:unknown[])=>{void sql;void valores;return [{insertId:8}];})};
  vi.mocked(getPool).mockReturnValue({getConnection:async()=>conn} as never);
  return conn;
 }
 it("es opcional, no negativo y no excede DECIMAL(12,2); 0 es un valor válido distinto de vacío",()=>{
  for(const v of [null,undefined,0,200,300.5])expect(perfilAjustesCrearSchema.safeParse({...perfil,viaticosHotelViaje:v}).success).toBe(true);
  for(const v of [-1,1e10,Infinity,NaN])expect(perfilAjustesCrearSchema.safeParse({...perfil,viaticosHotelViaje:v}).success).toBe(false);
 });
 it("INSERT lo persiste como texto DECIMAL y cuadran columnas, placeholders y parámetros",async()=>{
  const conn=conexion();
  await crearPerfilAjustes(1,"admin",{...perfil,viaticosHotelViaje:300});
  const [sql,values]=conn.execute.mock.calls[0];
  const columnas=sql.match(/\(([^)]+)\)\s*VALUES/)![1].split(",").map(x=>x.trim());
  expect(columnas).toContain("viaticos_hotel_viaje");
  expect(columnas).toHaveLength(values.length);expect(sql.match(/\?/g)).toHaveLength(values.length);
  expect(values[columnas.indexOf("viaticos_hotel_viaje")]).toBe("300.00");
 });
 it("sin valor se guarda NULL (no 0): «sin configurar» no es un monto inventado",async()=>{
  const conn=conexion();
  await crearPerfilAjustes(1,"admin",{...perfil});
  const [sql,values]=conn.execute.mock.calls[0];
  const columnas=sql.match(/\(([^)]+)\)\s*VALUES/)![1].split(",").map(x=>x.trim());
  expect(values[columnas.indexOf("viaticos_hotel_viaje")]).toBeNull();
 });
 it("UPDATE lo escribe solo en el perfil indicado (empresa_id + id) y conserva los demás campos",async()=>{
  const conn=conexion();
  const {codigo,...input}=perfil;void codigo;
  await actualizarPerfilAjustes(1,5,"admin",{...input,viaticosHotelViaje:200,salarioPilotoMensual:6787.69});
  const [sql,values]=conn.execute.mock.calls[0];
  expect(sql).toContain("viaticos_hotel_viaje=?");expect(sql).toContain("WHERE empresa_id=? AND id=?");
  const columnas=sql.split(" SET ")[1].split(" WHERE ")[0].split(",").map(x=>x.split("=")[0]);
  expect(values[columnas.indexOf("viaticos_hotel_viaje")]).toBe("200.00");
  expect(values.slice(-2)).toEqual([1,5]);
 });
});
