import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { confirmarPerdida } from "./edicion-rapida-helpers";
import { exigeVehiculoSolicitadoAlEditar, MSG_VEHICULO_SOLICITADO_OBLIGATORIO } from "@/lib/tms/vehiculo-solicitado";

// Harness acotado: ejecuta las ramas JSX y handlers REALES del padre con imports
// controlados. No simula el negocio de los hijos ni pretende ser QA de navegador.
type Props = Record<string, unknown>;
type Nodo = { type: unknown; props: Props; key?: unknown };
type Fn = (...args: unknown[]) => unknown;
type Herramienta = "form" | "rapida";
const source = readFileSync(new URL("./programacion-client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const jsx = (type: unknown, props: Props, key?: unknown): Nodo => ({ type, props: props ?? {}, key });
const emitir = (s: string) => ts.transpileModule(s, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function nodos(s: ts.SourceFile) {
  const todos: ts.Node[] = [];
  function visitar(n: ts.Node) { todos.push(n); ts.forEachChild(n, visitar); }
  visitar(s);
  return todos;
}
const ramas = nodos(ast).filter((n): n is ts.JsxExpression =>
  ts.isJsxExpression(n) && !!n.expression && ts.isConditionalExpression(n.expression) &&
  /<PlanForm\b|<EdicionRapida\b/.test(n.expression.whenTrue.getText(ast)),
);
const handlers = nodos(ast).filter((n): n is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(n) && ["cerrarFormulario", "siSePuedenPerderCambios", "alternarModoRapido"].includes(n.name?.text ?? ""),
).map(n => n.getText(ast)).join("\n");
const declaraciones = ast.statements.filter(n => ts.isVariableStatement(n) &&
  n.declarationList.declarations.some(d => ["PlanForm", "EdicionRapida"].includes(d.name.getText(ast))),
).map(n => n.getText(ast)).join("\n");

function montar(modo: "static" | "lazy") {
  const requeridos = vi.fn();
  const confirmar = vi.fn(() => true);
  const guardar = vi.fn();
  const refrescar = vi.fn(async () => {});
  const gates: Partial<Record<Herramienta, () => void>> = {};
  const trabajos: Partial<Record<Herramienta, Promise<void>>> = {};
  const opciones: { loading: () => Nodo; ssr?: boolean }[] = [];
  const hoja = (tipo: Herramienta) => (props: Props) => jsx("herramienta", { ...props, herramienta: tipo });
  const form = hoja("form"), rapida = hoja("rapida");
  let indice = 0;
  const dynamic = (loader: () => Promise<{ default: (p: Props) => Nodo } | ((p: Props) => Nodo)>, options: { loading: () => Nodo; ssr?: boolean }) => {
    const tipo: Herramienta = indice++ === 0 ? "form" : "rapida";
    opciones.push(options);
    let componente: ((p: Props) => Nodo) | undefined;
    return (props: Props) => {
      if (!trabajos[tipo]) {
        const gate = new Promise<void>(resolve => { gates[tipo] = resolve; });
        trabajos[tipo] = Promise.all([loader(), gate]).then(([mod]) => {
          componente = typeof mod === "function" ? mod : mod.default;
        });
      }
      return componente ? componente(props) : options.loading();
    };
  };
  const ctx: Props = {
    exports: {}, slug: "tenant-fixture", hoy: "2026-10-17", rango: "manana",
    mostrarCrear: false, editandoId: null, planEditando: null, planEditandoVisible: false,
    modoRapido: false, pendientesRapida: false, versionRapida: 0, avisoRango: "",
    p: { id: -1 }, filasEdicionRapida: [], disponibilidadPorFecha: new Map(), estadoVehiculos: [],
    tarifasPorRuta: {}, permisos: [], confirmarPerdida, alGuardar: guardar, cargar: refrescar,
    sumarDias: () => "2026-10-18", tienePermiso: () => true, window: { confirm: confirmar },
    require: (id: string) => {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (id === "next/dynamic") return dynamic;
      requeridos(id);
      if (id === "./plan-form") return { __esModule: true, default: form };
      if (id === "./edicion-rapida") return { __esModule: true, EdicionRapida: rapida };
      throw new Error("Import inesperado: " + id);
    },
  };
  Object.defineProperty(ctx, "hayPendientesRapida", { get: () => ctx.modoRapido && ctx.pendientesRapida });
  for (const [setter, estado] of [
    ["setMostrarCrear", "mostrarCrear"], ["setEditandoId", "editandoId"], ["setModoRapido", "modoRapido"],
    ["setPendientesRapida", "pendientesRapida"], ["setVersionRapida", "versionRapida"], ["setAvisoRango", "avisoRango"],
  ]) ctx[setter] = (valor: unknown) => { ctx[estado] = typeof valor === "function" ? (valor as Fn)(ctx[estado]) : valor; };
  const imports = modo === "static"
    ? 'import PlanForm from "./plan-form"; import { EdicionRapida } from "./edicion-rapida";'
    : 'import dynamic from "next/dynamic";' + declaraciones;
  runInNewContext(emitir(imports + "\n" + handlers + "\nexport { cerrarFormulario, alternarModoRapido };\nexport function render(){ return <>"
    + ramas.map(n => "{" + n.expression!.getText(ast) + "}").join("\n") + "</>; }"), ctx);
  const api = ctx.exports as Record<string, Fn>;
  function expandir(value: unknown, key?: unknown): Nodo[] {
    if (Array.isArray(value)) return value.flatMap(n => expandir(n, key));
    if (!value || typeof value !== "object") return [];
    const n = value as Nodo, clave = n.key ?? key;
    if (typeof n.type === "function") return expandir((n.type as Fn)(n.props), clave);
    return [{ ...n, key: clave }, ...expandir(n.props.children)];
  }
  const render = () => expandir(api.render());
  return {
    ctx, api, requeridos, confirmar, guardar, refrescar, opciones, render,
    herramientas: () => render().filter(n => n.type === "herramienta"),
    actualizar: (p: Props) => Object.assign(ctx, p),
    async resolver(tipo: Herramienta) { gates[tipo]?.(); await trabajos[tipo]; return render(); },
  };
}
const propsDe = (n: Nodo) => ({ ...n.props, onSaved: undefined, onCancel: undefined, onPendientesChange: undefined, onGuardado: undefined });

describe("Programación: fronteras de carga sin cambiar ramas/props", () => {
  it("las tres ubicaciones del formulario y la tabla siguen siendo condicionales", () => {
    expect(ramas).toHaveLength(4);
    expect(declaraciones).toContain('import("./plan-form")');
    expect(declaraciones).toContain('import("./edicion-rapida").then');
    expect(source).toContain('import type { FilaEdicionRapidaEntrada } from "./edicion-rapida"');
  });

  it("cerrados: BASE importa ambos módulos, lazy no los importa ni muestra fallback", () => {
    const base = montar("static"), head = montar("lazy");
    expect(base.herramientas()).toEqual([]);
    expect(head.herramientas()).toEqual([]);
    expect(base.requeridos.mock.calls.map(c => c[0])).toEqual(["./plan-form", "./edicion-rapida"]);
    expect(head.requeridos).not.toHaveBeenCalled();
    expect(head.render().some(n => n.type === "p")).toBe(false);
    expect(head.opciones).toHaveLength(2);
    expect(head.opciones.every(o => o.ssr !== false)).toBe(true);
  });

  it("nuevo: fallback mínimo, mismas props y callbacks al resolver", async () => {
    const base = montar("static"), head = montar("lazy");
    for (const m of [base, head]) m.actualizar({ mostrarCrear: true });
    expect(head.render().some(n => n.props.children === "Cargando formulario…")).toBe(true);
    expect(head.herramientas()).toEqual([]);
    await head.resolver("form");
    const b = base.herramientas()[0], h = head.herramientas()[0];
    expect(propsDe(h)).toEqual(propsDe(b));
    expect(h.props.fechaSugerida).toBe("2026-10-18");
    const info = { id: 9, fechaPlan: "2026-10-18" };
    (h.props.onSaved as Fn)(info);
    expect(head.guardar).toHaveBeenCalledExactlyOnceWith(info);
    (h.props.onCancel as Fn)();
    expect(head.herramientas()).toEqual([]);
  });

  it.each(["Propio", "Tercerizado"])("edición inline %s: mismo objeto, key y callbacks", async tipo => {
    const plan = { id: 7, tipo_viaje: tipo, vehiculo_solicitado_perfil_id: 3 };
    const base = montar("static"), head = montar("lazy");
    for (const m of [base, head]) m.actualizar({ editandoId: 7, planEditando: plan, planEditandoVisible: true, p: plan });
    head.render(); await head.resolver("form");
    expect(propsDe(head.herramientas()[0])).toEqual(propsDe(base.herramientas()[0]));
    expect(head.herramientas()[0].props.plan).toBe(plan);
    expect(head.herramientas()[0].key).toBe(7);
  });

  it("edición fuera del rango: mantiene la rama superior y su key por plan", async () => {
    const m = montar("lazy"), plan = { id: 8 };
    m.actualizar({ editandoId: 8, planEditando: plan, planEditandoVisible: false });
    m.render(); await m.resolver("form");
    expect(m.herramientas()).toHaveLength(1);
    expect(m.herramientas()[0].props.plan).toBe(plan);
    expect(m.herramientas()[0].key).toBe(8);
  });

  it("cerrar antes de cargar no monta al resolver; reabrir reutiliza el módulo", async () => {
    const m = montar("lazy");
    m.actualizar({ mostrarCrear: true }); m.render();
    m.api.cerrarFormulario();
    await m.resolver("form");
    expect(m.herramientas()).toEqual([]);
    m.actualizar({ mostrarCrear: true });
    expect(m.herramientas()).toHaveLength(1);
    expect(m.requeridos.mock.calls.filter(c => c[0] === "./plan-form")).toHaveLength(1);
  });

  it("edición rápida: mismo montaje, props y recarga; no carga PlanForm", async () => {
    const base = montar("static"), head = montar("lazy");
    for (const m of [base, head]) m.api.alternarModoRapido();
    expect(head.render().some(n => n.props.children === "Cargando edición rápida…")).toBe(true);
    await head.resolver("rapida");
    expect(propsDe(head.herramientas()[0])).toEqual(propsDe(base.herramientas()[0]));
    expect(head.ctx.mostrarCrear).toBe(false);
    expect(head.ctx.editandoId).toBe(null);
    expect(head.requeridos.mock.calls.map(c => c[0])).toEqual(["./edicion-rapida"]);
    await (head.herramientas()[0].props.onGuardado as Fn)();
    expect(head.refrescar).toHaveBeenCalledTimes(1);
  });

  it("borrador pendiente: cancelar salida conserva tipo/key y no pide otro chunk", async () => {
    const m = montar("lazy"); m.api.alternarModoRapido(); m.render(); await m.resolver("rapida");
    const original = m.herramientas()[0];
    (original.props.onPendientesChange as Fn)(true);
    m.confirmar.mockReturnValue(false); m.api.alternarModoRapido();
    expect(m.ctx.modoRapido).toBe(true);
    expect(m.ctx.pendientesRapida).toBe(true);
    expect(m.herramientas()[0].type).toBe(original.type);
    expect(m.herramientas()[0].key).toBe(original.key);
    expect(m.requeridos).toHaveBeenCalledTimes(1);
  });

  it("confirmar descarte y reabrir mantiene la versión/remontaje de BASE", async () => {
    for (const modo of ["static", "lazy"] as const) {
      const m = montar(modo); m.api.alternarModoRapido(); m.render(); await m.resolver("rapida");
      (m.herramientas()[0].props.onPendientesChange as Fn)(true);
      m.api.alternarModoRapido();
      expect(m.ctx.modoRapido).toBe(false);
      expect(m.ctx.pendientesRapida).toBe(false);
      expect(m.ctx.versionRapida).toBe(1);
      m.api.alternarModoRapido();
      expect(m.herramientas()[0].key).toBe(1);
    }
  });
});

describe("PlanForm real: validación/foco conservados al cargar", () => {
  const formSource = readFileSync(new URL("./plan-form.tsx", import.meta.url), "utf8");
  const formAst = ts.createSourceFile("form.tsx", formSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const submit = nodos(formAst).find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "onSubmit")!;
  it.each(["Propio", "Tercerizado"])("%s sin vehículo solicitado: mensaje y foco, sin fetch", async tipo => {
    const focus = vi.fn(), fetch = vi.fn(), error = vi.fn(), preventDefault = vi.fn();
    const contexto = {
      exports: {} as Record<string, Fn>, saving: false, bloqueado: false, esEdicion: false,
      form: { tipoViaje: tipo, vehiculoSolicitadoPerfilId: 0 }, setError: vi.fn(), setErrores: vi.fn(),
      setErrorVehiculo: error, setMsg: vi.fn(), setAvisosRechazoPlan: vi.fn(), vehiculoRef: { current: { focus } },
      exigeVehiculoSolicitadoAlEditar, MSG_VEHICULO_SOLICITADO_OBLIGATORIO, fetch,
    };
    runInNewContext(emitir(submit.getText(formAst) + "\nexport { onSubmit };"), contexto);
    await contexto.exports.onSubmit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenLastCalledWith(MSG_VEHICULO_SOLICITADO_OBLIGATORIO);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
