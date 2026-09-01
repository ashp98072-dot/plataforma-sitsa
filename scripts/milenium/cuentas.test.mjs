import { test } from "node:test";
import assert from "node:assert/strict";
import { analizarCuentas, leerDbf } from "./cuentas.mjs";

// Todos los registros son ficticios; nunca se lee una base real desde las pruebas.
function dbf(campos, filas) {
  const inicio = 33 + 32 * campos.length;
  const largo = 1 + campos.reduce((sum, campo) => sum + campo[2], 0);
  const buffer = Buffer.alloc(inicio + largo * filas.length + 1);
  buffer[0] = 0x30; buffer[29] = 3;
  buffer.writeUInt32LE(filas.length, 4);
  buffer.writeUInt16LE(inicio, 8); buffer.writeUInt16LE(largo, 10);
  campos.forEach(([nombre, tipo, longitud], i) => {
    const p = 32 + i * 32;
    buffer.write(nombre, p, "ascii"); buffer[p + 11] = tipo.charCodeAt(0); buffer[p + 16] = longitud;
  });
  buffer[inicio - 1] = 13;
  filas.forEach((fila, i) => {
    const p = inicio + i * largo;
    buffer.fill(32, p, p + largo); buffer[p] = fila.borrada ? 42 : 32;
    let offset = 1;
    for (const [nombre, , longitud] of campos) {
      const valor = String(fila[nombre] ?? "");
      buffer.write(valor, p + offset, Math.min(valor.length, longitud), "latin1"); offset += longitud;
    }
  });
  buffer[buffer.length - 1] = 26;
  return buffer;
}
const camposCuenta = [["CODIGO_CTA", "C", 20], ["NOMBRE_CTA", "C", 60], ["TIPO_CTA", "N", 1], ["NIVEL_CTA", "N", 2], ["LINACTIVA_", "L", 1], ["CTACOM_CTA", "L", 1], ["MULTIP_CTA", "N", 2]];
const cuenta = { CODIGO_CTA: "001.01", NOMBRE_CTA: "Cuenta ficticia", TIPO_CTA: "1", NIVEL_CTA: "2", LINACTIVA_: "F", CTACOM_CTA: "T", MULTIP_CTA: "1" };
const empresas = (codigo = "01", nombre = "KUIQ ficticia") => dbf([["CODIGO_EMP", "C", 2], ["NOMBRE_EMP", "C", 40], ["RAZON_EMP", "C", 40]], [{ CODIGO_EMP: codigo, NOMBRE_EMP: nombre, RAZON_EMP: nombre }]);

