import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Harness sin DOM (mismo patrón que cotizacion-costeo-panel.test.ts): ejecuta los efectos y handlers
// reales del componente y conserva el estado entre renders.
const hooks = vi.hoisted(() => ({ activo: false, indice: 0, estados: [] as unknown[], efectos: [] as (() => void | (() => void))[] }));
vi.mock("react", async (importar) => {
  const real = await importar<typeof import("react")>();
  return {
    ...real,
    useId: () => (hooks.activo ? ":r1:" : real.useId()),
    useRef: (inicial: unknown) => (hooks.activo ? { current: inicial } : real.useRef(inicial)),
    useState: (inicial: unknown) => {
      if (!hooks.activo) return real.useState(inicial);
      const i = hooks.indice++;
      if (!(i in hooks.estados)) hooks.estados[i] = typeof inicial === "function" ? inicial() : inicial;
      return [hooks.estados[i], (valor: unknown) => { hooks.estados[i] = typeof valor === "function" ? valor(hooks.estados[i]) : valor; }];
    },
    useEffect: (efecto: () => void | (() => void)) => { if (hooks.activo) hooks.efectos.push(efecto); else real.useEffect(efecto); },
  };
});
import { ClienteSearch } from "./cliente-search";

type Props = Parameters<typeof ClienteSearch>[0];
type Opt = { id: number; nombre: string; codigo?: string | null; nit?: string | null; telefono?: string | null; estado?: string | null };

const fetchMock = vi.fn();
const respuesta = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
const documentoMock = { addEventListener: vi.fn(), removeEventListener: vi.fn(), activeElement: null };

function ejecutar<T>(render: () => T): T {
  hooks.indice = 0; hooks.efectos = []; hooks.activo = true;
  try { return render(); } finally { hooks.activo = false; }
}
function elementos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(elementos);
  if (!isValidElement<Record<string, unknown>>(nodo)) return [];
  return [nodo, ...elementos(nodo.props.children as ReactNode)];
}
function texto(nodo: ReactNode): string {
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  if (isValidElement<{ children?: ReactNode }>(nodo)) return texto(nodo.props.children);
  return typeof nodo === "string" || typeof nodo === "number" ? String(nodo) : "";
}
const html = (tree: ReactNode) => renderToStaticMarkup(tree as ReactElement);

/** Sesión del componente: cada `pintar()` es un render que conserva el estado, y ejecuta sus efectos. */
function montar(props: Partial<Props> = {}) {
  const onChange = vi.fn();
  const onLimpiar = vi.fn();
  let actuales: Props = { slug: "kt-monaco", valueNombre: "", valueId: 0, onChange, inputClassName: "in", ...props } as Props;
  let limpiezas: (void | (() => void))[] = [];
  const pintar = (cambios: Partial<Props> = {}) => {
    actuales = { ...actuales, ...cambios } as Props;
    limpiezas.forEach((l) => typeof l === "function" && l());
    const arbol = ejecutar(() => ClienteSearch(actuales));
    limpiezas = hooks.efectos.map((e) => e());
    // Los efectos pudieron cambiar estado (setBuscando): un render más para verlo.
    return ejecutar(() => ClienteSearch(actuales)) ?? arbol;
  };
  const leer = () => ejecutar(() => ClienteSearch(actuales));
  const input = () => elementos(leer()).find((e) => e.type === "input")!;
  const enfocar = () => (input().props.onFocus as () => void)();
  const escribir = (valor: string) => (input().props.onChange as (e: unknown) => void)({ target: { value: valor } });
  const tecla = (key: string) => {
    const preventDefault = vi.fn(); const blur = vi.fn();
    (input().props.onKeyDown as (e: unknown) => void)({ key, preventDefault, target: { blur } });
    return { preventDefault, blur };
  };
  const opcion = (nombre: string) => elementos(leer()).find((e) => e.type === "button" && texto(e.props.children as ReactNode).includes(nombre));
  return { onChange, onLimpiar, pintar, leer, input, enfocar, escribir, tecla, opcion, props: () => actuales };
}

