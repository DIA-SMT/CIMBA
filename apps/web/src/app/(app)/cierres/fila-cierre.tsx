"use client";

import { Camera } from "lucide-react";
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
  const [respuesta, setRespuesta] = useState("");
  const [error, setError] = useState<string | null>(null);

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
          </div>
        </td>
        <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(demanda.creadoEn)}</td>
        <td className="num px-4 py-2.5 font-semibold text-resuelto">{fechaCorta(demanda.cerradoEn)}</td>
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
              onClick={() => {
                setAbierto((v) => !v);
                setError(null);
              }}
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
          <td colSpan={9} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                maxLength={1000}
                disabled={pendiente}
                placeholder={`Se reparó el bache de su reclamo el ${
                  demanda.cerradoEn ? fechaCorta(demanda.cerradoEn) : "…"
                }`}
                className="w-full max-w-xl flex-1 rounded-lg border border-borde-2 bg-panel px-3 py-2 text-sm placeholder:text-texto-3"
              />
              <button
                onClick={cerrar}
                disabled={pendiente}
                className="rounded-lg bg-resuelto px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {pendiente ? "Cerrando…" : "Confirmar cierre"}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-texto-3">
              La respuesta es opcional y queda en el historial del reclamo, para responderle al vecino por el
              canal por donde pidió.
            </p>
            {error && <p className="mt-2 text-sm text-peligro">{error}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
