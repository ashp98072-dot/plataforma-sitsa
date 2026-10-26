import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
const read = (name: string) => readFileSync(`sql/${name}-2026-10-cb2-documentos-fase2.sql`, "utf8");
const paso = (name: string) => readFileSync(`sql/migrate-2026-10-cb2-documentos-fase2-${name}.sql`, "utf8");
const intermedio = () => readFileSync("sql/verificar-2026-10-cb2-documentos-fase2-paso1.sql", "utf8");
const codigo = (s: string) => s.replace(/--[^\n]*/g, "");
it("preflight y postcheck contienen solo sentencias de lectura (no se ejecutan)", () => {
    for (const archivo of [read("preflight"), intermedio(), read("postcheck")]) {
        const sql = codigo(archivo);
        for (const sentencia of sql.split(";").map(s => s.trim()).filter(Boolean)) expect(sentencia).toMatch(/^(SELECT|SHOW)\s/i);
    }
});
it("DDL mínimo: revisión, unicidad de clave, FK compuesta y controles MariaDB", () => {
    const sql = paso("paso1-revision") + paso("paso2-operaciones");
    expect(sql).toContain("revision_documental INT NOT NULL DEFAULT 0");
    expect(sql).toContain("UNIQUE KEY uq_cb2do_clave (empresa_id,proveedor_id,clave)");
    expect(sql).toContain("FOREIGN KEY (empresa_id,proveedor_id,factura_id)");
    expect(sql).toContain("REFERENCES flota_cb2_facturas(empresa_id,proveedor_id,id)");
    expect(sql).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
    expect(sql).toContain("JSON_VALID(resultado)"); expect(sql).toContain("revision_resultante=revision_esperada+1");
    expect(sql).toContain("ENGINE=InnoDB");
    expect(sql.replace(/--[^\n]*/g, "")).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\s+(flota_cb2_consumos|flota_cb2_filas|flota_cb2_importaciones)/i);
});
it("cada envío DDL contiene una sola sentencia ordinaria sin delimitadores ni bloques", () => {
    for (const [nombre, inicio] of [["paso1-revision", "ALTER TABLE"], ["paso2-operaciones", "CREATE TABLE"]]) {
        const sql = codigo(paso(nombre)).trim();
        expect(sql.startsWith(inicio)).toBe(true);
        expect(sql.split(";").filter(s => s.trim())).toHaveLength(1);
        expect(sql).not.toMatch(/\b(DELIMITER|BEGIN|SIGNAL|PREPARE|IF\s+NOT\s+EXISTS|OR\s+REPLACE)\b/i);
        expect(paso(nombre)).toContain("PARAR");
    }
});
it("el manifiesto no ejecuta SQL y la parada intermedia comprueba revisión y ausencia de operaciones", () => {
    expect(codigo(read("migrate")).trim()).toBe("");
    expect(intermedio()).toContain("SHOW CREATE TABLE flota_cb2_facturas");
    expect(intermedio()).toContain("tabla_operaciones_existente");
    expect(intermedio()).toContain("ck_cb2f_revision_documental");
    expect(intermedio()).toContain("@@check_constraint_checks");
    expect(intermedio()).toContain("fk_cb2do_factura");
});
