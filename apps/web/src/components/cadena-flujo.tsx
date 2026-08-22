import Link from "next/link";
import { HardHat, Inbox, Wrench } from "lucide-react";

/** Paleta funcional compartida del relato pedido → problema → trabajo. */
const PASOS = [
  {
    n: 1,
    titulo: "Pedido (demanda)",
    texto: "Un vecino o institución reclama un problema.",
    href: "/demandas",
    color: "#3987e5",
    Icono: Inbox,
  },
  {
    n: 2,
    titulo: "Problema (incidente)",
    texto: "Los pedidos del mismo lugar se agrupan y priorizan.",
    href: "/incidentes",
    color: "#f4dc00",
    Icono: Wrench,
  },
  {
    n: 3,
    titulo: "Trabajo (intervención)",
    texto: "Una cuadrilla u obra repara.",
    href: "/intervenciones",
    color: "#199e70",
    Icono: HardHat,
  },
] as const;

/**
 * La cadena completa del circuito con el paso actual resaltado ("estás acá").
 * Se muestra arriba de cada bandeja para que cualquier pantalla se explique sola.
 */
export function CadenaFlujo({ actual }: { actual: 1 | 2 | 3 }) {
  return (
    <div className="mb-5 grid gap-2 sm:grid-cols-3">
      {PASOS.map(({ n, titulo, texto, href, color, Icono }) => {
        const activo = n === actual;
        const cuerpo = (
          <div
            className={`h-full rounded-xl border px-3 py-2.5 transition ${activo ? "border-borde-2 bg-panel-2" : "border-borde bg-panel/50 hover:bg-panel-2/60"}`}
          >
            <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color }}>
              <Icono size={14} /> {n} · {titulo}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-texto-3">
              {texto}
              {activo && <b className="text-texto-2"> Estás acá.</b>}
            </p>
          </div>
        );
        return activo ? (
          <div key={n}>{cuerpo}</div>
        ) : (
          <Link key={n} href={href} className="block">
            {cuerpo}
          </Link>
        );
      })}
    </div>
  );
}
