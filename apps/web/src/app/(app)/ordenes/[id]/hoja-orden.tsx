import type { TipoIntervencion } from "@cimba/domain";
import { fechaCorta, numero } from "@/lib/formato";
import { urlFoto } from "@/lib/fotos";
import { formatoToneladas, toneladasDe, volumenDe } from "@/lib/medicion";
import type { OrdenDetalle } from "@/lib/ordenes";
import {
  ETIQUETA_AMBITO,
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_PRIORIDAD,
  ETIQUETA_TIPO_TRABAJO,
} from "../etiquetas";
import { ETIQUETA_TIPO_INTERVENCION } from "./tipos-intervencion";

/**
 * LA ORDEN EN PAPEL: la planilla que se firma, con la evidencia fotográfica.
 *
 * Vivía adentro de la pantalla de la orden de la Dirección. Se mudó acá para
 * que el portal de la empresa baje EXACTAMENTE la misma hoja —"la empresa debe
 * poder descargar su trabajo en PDF, tal como lo baja Leo, con fotos; es lo
 * mismo que vemos nosotros" (14/10)—, sin una segunda versión que se desfase.
 * En pantalla no se ve: solo existe al imprimir (o al guardar como PDF).
 */

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
  /* Evidencia fotográfica: una foto jamás se corta entre dos páginas. */
  .hoja-impresion figure, .hoja-impresion img { break-inside: avoid; page-break-inside: avoid; }
}
`;

const ETIQUETA_MOMENTO: Record<string, string> = { antes: "Antes", durante: "Durante", despues: "Después" };
/** Orden funcional para leer la evidencia de cada item: antes → durante → después. */
const ORDEN_MOMENTO: Record<string, number> = { antes: 0, durante: 1, despues: 2 };

/** Fecha ordenable con los sin-fecha al final (reportes viejos sin timestamp). */
function tiempoReporte(iso: string | null): number {
  const t = iso != null ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

export function HojaOrdenImprimible({ o }: { o: OrdenDetalle }) {
  // El plan real: lo propuesto sin validar (y lo rechazado) no sale en la hoja.
  const itemsPapel = o.itemsDetalle.filter((i) => i.estado !== "propuesto" && i.estado !== "rechazado");
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

  const totalesPapel = sumar(itemsPapel);

  // ── Evidencia para papel ────────────────────────────────────────────────
  // "Que aparezcan las fotos también al imprimir": los items HECHOS con foto,
  // cronológicos por reportado_en. El número de item es el de la tabla de
  // arriba (posición en la orden), para que el pie de cada foto se pueda
  // cruzar a mano con la planilla.
  // Posición sobre la hoja impresa (itemsPapel), que es donde se cruza a mano.
  const posicionItem = new Map(itemsPapel.map((it, i) => [it.id, i + 1]));
  const evidencia = o.itemsDetalle
    .filter((it) => it.estado === "hecho")
    .map((it) => ({
      item: it,
      fotos: it.fotos
        .flatMap((f) => {
          const url = urlFoto(f);
          return url ? [{ url, momento: f.momento }] : [];
        })
        .sort((a, b) => (ORDEN_MOMENTO[a.momento] ?? 9) - (ORDEN_MOMENTO[b.momento] ?? 9)),
    }))
    .filter((e) => e.fotos.length > 0)
    .sort((a, b) => tiempoReporte(a.item.reportadoEn) - tiempoReporte(b.item.reportadoEn));

  return (
    <>
      <style>{CSS_IMPRESION}</style>
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
              {/* Por dónde se definió la orden. Antes decía siempre "Circuito"
                  y leía solo circuitoCodigo: una orden armada por distrito
                  —que es el caso más común— salía impresa como "Circuito: —" y
                  el capataz recibía siete direcciones sin ninguna referencia de
                  zona. Ahora dice lo que se eligió en "2 · Por dónde se
                  define": "Distrito: 12", "Barrio: Néstor Kirchner"… */}
              <td style={{ width: "22%" }}>
                <b>{ETIQUETA_AMBITO[o.ambito] ?? "Ámbito"}:</b> {o.ambitoNombre ?? "—"}
              </td>
              <td style={{ width: "22%" }}>
                <b>Emitida:</b> {fechaCorta(o.emitidaEn)}
              </td>
              <td style={{ width: "22%" }}>
                <b>Vence:</b> {fechaCorta(o.venceEn)}
              </td>
            </tr>
            {o.contratoDecreto && (
              <tr>
                <td colSpan={4}>
                  <b>Contrato / Decreto:</b> {o.contratoDecreto}
                </td>
              </tr>
            )}
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
              <th style={{ width: 80 }} title="Cómo se resolvió realmente">Intervención</th>
              {/* La fecha del bache (pedido del usuario, 14/10): cuándo se tapó, no cuándo se cargó. */}
              <th style={{ width: 58 }}>Fecha</th>
              <th style={{ width: 50 }}>Reclamos</th>
              <th style={{ width: 62 }}>Ancho (m)</th>
              <th style={{ width: 62 }}>Largo (m)</th>
              <th style={{ width: 66 }}>Espesor (cm)</th>
              <th style={{ width: 50 }}>m²</th>
              <th style={{ width: 58 }}>Toneladas</th>
            </tr>
          </thead>
          <tbody>
            {/* Solo el plan real: un propuesto sin validar (o rechazado) no es
                trabajo encargado y no puede salir en la planilla que se firma. */}
            {itemsPapel.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>
                  {it.direccion ?? (it.incidenteId != null ? `Incidente #${it.incidenteId}` : "—")}
                  {it.estado === "no_encontrado" && <> — NO ENCONTRADO</>}
                  {it.estado === "ya_resuelto" && <> — YA ESTABA RESUELTO</>}
                  {/* El ticket del bache, y el del 147 si lo tiene: por ahí
                      controla el inspector (14/10). */}
                  <span style={{ display: "block", fontSize: 9, color: "#444" }}>
                    Ticket N° {it.id}
                    {it.tickets147 && <> · Atención Ciudadana N° {it.tickets147}</>}
                  </span>
                </td>
                <td>{ETIQUETA_TIPO_TRABAJO[it.tipoTrabajo] ?? it.tipoTrabajo}</td>
                {/* Lo pendiente sale en blanco: se completa al reportar */}
                <td>
                  {it.tipoIntervencion != null
                    ? (ETIQUETA_TIPO_INTERVENCION[it.tipoIntervencion as TipoIntervencion] ?? it.tipoIntervencion)
                    : " "}
                </td>
                <td>{it.fechaTrabajo ? fechaCorta(it.fechaTrabajo) : " "}</td>
                <td style={{ textAlign: "right" }}>{it.reclamos}</td>
                {/* Lo pendiente se imprime con las celdas vacías: las medidas
                    se anotan a mano en la calle y se cargan después */}
                <td style={{ textAlign: "right" }}>{it.anchoM != null ? numero(it.anchoM) : " "}</td>
                <td style={{ textAlign: "right" }}>{it.largoM != null ? numero(it.largoM) : " "}</td>
                <td style={{ textAlign: "right" }}>{it.espesorCm != null ? numero(it.espesorCm) : " "}</td>
                <td style={{ textAlign: "right" }}>{it.superficieM2 != null ? numero(it.superficieM2) : " "}</td>
                {/* Las toneladas del bache, al lado de sus m²: es lo que se
                    certifica, y quien firma el acta no tendría que hacer la
                    cuenta en el margen de la hoja. */}
                <td style={{ textAlign: "right" }}>
                  {it.superficieM2 != null && it.espesorCm != null
                    ? formatoToneladas(toneladasDe(volumenDe(it.superficieM2, it.espesorCm)))
                    : " "}
                </td>
              </tr>
            ))}
            {totalesPapel.items > 0 && (
              <tr style={{ fontWeight: 800, borderTop: "2px solid #555" }}>
                <td colSpan={9} style={{ textAlign: "right" }}>TOTAL</td>
                <td style={{ textAlign: "right" }}>{numero(totalesPapel.m2)}</td>
                <td style={{ textAlign: "right" }}>{formatoToneladas(totalesPapel.toneladas)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ fontSize: 10, marginTop: 8 }}>
          {numero(itemsPapel.length)} items · la empresa carga cada trabajo con medidas y foto en su portal, o completa
          esta planilla a mano y la carga al volver.
        </p>

        {/* Evidencia fotográfica: solo si hay hechos con fotos. En reportes
            parciales convive con los pendientes, que arriba siguen imprimiendo
            sus celdas vacías para anotar a mano. */}
        {evidencia.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <p style={{ fontSize: 13, fontWeight: 800, margin: 0, textTransform: "uppercase", borderBottom: "1px solid #555", paddingBottom: 3 }}>
              Evidencia fotográfica
            </p>
            <p style={{ fontSize: 10, margin: "3px 0 0" }}>
              Fotos cargadas por {o.empresaNombre} al reportar cada trabajo, en orden cronológico.
            </p>
            {evidencia.map(({ item, fotos }) => {
              const pos = posicionItem.get(item.id);
              const medidas =
                item.anchoM != null && item.largoM != null && item.espesorCm != null
                  ? `${numero(item.anchoM)} × ${numero(item.largoM)} m · ${numero(item.espesorCm)} cm`
                  : null;
              return (
                <div key={item.id} style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 11, margin: "0 0 4px", breakInside: "avoid" }}>
                    <b>
                      Item {pos} — {item.direccion ?? "Sin dirección"}
                    </b>
                    {" "}· Ticket N° {item.id}
                    {item.tickets147 && <> · Atención Ciudadana N° {item.tickets147}</>}
                    {item.fechaTrabajo && <> · {fechaCorta(item.fechaTrabajo)}</>}
                    {medidas && <> · {medidas}</>}
                    {item.superficieM2 != null && (
                      <>
                        {" "}
                        · <b>{numero(item.superficieM2)} m²</b>
                      </>
                    )}
                    {/* Las toneladas al lado de la descripción: es la unidad
                        con la que se certifica el pago, y quien mira la
                        evidencia para firmar no tendría que ir a buscarla a la
                        tabla de arriba ni hacer la cuenta al margen. */}
                    {item.superficieM2 != null && item.espesorCm != null && (
                      <>
                        {" "}
                        ·{" "}
                        <b>{formatoToneladas(toneladasDe(volumenDe(item.superficieM2, item.espesorCm)))}</b>
                      </>
                    )}
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4mm" }}>
                    {fotos.map((f, j) => (
                      <figure key={j} style={{ margin: 0, breakInside: "avoid", pageBreakInside: "avoid" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
                        <img
                          src={f.url}
                          alt={`Foto ${ETIQUETA_MOMENTO[f.momento] ?? f.momento} — item ${pos}`}
                          /* Excepción deliberada a la regla de lazy: esta sección
                             vive en display:none y una imagen lazy ahí adentro
                             NUNCA se descarga — al imprimir salían recuadros en
                             blanco. Eager las trae de entrada; los mismos
                             archivos ya se pidieron para los thumbnails, así
                             que en la práctica es caché, no doble descarga. */
                          loading="eager"
                          /**
                           * NUNCA recortada. Estaba fijada en 8×6 cm con
                           * object-fit:cover, y el capataz saca las fotos con
                           * el teléfono en vertical: el recorte a caja
                           * apaisada se comía la mitad del bache, que es lo
                           * único que la foto tiene que probar. Ahora la foto
                           * entra entera —se achica hasta caber, nunca se
                           * corta— y la caja se adapta a lo que hay.
                           */
                          style={{
                            width: "8cm",
                            maxWidth: "100%",
                            height: "auto",
                            maxHeight: "9cm",
                            objectFit: "contain",
                            border: "1px solid #555",
                          }}
                        />
                        <figcaption style={{ fontSize: 9, marginTop: 2 }}>
                          {(ETIQUETA_MOMENTO[f.momento] ?? f.momento).toUpperCase()} — {o.numero} · item {pos} ·{" "}
                          {fechaCorta(item.reportadoEn)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
    </>
  );
}
