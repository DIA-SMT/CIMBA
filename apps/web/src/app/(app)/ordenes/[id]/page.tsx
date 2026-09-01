import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { obtenerOrden, type ItemOrden } from "@/lib/ordenes";
import { fechaCorta, numero } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { Panel } from "@/components/ui";
import { AccionesOrden } from "./acciones-orden";
import {
  COLOR_ESTADO_ITEM,
  COLOR_ESTADO_ORDEN,
  COLOR_PRIORIDAD,
  ETIQUETA_ESTADO_ITEM,
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_PRIORIDAD,
  ETIQUETA_TIPO_TRABAJO,
} from "../etiquetas";

export const dynamic = "force-dynamic";

/**
 * Estilos de impresión: en papel solo existe la hoja `.hoja-impresion`.
 * El truco de visibility (y no display) esquiva el chrome del layout
 * (header, nav, chat flotante) sin tocar archivos ajenos a este módulo.
 */
const CSS_IMPRESION = `
@media print {
  @page { margin: 12mm; }
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > div { display: block !important; height: auto !important; overflow: visible !important; }
  main { overflow: visible !important; }
  header, nav { display: none !important; }
  body * { visibility: hidden; }
  .hoja-impresion, .hoja-impresion * { visibility: visible; }
  .hoja-impresion { position: absolute; top: 0; left: 0; width: 100%; color: #000; }
  .hoja-impresion table { width: 100%; border-collapse: collapse; }
  .hoja-impresion th, .hoja-impresion td { border: 1px solid #555; padding: 5px 7px; font-size: 11px; text-align: left; }
  .hoja-impresion th { background: #eee; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
}
`;

export default async function PaginaOrden({ params }: { params: Promise<{ id: string }> }) {
  const sesion = (await leerSesion())!;
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) notFound();
  const o = await obtenerOrden(sesion, Number(id));
  if (!o) notFound();

  const puedePlanificar = sesion.rol_cimba === "admin" || sesion.rol_cimba === "planificacion";
  const noEncontrados = o.itemsDetalle.filter((i) => i.estado === "no_encontrado").length;
  const pct = o.items > 0 ? Math.round((100 * o.hechos) / o.items) : 0;
  const colorEstado = COLOR_ESTADO_ORDEN[o.estado];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <style>{CSS_IMPRESION}</style>

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
                style={{ background: `${colorEstado}22`, color: colorEstado }}
              >
                {ETIQUETA_ESTADO_ORDEN[o.estado]}
              </span>
              <span className="text-xs font-semibold" style={{ color: COLOR_PRIORIDAD[o.prioridad] }}>
                Prioridad {ETIQUETA_PRIORIDAD[o.prioridad].toLowerCase()}
              </span>
              {o.circuitoCodigo && (
                <span className="rounded-md border border-borde-2 px-2 py-0.5 text-xs font-semibold">
                  Circuito {o.circuitoCodigo}
                </span>
              )}
            </div>
            <h1 className="num text-3xl font-extrabold tracking-tight">{o.numero}</h1>
            <p className="mt-1 text-sm text-texto-2">
              {o.titulo ?? "Orden de trabajo"} · <b>{o.empresaNombre}</b>
            </p>
            <p className="num mt-1 text-xs text-texto-3">
              Creada {fechaCorta(o.creadoEn)}
              {o.emitidaEn && <> · emitida {fechaCorta(o.emitidaEn)}</>}
              {o.venceEn && <> · vence {fechaCorta(o.venceEn)}</>}
              {o.cerradaEn && <> · cerrada {fechaCorta(o.cerradaEn)}</>}
            </p>
          </div>
          <AccionesOrden ordenId={o.id} estado={o.estado} puedePlanificar={puedePlanificar} />
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
                <span className="text-texto-3"> / {numero(o.items)}</span>
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

        {/* Items */}
        <h2 className="mb-3 text-sm font-bold tracking-wide uppercase">
          Los items{" "}
          <span className="font-normal text-texto-3 normal-case">
            — cada carga de la empresa crea la intervención real que alimenta la brecha
          </span>
        </h2>
        <Panel className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                <th className="px-3 py-3">Dirección</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="num px-3 py-3 text-right" title="Reclamos detrás de este punto">Reclamos</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3" title="Ancho × largo × espesor reportados">Medidas</th>
                <th className="num px-3 py-3 text-right">m²</th>
                <th className="px-3 py-3">Reportado</th>
                <th className="px-3 py-3">Fotos</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {o.itemsDetalle.map((it) => (
                <FilaItem key={it.id} item={it} />
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* ══ Hoja de impresión: la orden en papel ══ */}
      <section className="hoja-impresion hidden print:block">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>ORDEN DE TRABAJO {o.numero}</p>
            <p style={{ fontSize: 11, margin: "2px 0 0" }}>
              Dirección de Bacheo — Municipalidad de San Miguel de Tucumán
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <p style={{ margin: 0 }}>
              Estado: <b>{ETIQUETA_ESTADO_ORDEN[o.estado]}</b>
            </p>
            <p style={{ margin: 0 }}>
              Prioridad: <b>{ETIQUETA_PRIORIDAD[o.prioridad]}</b>
            </p>
          </div>
        </div>

        <table style={{ marginTop: 12 }}>
          <tbody>
            <tr>
              <td style={{ width: "34%" }}>
                <b>Empresa:</b> {o.empresaNombre}
              </td>
              <td style={{ width: "22%" }}>
                <b>Circuito:</b> {o.circuitoCodigo ?? "—"}
              </td>
              <td style={{ width: "22%" }}>
                <b>Emitida:</b> {fechaCorta(o.emitidaEn)}
              </td>
              <td style={{ width: "22%" }}>
                <b>Vence:</b> {fechaCorta(o.venceEn)}
              </td>
            </tr>
            {o.titulo && (
              <tr>
                <td colSpan={4}>
                  <b>Título:</b> {o.titulo}
                </td>
              </tr>
            )}
            {o.indicaciones && (
              <tr>
                <td colSpan={4}>
                  <b>Indicaciones:</b> {o.indicaciones}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 24 }}>#</th>
              <th>Dirección</th>
              <th style={{ width: 60 }}>Tipo</th>
              <th style={{ width: 50 }}>Reclamos</th>
              <th style={{ width: 62 }}>Ancho (m)</th>
              <th style={{ width: 62 }}>Largo (m)</th>
              <th style={{ width: 66 }}>Espesor (cm)</th>
              <th style={{ width: 50 }}>m²</th>
            </tr>
          </thead>
          <tbody>
            {o.itemsDetalle.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>
                  {it.direccion ?? (it.incidenteId != null ? `Incidente #${it.incidenteId}` : "—")}
                  {it.estado === "no_encontrado" && <> — NO ENCONTRADO</>}
                </td>
                <td>{ETIQUETA_TIPO_TRABAJO[it.tipoTrabajo] ?? it.tipoTrabajo}</td>
                <td style={{ textAlign: "right" }}>{it.reclamos}</td>
                {/* Lo pendiente se imprime con las celdas vacías: las medidas
                    se anotan a mano en la calle y se cargan después */}
                <td style={{ textAlign: "right" }}>{it.anchoM ?? " "}</td>
                <td style={{ textAlign: "right" }}>{it.largoM ?? " "}</td>
                <td style={{ textAlign: "right" }}>{it.espesorCm ?? " "}</td>
                <td style={{ textAlign: "right" }}>{it.superficieM2 != null ? numero(it.superficieM2) : " "}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ fontSize: 10, marginTop: 8 }}>
          {numero(o.items)} items · la empresa carga cada trabajo con medidas y foto en su portal, o completa
          esta planilla a mano y la carga al volver.
        </p>

        <div style={{ display: "flex", gap: 40, marginTop: 36 }}>
          <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4, fontSize: 11 }}>
            Entregó — Dirección de Bacheo
            <br />
            Aclaración y fecha
          </div>
          <div style={{ flex: 1, borderTop: "1px solid #000", paddingTop: 4, fontSize: 11 }}>
            Recibí conforme — {o.empresaNombre}
            <br />
            Aclaración y fecha
          </div>
        </div>
      </section>
    </div>
  );
}

