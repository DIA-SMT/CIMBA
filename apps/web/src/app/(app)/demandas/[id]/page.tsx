import Link from "next/link";
import { notFound } from "next/navigation";
import { leerSesion, puedeVerContacto } from "@/lib/auth";
import { obtenerDemanda, sugerenciasParaDemanda } from "@/lib/consultas";
import { analisisDemandaSchema, iaDisponible, type AnalisisDemanda } from "@/lib/ia";
import { fechaCorta } from "@/lib/formato";
import { BadgeEstadoDemanda, BadgeFuente, BadgeTipo, BarraConfianza, Panel, TituloPagina } from "@/components/ui";
import { AccionesDemanda } from "./acciones-demanda";
import { CorregirUbicacion } from "./corregir-ubicacion";
import { VerEnMapa } from "@/components/mapa/ver-en-mapa";

export const dynamic = "force-dynamic";

function analisisIaGuardado(metadata: Record<string, unknown>): AnalisisDemanda | null {
  const parseado = analisisDemandaSchema.safeParse(metadata.ia);
  return parseado.success ? parseado.data : null;
}

export default async function PaginaDemanda({ params }: { params: Promise<{ id: string }> }) {
  const sesion = (await leerSesion())!;
  const { id } = await params;
  const demanda = await obtenerDemanda(sesion, Number(id));
  if (!demanda) notFound();

  const sugerencias = demanda.lat != null ? await sugerenciasParaDemanda(sesion, demanda.id) : [];
  const puedeGestionar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "atencion_ciudadana";
  const puedeCorregir = ["admin", "atencion_ciudadana", "planificacion", "informacion_estrategica"].includes(
    sesion.rol_cimba,
  );
  const contacto = demanda.contacto && Object.keys(demanda.contacto).length > 0 ? demanda.contacto : null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/demandas" className="text-sm text-texto-2 hover:text-texto">← Bandeja</Link>
      <TituloPagina titulo={`Demanda #${demanda.id}`} sub={demanda.direccion ?? undefined} />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="space-y-3 p-5 text-sm">
          <div className="flex flex-wrap gap-2">
            <BadgeFuente fuente={demanda.fuente} />
            <BadgeTipo tipo={demanda.tipo} />
            <BadgeEstadoDemanda estado={demanda.estado} />
          </div>
          {demanda.descripcion && <p className="text-texto-2">{demanda.descripcion}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-texto-3">Ingresó</dt>
            <dd className="num">{fechaCorta(demanda.creadoEn)}</dd>
            <dt className="text-texto-3">Distrito</dt>
            <dd className="num">{demanda.distritoId ?? "—"}</dd>
            <dt className="text-texto-3">Geocodificación</dt>
            <dd><BarraConfianza valor={demanda.geocodConfianza} /></dd>
            <dt className="text-texto-3">Coordenadas</dt>
            <dd className="num text-xs">
              {demanda.lat != null ? `${demanda.lat.toFixed(6)}, ${demanda.lon?.toFixed(6)}` : "sin ubicación"}
            </dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {demanda.lat != null && demanda.lon != null && (
              <>
                <VerEnMapa lat={demanda.lat} lon={demanda.lon} etiqueta={demanda.direccion ?? `Demanda #${demanda.id}`} color="#8fa3bf" />
                <Link
                  href={`/mapa?lat=${demanda.lat.toFixed(6)}&lon=${demanda.lon.toFixed(6)}&z=17`}
                  className="inline-block text-[13px] font-semibold text-celeste hover:underline"
                >
                  Abrir en el mapa completo →
                </Link>
              </>
            )}
          </div>
          {puedeCorregir && <CorregirUbicacion demandaId={demanda.id} lat={demanda.lat} lon={demanda.lon} />}
        </Panel>

        <div className="space-y-4">
          {puedeVerContacto(sesion.rol_cimba) && contacto && (
            <Panel className="p-5 text-sm">
              <p className="mb-2 text-[10px] font-bold tracking-wider text-amarillo uppercase">
                Contacto del vecino · acceso restringido
              </p>
              <dl className="space-y-1 text-[13px]">
                {Object.entries(contacto).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="w-20 text-texto-3 capitalize">{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[10px] text-texto-3">
                Estos datos nunca aparecen en el mapa ni en exportaciones.
              </p>
            </Panel>
          )}

          {Object.keys(demanda.metadata).length > 0 && (
            <Panel className="p-5">
              <p className="mb-2 text-[10px] font-bold tracking-wider text-texto-3 uppercase">Metadatos de origen</p>
              <dl className="space-y-1 text-xs">
                {Object.entries(demanda.metadata)
                  .filter(([, v]) => v != null && v !== "" && v !== false && typeof v !== "object")
                  .slice(0, 10)
                  .map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-32 shrink-0 text-texto-3">{k.replaceAll("_", " ")}</dt>
                      <dd className="truncate text-texto-2" title={String(v)}>{String(v)}</dd>
                    </div>
                  ))}
              </dl>
            </Panel>
          )}
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-bold tracking-wide uppercase">
        ¿Es el mismo problema? <span className="font-normal text-texto-3">— incidentes cercanos sugeridos</span>
      </h2>
      <AccionesDemanda
        demandaId={demanda.id}
        estado={demanda.estado}
        tieneUbicacion={demanda.lat != null}
        sugerencias={sugerencias}
        puedeGestionar={puedeGestionar}
        iaHabilitada={iaDisponible()}
        analisisPrevio={analisisIaGuardado(demanda.metadata)}
      />
    </div>
  );
}
