import Link from "next/link";
import { notFound } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { obtenerOrden, type ItemOrden } from "@/lib/ordenes";
import { fechaCorta, numero } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { Panel } from "@/components/ui";
import { TarjetaItem } from "./tarjeta-item";

export const dynamic = "force-dynamic";

const TERCIARIA = { etiqueta: "TERCIARIA", clase: "bg-panel-3 text-texto-2" };
const PRIORIDAD: Record<string, { etiqueta: string; clase: string }> = {
  primaria: { etiqueta: "PRIMARIA", clase: "bg-encurso/15 text-encurso" },
  secundaria: { etiqueta: "SECUNDARIA", clase: "bg-amarillo/15 text-amarillo" },
  terciaria: TERCIARIA,
};

const m2 = (v: number | null) =>
  v != null ? new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v) : "—";

/** El trabajo del día: lo pendiente arriba y grande, lo hecho abajo como confirmación. */
export default async function PaginaOrdenEmpresa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden <= 0) notFound();

  const sesion = (await leerSesion())!;
  // obtenerOrden filtra por empresa cuando el rol es 'empresa' (y excluye
  // borradores): si el id es de otra empresa, vuelve null y esto es un 404, no
  // una fuga. El filtro vive en la consulta porque la RLS hoy no se aplica.
  const orden = await obtenerOrden(sesion, idOrden);
  if (!orden) notFound();

  const prioridad = PRIORIDAD[orden.prioridad] ?? TERCIARIA;
  const activa = orden.estado === "emitida" || orden.estado === "en_ejecucion";
  const pendientes = orden.itemsDetalle.filter((i) => i.estado === "pendiente");
  const hechos = orden.itemsDetalle.filter((i) => i.estado === "hecho");
  const noEncontrados = orden.itemsDetalle.filter((i) => i.estado === "no_encontrado");
  const pct = orden.items > 0 ? Math.round((100 * orden.hechos) / orden.items) : 0;

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      <Link
        href="/empresa"
        className="inline-flex min-h-12 items-center text-sm font-medium text-texto-2 hover:text-texto"
      >
        ← Mis órdenes
      </Link>

      {/* Cabecera compacta: lo justo para saber qué orden es y cuánto falta */}
      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="num text-xl font-extrabold">{orden.numero}</h1>
          <span className={`rounded px-2 py-1 text-[11px] font-bold ${prioridad.clase}`}>
            {prioridad.etiqueta}
          </span>
          {orden.circuitoCodigo && (
            <span className="rounded bg-celeste/10 px-2 py-1 text-[11px] font-bold text-celeste">
              Circuito {orden.circuitoCodigo}
            </span>
          )}
        </div>
        {orden.titulo && <p className="mt-1 text-base font-medium">{orden.titulo}</p>}
        {orden.indicaciones && (
          <p className="mt-2 rounded-lg border border-amarillo/30 bg-amarillo/5 px-3 py-2 text-sm leading-relaxed text-texto">
            <span className="font-bold text-amarillo">Indicaciones del Director: </span>
            {orden.indicaciones}
          </p>
        )}
        <div className="mt-3 flex items-baseline justify-between text-sm">
          <span>
            <b className="num">{numero(orden.hechos)}</b> de <b className="num">{numero(orden.items)}</b> hechos
          </span>
          <span className="num text-texto-2">{numero(orden.m2Reportados)} m²</span>
        </div>
        <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-panel-3">
          <div className="h-full rounded-full bg-resuelto" style={{ width: `${pct}%` }} />
        </div>
        {orden.venceEn && (
          <p className="mt-2 text-sm text-texto-2">Vence el {fechaCorta(orden.venceEn)}</p>
        )}
      </Panel>

      {!activa && (
        <p className="mb-4 rounded-xl border border-borde bg-panel px-4 py-3 text-sm text-texto-2">
          Esta orden está {orden.estado === "completada" ? "completada" : "anulada"}: ya no se pueden
          cargar trabajos.
        </p>
      )}

      {/* Lo pendiente, uno por uno y bien grande */}
      {pendientes.length > 0 && activa && (
        <div className="space-y-4">
          {pendientes.map((item) => (
            <TarjetaItem key={item.id} item={item} />
          ))}
        </div>
      )}
      {pendientes.length === 0 && activa && (
        <p className="rounded-xl border border-resuelto/40 bg-resuelto/10 px-4 py-6 text-center text-base font-semibold text-resuelto">
          No queda nada pendiente en esta orden. Buen trabajo.
        </p>
      )}

      {/* Lo hecho, colapsado: sirve de confirmación de lo que ya se cargó */}
      {hechos.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Hechos ({numero(hechos.length)})
          </h2>
          <div className="space-y-2">
            {hechos.map((item) => (
              <ItemHecho key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {noEncontrados.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            No encontrados ({numero(noEncontrados.length)})
          </h2>
          <div className="space-y-2">
            {noEncontrados.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <p className="font-medium">{item.direccion ?? "Sin dirección"}</p>
                {item.observaciones && (
                  <p className="mt-0.5 text-xs text-texto-3">Motivo: {item.observaciones}</p>
                )}
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ItemHecho({ item }: { item: ItemOrden }) {
  const fotos = item.fotos
    .map((f) => ({ momento: f.momento, url: urlFoto(f) }))
    .filter((f): f is { momento: string; url: string } => f.url != null);

  return (
    <details className="rounded-xl border border-borde bg-panel">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="text-resuelto">✓</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.direccion ?? "Sin dirección"}
        </span>
        <span className="num shrink-0 text-sm font-bold text-resuelto">{m2(item.superficieM2)} m²</span>
      </summary>
      <div className="border-t border-borde px-4 py-3 text-sm">
        <p className="num text-texto-2">
          {m2(item.anchoM)} × {m2(item.largoM)} m · espesor {m2(item.espesorCm)} cm
        </p>
        {item.reportadoEn && (
          <p className="mt-0.5 text-xs text-texto-3">Reportado el {fechaCorta(item.reportadoEn)}</p>
        )}
        {item.observaciones && <p className="mt-1 text-xs text-texto-2">{item.observaciones}</p>}
        {fotos.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {fotos.map((f, i) => (
              <figure key={i} className="shrink-0">
                <img
                  src={f.url}
                  alt={`Foto ${f.momento}`}
                  loading="lazy"
                  className="h-24 w-32 rounded-lg border border-borde-2 object-cover"
                />
                <figcaption className="mt-0.5 text-center text-[10px] text-texto-3 uppercase">
                  {f.momento === "despues" ? "después" : f.momento}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
