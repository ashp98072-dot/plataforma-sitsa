/** Static audit only: reads source/Git, never imports application code or opens DB. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const ref = args[0] && args[0] !== "--output" ? args.shift() : undefined;
const output = args[0] === "--output" && args.length === 2 ? args[1] : undefined;
if (args.length && !output) throw new Error("Usage: sandbox-inventory.mjs [SHA] [--output FILE]");
if (ref && !/^[a-f0-9]{40}$/.test(ref)) throw new Error("Expected full commit SHA.");
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const files = [...new Set((ref
  ? git(["ls-tree", "-r", "--name-only", "-z", ref, "--", "src", "scripts"])
  : git(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "scripts"]))
  .split("\0").filter((p) => /\.(?:[cm]?[jt]s|tsx)$/.test(p) && !/\.test\./.test(p)))].sort();
const result = { source: ref ?? "working-tree", filesScanned: files.length, driverImports: [], dbConsumers: [], constructors: [], checkouts: [], subprocesses: [], configLoaders: [], runtimeAssertions: {} };
for (const file of files) {
  const source = ref ? git(["show", `${ref}:${file}`]) : readFileSync(join(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const childSymbols = new Set(), childNamespaces = new Set();
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || !["child_process", "node:child_process"].includes(node.moduleSpecifier.text)) continue;
    if (node.importClause?.name) childNamespaces.add(node.importClause.name.text);
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) childNamespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) childSymbols.add(item.name.text);
  }
  const at = (node) => ({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text, clause = node.importClause;
      const typeOnly = clause?.isTypeOnly || (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) {
        if (/^(?:mysql2|mysql|mariadb|pg|postgres|sqlite3|better-sqlite3|knex|sequelize|@prisma\/client)(?:\/|$)/.test(specifier)) result.driverImports.push({ ...at(node), module: specifier });
        const target = specifier.startsWith(".") ? posix.normalize(posix.join(dirname(file).replaceAll("\\", "/"), specifier)) : specifier;
        if (["@/lib/db", "src/lib/db", "src/lib/db.ts"].includes(target)) result.dbConsumers.push({ ...at(node), module: specifier, bindings: clause?.getText(ast) });
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression, name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (["createConnection", "createPool"].includes(name)) result.constructors.push({ ...at(node), call: callee.getText(ast) });
      if (["getPool", "getConnection"].includes(name)) result.checkouts.push({ ...at(node), call: callee.getText(ast) });
      if ((ts.isIdentifier(callee) && childSymbols.has(callee.text)) || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && childNamespaces.has(callee.expression.text))) result.subprocesses.push({ ...at(node), call: callee.getText(ast) });
      if (["loadRuntimeEnv", "loadEnvConfig"].includes(name) || (name === "config" && source.includes('"dotenv"'))) result.configLoaders.push({ ...at(node), call: callee.getText(ast) });
      if (callee.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && /mysql|mariadb|postgres|sqlite|prisma/.test(node.arguments[0].text)) result.driverImports.push({ ...at(node), module: node.arguments[0].text });
      if (ts.isIdentifier(callee) && callee.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && /mysql|mariadb|postgres|sqlite|prisma/.test(node.arguments[0].text)) result.driverImports.push({ ...at(node), module: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const constructors = result.constructors.filter((item) => item.file.startsWith("src/"));
const drivers = result.driverImports.filter((item) => item.file.startsWith("src/"));
result.runtimeAssertions = {
  soleConstructor: constructors.length === 1 && constructors[0].file === "src/lib/db.ts" && constructors[0].call === "mysql.createPool",
  soleDriverImport: drivers.length === 1 && drivers[0].file === "src/lib/db.ts" && drivers[0].module === "mysql2/promise",
  noAppSubprocesses: !result.subprocesses.some((item) => item.file.startsWith("src/")),
};
const json = JSON.stringify(result, null, 2) + "\n";
if (output) writeFileSync(output, json, "utf8");
else console.log(json);
if (Object.values(result.runtimeAssertions).some((passed) => !passed)) process.exitCode = 1;