function FilaItem({ item }: { item: ItemOrden }) {
  const medidas =
    item.anchoM != null && item.largoM != null && item.espesorCm != null
      ? `${numero(item.anchoM)} × ${numero(item.largoM)} m · ${numero(item.espesorCm)} cm`
      : null;
  return (
    <tr className="border-b border-borde/60 transition hover:bg-panel-2">
      <td className="max-w-56 px-3 py-2.5">
        <span className="block truncate" title={item.direccion ?? undefined}>
          {item.direccion ?? "Sin dirección"}
        </span>
        {item.observaciones && (
          <span className="block truncate text-[11px] text-texto-3" title={item.observaciones}>
            {item.observaciones}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-texto-2">{ETIQUETA_TIPO_TRABAJO[item.tipoTrabajo] ?? item.tipoTrabajo}</td>
      <td className="num px-3 py-2.5 text-right font-bold" style={{ color: item.reclamos > 0 ? "#f4dc00" : "#5c6b84" }}>
        {numero(item.reclamos)}
      </td>
      <td className="px-3 py-2.5">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
          style={{ background: `${COLOR_ESTADO_ITEM[item.estado]}22`, color: COLOR_ESTADO_ITEM[item.estado] }}
        >
          {ETIQUETA_ESTADO_ITEM[item.estado]}
        </span>
      </td>
      <td className="num px-3 py-2.5 text-xs whitespace-nowrap text-texto-2">{medidas ?? "—"}</td>
      <td className="num px-3 py-2.5 text-right" style={{ color: item.superficieM2 != null ? "#199e70" : "#5c6b84" }}>
        {item.superficieM2 != null ? numero(item.superficieM2) : "—"}
      </td>
      <td className="num px-3 py-2.5 text-xs text-texto-2">{fechaCorta(item.reportadoEn)}</td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1.5">
          {item.fotos.map((f, i) => {
            const url = urlFoto(f);
            if (!url) return null;
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`Foto ${f.momento} — abrir en tamaño completo`}
                className="block overflow-hidden rounded border border-borde transition hover:border-celeste"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
                <img src={url} alt={`Foto ${f.momento}`} loading="lazy" className="h-20 w-20 object-cover" />
              </a>
            );
          })}
          {item.fotos.length === 0 && <span className="text-xs text-texto-3">—</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        {item.incidenteId != null && (
          <Link
            href={`/incidentes/${item.incidenteId}`}
            className="num text-xs font-semibold whitespace-nowrap text-celeste hover:underline"
            title="La historia completa de este punto"
          >
            #{item.incidenteId} →
          </Link>
        )}
      </td>
    </tr>
  );
}
