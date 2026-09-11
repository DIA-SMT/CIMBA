import Link from "next/link";
import { numero } from "@/lib/formato";
import type { EmbudoDemandas } from "@/lib/consultas";

/**
 * DE DÓNDE SALE CADA NÚMERO.
 *
 * Existe porque la misma palabra contaba cosas distintas en cada pantalla
 * ("Bacheo 1.876" en la bandeja, "Bacheo 1.543" en el mapa) y eso hacía
 * desconfiar del tablero entero. Acá la cadena se muestra completa y en
 * criollo: cuántos entraron, cuántos ya se cerraron, cuántos no se pueden
 * ubicar, y recién ahí cuántos ve el mapa.
 *
 * La regla de lectura es siempre la misma: cada escalón es un subconjunto
 * del anterior.
 */
export function EmbudoNumeros({ e, compacto = false }: { e: EmbudoDemandas; compacto?: boolean }) {
  const pasos = [
    {
      n: e.total,
      titulo: "pedidos en total",
      detalle: "Todo lo que entró alguna vez, por cualquier canal.",
      color: "var(--color-texto-2)",
      href: "/demandas",
    },
    {
      n: e.cerradas,
      titulo: "ya tienen destino",
      detalle: "Vinculados a un problema del territorio, cerrados o descartados. No son deuda.",
      color: "var(--color-hecho)",
      href: "/demandas?estado=vinculada",
      resta: true,
    },
    {
      n: e.abiertas,
      titulo: "abiertos, esperando",
      detalle: "Nadie los cerró todavía. Esta es la deuda real con el vecino.",
      color: "var(--color-en-cola)",
      href: "/demandas?estado=recibida",
    },
    {
      n: e.sinUbicacion,
      titulo: "sin ubicación",
      detalle: "No tienen punto en el mapa: no se pueden dibujar ni mandar a una cuadrilla hasta corregirlos.",
      color: "var(--color-sin-atencion)",
      href: "/demandas?calidad=sin_ubicacion",
      resta: true,
    },
    {
      n: e.enElMapa,
      titulo: "es lo que puede mostrar el mapa",
      detalle: `De esos, el mapa abre mostrando solo la cola de Bacheo (${numero(e.porDestino.bacheo)}); SAT y Ingeniería se prenden con los chips.`,
      color: "var(--color-celeste)",
      href: "/mapa",
    },
  ];

  return (
    <div className="rounded-xl border border-borde bg-panel p-4">
      <p className="text-sm font-bold">De dónde sale cada número</p>
      <p className="mt-0.5 mb-3 text-[12px] leading-relaxed text-texto-3">
        Cada escalón es una parte del anterior. Si dos pantallas muestran cifras distintas para lo mismo,
        es porque están paradas en escalones distintos — acá se ve cuál es cuál.
      </p>

      <div className="space-y-1.5">
        {pasos.map((p) => (
          <Link
            key={p.titulo}
            href={p.href}
            className="flex items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-panel-2"
          >
            <span
              className="num w-20 shrink-0 text-right text-lg leading-tight font-bold"
              style={{ color: p.color }}
            >
              {p.resta ? "− " : ""}
              {numero(p.n)}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{p.titulo}</span>
              {!compacto && (
                <span className="block text-[11px] leading-snug text-texto-3">{p.detalle}</span>
              )}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-3 border-t border-borde pt-2.5">
        <p className="text-[12px] leading-relaxed text-texto-2">
          De los <b className="num">{numero(e.enElMapa)}</b> que están en el mapa,{" "}
          <b className="num" style={{ color: "var(--color-sin-atencion)" }}>
            {numero(e.sinAtencion)}
          </b>{" "}
          <b>no tienen a nadie trabajándolos</b> — ni una cuadrilla asignada ni una reparación cerca.
        </p>
        {/* El número asusta hasta que se ve de dónde viene: la mayoría no son
            vecinos esperando, son registros históricos cargados de golpe por
            archivo, con fecha de importación y sin triage. Decirlo evita leer
            un problema de gestión donde hay un problema de datos. */}
        {e.sinAtencionDeArchivo > 0 && (
          <p className="mt-1.5 rounded-lg border border-amarillo/40 bg-amarillo/10 px-3 py-2 text-[12px] leading-relaxed">
            <b className="num">{numero(e.sinAtencionDeArchivo)}</b> de esos{" "}
            <b>entraron por carga de archivo</b>, no por un reclamo en vivo: traen la fecha del día en que
            se importaron y nunca pasaron por triage. Los que realmente llegaron por un canal activo son{" "}
            <b className="num">{numero(e.sinAtencion - e.sinAtencionDeArchivo)}</b>. Son dos problemas
            distintos: uno es limpiar una base, el otro es salir a bachear.
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-texto-3">
          Reparto por quién resuelve: Bacheo <b className="num">{numero(e.porDestino.bacheo)}</b> · SAT{" "}
          <b className="num">{numero(e.porDestino.sat)}</b> · Ingeniería{" "}
          <b className="num">{numero(e.porDestino.ingenieria)}</b>. La SAT no la resuelve el municipio: se
          deriva y se acompaña.
        </p>
      </div>
    </div>
  );
}
