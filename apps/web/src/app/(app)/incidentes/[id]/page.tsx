import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, HardHat, Inbox, Wrench } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarCuadrillas, obtenerHistoriaIncidente } from "@/lib/consultas";
import { COLOR_MACRO, ETIQUETA_FUENTE, fechaCorta, macroDeEstado, numero } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { BadgeEstadoIncidente, BadgeFuente, BadgeTipo, Panel } from "@/components/ui";
import { MapaPunto } from "@/components/mapa/mapa-punto";
import { StreetView } from "@/components/mapa/street-view";
import { AccionesIncidente } from "../acciones-incidente";

export const dynamic = "force-dynamic";

/** Paleta funcional del relato (la misma del mapa): pedido / en curso / hecho. */
const C = { pedido: "#3987e5", curso: "#d95926", hecho: "#199e70", hito: "#f4dc00" } as const;

const ETIQUETA_IV: Record<string, string> = {
  asignada: "Asignada",
  en_curso: "En curso",
  finalizada: "Finalizada",
  anulada: "Anulada",
};

interface Evento {
  fecha: string | null;
  titulo: string;
  detalle?: string | null;
  color: string;
}

export default async function PaginaHistoriaIncidente({ params }: { params: Promise<{ id: string }> }) {
  const sesion = (await leerSesion())!;
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const nId = Number(id);
  const h = await obtenerHistoriaIncidente(sesion, nId);
  if (!h) notFound();
  const cuadrillas = await listarCuadrillas(sesion);

  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  const puedeVerificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "supervision";

  // ── La línea de tiempo: todos los hechos en orden cronológico ──────────────
  const eventos: Evento[] = [];
  const sinFecha: Evento[] = [];
  for (const d of h.demandas) {
    const ev: Evento = {
      fecha: d.sinFecha ? null : d.creadoEn,
      titulo: `Pedido vía ${ETIQUETA_FUENTE[d.fuente] ?? d.fuente}`,
      detalle: d.descripcion ? d.descripcion.slice(0, 110) : null,
      color: C.pedido,
    };
    (ev.fecha ? eventos : sinFecha).push(ev);
  }
  eventos.push({
    fecha: h.detectadoEn,
    titulo: "Problema detectado y agrupado como incidente",
    detalle: h.demandas.length > 1 ? `${h.demandas.length} pedidos apuntaban al mismo punto del territorio` : null,
    color: C.hito,
  });
  for (const iv of h.intervenciones) {
    // El evento se emite según el ESTADO real, no según qué fechas trajo el
    // importador (SIGOV certifica fechas también en obras en curso o anuladas).
    let emitido = false;
    if (iv.estado === "anulada") {
      const fecha = iv.finalizadaEn ?? iv.iniciadaEn;
      const ev: Evento = { fecha, titulo: `Trabajo anulado — ${iv.ejecutor}`, color: "#8b94a3" };
      (fecha ? eventos : sinFecha).push(ev);
      emitido = true;
    } else {
      if (iv.iniciadaEn) {
        eventos.push({ fecha: iv.iniciadaEn, titulo: `Trabajo iniciado — ${iv.ejecutor}`, color: C.curso });
        emitido = true;
      }
      if (iv.finalizadaEn && iv.estado === "finalizada") {
        eventos.push({
          fecha: iv.finalizadaEn,
          titulo: `Trabajo finalizado — ${iv.ejecutor}`,
          detalle: iv.superficieM2 != null ? `${numero(Math.round(iv.superficieM2))} m² reparados` : null,
          color: C.hecho,
        });
        emitido = true;
      }
    }
    if (!emitido) {
      const estadoTrabajo: Record<string, string> = { asignada: "asignado", en_curso: "en curso", finalizada: "finalizado" };
      sinFecha.push({ fecha: null, titulo: `Trabajo ${estadoTrabajo[iv.estado] ?? iv.estado} — ${iv.ejecutor}`, color: C.curso });
    }
  }
  if (h.cerradoEn) eventos.push({ fecha: h.cerradoEn, titulo: "Incidente cerrado", color: C.hecho });
  eventos.sort((a, b) => Date.parse(a.fecha!) - Date.parse(b.fecha!));

  const macro = macroDeEstado(h.estado);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <Link href="/incidentes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto">
        <ArrowLeft size={15} /> Cola de incidentes
      </Link>

      {/* Cabecera: qué es este problema y en qué está */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <BadgeTipo tipo={h.tipo} />
            <BadgeEstadoIncidente estado={h.estado} />
            {h.scorePrioridad != null && (
              <span className="num rounded-md border border-borde-2 px-2 py-0.5 text-xs font-bold text-amarillo" title="Score de priorización 0-100: combina cantidad de pedidos, antigüedad, tipo y fuente">
                prioridad {h.scorePrioridad.toFixed(1)}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">{h.direccion ?? `Incidente #${h.id}`}</h1>
          <p className="mt-1 text-sm text-texto-2">
            Incidente <span className="num">#{h.id}</span> · la historia completa de este punto: qué se pidió, qué se hizo y en qué quedó.
          </p>
        </div>
        <AccionesIncidente
          incidenteId={h.id}
          estado={h.estado}
          cuadrillas={cuadrillas}
          puedePlanificar={puedePlanificar}
          puedeVerificar={puedeVerificar}
        />
      </div>

      {/* La cadena pedido → problema → trabajo, en números */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        <Cadena n={h.demandas.length} etiqueta={h.demandas.length === 1 ? "pedido recibido" : "pedidos recibidos"}
          color={C.pedido} icono={<Inbox size={16} />}
          nota={h.demandas.length === 0 ? "nadie lo reclamó: se detectó trabajando" : null} />
        <Cadena n={1} etiqueta="problema en el territorio" color={C.hito} icono={<Wrench size={16} />}
          nota={h.superficieM2 != null ? `${numero(Math.round(h.superficieM2))} m² estimados` : null} />
        <Cadena n={h.intervenciones.length} etiqueta={h.intervenciones.length === 1 ? "trabajo en la calle" : "trabajos en la calle"}
          color={COLOR_MACRO[macro]} icono={<HardHat size={16} />}
          nota={h.intervenciones.length === 0 ? "todavía en la cola: sin trabajo asignado" : null} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Línea de tiempo */}
        <Panel className="p-5">
          <p className="mb-4 text-sm font-bold">Línea de tiempo</p>
          {eventos.length > 0 ? (
            <ol className="relative ml-2 space-y-5 border-l border-borde-2 pl-5">
              {eventos.map((ev, i) => (
                <li key={i} className="relative">
                  <span
                    className="absolute top-1 -left-[26px] h-3 w-3 rounded-full border-2 border-fondo"
                    style={{ background: ev.color }}
                  />
                  <p className="text-[13px] font-semibold leading-snug">{ev.titulo}</p>
                  {ev.detalle && <p className="mt-0.5 text-xs leading-relaxed text-texto-2">{ev.detalle}</p>}
                  <p className="num mt-0.5 text-[11px] text-texto-3">{fechaCorta(ev.fecha)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-texto-3">Sin hechos fechados todavía.</p>
          )}
          {sinFecha.length > 0 && (
            <div className="mt-5 border-t border-borde pt-4">
              <p className="mb-2 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                Sin fecha confiable (histórico consolidado)
              </p>
              {sinFecha.map((ev, i) => (
                <p key={i} className="flex items-center gap-2 py-0.5 text-xs text-texto-2">
                  <span className="inline-block h-2 w-2 rounded-full opacity-60" style={{ background: ev.color }} />
                  {ev.titulo}
                </p>
              ))}
            </div>
          )}
        </Panel>

        {/* Dónde está */}
        <div className="space-y-3">
          {h.lat != null && h.lon != null ? (
            <MapaPunto lat={h.lat} lon={h.lon} color={COLOR_MACRO[macro]} alto={280} />
          ) : (
            <Panel className="p-5 text-sm text-texto-3">Este incidente no tiene ubicación registrada.</Panel>
          )}
          <Panel className="space-y-2 p-4 text-[13px]">
            <FilaDato k="Detectado" v={fechaCorta(h.detectadoEn)} />
            {h.cerradoEn && <FilaDato k="Cerrado" v={fechaCorta(h.cerradoEn)} />}
            {h.superficieM2 != null && <FilaDato k="Superficie" v={`${numero(Math.round(h.superficieM2))} m²`} />}
            <FilaDato k="Pedidos vinculados" v={String(h.demandas.length)} />
            <FilaDato k="Trabajos" v={String(h.intervenciones.length)} />
          </Panel>
        </div>
      </div>

      {/* Lo que se pidió */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <Inbox size={15} style={{ color: C.pedido }} /> Lo que se pidió
        <span className="font-normal text-texto-3 normal-case">— los reclamos que apuntan a este lugar</span>
      </h2>
      {h.demandas.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {h.demandas.map((d) => (
            <Panel key={d.id} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <BadgeFuente fuente={d.fuente} />
                <span className="num text-[11px] text-texto-3">
                  {d.sinFecha ? "sin fecha de origen" : fechaCorta(d.creadoEn)}
                </span>
                {d.automatico && (
                  <span className="rounded border border-borde-2 px-1.5 py-0.5 text-[10px] text-texto-3"
                    title={`Vinculado automáticamente${d.confianza != null ? ` con confianza ${(d.confianza * 100).toFixed(0)}%` : ""}`}>
                    vínculo automático
                  </span>
                )}
              </div>
              <p className="line-clamp-2 text-[13px] leading-relaxed text-texto-2">
                {d.descripcion ?? d.direccion ?? "Sin descripción."}
              </p>
              <Link href={`/demandas/${d.id}`} className="mt-2 inline-block text-xs font-semibold text-celeste hover:underline">
                Ver el pedido completo →
              </Link>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel className="p-5 text-sm leading-relaxed text-texto-2">
          <b>Nadie pidió esto.</b> El problema se registró directamente desde el trabajo en la calle
          (cuadrilla u obra), sin un reclamo previo de vecinos ni instituciones. Es el caso típico del
          "trabajo sin pedido" que medimos en <Link href="/brecha" className="text-celeste hover:underline">Brecha</Link>.
        </Panel>
      )}

      {/* Lo que se hizo */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <HardHat size={15} style={{ color: C.hecho }} /> Lo que se hizo
        <span className="font-normal text-texto-3 normal-case">— los trabajos que atendieron este problema</span>
      </h2>
      {h.intervenciones.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {h.intervenciones.map((iv) => {
            const color = iv.estado === "finalizada" ? C.hecho : iv.estado === "en_curso" ? C.curso : "#8b94a3";
            return (
              <Panel key={iv.id} className="p-4">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: `${color}22`, color }}>
                    {ETIQUETA_IV[iv.estado] ?? iv.estado}
                  </span>
                  <span className="rounded border border-borde-2 px-1.5 py-0.5 text-[10px] text-texto-3">
                    {iv.contratada ? "Obra contratada (SIGOV)" : iv.deCuadrilla ? "Cuadrilla municipal" : "Sin datos del ejecutor"}
                  </span>
                </div>
                <p className="text-[13px] font-semibold">{iv.ejecutor}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-texto-2">
                  {iv.iniciadaEn && <span>Inicio: <span className="num">{fechaCorta(iv.iniciadaEn)}</span></span>}
                  {iv.finalizadaEn && iv.estado === "finalizada" && (
                    <span>Fin: <span className="num">{fechaCorta(iv.finalizadaEn)}</span></span>
                  )}
                  {iv.superficieM2 != null && <span className="num font-bold text-texto">{numero(Math.round(iv.superficieM2))} m²</span>}
                  {iv.fotos > 0 && (
                    <span className="flex items-center gap-1"><Camera size={12} /> {iv.fotos}</span>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel className="p-5 text-sm leading-relaxed text-texto-2">
          <b>Todavía no hay trabajos.</b> El problema está en la cola, ordenado por su score de
          prioridad. Cuando se programe una intervención va a aparecer acá, con su ejecutor, fechas y
          superficie.
        </Panel>
      )}

      {/* La evidencia: las fotos de la cuadrilla contra cómo se ve la calle */}
      <h2 className="mt-8 mb-3 flex items-center gap-2 text-sm font-bold tracking-wide uppercase">
        <Camera size={15} className="text-amarillo" /> La evidencia
        <span className="font-normal text-texto-3 normal-case">
          — las fotos de obra, contrastadas con la vista de calle
        </span>
      </h2>
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Panel className="p-4">
          {h.galeria.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {h.galeria.map((fo) => {
                const url = urlFoto(fo);
                if (!url) return null;
                return (
                  <a
                    key={fo.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block overflow-hidden rounded-lg border border-borde"
                    title="Abrir en tamaño completo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
                    <img
                      src={url}
                      alt={`Obra ${ETIQUETA_MOMENTO[fo.momento]} en ${h.direccion ?? "el lugar"}`}
                      className="h-32 w-full object-cover transition group-hover:brightness-110"
                      loading="lazy"
                    />
                    <span
                      className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
                      style={{
                        background: "rgba(7,10,16,0.8)",
                        color: fo.momento === "despues" ? C.hecho : fo.momento === "antes" ? C.pedido : C.curso,
                      }}
                    >
                      {ETIQUETA_MOMENTO[fo.momento]}
                    </span>
                    {/* El sello que vuelve la foto auditable: cuándo y dónde se tomó */}
                    <span className="absolute inset-x-0 bottom-0 bg-fondo/85 px-1.5 py-1 text-[9px] leading-tight text-texto-2">
                      {fo.tomadaEn ? fechaCorta(fo.tomadaEn) : "sin fecha"}
                      {fo.lat != null && fo.lon != null && (
                        <span className="num block text-texto-3">
                          {fo.lat.toFixed(5)}, {fo.lon.toFixed(5)}
                        </span>
                      )}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-sm leading-relaxed text-texto-2">
              <Camera size={22} className="mx-auto mb-2 text-texto-3" />
              <b>Sin fotos todavía.</b>
              <p className="mt-1 text-[13px] text-texto-3">
                Las cuadrillas las cargan desde{" "}
                <Link href="/campo" className="text-celeste hover:underline">Campo</Link> mientras trabajan
                (antes y después, con GPS y hora). Son obligatorias para poder finalizar un trabajo, así que
                van a aparecer acá solas.
              </p>
            </div>
          )}
        </Panel>
        {h.lat != null && h.lon != null && (
          <div>
            <StreetView lat={h.lat} lon={h.lon} alto={200} etiqueta="La calle hoy" />
            <p className="mt-1.5 text-[11px] leading-snug text-texto-3">
              Vista de calle del punto exacto. Sirve de referencia para contrastar con las fotos de obra —
              tocala para recorrerla.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const ETIQUETA_MOMENTO: Record<string, string> = {
  antes: "Antes",
  durante: "Durante",
  despues: "Después",
};

function Cadena({
  n,
  etiqueta,
  color,
  icono,
  nota,
}: {
  n: number;
  etiqueta: string;
  color: string;
  icono: React.ReactNode;
  nota?: string | null;
}) {
  return (
    <div className="panel-vidrio rounded-xl border-t-2 px-3 py-3 sm:px-4" style={{ borderTopColor: color }}>
      <div className="flex items-center gap-2" style={{ color }}>
        {icono}
        <span className="num text-2xl font-extrabold">{numero(n)}</span>
      </div>
      <p className="mt-0.5 text-[11px] leading-tight text-texto-2">{etiqueta}</p>
      {nota && <p className="mt-1 text-[10px] leading-tight text-texto-3">{nota}</p>}
    </div>
  );
}

function FilaDato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-texto-3">{k}</span>
      <span className="num font-semibold">{v}</span>
    </div>
  );
}
