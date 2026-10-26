import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
const read = (name: string) => readFileSync(`sql/${name}-2026-10-cb2-documentos-fase2.sql`, "utf8");
it("preflight y postcheck contienen solo sentencias de lectura (no se ejecutan)", () => {
    for (const name of ["preflight", "postcheck"]) {
        const sql = read(name).replace(/--[^\n]*/g, "");
        for (const sentencia of sql.split(";").map(s => s.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(SELECT|SHOW)\s/i);
    }
});
it("DDL mínimo: revisión, unicidad de clave, FK compuesta y controles MariaDB", () => {
    const sql = read("migrate");
    expect(sql).toContain("revision_documental INT NOT NULL DEFAULT 0");
    expect(sql).toContain("UNIQUE KEY uq_cb2do_clave (empresa_id,proveedor_id,clave)");
    expect(sql).toContain("FOREIGN KEY (empresa_id,proveedor_id,factura_id)");
    expect(sql).toContain("REFERENCES flota_cb2_facturas(empresa_id,proveedor_id,id)");
    expect(sql).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
    expect(sql).toContain("JSON_VALID(resultado)"); expect(sql).toContain("revision_resultante=revision_esperada+1");
    expect(sql).toContain("ENGINE=InnoDB");
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\s+(flota_cb2_consumos|flota_cb2_filas|flota_cb2_importaciones)/i);
});
