"use client";

import { Check, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { darDeBajaCarga, marcarCargaControlada } from "@/lib/acciones-control";
import { mensajeDeError } from "@/lib/errores";
import { fechaCorta } from "@/lib/formato";
import { CorregirMedidas } from "../[id]/corregir-medidas";

interface Cercana {
  itemId: number;
  orden: string;
  direccion: string | null;
  reportadoEn: string | null;
  metros: number;
  /** URL ya resuelta de la foto del después, para reconocerla a simple vista. */
  foto: string | null;
}

/**
 * Lo que el inspector decide sobre una carga. Dar de baja pide motivo, y si es
 * duplicado pide CUÁL es el original: sin eso, el sistema no sabe a qué
 * arreglo sumarle los vecinos de la copia.
 */
export function AccionesControl({
  itemId,
  controlada,
  ordenActiva,
  medidas,
  cercanas,
}: {
  itemId: number;
  controlada: boolean;
  /** Si la orden sigue viva, lo mal cargado vuelve a ella; si no, a la cola de la ciudad. */
  ordenActiva: boolean;
  medidas: {
    superficieM2: number | null;
    espesorCm: number | null;
    anchoM: number | null;
    largoM: number | null;
    medicion: string | null;
    tipoObra: string | null;
  };
  cercanas: Cercana[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [baja, setBaja] = useState(false);
  const [motivo, setMotivo] = useState<"duplicado" | "mal_cargado" | null>(null);
  const [original, setOriginal] = useState<number | null>(cercanas[0]?.itemId ?? null);
  const [detalle, setDetalle] = useState("");

  const ejecutar = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setBaja(false);
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo guardar"));
      }
    });
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={() => ejecutar(() => marcarCargaControlada({ itemId, controlada: !controlada }))}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
            controlada
              ? "border border-borde-2 text-texto-2 hover:text-texto"
              : "bg-resuelto text-white hover:brightness-110"
          }`}
          title={controlada ? "Quitar la marca de revisada" : "Las fotos y las medidas cierran"}
        >
          <Check size={14} /> {controlada ? "Quitar «revisada»" : "Está bien"}
        </button>
        <CorregirMedidas
          itemId={itemId}
          superficieM2={medidas.superficieM2}
          espesorCm={medidas.espesorCm}
          anchoM={medidas.anchoM}
          largoM={medidas.largoM}
          medicion={medidas.medicion}
          tipoObra={medidas.tipoObra}
          enActa={false}
          etiqueta="Corregir medidas"
        />
        {!baja && (
          <button
            type="button"
            disabled={pendiente}
            onClick={() => {
              setBaja(true);
              setMotivo(null);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-peligro/40 px-3 py-2 text-xs font-semibold text-peligro transition hover:bg-peligro/10 disabled:opacity-50"
          >
            <Trash2 size={14} /> Dar de baja
          </button>
        )}
      </div>

      {baja && (
        <div className="mt-3 max-w-xl rounded-xl border border-peligro/30 bg-peligro/5 p-3">
          <p className="text-sm font-bold">¿Por qué se da de baja?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                { valor: "duplicado", etiqueta: "Duplicado", desc: "El mismo bache está cargado en otra carga" },
                { valor: "mal_cargado", etiqueta: "Mal cargado", desc: "La carga no sirve: fotos o datos que no corresponden" },
              ] as const
            ).map((m) => (
              <button
                key={m.valor}
                type="button"
                onClick={() => setMotivo(m.valor)}
                title={m.desc}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  motivo === m.valor
                    ? "border-peligro bg-peligro text-white"
                    : "border-borde-2 text-texto-2 hover:border-peligro/50 hover:text-peligro"
                }`}
              >
                {m.etiqueta}
              </button>
            ))}
          </div>

          {motivo === "duplicado" &&
            (cercanas.length === 0 ? (
              <p className="mt-2 text-[12px] leading-snug text-amarillo">
                No hay otra carga de esta empresa a menos de 30 m. Si el punto no corresponde, usá «Mal
                cargado».
              </p>
            ) : (
              <div className="mt-2">
                <p className="text-[12px] text-texto-2">
                  ¿Cuál es la carga buena? Esta se anula y el bache queda arreglado por esa.
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {cercanas.map((x) => (
                    <label
                      key={x.itemId}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border p-2 text-[12px] ${
                        original === x.itemId ? "border-celeste/60 bg-celeste/5" : "border-borde"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`original-${itemId}`}
                        checked={original === x.itemId}
                        onChange={() => setOriginal(x.itemId)}
                        className="accent-[#2eb1ff]"
                      />
                      {x.foto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={x.foto} alt="" className="h-12 w-16 shrink-0 rounded object-cover" loading="lazy" />
                      ) : (
                        <span className="h-12 w-16 shrink-0 rounded bg-panel-3" />
                      )}
                      <span className="min-w-0">
                        <b className="block truncate">{x.direccion ?? `Item #${x.itemId}`}</b>
                        <span className="num text-texto-3">
                          a {x.metros} m · {x.orden}
                          {x.reportadoEn && <> · {fechaCorta(x.reportadoEn)}</>}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

          {motivo === "mal_cargado" && (
            <p className="mt-2 text-[12px] leading-snug text-texto-2">
              La carga se anula y el bache{" "}
              {ordenActiva
                ? "vuelve a pendiente en su orden, para que la empresa lo cargue bien."
                : "vuelve a la cola de la ciudad: la orden ya está cerrada, así que tiene que entrar en otra."}
            </p>
          )}

          {motivo && (
            <>
              <input
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                maxLength={1000}
                placeholder="Qué se vio (opcional): «misma foto que el de Lavalle 300», «no hay bache»…"
                className="mt-2 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={pendiente || (motivo === "duplicado" && (cercanas.length === 0 || original == null))}
                  onClick={() =>
                    ejecutar(() =>
                      darDeBajaCarga({
                        itemId,
                        motivo,
                        originalItemId: motivo === "duplicado" ? (original ?? undefined) : undefined,
                        detalle: detalle.trim() || undefined,
                      }),
                    )
                  }
                  className="rounded-lg bg-peligro px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  {pendiente ? "Dando de baja…" : "Confirmar la baja"}
                </button>
                <button type="button" onClick={() => setBaja(false)} className="text-sm text-texto-2 hover:text-texto">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-peligro">{error}</p>}
    </div>
  );
}