const CLIENTE_A: Opt = { id: 41, nombre: "Cliente Uno, S.A.", codigo: "CLI-001", nit: "1234567-8", telefono: "55551234", estado: "Activo" };
const CLIENTE_B: Opt = { id: 42, nombre: "Cliente Dos", codigo: null, nit: null, telefono: null, estado: "Activo" };

beforeEach(() => {
  vi.useFakeTimers();
  hooks.estados = []; hooks.efectos = []; hooks.activo = false;
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => respuesta({ clientes: [CLIENTE_A, CLIENTE_B] }));
  documentoMock.addEventListener.mockReset(); documentoMock.removeEventListener.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  vi.stubGlobal("document", documentoMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ClienteSearch — modo remoto (paridad con RutaSelect)", () => {
  it("no consulta nada mientras el campo no se ha enfocado", async () => {
    const s = montar(); s.pintar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("al enfocar consulta /tms/clientes (sin q) tras el debounce de 200 ms", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/empresas/kt-monaco/tms/clientes?");
  });

  it("debounce: varias pulsaciones seguidas producen UNA sola consulta, con el último texto", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    for (const t of ["c", "cl", "cli"]) { s.pintar({ valueNombre: t }); await vi.advanceTimersByTimeAsync(50); }
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/empresas/kt-monaco/tms/clientes?q=cli");
  });

  it("envía el texto codificado (nombre, código, NIT o teléfono viajan igual en q)", async () => {
    const s = montar({ valueNombre: "Café & Cía 12%" }); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledWith(`/api/empresas/kt-monaco/tms/clientes?q=${encodeURIComponent("Café & Cía 12%").replace(/%20/g, "+")}`);
  });

  it("nunca llama al catálogo completo /tms/catalogos, por más que se escriba", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    for (const t of ["a", "ab", "abc", "abcd"]) { s.pintar({ valueNombre: t }); await vi.advanceTimersByTimeAsync(250); }
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).not.toContain("/tms/catalogos");
  });

  it("muestra «Buscando...» mientras la consulta está en curso", async () => {
    let resolver: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((r) => { resolver = r; }));
    const s = montar(); s.pintar(); s.enfocar();
    expect(html(s.pintar())).toContain("Buscando...");
    await vi.advanceTimersByTimeAsync(200);
    expect(html(s.leer())).toContain("Buscando...");
    resolver({ ok: true, json: async () => ({ clientes: [CLIENTE_A] }) });
    await vi.advanceTimersByTimeAsync(0);
    const listo = html(s.leer());
    expect(listo).not.toContain("Buscando...");
    expect(listo).toContain("Cliente Uno, S.A.");
  });

  it("lista código · nombre y NIT/teléfono de cada resultado", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    const marcado = html(s.leer());
    expect(marcado).toContain("CLI-001 · Cliente Uno, S.A.");
    expect(marcado).toContain("NIT 1234567-8 · 55551234");
    expect(marcado).toContain("Sin NIT");
  });

  it("sin resultados muestra «Sin clientes que coincidan.»", async () => {
    fetchMock.mockImplementation(() => respuesta({ clientes: [] }));
    const s = montar({ valueNombre: "zzz" }); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    expect(html(s.leer())).toContain("Sin clientes que coincidan.");
  });

  it("si la consulta falla (HTTP o red) muestra «Sin clientes que coincidan.» y no revienta", async () => {
    fetchMock.mockImplementationOnce(() => respuesta({ error: "x" }, false));
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    expect(html(s.leer())).toContain("Sin clientes que coincidan.");
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    s.pintar({ valueNombre: "otra" });
    await vi.advanceTimersByTimeAsync(200);
    expect(html(s.leer())).toContain("Sin clientes que coincidan.");
  });

  it("ignora la respuesta de una consulta ya superada (evita resultados viejos)", async () => {
    const resolvers: ((v: unknown) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((r) => { resolvers.push(r); }));
    const s = montar(); s.pintar(); s.enfocar(); s.pintar({ valueNombre: "a" });
    await vi.advanceTimersByTimeAsync(200); // consulta 1 en vuelo
    s.pintar({ valueNombre: "ab" });        // limpia el efecto anterior => ignore
    await vi.advanceTimersByTimeAsync(200); // consulta 2 en vuelo
    resolvers[1]({ ok: true, json: async () => ({ clientes: [CLIENTE_B] }) });
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]({ ok: true, json: async () => ({ clientes: [CLIENTE_A] }) });
    await vi.advanceTimersByTimeAsync(0);
    const marcado = html(s.leer());
    expect(marcado).toContain("Cliente Dos");
    expect(marcado).not.toContain("Cliente Uno");
  });

  it("clic en una opción selecciona el tms_clientes.id devuelto y cierra la lista", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    (s.opcion("Cliente Uno")!.props.onClick as () => void)();
    expect(s.onChange).toHaveBeenCalledWith({ clienteId: 41, clienteNombre: "Cliente Uno, S.A." });
    expect(html(s.leer())).not.toContain('role="listbox"');
  });

  it("Enter elige la primera opción de la lista", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    const { preventDefault } = s.tecla("Enter");
    expect(preventDefault).toHaveBeenCalled();
    expect(s.onChange).toHaveBeenCalledWith({ clienteId: 41, clienteNombre: "Cliente Uno, S.A." });
  });

  it("Enter sin resultados no selecciona nada", async () => {
    fetchMock.mockImplementation(() => respuesta({ clientes: [] }));
    const s = montar({ valueNombre: "zzz" }); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    s.tecla("Enter");
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("Escape cierra la lista y quita el foco sin cambiar la selección", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    expect(html(s.leer())).toContain('role="listbox"');
    const { blur } = s.tecla("Escape");
    expect(blur).toHaveBeenCalled();
    expect(html(s.leer())).not.toContain('role="listbox"');
    expect(s.onChange).not.toHaveBeenCalled();
  });

  it("clic fuera cierra la lista (listener de mousedown en document)", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    const alMouseDown = documentoMock.addEventListener.mock.calls.find(([tipo]) => tipo === "mousedown")?.[1] as (e: unknown) => void;
    expect(alMouseDown).toBeTypeOf("function");
    alMouseDown({ target: {} });
    expect(html(s.leer())).not.toContain('role="listbox"');
  });

  it("escribir NO selecciona por coincidencia de nombre: fija clienteId = 0 (aunque el texto sea idéntico a un cliente)", async () => {
    const s = montar({ valueNombre: "Cliente Dos", valueId: 42 }); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    s.escribir("Cliente Dos");
    expect(s.onChange).toHaveBeenCalledWith({ clienteId: 0, clienteNombre: "Cliente Dos" });
  });

  it("al salir del campo (blur) con texto sin elegir NO se autoselecciona nada", async () => {
    const s = montar({ valueNombre: "Cliente Dos" }); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    (s.input().props.onBlur as () => void)();
    (documentoMock as { activeElement: unknown }).activeElement = null;
    await vi.advanceTimersByTimeAsync(200);
    expect(s.onChange).not.toHaveBeenCalled();
  });
});

