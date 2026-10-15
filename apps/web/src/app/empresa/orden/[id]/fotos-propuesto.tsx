"use client";

import { Camera } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { reemplazarFotoPropuesto } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";

/**
 * LAS FOTOS DE UN BACHE PROPUESTO, en el portal de empresa: para verlas (así la
 * cuadrilla se guía al corregir el pin) y para cambiar una que subió mal.
 *
 * Mientras el bache espera validación la empresa puede reemplazar el antes o el
 * después; cada foto abre en grande con un toque y tiene su botón "Cambiar".
 * Pedido de INGECO, 15/10.
 */
export function FotosPropuesto({
  itemId,
  urlAntes,
  urlDespues,
}: {
  itemId: number;
  urlAntes: string | null;
  urlDespues: string | null;
}) {
  if (!urlAntes && !urlDespues) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      {urlAntes && <FotoCambiable itemId={itemId} cual="antes" url={urlAntes} etiqueta="Antes" />}
      {urlDespues && <FotoCambiable itemId={itemId} cual="despues" url={urlDespues} etiqueta="Después" />}
    </div>
  );
}

function FotoCambiable({
  itemId,
  cual,
  url,
  etiqueta,
}: {
  itemId: number;
  cual: "antes" | "despues";
  url: string;
  etiqueta: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cambiar = (archivo: File) => {
    setError(null);
    const fd = new FormData();
    fd.set("itemId", String(itemId));
    fd.set("cual", cual);
    fd.set("foto", archivo);
    startTransition(async () => {
      try {
        await reemplazarFotoPropuesto(fd);
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo cambiar la foto"));
      }
    });
  };

  return (
    <div className="w-28">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={`Foto del ${etiqueta.toLowerCase()}`}
          className="h-28 w-28 rounded-lg border border-borde-2 object-cover"
        />
      </a>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold tracking-wider text-texto-3 uppercase">{etiqueta}</span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={pendiente}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-celeste transition hover:underline disabled:opacity-40"
          title="Subir otra foto en lugar de esta"
        >
          <Camera size={12} /> {pendiente ? "Subiendo…" : "Cambiar"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) cambiar(f);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-1 text-[11px] text-peligro">{error}</p>}
    </div>
  );
}
