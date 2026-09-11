"use client";

import { AtSign, Camera, Copy, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FuenteDemanda } from "@cimba/domain";
import { cerrarDemandaAtencion } from "@/lib/acciones-ordenes";
import type { DemandaParaCerrar } from "@/lib/ordenes";
import { fechaCorta, numero } from "@/lib/formato";
import { BadgeFuente, BadgeTipo } from "@/components/ui";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";

/**
 * EL ÚLTIMO METRO: de la respuesta escrita a la persona que reclamó.
 *
 * CIDITUC todavía no expone el cierre del ticket del 147, así que el sistema
 * no puede mandar nada solo — y tampoco debería: el que responde es el
 * operador, con su nombre. Lo que sí se puede hacer hoy es dejar el mensaje
 * armado y abrir el canal con un toque. WhatsApp es el canal real: de los
 * reclamos de Atención Ciudadana, prácticamente todos traen teléfono y menos
 * de la mitad traen mail.
 *
 * wa.me solo ABRE WhatsApp con el texto puesto; el envío lo hace la persona.
 */

/** Argentina para WhatsApp: 54 + 9 + área + número, sin símbolos.
 *  Devuelve null si el número no tiene la forma esperada — mejor no ofrecer
 *  el botón que abrir un chat con un desconocido. */