describe("ClienteSearch — mensajes, cliente seleccionado y limpieza", () => {
  it("muestra «Seleccionado: CODIGO · NOMBRE · NIT …» tras elegir", async () => {
    const s = montar(); s.pintar(); s.enfocar(); s.pintar();
    await vi.advanceTimersByTimeAsync(200);
    (s.opcion("Cliente Uno")!.props.onClick as () => void)();
    const marcado = html(s.pintar({ valueId: 41, valueNombre: "Cliente Uno, S.A." }));
    expect(marcado).toContain("Seleccionado:");
    expect(marcado).toContain("CLI-001 · Cliente Uno, S.A. · NIT 1234567-8 · 55551234");
  });

  it("con un cliente ya cargado (p. ej. al editar) muestra «Seleccionado: NOMBRE» sin inventar código ni NIT", () => {
    const s = montar({ valueId: 9, valueNombre: "Cliente Guardado" });
    const marcado = html(s.pintar());
    expect(marcado).toContain("Seleccionado: Cliente Guardado</span>");
  });

  it("texto sin cliente elegido muestra el mensaje configurado y nunca el viejo «Sin coincidencia exacta»", () => {
    const s = montar({ valueNombre: "algo escrito", mensajeSinSeleccion: "Selecciona un cliente de la lista o crea uno nuevo." });
    const marcado = html(s.pintar());
    expect(marcado).toContain("Selecciona un cliente de la lista o crea uno nuevo.");
    expect(marcado).not.toContain("Sin coincidencia exacta");
    expect(marcado).not.toContain("se usará el nombre al guardar");
    expect(marcado).not.toContain("Seleccionado");
  });

  it("vacío muestra la descripción (por defecto o la recibida)", () => {
    expect(html(montar().pintar())).toContain("busca por nombre, código, NIT o teléfono");
    expect(html(montar({ descripcion: "Ayuda propia" }).pintar())).toContain("Ayuda propia");
  });

  it("dibuja UN solo <label> con el texto recibido, asociado al input (sin label anidado)", () => {
    const marcado = html(montar({ label: "Cliente de la cotización" }).pintar());
    expect(marcado.match(/<label/g)).toHaveLength(1);
    expect(marcado).toMatch(/<label for=":r1:" class="block">Cliente de la cotización<\/label>/);
    expect(marcado).toContain('id=":r1:"');
  });

  it("sin onLimpiar no hay botón; con onLimpiar aparece solo si hay texto o selección", () => {
    expect(html(montar({ valueNombre: "x" }).pintar())).not.toContain("Limpiar");
    const s = montar({ onLimpiar: vi.fn() });
    expect(html(s.pintar())).not.toContain("Limpiar");
    expect(html(s.pintar({ valueNombre: "x" }))).toContain("Limpiar");
    expect(html(s.pintar({ valueNombre: "Cliente", valueId: 41 }))).toContain("Limpiar");
  });

  it("«Limpiar» invoca onLimpiar, con aria-label y sin abrir la lista", () => {
    const onLimpiar = vi.fn();
    const s = montar({ onLimpiar, valueNombre: "Cliente Uno", valueId: 41, limpiarAriaLabel: "Limpiar filtro de cliente" });
    s.pintar();
    const limpiar = elementos(s.leer()).find((e) => e.type === "button" && texto(e.props.children as ReactNode) === "Limpiar")!;
    expect(limpiar.props["aria-label"]).toBe("Limpiar filtro de cliente");
    (limpiar.props.onClick as () => void)();
    expect(onLimpiar).toHaveBeenCalledTimes(1);
    expect(html(s.leer())).not.toContain('role="listbox"');
  });
});

