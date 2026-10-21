import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
it("catalogo depende de empresa, efecto separado de filtros y refresh explicito tras guardar", () => {
  const text=readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx","utf8");
  const source=ts.createSourceFile("page.tsx",text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const efectos: ts.CallExpression[]=[];
  const callbacks: ts.VariableDeclaration[]=[];
  function visit(n:ts.Node) {
    if(ts.isCallExpression(n) && n.expression.getText(source)==="useEffect") efectos.push(n);
    if(ts.isVariableDeclaration(n) && n.name.getText(source)==="cargarSupervisores") callbacks.push(n);
    ts.forEachChild(n,visit);
  }
  visit(source);
  const catalogo=efectos.filter(e=>e.arguments[0]?.getText(source).includes("void cargarSupervisores()"));
  expect(catalogo).toHaveLength(1);
  expect(catalogo[0].arguments[1].getText(source)).toBe("[cargarSupervisores]");
  expect(catalogo[0].arguments[0].getText(source)).not.toContain("void cargar()");
  const cb=callbacks[0].initializer as ts.CallExpression;
  expect(cb.arguments[1].getText(source)).toBe("[slug]");
  expect(text).toContain("await cargarSupervisores();");
});
