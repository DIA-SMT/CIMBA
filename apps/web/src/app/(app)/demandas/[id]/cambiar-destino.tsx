"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cambiarDestinoDemanda } from "@/lib/acciones-tratamiento";
import { DESTINOS } from "@/lib/formato";
import { mensajeDeError } from "@/lib/errores";

/**
 * A QUIÉN LE TOCA ESTE PEDIDO, y la forma de corregirlo. El destino lo pone
 * la base según la red vial, y la red vial tiene cuadras de hormigón marcadas
 * como cordón cuneta: el pedido se iba a Ingeniería "por ripio" con la foto
 * mostrando pavimento (Estados Unidos 1288, 14/10). Acá una persona lo cambia
 * y queda su nombre.
 */
export function CambiarDestino({
  demandaId,
  destino,
  correccion,
  puedeCambiar,
}: {
  demandaId: number;
  destino: string | null;
  /** La última corrección a mano, si la hubo: quién y cuándo. */
  correccion: { por?: string; en?: string } | null;
  /** Rol habilitado y pedido abierto: si no, solo se muestra el destino. */
  puedeCambiar: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const actual = DESTINOS.find((d) => d.valor === destino);
  const cuando = correccion?.en ? new Date(correccion.en).toLocaleDateString("es-AR") : null;

  const guardar = () => {
    if (!elegido) return;
    setError(null);
    iniciar(async () => {
      try {
        await cambiarDestinoDemanda({ demandaId, destino: elegido, motivo: motivo.trim() || undefined });
        setAbierto(false);
        setElegido(null);
        setMotivo("");
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo cambiar el destino"));
      }
    });
  };

  return (
    <div className="rounded-lg border border-borde px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          <span className="text-texto-3">Lo resuelve: </span>
          <b>{actual?.etiqueta ?? "Sin clasificar"}</b>
          {correccion?.por && (
            <span className="block text-[11px] text-texto-3">
              Corregido a mano por {correccion.por}
              {cuando && <> el {cuando}</>}
            </span>
          )}
        </p>
        {puedeCambiar && !abierto && (
          <button
            type="button"
            onClick={() => setAbierto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-1.5 text-[13px] font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
            title="Pasarlo a Bacheo, a la S.A.T. o a Ingeniería"
          >
            <ArrowRightLeft size={14} /> Cambiar destino
          </button>
        )}
      </div>

      {abierto && (
        <div className="mt-2.5 space-y-2">
          <div className="grid gap-1.5">
            {DESTINOS.filter((d) => d.valor !== destino).map((d) => (
              <button
                key={d.valor}
                type="button"
                onClick={() => setElegido(d.valor)}
                className={`rounded-lg border px-3 py-2 text-left text-[13px] transition ${
                  elegido === d.valor
                    ? "border-celeste bg-celeste/10"
                    : "border-borde-2 hover:border-celeste/50"
                }`}
              >
                <b className="block">{d.etiqueta}</b>
                <span className="text-[11px] text-texto-3">{d.detalle}</span>
              </button>
            ))}
          </div>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            placeholder="Por qué (opcional): p. ej. «la foto muestra pavimento»"
            className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={guardar}
              disabled={!elegido || pendiente}
              className="rounded-lg bg-azul px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {pendiente ? "Guardando…" : "Guardar destino"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAbierto(false);
                setElegido(null);
                setMotivo("");
                setError(null);
              }}
              className="text-xs text-texto-2 hover:text-texto"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="text-xs text-peligro">{error}</p>}
        </div>
      )}
    </div>
  );
}