describe("ClienteSearch — modo local (sin slug, otros consumidores)", () => {
  const catalogo: Opt[] = [CLIENTE_A, CLIENTE_B, { id: 43, nombre: "Inactivo SA", estado: "Inactivo" }];

  it("filtra el catálogo local sin llamar al servidor y solo muestra activos", async () => {
    const s = montar({ slug: undefined, clientes: catalogo, valueNombre: "cli" }); s.pintar(); s.enfocar();
    const marcado = html(s.pintar());
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(marcado).toContain("Cliente Uno");
    expect(marcado).toContain("Cliente Dos");
    expect(marcado).not.toContain("Inactivo SA");
    expect(marcado).not.toContain("Buscando...");
  });

  it("conserva el comportamiento histórico: coincidencia exacta de nombre fija el id y mantiene el mensaje legado", () => {
    const s = montar({ slug: undefined, clientes: catalogo }); s.pintar();
    s.escribir("cliente dos");
    expect(s.onChange).toHaveBeenCalledWith({ clienteId: 42, clienteNombre: "cliente dos" });
    const marcado = html(montar({ slug: undefined, clientes: catalogo, valueNombre: "otro" }).pintar());
    expect(marcado).toContain("Sin coincidencia exacta");
    expect(marcado).toContain("Cliente (buscar en catálogo)");
    expect(marcado).not.toContain("Limpiar");
  });
});