function whatsappDe(tel: string | undefined): string | null {
  if (!tel) return null;
  let d = tel.replace(/[^0-9]/g, "").replace(/^00/, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // Área (2 a 4 dígitos) + el 15 viejo de celular: WhatsApp no lo lleva.
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  return d.length === 10 ? `549${d}` : null;
}

/** Cómo se resolvió (intervenciones.tipo_intervencion). Etiquetas locales:
 *  formato.ts no es de esta tarea. */
const ETIQUETA_TIPO_INTERVENCION: Record<string, string> = {
  bacheo: "Bacheo",
  pano_hormigon: "Paño de hormigón",
  carpeta: "Carpeta",
  enripiado: "Enripiado",
};

/**
 * Fila de la bandeja de cierre, con su botón "Cerrar" que expande la
 * respuesta al vecino.
 *
 * A propósito NO existe un "cerrar todos los de esta página": cada cierre es
 * la respuesta a UNA persona sobre SU reclamo. Un cierre masivo invitaría a
 * responder sin mirar la fila (dirección equivocada, reparación que en
 * realidad era de otro bache de la cuadra) y el vecino recibiría un "ya está
 * arreglado" falso. El criterio humano por fila es el punto de esta bandeja,
 * no una fricción a optimizar.
 */
export function FilaCierre({
  demanda,
  puedeCerrar,
}: {
  demanda: DemandaParaCerrar;
  puedeCerrar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * La respuesta SEMI-AUTOMÁTICA: el sistema redacta con lo que ya sabe
   * (dirección, fecha, cómo se resolvió y el link a la foto del trabajo) y la
   * persona solo revisa y confirma — o la reescribe. La foto del después es
   * la prueba del trabajo; si hay del antes, va también.
   */
  const respuestaSugerida = (() => {
    const que = demanda.tipoIntervencion
      ? (ETIQUETA_TIPO_INTERVENCION[demanda.tipoIntervencion] ?? demanda.tipoIntervencion).toLowerCase()
      : "la reparación";
    const donde = demanda.direccion ? ` en ${demanda.direccion}` : "";
    const cuando = demanda.cerradoEn ? ` el ${fechaCorta(demanda.cerradoEn)}` : "";
    const despues = demanda.fotos.find((f) => f.momento === "despues");
    const antes = demanda.fotos.find((f) => f.momento === "antes");
    let texto = `Su reclamo${donde} fue resuelto${cuando} mediante ${que}.`;
    if (despues && antes) texto += ` Foto del trabajo terminado: ${despues.url} · Antes de la reparación: ${antes.url}.`;
    else if (despues) texto += ` Foto del trabajo terminado: ${despues.url}.`;
    else if (antes) texto += ` Foto del estado previo a la reparación: ${antes.url}.`;
    texto += " Muchas gracias por avisarnos.";
    return texto;
  })();
  const [respuesta, setRespuesta] = useState("");
  // Al abrir por primera vez, la sugerencia ya está puesta: solo confirmar.
  const abrir = () => {
    setAbierto((v) => {
      if (!v && respuesta === "") setRespuesta(respuestaSugerida);
      return !v;
    });
    setError(null);
  };

  const cerrar = () => {
    setError(null);
    startTransition(async () => {
      try {
        await cerrarDemandaAtencion({
          demandaId: demanda.demandaId,
          respuesta: respuesta.trim() || undefined,
        });
        setAbierto(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cerrar el reclamo: probá de nuevo");
      }
    });
  };

  return (
    <>
      <tr className="border-b border-borde/60 transition hover:bg-panel-2">
        <td className="px-4 py-2.5">
          <BadgeFuente fuente={demanda.fuente as FuenteDemanda} />
        </td>
        <td className="px-4 py-2.5">
          <BadgeTipo tipo={demanda.tipo} />
        </td>
        <td className="max-w-64 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            {/* Verificar el punto reparado antes de responderle al vecino:
                el cierre es por fila y a conciencia, el mapa ayuda a mirar. */}
            <ChipMiniMapa
              lat={demanda.lat}
              lon={demanda.lon}
              etiqueta={demanda.direccion ?? `Incidente #${demanda.incidenteId}`}
            />
            <span className="min-w-0 flex-1 truncate" title={demanda.direccion ?? ""}>
              {demanda.direccion ?? "—"}
            </span>
            {/* Se ve de un vistazo cuáles tienen a alguien del otro lado: es
                la diferencia entre cerrar y poder avisar que se cerró. */}
            {whatsappDe(demanda.contacto?.telefono) && (
              <span className="shrink-0 text-resuelto" title="Se le puede avisar por WhatsApp">
                <MessageCircle size={12} />
              </span>
            )}
          </div>
        </td>
        <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(demanda.creadoEn)}</td>
        <td className="num px-4 py-2.5 font-semibold text-resuelto">{fechaCorta(demanda.cerradoEn)}</td>
        <td className="px-4 py-2.5">
          {/* Cómo se resolvió: para que la respuesta al vecino diga "bacheo" o
              "cambio de paño" — el reclamo original del Director. */}
          {demanda.tipoIntervencion ? (
            <span className="rounded-md border border-borde-2 px-1.5 py-0.5 text-[11px] font-semibold text-texto-2">
              {ETIQUETA_TIPO_INTERVENCION[demanda.tipoIntervencion] ?? demanda.tipoIntervencion}
            </span>
          ) : (
            <span className="text-[11px] text-texto-3">sin dato</span>
          )}
        </td>
        <td className="num px-4 py-2.5 text-texto-2">{demanda.m2 != null ? numero(demanda.m2) : "—"}</td>
        <td className="px-4 py-2.5">
          {demanda.fotosDespues > 0 ? (
            <span className="flex items-center gap-1.5 text-texto-2">
              <Camera size={13} className="text-celeste" />
              <span className="num">{numero(demanda.fotosDespues)}</span>
            </span>
          ) : (
            <span className="text-[11px] text-texto-3">sin foto</span>
          )}
        </td>
        <td className="px-4 py-2.5">
          <Link
            href={`/incidentes/${demanda.incidenteId}`}
            className="num font-semibold text-celeste hover:underline"
            title="Ver la historia completa del incidente reparado"
          >
            #{demanda.incidenteId}
          </Link>
        </td>
        <td className="px-4 py-2.5 text-right">
          {puedeCerrar && (
            <button
              onClick={abrir}
              disabled={pendiente}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                abierto
                  ? "border border-borde-2 text-texto-2 hover:text-texto"
                  : "bg-azul text-white hover:brightness-110"
              }`}
            >
              {abierto ? "Cancelar" : "Cerrar"}
            </button>
          )}
        </td>
      </tr>

      {abierto && (
        <tr className="border-b border-borde/60 bg-panel-2/60">
          <td colSpan={10} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <textarea
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                maxLength={1000}
                rows={3}
                disabled={pendiente}
                className="w-full max-w-xl flex-1 rounded-lg border border-borde-2 bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-texto-3"
              />
              <button
                onClick={cerrar}
                disabled={pendiente}
                className="rounded-lg bg-resuelto px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {pendiente ? "Cerrando…" : "Confirmar cierre"}
              </button>
            </div>
            <CanalesVecino demanda={demanda} texto={respuesta} />

            <p className="mt-1.5 text-[11px] leading-relaxed text-texto-3">
              <b className="text-texto-2">¿A dónde va esto?</b> El reclamo pasa a <b>cerrado</b> y la
              respuesta queda guardada en su ficha (
              <Link href={`/demandas/${demanda.demandaId}`} className="font-semibold text-celeste hover:underline">
                verla acá
              </Link>
              ), con tu nombre y la fecha — también aparece en Actividad. El aviso al vecino lo mandás
              vos con los botones de arriba: el sistema abre el chat o el mail con el texto puesto, y el
              envío queda en tus manos. Cuando Innovación habilite el cierre de tickets del 147, este
              mismo botón va a cerrar el ticket y mandar la respuesta sin ese paso.
            </p>
            {error && <p className="mt-2 text-sm text-peligro">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Los canales reales para avisarle a la persona, con el texto que está en el
 * cuadro de arriba (si el operador lo editó, viaja lo editado).
 *
 * Cuando no hay con quién hablar lo dice fuerte y con el motivo: ese reclamo
 * no lo trajo una persona, lo trajo una planilla. Callarlo haría creer que el
 * cierre avisó a alguien.
 */
function CanalesVecino({ demanda, texto }: { demanda: DemandaParaCerrar; texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const c = demanda.contacto;
  const wa = whatsappDe(c?.telefono);
  const mail = c?.email?.includes("@") ? c.email : null;
  const nombre = c?.nombre?.trim();

  if (!wa && !mail) {
    return (
      <p className="mt-2 rounded-lg border border-borde-2 bg-panel px-3 py-2 text-[11px] leading-relaxed text-texto-3">
        <b className="text-texto-2">Sin contacto del vecino.</b>{" "}
        {c?.telefono
          ? `El teléfono cargado (${c.telefono}) no tiene forma de celular argentino: revisalo en la ficha si querés avisarle.`
          : "Este reclamo entró por planilla, no por una persona que dejó sus datos. El cierre queda registrado igual, pero no hay a quién avisarle."}
      </p>
    );
  }

  const copiar = () => {
    void navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  };

  return (
    <div className="mt-2 rounded-lg border border-celeste/30 bg-celeste/5 px-3 py-2">
      <p className="text-[11px] font-semibold text-texto-2">
        Avisarle a {nombre || "quien reclamó"}
        {c?.telefono && <span className="num ml-1.5 font-normal text-texto-3">{c.telefono}</span>}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {wa && (
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(texto)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-resuelto px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
          >
            <MessageCircle size={13} /> WhatsApp
          </a>
        )}
        {mail && (
          <a
            href={`mailto:${mail}?subject=${encodeURIComponent(
              `Su reclamo${demanda.direccion ? ` en ${demanda.direccion}` : ""} fue resuelto`,
            )}&body=${encodeURIComponent(texto)}`}
            className="flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-1.5 text-xs font-semibold text-texto-2 transition hover:text-texto"
          >
            <AtSign size={13} /> Mail
          </a>
        )}
        <button
          type="button"
          onClick={copiar}
          className="flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-1.5 text-xs font-semibold text-texto-2 transition hover:text-texto"
        >
          <Copy size={13} /> {copiado ? "Copiado" : "Copiar texto"}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-texto-3">
        Se abre el chat o el mail con el mensaje escrito. <b>Lo mandás vos</b>: el sistema no envía
        nada solo.
      </p>
    </div>
  );
}
