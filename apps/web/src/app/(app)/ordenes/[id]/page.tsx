import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas, listarOrdenes, obtenerOrden, type ItemOrden } from "@/lib/ordenes";
import { fechaCorta, numero } from "@/lib/formato";
import { TicketBache } from "@/components/ticket-bache";
import { formatoToneladas, medicionDelItem, toneladasDe, volumenDe } from "@/lib/medicion";
import { urlFoto } from "@/lib/fotos";
import { Panel } from "@/components/ui";
import { GaleriaFotos, type FotoVisor } from "@/components/visor-fotos";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";
import type { TipoIntervencion } from "@cimba/domain";
import { AccionesOrden } from "./acciones-orden";
import { HojaOrdenImprimible } from "./hoja-orden";
import { CorregirFecha } from "./corregir-fecha";
import { CorregirUbicacionItem } from "@/components/corregir-ubicacion-item";
import { MoverItem } from "./mover-item";
import { MapaOrden } from "@/app/empresa/orden/[id]/mapa-orden";
import { ResolverPropuesto } from "./resolver-propuesto";
import { BorrarItem } from "./borrar-item";
import { CorregirMedidas } from "./corregir-medidas";
import { SelectTipoIntervencion } from "./select-tipo-intervencion";
import { ETIQUETA_TIPO_INTERVENCION } from "./tipos-intervencion";
import { PanelTabla } from "@/components/tabla-deslizable";
import {
  COLOR_ESTADO_ITEM,
  COLOR_ESTADO_ORDEN,
  fondoTenue,
  COLOR_PRIORIDAD,
  ETIQUETA_AMBITO,
  ETIQUETA_ESTADO_ITEM,
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_PRIORIDAD,
  ETIQUETA_TIPO_TRABAJO,
} from "../etiquetas";

export const dynamic = "force-dynamic";


const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };


/** Quién y cuándo propuso el item (metadata.propuesto, lo escribe proponerItem). */
function datosPropuesto(metadata: Record<string, unknown>): { por: string | null; en: string | null } {
  const p = metadata.propuesto as { por?: unknown; en?: unknown } | undefined;
  return {
    por: typeof p?.por === "string" ? p.por : null,
    en: typeof p?.en === "string" ? p.en : null,
  };
}

/**
 * Lo que la cuadrilla cargó cuando propuso el bache YA TAPADO: la foto del
 * después, cómo lo midió y quién lo hizo. Sin esto, validar era decidir a
 * ciegas — "faltaría poder acceder al registro para ver las fotos y los datos
 * que cargaron, o que aparezca la foto del antes y después ahí para comparar
 * y validar con más confianza" (15/09).
 */
function datosYaEjecutado(metadata: Record<string, unknown>): {
  fotoDespues: string | null;
  medicion: string | null;
  capataz: string | null;
  /** Día en que lo taparon (YYYY-MM-DD). Los propuestos viejos no lo tienen. */
  fecha: string | null;
} {
  const y = metadata.ya_ejecutado as
    | { foto_despues?: unknown; medicion?: unknown; capataz?: unknown; fecha?: unknown }
    | undefined;
  return {
    fotoDespues: typeof y?.foto_despues === "string" ? y.foto_despues : null,
    medicion: typeof y?.medicion === "string" ? y.medicion : null,
    capataz: typeof y?.capataz === "string" ? y.capataz : null,
    fecha: typeof y?.fecha === "string" ? y.fecha : null,
  };
}

/** El día de Tucumán de una fecha con hora, 'YYYY-MM-DD'. Con slice(0, 10)
 *  sobre UTC, lo cerrado a la noche quedaba en el día siguiente. */
function diaEnTucuman(fecha: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Tucuman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(fecha));
}

/** Ruta en Storage de la foto que mandó la cuadrilla al proponer (si mandó). */
function fotoPropuesta(metadata: Record<string, unknown>): string | null {
  return typeof metadata.foto_propuesta === "string" ? metadata.foto_propuesta : null;
}

