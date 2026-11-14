import {it,expect} from "vitest";import {unidadesTmsVisibles} from "./unidad-canonica-catalogo";
it("una opción por identidad aprobada, acceso vigente y IDs TMS históricos intactos",()=>{
 const unidades=[{id:1,flota_vehiculo_id:1300},{id:2,flota_vehiculo_id:651},{id:3,flota_vehiculo_id:999},{id:4,flota_vehiculo_id:null},{id:5,flota_vehiculo_id:null}];const antes=structuredClone(unidades);
 expect(unidadesTmsVisibles(unidades,[{id:651,identidadCanonica:'FISICA:1',equivalenciasHistoricas:[651,1300]}]).map(u=>u.id)).toEqual([2,4,5]);expect(unidades).toEqual(antes);
 expect(unidadesTmsVisibles(unidades,[{id:651},{id:1300}]).map(u=>u.id)).toEqual([1,2,4,5]);
});
