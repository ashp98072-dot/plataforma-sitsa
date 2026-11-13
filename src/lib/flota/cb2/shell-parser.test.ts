import { it,expect } from "vitest";
import { analizar } from "./model";
import { filaShell,libroShell } from "./fixture";
it("parser 3 captura sucursal sin reinterpretar originales v1/v2 ni cambiar identidad Shell",async()=>{
 const buffer=await libroShell([filaShell("VERSION-SHELL")]);
 const v1=(await analizar(buffer,"SHELL","GTQ",1)).find(l=>l.clave)!;
 const v2=(await analizar(buffer,"SHELL","GTQ",2)).find(l=>l.clave)!;
 const v3=(await analizar(buffer,"SHELL","GTQ",3)).find(l=>l.clave)!;
 expect(v1.fila.textos.auxiliar).toBe("");expect(v2.fila.textos.auxiliar).toBe("");
 expect(v3.fila.textos.auxiliar).toBe("Sucursal sintetica / observacion");
 expect(v3.fila.celdas).toEqual(v2.fila.celdas);
 expect(v3.clave).toBe(v2.clave);expect(v3.payload).toBe(v2.payload);expect(v3.huella).toBe(v2.huella);
});
