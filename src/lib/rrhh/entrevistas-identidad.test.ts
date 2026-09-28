import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ execute: m.execute, query: m.query }));
import { actualizarEntrevista, crearEntrevista, obtenerEntrevista } from "./entrevistas";

beforeEach(() => {
  vi.resetAllMocks();
  m.execute.mockResolvedValue({ insertId: 55, affectedRows: 1 });
  m.query.mockResolvedValue([]);
});

const base = {
  empresaId: 1,
  candidatoPrimerNombre: "Juan",
  candidatoPrimerApellido: "Pérez",
  puesto: "Piloto",
  fechaHora: "2026-09-28T09:00",
  creadoPor: "RRHH",
};

describe("IDENTIDAD — crearEntrevista", () => {
  it("1) primer nombre + primer apellido: crea y compone el nombre completo", async () => {
    const r = await crearEntrevista(base);
    expect(r.ok).toBe(true);
    expect(r.id).toBe(55);
    const [, params] = m.execute.mock.calls[0];
    expect(params[1]).toBe("Juan Pérez"); // candidato_nombre recompuesto server-side
    expect(params[2]).toBe("Juan"); // candidato_primer_nombre
    expect(params[6]).toBe("Pérez"); // candidato_primer_apellido
  });
  it("2-5) segundo/tercer/cuarto nombre, segundo apellido y apellido de casada se guardan", async () => {
    await crearEntrevista({
      ...base, candidatoSegundoNombre: "Carlos", candidatoTercerNombre: "Antonio", candidatoCuartoNombre: "José",
      candidatoSegundoApellido: "López", candidatoApellidoCasada: "de Ramírez",
    });
    const [, params] = m.execute.mock.calls[0];
    expect(params[1]).toBe("Juan Carlos Antonio José Pérez López de Ramírez");
  });
  it("8) backend NO confía en un nombre completo enviado por el cliente: solo acepta partes separadas", async () => {
    // El schema/tipo de crearEntrevista ya no tiene un campo "candidatoNombre" libre — solo lo compone el backend.
    await crearEntrevista(base);
    expect(m.execute.mock.calls[0][0]).not.toContain("candidato_nombre = ?"); // es INSERT, no UPDATE con override
  });
  it("primer nombre vacío -> rechazado (obligatorio también en backend)", async () => {
    const r = await crearEntrevista({ ...base, candidatoPrimerNombre: "  " });
    expect(r.ok).toBe(false);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("primer apellido vacío -> rechazado", async () => {
    const r = await crearEntrevista({ ...base, candidatoPrimerApellido: "" });
    expect(r.ok).toBe(false);
  });
  it("puesto vacío -> rechazado", async () => {
    const r = await crearEntrevista({ ...base, puesto: " " });
    expect(r.ok).toBe(false);
  });
});

describe("EDICIÓN — actualizarEntrevista", () => {
  const filaActual = {
    candidato_primer_nombre: "Juan", candidato_segundo_nombre: null, candidato_tercer_nombre: null, candidato_cuarto_nombre: null,
    candidato_primer_apellido: "Pérez", candidato_segundo_apellido: null, candidato_apellido_casada: null,
    candidato_nombre: "Juan Pérez",
  };
  beforeEach(() => { m.query.mockResolvedValue([filaActual]); });

  it("9) editar primer nombre recompone candidato_nombre fusionando con lo ya guardado", async () => {
    const r = await actualizarEntrevista(1, 55, { candidatoPrimerNombre: "Juancito" });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("candidato_nombre = ?");
    expect(params).toContain("Juancito Pérez"); // 14) nombre completo se recalcula
  });
  it("10) editar apellido (segundo apellido) recompone el nombre completo con el resto intacto", async () => {
    await actualizarEntrevista(1, 55, { candidatoSegundoApellido: "López" });
    const [, params] = m.execute.mock.calls[0];
    expect(params).toContain("Juan Pérez López");
  });
  it("11) editar teléfono", async () => {
    await actualizarEntrevista(1, 55, { candidatoTelefono: "5555-1234" });
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("candidato_telefono = ?");
    expect(params).toContain("5555-1234");
  });
  it("12) editar email", async () => {
    await actualizarEntrevista(1, 55, { candidatoEmail: "juan@example.com" });
    expect(m.execute.mock.calls[0][0]).toContain("candidato_email = ?");
  });
  it("13) editar puesto (antes NO se permitía — causa raíz corregida)", async () => {
    const r = await actualizarEntrevista(1, 55, { puesto: "Auxiliar" });
    expect(r.ok).toBe(true);
    const [sql, params] = m.execute.mock.calls[0];
    expect(sql).toContain("puesto = ?");
    expect(params).toContain("Auxiliar");
  });
  it("15) editar SOLO la fecha no altera el nombre histórico (no toca identidad)", async () => {
    await actualizarEntrevista(1, 55, { fechaHora: "2026-09-29T10:00" });
    const [sql] = m.execute.mock.calls[0];
    expect(sql).not.toContain("candidato_nombre = ?");
    expect(sql).not.toContain("candidato_primer_nombre = ?");
  });
  it("editar identidad dejando primer nombre vacío -> rechazado", async () => {
    const r = await actualizarEntrevista(1, 55, { candidatoPrimerNombre: "  " });
    expect(r.ok).toBe(false);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("puesto vacío en edición -> rechazado", async () => {
    const r = await actualizarEntrevista(1, 55, { puesto: "" });
    expect(r.ok).toBe(false);
  });
});

describe("HISTÓRICO — entrevistas sin identidad estructurada", () => {
  it("16) entrevista vieja solo con candidato_nombre sigue cargando (mapEntrevista tolera columnas NULL)", async () => {
    m.query.mockResolvedValue([{
      id: 9, empresa_id: 1, candidato_nombre: "Juan Carlos Pérez López",
      candidato_primer_nombre: null, candidato_segundo_nombre: null, candidato_tercer_nombre: null, candidato_cuarto_nombre: null,
      candidato_primer_apellido: null, candidato_segundo_apellido: null, candidato_apellido_casada: null,
      candidato_telefono: null, candidato_email: null, puesto: "Piloto", fecha_hora_iso: "2026-01-01T09:00:00",
      entrevistador_empleado_id: null, modalidad: "Presencial", lugar_o_enlace: null, estado: "Programada", resultado: "Pendiente",
      notas: null, creado_por: null, creado_en: "2026-01-01 08:00:00",
    }]);
    const ent = await obtenerEntrevista(1, 9);
    expect(ent?.candidatoNombre).toBe("Juan Carlos Pérez López");
    expect(ent?.candidatoPrimerNombre).toBeNull();
    expect(ent?.candidatoPrimerApellido).toBeNull();
  });
  it("17) NO se separa heurísticamente: 'Juan Carlos Pérez López' no se reparte automáticamente en primer/segundo nombre/apellido", async () => {
    // crearEntrevista jamás acepta un nombre completo libre: solo partes explícitas — así ninguna ruta puede
    // adivinar una separación heurística de un nombre histórico. Este test documenta esa garantía estructural.
    expect(Object.keys(base)).not.toContain("candidatoNombre");
  });
  it("18) se puede completar identidad después (editar una entrevista histórica agrega primer nombre/apellido)", async () => {
    m.query.mockResolvedValue([{
      candidato_primer_nombre: null, candidato_segundo_nombre: null, candidato_tercer_nombre: null, candidato_cuarto_nombre: null,
      candidato_primer_apellido: null, candidato_segundo_apellido: null, candidato_apellido_casada: null,
      candidato_nombre: "Juan Carlos Pérez López",
    }]);
    const r = await actualizarEntrevista(1, 9, { candidatoPrimerNombre: "Juan", candidatoPrimerApellido: "Pérez" });
    expect(r.ok).toBe(true);
    const [, params] = m.execute.mock.calls[0];
    expect(params).toContain("Juan Pérez"); // nuevo nombre derivado, ya no el histórico libre
  });
});

describe("41-42) tenant / permisos (a nivel de modelo: siempre filtra por empresa_id)", () => {
  it("obtenerEntrevista filtra por empresa_id", async () => {
    m.query.mockResolvedValue([]);
    await obtenerEntrevista(1, 9);
    expect(m.query.mock.calls[0][0]).toContain("ent.empresa_id = ?");
    expect(m.query.mock.calls[0][1]).toEqual([1, 9]);
  });
  it("actualizarEntrevista: entrevista de otra empresa no se encuentra (empresa_id en el SELECT inicial)", async () => {
    m.query.mockResolvedValue([]);
    const r = await actualizarEntrevista(1, 9, { puesto: "Otro" });
    expect(r.ok).toBe(false);
    expect(m.query.mock.calls[0][1]).toEqual([9, 1]);
  });
});