export default async function PaginaOrden({ params }: { params: Promise<{ id: string }> }) {
  const sesion = (await leerSesion())!;
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const o = await obtenerOrden(sesion, Number(id));
  if (!o) notFound();

  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  /* Para poder pasarle la orden a otra empresa. Solo las activas: a una dada
     de baja no se le asigna trabajo nuevo. */
  const empresas = puedePlanificar
    ? (await listarEmpresas(sesion)).filter((e) => e.activa).map((e) => ({ id: e.id, nombre: e.nombre }))
    : [];
  // Supervisión también valida propuestos (resolverPropuesto lo permite); la
  // corrección del tipo de intervención queda para admin/planificación.
  const puedeSupervisar = puedePlanificar || sesion.rol_cimba === "supervision";
  /* A dónde se puede pasar un bache cargado en la orden equivocada (28/10):
     las otras órdenes de la MISMA empresa que no estén anuladas ni en borrador. */
  const destinosMover = puedeSupervisar
    ? (await listarOrdenes(sesion, { empresaId: o.empresaId }))
        .filter((x) => x.id !== o.id && x.estado !== "anulada" && x.estado !== "borrador")
        .map((x) => ({ id: x.id, numero: x.numero, detalle: x.ambitoNombre ?? x.titulo ?? "" }))
    : [];
  const noEncontrados = o.itemsDetalle.filter((i) => i.estado === "no_encontrado").length;
  const propuestos = o.itemsDetalle.filter((i) => i.estado === "propuesto");
  /* Los puntos del mapa: lo que falta, lo hecho y lo que espera validación. */
  const puntosDelMapa = o.itemsDetalle.flatMap((i) =>
    i.lat != null && i.lon != null && i.estado !== "rechazado"
      ? [
          {
            id: i.id,
            lat: i.lat,
            lon: i.lon,
            direccion: i.direccion,
            hecho: i.estado !== "pendiente" && i.estado !== "propuesto",
            estado:
              i.estado === "propuesto"
                ? ("sin_validar" as const)
                : i.estado === "pendiente"
                  ? ("falta" as const)
                  : ("hecho" as const),
            fueraM: i.fueraDelAmbitoM ?? null,
          },
        ]
      : [],
  );
  const fueraDelArea = puntosDelMapa.filter((p) => p.fueraM != null).length;
  // El plan real de la orden: lo propuesto sin validar (y lo rechazado) no es
  // trabajo encargado — ni infla el % de avance ni sale en la hoja impresa.
  const itemsPapel = o.itemsDetalle.filter((i) => i.estado !== "propuesto" && i.estado !== "rechazado");
  // o.enPlan es itemsPapel.length calculado en la consulta: se usa el del
  // servidor para que el listado y el detalle no puedan divergir nunca.
  /**
   * LOS TOTALES DE LA ORDEN. Solo suman los items que TIENEN medidas: un
   * pendiente sin cargar no aporta cero metros, aporta "todavía no se sabe", y
   * mezclarlos haría que el total baje de sentido a medida que se emiten
   * órdenes nuevas. Las toneladas salen del volumen a 2,4 t/m³, la misma
   * constante con la que se certifica (ver lib/medicion.ts).
   *
   * Dos totales y no uno: la pantalla muestra también lo rechazado y lo no
   * encontrado, y el papel es el plan que se firma. Si compartieran el número,
   * uno de los dos estaría mal.
   */
  const sumar = (items: typeof o.itemsDetalle) =>
    items.reduce(
      (acc, it) => {
        if (it.superficieM2 == null || it.espesorCm == null) return acc;
        return {
          items: acc.items + 1,
          m2: acc.m2 + it.superficieM2,
          toneladas: acc.toneladas + toneladasDe(volumenDe(it.superficieM2, it.espesorCm)),
        };
      },
      { items: 0, m2: 0, toneladas: 0 },
    );
  const totales = sumar(o.itemsDetalle.filter((i) => i.estado !== "propuesto"));

  const pct = o.enPlan > 0 ? Math.round((100 * o.hechos) / o.enPlan) : 0;
  const colorEstado = COLOR_ESTADO_ORDEN[o.estado];


  return (
    <div className="mx-auto max-w-6xl p-6">

      {/* ══ Versión pantalla ══ */}
      <div className="print:hidden">
        <Link
          href="/ordenes"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-texto-2 transition hover:text-texto"
        >
          <ArrowLeft size={15} /> Órdenes
        </Link>

        {/* Cabecera */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span
                className="rounded-md px-2 py-0.5 text-xs font-bold"
                style={{ background: fondoTenue(colorEstado), color: colorEstado }}
              >
                {ETIQUETA_ESTADO_ORDEN[o.estado]}
              </span>
              <span className="text-xs font-semibold" style={{ color: COLOR_PRIORIDAD[o.prioridad] }}>
                Prioridad {ETIQUETA_PRIORIDAD[o.prioridad].toLowerCase()}
              </span>
              {/* Mismo dato que la hoja impresa, misma fuente. */}
              {o.ambitoNombre && (
                <span className="rounded-md border border-borde-2 px-2 py-0.5 text-xs font-semibold">
                  {ETIQUETA_AMBITO[o.ambito] ?? "Ámbito"} {o.ambitoNombre}
                </span>
              )}
            </div>
            <h1 className="num text-3xl font-extrabold tracking-tight">{o.numero}</h1>
            <p className="mt-1 text-sm text-texto-2">
              {o.titulo ?? "Orden de trabajo"} · <b>{o.empresaNombre}</b>
              {o.contratoDecreto && <> · Contrato/Decreto {o.contratoDecreto}</>}
            </p>
            <p className="num mt-1 text-xs text-texto-3">
              Creada {fechaCorta(o.creadoEn)}
              {o.emitidaEn && <> · emitida {fechaCorta(o.emitidaEn)}</>}
              {o.venceEn && <> · vence {fechaCorta(o.venceEn)}</>}
              {o.cerradaEn && <> · cerrada {fechaCorta(o.cerradaEn)}</>}
            </p>
            {/* La fecha de finalización se corrige acá mismo: el cierre si la
                orden ya terminó, el vencimiento si sigue viva. */}
            {puedePlanificar && o.estado !== "anulada" && (
              <div className="mt-1">
                <CorregirFecha
                  ordenId={o.id}
                  campo={o.estado === "completada" ? "cierre" : "vencimiento"}
                  actual={
                    o.estado === "completada"
                      ? o.cerradaEn
                        ? diaEnTucuman(o.cerradaEn)
                        : null
                      : (o.venceEn?.slice(0, 10) ?? null)
                  }
                />
              </div>
            )}
          </div>
          <AccionesOrden
            ordenId={o.id}
            numero={o.numero}
            estado={o.estado}
            puedePlanificar={puedePlanificar}
            itemsPendientes={o.itemsDetalle.filter((i) => i.estado === "pendiente").length}
            propuestosSinValidar={propuestos.length}
            cargaTerminada={o.cargaTerminada}
            empresaId={o.empresaId}
            empresas={empresas}
          />
        </div>

        {o.indicaciones && (
          <Panel className="mb-5 p-4 text-sm leading-relaxed text-texto-2">
            <b className="text-texto">Indicaciones:</b> {o.indicaciones}
          </Panel>
        )}

        {/* Progreso */}
        <Panel className="mb-6 p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="num text-2xl font-extrabold">
                <span style={{ color: "#199e70" }}>{numero(o.hechos)}</span>
                <span className="text-texto-3"> / {numero(itemsPapel.length)}</span>
              </p>
              <p className="text-[11px] text-texto-3">items hechos</p>
            </div>
            <div>
              <p className="num text-2xl font-extrabold" style={{ color: o.m2Reportados > 0 ? "#199e70" : undefined }}>
                {numero(o.m2Reportados)}
              </p>
              <p className="text-[11px] text-texto-3">m² reportados</p>
            </div>
            <div>
              <p className="num text-2xl font-extrabold" style={{ color: noEncontrados > 0 ? "#d95926" : undefined }}>
                {numero(noEncontrados)}
              </p>
              <p className="text-[11px] text-texto-3">no encontrados</p>
            </div>
            <div className="min-w-40 flex-1">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-3">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#199e70" }} />
              </div>
              <p className="num mt-1 text-right text-[11px] text-texto-3">{pct}%</p>
            </div>
          </div>
        </Panel>

        {/**
          * DÓNDE ESTÁ CADA BACHE, antes de validar (Leo, 13/10). Es el mismo
          * mapa que ve la empresa en su portal, con el área de la orden y un
          * aro rojo en lo que cae afuera: validar un bache que está en la zona
          * de otra empresa ahora se ve antes de tocar el botón.
          */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold tracking-wide uppercase">
            Dónde está cada bache{" "}
            {fueraDelArea > 0 && (
              <span className="font-semibold text-peligro normal-case">
                · {fueraDelArea === 1 ? "1 cae fuera del área de la orden" : `${numero(fueraDelArea)} caen fuera del área de la orden`}
              </span>
            )}
          </h2>
          <MapaOrden puntos={puntosDelMapa} area={o.areaAmbito ?? o.poligono} modo="direccion" alto={380} />
        </section>

        {/* Bandeja de validación: lo que la cuadrilla encontró en la calle */}
        {propuestos.length > 0 && (
          <>
            <h2 id="propuestos" className="mb-3 scroll-mt-20 text-sm font-bold tracking-wide uppercase">
              Propuestos por la empresa ({numero(propuestos.length)}){" "}
              <span className="font-normal text-texto-3 normal-case">
                — baches que la cuadrilla encontró y no estaban en la orden; validado, pasa a pendiente
              </span>
            </h2>
            <div className="mb-6 space-y-3">
              {propuestos.map((it) => {
                const prop = datosPropuesto(it.metadata);
                const ruta = fotoPropuesta(it.metadata);
                const urlPropuesta = ruta ? urlFoto({ storagePath: ruta, urlExterna: null }) : null;
                const ejec = datosYaEjecutado(it.metadata);
                const urlDespues = ejec.fotoDespues
                  ? urlFoto({ storagePath: ejec.fotoDespues, urlExterna: null })
                  : null;
                /* ANTES y DESPUÉS juntos, en ese orden: validar es comparar. */
                const fotosPropuesto: FotoVisor[] = [
                  ...(urlPropuesta
                    ? [
                        {
                          url: urlPropuesta,
                          alt: "Foto del bache propuesto",
                          etiqueta: `ANTES · ${it.direccion ?? `Item #${it.id}`}`,
                        },
                      ]
                    : []),
                  ...(urlDespues
                    ? [
                        {
                          url: urlDespues,
                          alt: "Foto del trabajo terminado",
                          etiqueta: `DESPUÉS · ${it.direccion ?? `Item #${it.id}`}`,
                        },
                      ]
                    : []),
                ];
                return (
                  <Panel key={it.id} id={`item-${it.id}`} className="scroll-mt-20 border-amarillo/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <ChipMiniMapa lat={it.lat} lon={it.lon} etiqueta={it.direccion ?? `Item #${it.id}`} />
                          <span className="font-semibold">{it.direccion ?? "Sin dirección"}</span>
                          <TicketBache id={it.id} tickets147={it.tickets147} />
                          <span className="rounded-md border border-borde-2 px-2 py-0.5 text-[11px] font-semibold text-texto-2">
                            {ETIQUETA_TIPO_TRABAJO[it.tipoTrabajo] ?? it.tipoTrabajo}
                          </span>
                          {it.fueraDelAmbitoM != null && (
                            <span className="rounded-md bg-peligro/10 px-2 py-0.5 text-[11px] font-bold text-peligro">
                              Fuera del área de la orden · a {numero(it.fueraDelAmbitoM)} m
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-texto-3">
                          Propuesto{prop.por && <> por <b className="text-texto-2">{prop.por}</b></>}
                          {prop.en && <> el {fechaCorta(prop.en)}</>}
                        </p>
                        {it.observaciones && (
                          <p className="mt-1 text-sm text-texto-2">{it.observaciones}</p>
                        )}

                        {/**
                          * LO QUE CARGARON, A LA VISTA DE QUIEN VALIDA.
                          *
                          * Si la cuadrilla lo propuso YA TAPADO, validar no es
                          * "¿existe este bache?" sino "¿le creo la medida?" — y
                          * eso no se puede contestar sin ver la medida. Va con
                          * las toneladas calculadas, que es lo que se certifica:
                          * validar esto es habilitar un pago.
                          */}
                        {it.superficieM2 != null && it.espesorCm != null && (
                          <div className="mt-2 rounded-lg border border-amarillo/40 bg-amarillo/5 px-3 py-2 text-[12px] leading-relaxed">
                            <b className="text-amarillo">Ya lo taparon y lo midieron.</b>{" "}
                            <span className="num font-semibold">
                              {numero(it.superficieM2)} m²
                            </span>{" "}
                            · espesor <span className="num">{numero(it.espesorCm)} cm</span> ·{" "}
                            <span className="num font-semibold text-amarillo">
                              {formatoToneladas(toneladasDe(volumenDe(it.superficieM2, it.espesorCm)))}
                            </span>
                            {it.anchoM != null && it.largoM != null && (
                              <>
                                {" "}
                                · <span className="num">{numero(it.anchoM)} × {numero(it.largoM)} m</span>
                              </>
                            )}
                            {ejec.medicion && <> · medido por {ejec.medicion}</>}
                            {ejec.capataz && (
                              <>
                                {" "}
                                · capataz <b className="text-texto-2">{ejec.capataz}</b>
                              </>
                            )}
                            {ejec.fecha && (
                              <>
                                {" "}
                                · tapado el{" "}
                                <b className="num text-texto-2">{ejec.fecha.split("-").reverse().join("/")}</b>
                              </>
                            )}
                            <span className="mt-0.5 block text-texto-3">
                              Al validar se crea la intervención con estas medidas y el item pasa a hecho.
                            </span>
                          </div>
                        )}
                        {puedeSupervisar && (
                          <div className="mt-3">
                            <ResolverPropuesto itemId={it.id} />
                            {/* Corregir ANTES de decidir. Un propuesto con el
                                pin media cuadra corrido no se podía arreglar:
                                había que rechazarlo y pedir que lo cargaran de
                                nuevo, con foto y medidas otra vez. */}
                            <div className="mt-2">
                              <CorregirUbicacionItem
                                itemId={it.id}
                                lat={it.lat}
                                lon={it.lon}
                                direccion={it.direccion}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {fotosPropuesto.length > 0 && (
                        <GaleriaFotos fotos={fotosPropuesto} miniAlto={96} miniAncho={128} className="flex shrink-0 gap-2" />
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          </>
        )}

        {/* Items */}
        <h2 className="mb-3 text-sm font-bold tracking-wide uppercase">
          Los items{" "}
          <span className="font-normal text-texto-3 normal-case">
            — cada carga de la empresa crea la intervención real que alimenta la brecha
          </span>
          {/* El control del inspector de ESTA orden: fotos y medidas de cada
              carga, con la baja para lo duplicado o mal cargado. */}
          {o.hechos > 0 && (
            <Link
              href={`/ordenes/control?vista=todos&orden=${o.id}`}
              className="ml-2 text-xs font-semibold text-celeste normal-case hover:underline"
            >
              Controlar lo cargado →
            </Link>
          )}
        </h2>
        {/* En el celular la tabla se vuelve una ficha por bache (14/10: "deben
            verse todos los items"): 11 columnas en 375 px eran 1.272 px de
            tabla en 262 visibles. Cada dato lleva su nombre (data-etiqueta). */}
        <PanelTabla>
          <table className="w-full text-sm max-md:block">
            <thead className="max-md:hidden">
              <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                <th className="px-3 py-3">Dirección</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="num px-3 py-3 text-right" title="Reclamos detrás de este punto">Reclamos</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3" title="Cómo se resolvió realmente (lo declara la empresa al reportar)">
                  Intervención
                </th>
                <th className="px-3 py-3" title="Ancho × largo × espesor reportados">Medidas</th>
                <th className="num px-3 py-3 text-right">m²</th>
                <th className="num px-3 py-3 text-right text-amarillo" title="Del volumen a 2,4 t/m³: es la unidad con la que se certifica">
                  Toneladas
                </th>
                <th className="px-3 py-3">Reportado</th>
                <th className="px-3 py-3">Fotos</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="max-md:block">
              {/* Los propuestos viven arriba, en la bandeja con sus botones:
                  acá abajo solo el plan y sus desenlaces (rechazados incluidos). */}
              {o.itemsDetalle
                .filter((it) => it.estado !== "propuesto")
                .map((it) => (
                  <FilaItem key={it.id} item={it} puedeCorregirTipo={puedePlanificar} puedePlanificar={puedePlanificar} destinosMover={destinosMover} />
                ))}
              {/**
                * LA SUMA, AL PIE DE LA COLUMNA QUE SUMA.
                *
                * "En los reportes debe aparecer las toneladas de cada bache y
                * en el cuadro una sumatoria de los m² y las toneladas"
                * (Dirección de Bacheo, 16/09). Quien certifica sacaba el total
                * con una calculadora al lado de la pantalla, que es justo
                * donde se cuela un error de tipeo en un número que es un pago.
                */}
              {totales.items > 0 && (
                <tr className="border-t-2 border-borde bg-panel-2 text-sm font-bold max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:p-3">
                  <td className="px-3 py-3 max-md:col-span-2 max-md:p-0" colSpan={6}>
                    Total reportado{" "}
                    <span className="font-normal text-texto-3">
                      — {numero(totales.items)} {totales.items === 1 ? "trabajo" : "trabajos"} con medidas
                    </span>
                  </td>
                  <td data-etiqueta="m²" className="num px-3 py-3 text-right max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]" style={{ color: "#199e70" }}>
                    {numero(totales.m2)}
                  </td>
                  <td data-etiqueta="Toneladas" className="num px-3 py-3 text-right text-amarillo max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
                    {formatoToneladas(totales.toneladas)}
                  </td>
                  <td className="px-3 py-3 max-md:hidden" colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        </PanelTabla>
      </div>

      {/* ══ Hoja de impresión: la orden en papel (la misma que baja la empresa) ══ */}
      <HojaOrdenImprimible o={o} />
    </div>
  );
}

function FilaItem({
  item,
  puedeCorregirTipo,
  puedePlanificar,
  destinosMover,
}: {
  item: ItemOrden;
  puedeCorregirTipo: boolean;
  puedePlanificar: boolean;
  /** Vacío para quien no es de Bacheo: ahí no aparece «Pasar a otra orden». */
  destinosMover: Array<{ id: number; numero: string; detalle: string }>;
}) {
  const medidas =
    item.anchoM != null && item.largoM != null && item.espesorCm != null
      ? `${numero(item.anchoM)} × ${numero(item.largoM)} m · ${numero(item.espesorCm)} cm`
      : null;
  // Todas las fotos del item, ya serializadas para el visor (isla cliente):
  // un click en cualquier thumbnail abre la tanda completa, sin pestañas.
  const fotosVisor: FotoVisor[] = item.fotos.flatMap((f) => {
    const url = urlFoto(f);
    if (!url) return [];
    const momento = ETIQUETA_MOMENTO[f.momento] ?? f.momento;
    return [
      {
        url,
        alt: `Foto ${momento}`,
        etiqueta: `${momento.toUpperCase()} · ${item.direccion ?? `Item #${item.id}`}`,
      },
    ];
  });
  return (
    <tr
      id={`item-${item.id}`}
      className="scroll-mt-20 border-b border-borde/60 transition hover:bg-panel-2 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2.5 max-md:px-3 max-md:py-3.5"
    >
      <td className="max-w-56 px-3 py-2.5 max-md:col-span-2 max-md:max-w-none max-md:p-0">
        <div className="flex items-center gap-1.5">
          {/* El pedido del Director: verificar el punto sin salir de la orden */}
          <ChipMiniMapa lat={item.lat} lon={item.lon} etiqueta={item.direccion ?? `Item #${item.id}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={item.direccion ?? undefined}>
              {item.direccion ?? "Sin dirección"}
            </span>
            <TicketBache id={item.id} tickets147={item.tickets147} className="mt-0.5" />
            {item.observaciones && (
              <span className="block truncate text-[11px] text-texto-3" title={item.observaciones}>
                {item.observaciones}
              </span>
            )}
          </span>
        </div>
      </td>
      <td data-etiqueta="Tipo" className="px-3 py-2.5 text-xs text-texto-2 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">{ETIQUETA_TIPO_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo}</td>
      <td data-etiqueta="Reclamos" className="num px-3 py-2.5 text-right font-bold max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]" style={{ color: item.reclamos > 0 ? "var(--color-amarillo)" : "var(--color-texto-3)" }}>
        {numero(item.reclamos)}
      </td>
      <td data-etiqueta="Estado" className="px-3 py-2.5 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
          style={{ background: fondoTenue(COLOR_ESTADO_ITEM[item.estado]), color: COLOR_ESTADO_ITEM[item.estado] }}
        >
          {ETIQUETA_ESTADO_ITEM[item.estado]}
        </span>
      </td>
      <td data-etiqueta="Intervención" className="px-3 py-2.5 max-md:min-w-0 max-md:[&_select]:w-full max-md:[&_select]:min-w-0max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
        {item.tipoIntervencion != null && item.intervencionId != null ? (
          puedeCorregirTipo ? (
            /* "Capaz que empieza como bacheo y al final se ha hecho cambio de
               paño": el Director lo corrige acá mismo, sin salir de la orden. */
            <SelectTipoIntervencion
              intervencionId={item.intervencionId}
              tipo={item.tipoIntervencion as TipoIntervencion}
            />
          ) : (
            <span className="text-xs whitespace-nowrap text-texto-2">
              {ETIQUETA_TIPO_INTERVENCION[item.tipoIntervencion as TipoIntervencion] ?? item.tipoIntervencion}
            </span>
          )
        ) : (
          <span className="text-xs text-texto-3">—</span>
        )}
      </td>
      <td data-etiqueta="Medidas" className="num px-3 py-2.5 text-xs whitespace-nowrap text-texto-2 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
        <span className="flex items-center gap-1.5">
          {medidas ?? "—"}
          {/* "Todos nos equivocamos, seguro cargan mal": la medida entra desde
              un teléfono con guantes y hasta ahora quedaba fija para siempre.
              Solo sobre trabajo ya reportado y todavía sin certificar. */}
          {puedePlanificar && item.estado === "hecho" && item.intervencionId != null && (
            <CorregirMedidas
              itemId={item.id}
              superficieM2={item.superficieM2}
              espesorCm={item.espesorCm}
              anchoM={item.anchoM}
              largoM={item.largoM}
              medicion={medicionDelItem(item.metadata)}
              tipoObra={item.tipoObra ?? null}
              enActa={item.actaId != null}
            />
          )}
        </span>
      </td>
      <td data-etiqueta="m²" className="num px-3 py-2.5 text-right max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]" style={{ color: item.superficieM2 != null ? "#199e70" : "#5c6b84" }}>
        {item.superficieM2 != null ? numero(item.superficieM2) : "—"}
      </td>
      {/* Faltaba: el encabezado tenía "Toneladas" y la fila no, así que desde
          acá cada dato caía bajo la columna de al lado. */}
      <td data-etiqueta="Toneladas" className="num px-3 py-2.5 text-right text-amarillo max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
        {item.superficieM2 != null && item.espesorCm != null
          ? formatoToneladas(toneladasDe(volumenDe(item.superficieM2, item.espesorCm)))
          : "—"}
      </td>
      <td data-etiqueta="Reportado" className="num px-3 py-2.5 text-xs text-texto-2 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">{fechaCorta(item.reportadoEn)}</td>
      <td data-etiqueta="Fotos" className="px-3 py-2.5 max-md:col-span-2 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[10px] max-md:before:font-semibold max-md:before:tracking-wider max-md:before:text-texto-3 max-md:before:uppercase max-md:before:content-[attr(data-etiqueta)]">
        {fotosVisor.length > 0 ? (
          <GaleriaFotos fotos={fotosVisor} miniAlto={80} miniAncho={80} className="flex gap-1.5" />
        ) : (
          <span className="text-xs text-texto-3">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right max-md:col-span-2 max-md:p-0 max-md:text-left">
        {item.incidenteId != null && (
          <Link
            href={`/incidentes/${item.incidenteId}`}
            className="num text-xs font-semibold whitespace-nowrap text-celeste hover:underline"
            title="La historia completa de este punto"
          >
            #{item.incidenteId} →
          </Link>
        )}
        {/* Sacar un punto que no corresponde. Solo mientras no tenga
            trabajo reportado: detrás de un item hecho hay una intervención
            con fotos y m², y borrarlo dejaría los números mintiendo. */}
        {puedePlanificar && item.estado !== "hecho" && item.intervencionId == null && (
          <span className="mt-1 flex justify-end">
            <BorrarItem itemId={item.id} direccion={item.direccion} />
          </span>
        )}
        {/* Cargado en la orden equivocada: se pasa a otra de la misma empresa
            (solo Bacheo, nunca con el bache en un acta). */}
        {item.actaId == null && destinosMover.length > 0 && (
          <span className="mt-1 flex justify-end">
            <MoverItem itemId={item.id} destinos={destinosMover} />
          </span>
        )}
      </td>
    </tr>
  );
}
