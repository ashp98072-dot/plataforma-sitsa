import type { Catalogo, Externo } from "./contratos";
const externo = (id: number, estado: Externo["estado"] = "VERIFICADO"): Externo => ({ id, empresa: "A", nombre: `Persona sintética ${id}`, estado, evidencia: "EXP-SIMULADO", capturadoPor: "capturista-demo", verificadoPor: "revisor-demo" });
export const catalogoSintetico: Catalogo = {
  empleados: [{ id: 11, empresa: "A", nombre: "Persona A", activo: true }, { id: 12, empresa: "A", nombre: "Homónimo", activo: true }, { id: 13, empresa: "A", nombre: "Homónimo", activo: true }, { id: 14, empresa: "A", nombre: "Inactivo", activo: false }, { id: 22, empresa: "B", nombre: "Persona B", activo: true }],
  conductores: [externo(31), externo(32, "PENDIENTE"), externo(33, "INACTIVO"), { ...externo(34), empresa: "B" }].map(e => ({ ...e, relacion: "CONTRATISTA", referenciaRelacion: "Contratista sintético" })),
  unidades: [{ id: 101, empresa: "A", placa: "DEMO-001", activo: true, compartidoCon: [] }, { id: 102, empresa: "A", placa: "DEMO-002", activo: true, compartidoCon: [] }, { id: 103, empresa: "A", placa: "DEMO-002", activo: true, compartidoCon: [] }, { id: 201, empresa: "B", placa: "DEMO-B", activo: true, compartidoCon: [] }, { id: 202, empresa: "B", placa: "DEMO-C", activo: true, compartidoCon: ["A"] }],
  vehiculos: [{ ...externo(301), nombre: "DEMO-EXT", jurisdiccion: "Jurisdicción sintética", tenedor: "Tercero demo" }, { ...externo(302, "PENDIENTE"), jurisdiccion: "", tenedor: "" }],
};
