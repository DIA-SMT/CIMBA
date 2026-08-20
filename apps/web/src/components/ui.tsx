import type { EstadoIncidente, FuenteDemanda, TipoProblema } from "@cimba/domain";
import {
  COLOR_MACRO,
  ETIQUETA_ESTADO_DEMANDA,
  ETIQUETA_ESTADO_INCIDENTE,
  ETIQUETA_FUENTE,
  ETIQUETA_TIPO,
  macroDeEstado,
} from "@/lib/formato";

export function Chip({ children, tono = "neutro" }: { children: React.ReactNode; tono?: "neutro" | "azul" | "amarillo" | "celeste" }) {
  const clases = {
    neutro: "border-borde-2 bg-panel-2 text-texto-2",
    azul: "border-azul/40 bg-azul/10 text-celeste",
    amarillo: "border-amarillo/40 bg-amarillo/10 text-amarillo",
    celeste: "border-celeste/40 bg-celeste/10 text-celeste",
  }[tono];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${clases}`}>
      {children}
    </span>
  );
}

export function BadgeFuente({ fuente }: { fuente: FuenteDemanda }) {
  const tono: Record<string, "azul" | "amarillo" | "celeste" | "neutro"> = {
    atencion_ciudadana: "azul",
    hcd: "amarillo",
    sat: "celeste",
  };
  return <Chip tono={tono[fuente] ?? "neutro"}>{ETIQUETA_FUENTE[fuente]}</Chip>;
}

export function BadgeTipo({ tipo }: { tipo: TipoProblema | null }) {
  return <Chip>{tipo ? ETIQUETA_TIPO[tipo] : "Sin clasificar"}</Chip>;
}

export function BadgeEstadoIncidente({ estado }: { estado: EstadoIncidente }) {
  const color = COLOR_MACRO[macroDeEstado(estado)];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        className={`inline-block h-2 w-2 rounded-full ${estado === "en_ejecucion" ? "pulso" : ""}`}
        style={{ background: color }}
      />
      {ETIQUETA_ESTADO_INCIDENTE[estado]}
      {estado === "verificado" && <span className="text-resuelto">✓</span>}
    </span>
  );
}

export function BadgeEstadoDemanda({ estado }: { estado: string }) {
  return <Chip tono={estado === "vinculada" ? "celeste" : estado === "recibida" ? "amarillo" : "neutro"}>{ETIQUETA_ESTADO_DEMANDA[estado] ?? estado}</Chip>;
}

/** Barra de confianza de geocodificación (0..1). */
export function BarraConfianza({ valor }: { valor: number | null }) {
  if (valor == null)
    return <span className="text-[11px] text-texto-3">s/d</span>;
  const color = valor >= 0.75 ? "var(--color-resuelto)" : valor >= 0.5 ? "var(--color-amarillo)" : "var(--color-peligro)";
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confianza de geocodificación: ${(valor * 100).toFixed(0)}%`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-panel-3">
        <span className="block h-full rounded-full" style={{ width: `${valor * 100}%`, background: color }} />
      </span>
      <span className="num text-[10px] text-texto-3">{(valor * 100).toFixed(0)}%</span>
    </span>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-borde bg-panel ${className}`}>{children}</div>;
}

export function TituloPagina({ titulo, sub, extra }: { titulo: string; sub?: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{titulo}</h1>
        {sub && <p className="mt-0.5 text-sm text-texto-2">{sub}</p>}
      </div>
      {extra}
    </div>
  );
}