describe("ClienteSearch / página de Cotizaciones — guardas de código", () => {
  const leerFuente = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
  const page = leerFuente("src/app/e/[slug]/cotizaciones/page.tsx");

  it("la página ya no descarga /tms/catalogos ni lee la clave inexistente tmsClientes", () => {
    expect(page).not.toContain("/tms/catalogos");
    expect(page).not.toContain("tmsClientes");
    expect(page).not.toContain("cargarClientes");
    expect(page).not.toMatch(/clientes=\{clientes\}/);
  });

  it("los dos campos son independientes y tienen etiquetas propias, ambos en modo remoto", () => {
    expect(page).toContain('label="Filtrar cotizaciones por cliente"');
    expect(page).toContain('label="Cliente de la cotización"');
    const usos = page.match(/<ClienteSearch[\s\S]*?\/>/g) ?? [];
    expect(usos).toHaveLength(2);
    for (const uso of usos) expect(uso).toContain("slug={slug}");
    const [filtro, formulario] = usos;
    // El filtro solo toca fClienteId/fClienteNombre; el formulario solo toca form.*
    expect(filtro).toContain("valueId={fClienteId}");
    expect(filtro).toContain("setFClienteId(clienteId)");
    expect(filtro).not.toContain("form.");
    expect(filtro).not.toContain("setForm");
    expect(formulario).toContain("valueId={form.clienteId}");
    expect(formulario).toContain("setForm(");
    expect(formulario).not.toContain("setFCliente");
    expect(formulario).not.toContain("fCliente");
  });

  it("el filtro tiene «Limpiar» que reinicia solo el filtro", () => {
    const filtro = (page.match(/<ClienteSearch[\s\S]*?\/>/g) ?? [])[0];
    expect(filtro).toContain('onLimpiar={() => { setFClienteId(0); setFClienteNombre(""); }}');
    expect(filtro).toContain("Limpiar filtro de cliente");
  });

  it("ningún ClienteSearch queda dentro de un <label> (sin labels anidados)", () => {
    for (const bloque of page.match(/<label\b[\s\S]*?<\/label>/g) ?? []) expect(bloque).not.toContain("<ClienteSearch");
  });

  it("el mensaje del formulario es «Selecciona un cliente de la lista o crea uno nuevo.»", () => {
    const formulario = (page.match(/<ClienteSearch[\s\S]*?\/>/g) ?? [])[1];
    expect(formulario).toContain('mensajeSinSeleccion="Selecciona un cliente de la lista o crea uno nuevo."');
    expect(page).not.toContain("Sin coincidencia exacta");
  });

  it("guardar() bloquea clienteId <= 0 antes de cualquier fetch", () => {
    const guardar = page.slice(page.indexOf("async function guardar()"));
    const validacion = guardar.indexOf("if (!(form.clienteId > 0))");
    expect(validacion).toBeGreaterThan(0);
    expect(validacion).toBeLessThan(guardar.indexOf("fetch("));
    expect(guardar.slice(validacion, validacion + 200)).toContain("return;");
    expect(guardar).toContain("clienteId: form.clienteId,");
  });

  it("«+ Crear cliente» solo con permiso clientes:crear y selecciona el cliente creado sin recargar la página", () => {
    expect(page).toContain("puedeCrearCliente={permisosRapidos.clientes}");
    expect(page).toContain('clientes: crear("clientes")');
    expect(page).toContain("onCliente={(c) => setForm((f) => ({ ...f, clienteId: c.id, clienteNombre: c.nombre }))}");
    expect(page).not.toMatch(/location\.(reload|href)|router\.refresh/);
    const rapidos = leerFuente("src/components/tms/cotizacion-catalogos-rapidos.tsx");
    // El id que se selecciona es el de tms_clientes, no el de clientes.
    expect(rapidos).toContain("data.cliente?.tmsClienteId");
    expect(rapidos).toContain("onCliente({ id: tmsId,");
  });

  it("el componente remoto consulta /tms/clientes y no /tms/catalogos", () => {
    const fuente = leerFuente("src/components/tms/cliente-search.tsx");
    expect(fuente).toContain("/tms/clientes?");
    expect(fuente).not.toContain("/tms/catalogos");
  });
});
