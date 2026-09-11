import Link from "next/link";
import type { EstadoIncidente, FuenteDemanda, TipoProblema } from "@cimba/domain";
import {
  ETIQUETA_ESTADO_DEMANDA,
  ETIQUETA_ESTADO_INCIDENTE,
  ETIQUETA_FUENTE,
  ETIQUETA_TIPO,
  SEMAFORO,
  pasoDeEstado,
  pasoDeEstadoDemanda,
} from "@/lib/formato";
import { GLOSARIO, type ClaveGlosario } from "@/lib/glosario";

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
  // El paso (no el macro) para que "Programado" se lea naranja —comprometido,
  // todavía en cola— y solo "En ejecución" tome el ámbar de obra.
  const color = SEMAFORO[pasoDeEstado(estado)];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        className={`inline-block h-2 w-2 rounded-full ${estado === "en_ejecucion" ? "pulso" : ""}`}
        style={{ background: color }}
      />
      {ETIQUETA_ESTADO_INCIDENTE[estado]}
      {estado === "verificado" && <span className="text-hecho">✓</span>}
    </span>
  );
}

/**
 * Mismo patrón que el badge del incidente —punto de color + etiqueta— y el
 * mismo mapeo que los chips de filtro de /demandas, que ya pintaban bien.
 *
 * Antes era un Chip con tres tonos propios: "Vinculada" salía celeste abajo y
 * ámbar arriba en la misma pantalla, y los cuatro finales del reclamo del
 * vecino (cerrada, descartada, fuera de alcance) compartían un gris único —
 * "respondida" se leía igual que "descartada", que es lo contrario.
 */
export function BadgeEstadoDemanda({ estado }: { estado: string }) {
  const color = SEMAFORO[pasoDeEstadoDemanda(estado)];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      title={estado in GLOSARIO ? GLOSARIO[estado as ClaveGlosario].texto : undefined}
    >
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {ETIQUETA_ESTADO_DEMANDA[estado] ?? estado}
      {/* Refuerzo no cromático del único final bueno: al vecino se le respondió. */}
      {estado === "cerrada" && <span className="text-hecho">✓</span>}
    </span>
  );
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

/**
 * EL VACÍO, CON SALIDA.
 *
 * Había diecisiete de estos repartidos por el sistema y todos eran la misma
 * caja gris con una frase: «Sin incidentes con estos filtros.» El operador que
 * filtró de más quedaba mirando un texto que no distingue dos situaciones muy
 * distintas —"no hay nada que hacer" y "tu filtro es demasiado angosto"— y sin
 * un solo lugar donde tocar para volver.
 *
 * `accion` es lo que saca del vacío: casi siempre «Quitar los filtros» con el
 * href limpio de la pantalla. Si el vacío es una buena noticia (una bandeja al
 * día), no lleva acción y el tono cambia con `bueno`.
 */
export function EstadoVacio({
  titulo,
  detalle,
  accion,
  bueno = false,
}: {
  titulo: string;
  detalle?: string;
  accion?: { texto: string; href: string };
  bueno?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-10 text-center ${
        bueno ? "border-hecho/40 bg-hecho/5" : "border-borde bg-panel"
      }`}
    >
      <p className={`text-sm font-semibold ${bueno ? "text-hecho" : "text-texto-2"}`}>{titulo}</p>
      {detalle && <p className="max-w-md text-[12px] leading-relaxed text-texto-3">{detalle}</p>}
      {accion && (
        <Link
          href={accion.href}
          className="mt-1 rounded-lg border border-borde-2 px-3 py-1.5 text-xs font-semibold text-celeste transition hover:border-celeste/60"
        >
          {accion.texto}
        </Link>
      )}
    </div>
  );
}

/** La misma pieza, adentro de una tabla: una tabla vacía sin fila se colapsa
 *  y deja el encabezado flotando sobre la nada. */
export function FilaVacia({
  columnas,
  titulo,
  detalle,
  accion,
  bueno = false,
}: {
  columnas: number;
  titulo: string;
  detalle?: string;
  accion?: { texto: string; href: string };
  bueno?: boolean;
}) {
  return (
    <tr>
      <td colSpan={columnas} className="px-4 py-8">
        <EstadoVacio titulo={titulo} detalle={detalle} accion={accion} bueno={bueno} />
      </td>
    </tr>
  );
}
