import styles from "./panel.module.css";
export function EstadoCB2({ estado }: { estado: string }) {
    return <span className={styles.badge} data-state={estado}>{estado.replaceAll("_", " ")}</span>;
}
export function VacioCB2({ children }: { children: React.ReactNode }) {
    return <p className={styles.empty}>{children}</p>;
}
export function PasosImportacionCB2({ paso }: { paso: number }) {
    return <ol className={styles.steps} aria-label="Pasos de importación">{["Seleccionar archivo", "Analizar Excel", "Revisar coincidencias", "Confirmar selección"].map((label, i) => <li key={label} aria-current={paso === i + 1 ? "step" : undefined}><span aria-hidden="true">{i + 1}</span>{label}</li>)}</ol>;
}