test("conserva ceros iniciales y decodifica Windows-1252", () => {
  const buffer = dbf(camposCuenta, [{ ...cuenta, NOMBRE_CTA: "Depósito ficticio €" }]);
  // Euro no pertenece a Latin1: sustituir el byte sintético por Windows-1252 0x80.
  const prefijo = Buffer.from("Depósito ficticio ", "latin1");
  buffer[buffer.indexOf(prefijo) + prefijo.length] = 0x80;
  const data = leerDbf(buffer, { CODIGO_CTA: "C", NOMBRE_CTA: "C" });
  assert.equal(data.filas[0].CODIGO_CTA, "001.01");
  assert.equal(data.filas[0].NOMBRE_CTA, "Depósito ficticio €");
});
test("excluye borrados lógicos sin confundirlos con cuentas inactivas", () => {
  const r = analizarCuentas("KT", empresas(), dbf(camposCuenta, [cuenta, { ...cuenta, borrada: true }, { ...cuenta, CODIGO_CTA: "002", LINACTIVA_: "T" }]));
  assert.deepEqual(r.registros, { declarados: 3, vigentes: 2, marcados_borrados: 1, inactivos: 1 });
});
test("detecta códigos equivalentes sin modificar el origen", () => {
  const b = dbf(camposCuenta, [{ ...cuenta, CODIGO_CTA: "ábc" }, { ...cuenta, CODIGO_CTA: "ABC" }]);
  const copia = Buffer.from(b);
  assert.equal(analizarCuentas("KT", empresas(), b).incidencias.duplicado_normalizado, 1);
  assert.deepEqual(b, copia);
});
test("separa Mónaco actual e histórico y rechaza identidad equivocada", () => {
  const b = dbf(camposCuenta, [cuenta]);
  assert.equal(analizarCuentas("MONACO", empresas("08", "Mónaco ficticia"), b).origen.codigo, "08");
  assert.equal(analizarCuentas("MONACO_HISTORICO", empresas("00", "Mónaco ficticia"), b).origen.uso, "historico_separado");
  assert.throws(() => analizarCuentas("KT", empresas("08", "Mónaco ficticia"), b), /identidad/);
  assert.throws(() => analizarCuentas("toString", empresas(), b), /no admitida/);
});
test("FASE3-HOMOLOGACION: reporta distribución de CTACOM_CTA y MULTIP_CTA por valor, nunca por cuenta", () => {
  const filas = [
    { ...cuenta, CTACOM_CTA: "T", MULTIP_CTA: "1" },
    { ...cuenta, CODIGO_CTA: "002", CTACOM_CTA: "T", MULTIP_CTA: "-1" },
    { ...cuenta, CODIGO_CTA: "003", CTACOM_CTA: "F", MULTIP_CTA: "" },
  ];
  const r = analizarCuentas("KT", empresas(), dbf(camposCuenta, filas));
  assert.deepEqual(r.ctacom_origen, { true: 2, false: 1 });
  assert.deepEqual(r.multip_origen, { "1": 1, "-1": 1, sin_valor: 1 });
});
test("ningún informe contiene cuentas ni habilita una importación", () => {
  const r = analizarCuentas("KT", empresas(), dbf(camposCuenta, [cuenta]));
  assert.equal(r.listo_para_importar, false);
  assert.equal(JSON.stringify(r).includes(cuenta.CODIGO_CTA), false);
  assert.equal(JSON.stringify(r).includes(cuenta.NOMBRE_CTA), false);
});
test("reporta campos incompletos y nivel inválido", () => {
  const r = analizarCuentas("KT", empresas(), dbf(camposCuenta, [{ ...cuenta, CODIGO_CTA: "", NOMBRE_CTA: "", NIVEL_CTA: "0", LINACTIVA_: "?" }]));
  assert.equal(r.incidencias.codigo_vacio, 1);
  assert.equal(r.incidencias.nombre_vacio, 1);
  assert.equal(r.incidencias.nivel_invalido, 1);
  assert.equal(r.incidencias.estado_desconocido, 1);
});
test("rechaza DBF truncado, longitud incorrecta y marca desconocida", () => {
  const b = dbf(camposCuenta, [cuenta]);
  assert.throws(() => leerDbf(b.subarray(0, b.length - 10), {}), /incompleto/);
  const largo = Buffer.from(b); largo.writeUInt16LE(1, 10);
  assert.throws(() => leerDbf(largo, {}), /inconsistente/);
  const marca = Buffer.from(b); marca[marca.readUInt16LE(8)] = 0;
  assert.throws(() => leerDbf(marca, {}), /Marca/);
});
test("rechaza codificación, versión y campos no soportados", () => {
  const b = dbf(camposCuenta, [cuenta]);
  for (const offset of [0, 29]) {
    const copia = Buffer.from(b); copia[offset] = 0;
    assert.throws(() => leerDbf(copia, {}), /no verificada/);
  }
  assert.throws(() => leerDbf(b, { AUSENTE: "C" }), /no compatible/);
  assert.throws(() => leerDbf(b, { CODIGO_CTA: "N" }), /no compatible/);
  const nullable = Buffer.from(b); nullable[32 + 18] = 2;
  assert.throws(() => leerDbf(nullable, { CODIGO_CTA: "C" }), /no compatible/);
});
test("rechaza números o lógicos dañados sin publicar valores del registro", () => {
  assert.throws(() => analizarCuentas("KT", empresas(), dbf(camposCuenta, [{ ...cuenta, NIVEL_CTA: "xx" }])), /Número DBF inválido/);
  assert.throws(() => analizarCuentas("KT", empresas(), dbf(camposCuenta, [{ ...cuenta, LINACTIVA_: "x" }])), /Lógico DBF inválido/);
});
