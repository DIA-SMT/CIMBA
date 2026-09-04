import Link from "next/link";
import { notFound } from "next/navigation";
import { leerSesion } from "@/lib/auth";
import { obtenerOrden, type ItemOrden } from "@/lib/ordenes";
import { fechaCorta, numero } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { Panel } from "@/components/ui";
import { GaleriaFotos, type FotoVisor } from "@/components/visor-fotos";
import { resolverVistaPortal } from "../../vista";
import { ProponerItem } from "./proponer-item";
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

const ETIQUETA_TRABAJO: Record<string, string> = {
  bache: "Bache",
  carpeta: "Carpeta",
  tramo: "Tramo",
};

/** Motivo del rechazo que dejó Bacheo en metadata.validacion (resolverPropuesto). */
function motivoRechazo(metadata: Record<string, unknown>): string | null {
  const v = metadata.validacion as { motivo?: unknown } | undefined;
  return typeof v?.motivo === "string" ? v.motivo : null;
}

/** El trabajo del día: lo pendiente arriba y grande, lo hecho abajo como confirmación. */
export default async function PaginaOrdenEmpresa({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { id } = await params;
  const idOrden = Number(id);
  if (!Number.isInteger(idOrden) || idOrden <= 0) notFound();

  const sesion = (await leerSesion())!;
  const resuelta = resolverVistaPortal(sesion, await searchParams);
  // obtenerOrden filtra por empresa cuando el rol es 'empresa' (y excluye
  // borradores): si el id es de otra empresa, vuelve null y esto es un 404, no
  // una fuga. El filtro vive en la consulta porque la RLS hoy no se aplica.
  const orden = await obtenerOrden(sesion, idOrden);
  if (!orden) notFound();
  /**
   * El staff en el portal está SIEMPRE en vista espejo, venga o no ?empresa en
   * la URL: sin esto, entrar directo a /empresa/orden/N mostraba el portal
   * vivo sin el banner de advertencia. Sin ?empresa, la empresa espejada es la
   * dueña de la orden.
   */
  const vista =
    sesion.rol_cimba === "empresa"
      ? resuelta
      : { empresaId: resuelta.empresaId ?? orden.empresaId, esVistaEspejo: true };
  // Coherencia de la vista espejo: si el staff está mirando el portal de la
  // empresa N, una orden de otra empresa no existe "en ese portal".
  if (vista.esVistaEspejo && orden.empresaId !== vista.empresaId) notFound();
  // El portal muestra lo que ve la empresa, y la empresa nunca ve borradores:
  // el staff los revisa en /ordenes/[id], no acá.
  if (orden.estado === "borrador") notFound();
  // En vista espejo los links internos arrastran ?empresa=N para no perderse.
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  const prioridad = PRIORIDAD[orden.prioridad] ?? TERCIARIA;
  const activa = orden.estado === "emitida" || orden.estado === "en_ejecucion";
  const pendientes = orden.itemsDetalle.filter((i) => i.estado === "pendiente");
  const hechos = orden.itemsDetalle.filter((i) => i.estado === "hecho");
  const noEncontrados = orden.itemsDetalle.filter((i) => i.estado === "no_encontrado");
  const yaResueltos = orden.itemsDetalle.filter((i) => i.estado === "ya_resuelto");
  const propuestos = orden.itemsDetalle.filter((i) => i.estado === "propuesto");
  const rechazados = orden.itemsDetalle.filter((i) => i.estado === "rechazado");
  // El progreso se mide sobre el plan real: un propuesto sin validar (o
  // rechazado) no es trabajo encargado y no puede inflar el denominador.
  const enPlan = orden.items - propuestos.length - rechazados.length;
  const pct = enPlan > 0 ? Math.round((100 * orden.hechos) / enPlan) : 0;

  return (
    <div className="mx-auto max-w-xl p-4 pb-16">
      {vista.esVistaEspejo && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amarillo/50 bg-amarillo/10 px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">
            <b className="text-amarillo">Vista espejo:</b> estás viendo el portal como{" "}
            <b>{orden.empresaNombre}</b>. Lo que cargues acá vale de verdad.
          </p>
          <Link href="/ordenes/empresas" className="shrink-0 font-semibold text-celeste hover:underline">
            volver a Órdenes
          </Link>
        </div>
      )}
      <Link
        href={`/empresa${sufijoEspejo}`}
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
            <b className="num">{numero(orden.hechos)}</b> de <b className="num">{numero(enPlan)}</b> hechos
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

      {/* La calle manda: lo que la cuadrilla encuentra y no estaba en el papel */}
      {activa && (
        <div className="mt-4">
          <ProponerItem ordenId={orden.id} />
        </div>
      )}

      {(propuestos.length > 0 || rechazados.length > 0) && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Propuestos por ustedes ({numero(propuestos.length + rechazados.length)})
          </h2>
          <div className="space-y-2">
            {propuestos.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                  <span className="rounded bg-amarillo/15 px-2 py-1 text-[11px] font-bold text-amarillo">
                    Esperando validación
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-texto-3">
                  {ETIQUETA_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo} · Bacheo lo está revisando: si
                  lo valida, aparece en los pendientes.
                </p>
              </Panel>
            ))}
            {rechazados.map((item) => {
              const motivo = motivoRechazo(item.metadata);
              return (
                <Panel key={item.id} className="px-4 py-3 text-sm opacity-80">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                    <span className="rounded bg-panel-3 px-2 py-1 text-[11px] font-bold text-texto-2">
                      Rechazado
                    </span>
                  </div>
                  {motivo && <p className="mt-0.5 text-xs text-texto-3">Motivo: {motivo}</p>}
                </Panel>
              );
            })}
          </div>
        </>
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

      {yaResueltos.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Ya estaban hechos ({numero(yaResueltos.length)})
          </h2>
          <div className="space-y-2">
            {yaResueltos.map((item) => (
              <Panel key={item.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{item.direccion ?? "Sin dirección"}</span>
                  <span className="rounded px-2 py-1 text-[11px] font-bold" style={{ background: "#5c8a7622", color: "#5c8a76" }}>
                    Ya estaba resuelto
                  </span>
                </div>
                {item.observaciones && (
                  <p className="mt-0.5 text-xs text-texto-3">{item.observaciones}</p>
                )}
              </Panel>
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

const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };
// La misma paleta funcional del relato (incidentes): pedido / en curso / hecho.
const COLOR_MOMENTO: Record<string, string> = { antes: "#3987e5", durante: "#d95926", despues: "#199e70" };

function ItemHecho({ item }: { item: ItemOrden }) {
  // Serializado para el visor (isla cliente): URL resuelta + etiqueta legible.
  const fotos: FotoVisor[] = item.fotos.flatMap((f) => {
    const url = urlFoto(f);
    if (!url) return [];
    const momento = ETIQUETA_MOMENTO[f.momento] ?? f.momento;
    return [
      {
        url,
        alt: `Foto ${momento}`,
        etiqueta: item.reportadoEn ? `${momento.toUpperCase()} · ${fechaCorta(item.reportadoEn)}` : momento.toUpperCase(),
        insignia: { texto: momento, color: COLOR_MOMENTO[f.momento] ?? "#ffffff" },
      },
    ];
  });

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
          /* El visor a pantalla completa: targets grandes para el capataz en
             el celular, sin abrir pestañas. */
          <GaleriaFotos fotos={fotos} miniAlto={96} miniAncho={128} className="mt-2 flex gap-2 overflow-x-auto pb-1" />
        )}
      </div>
    </details>
  );
}
