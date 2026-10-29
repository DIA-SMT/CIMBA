"use client";

import { ImageUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { reemplazarFotoTrabajo } from "@/lib/acciones-ordenes";
import { comprimirFoto } from "@/lib/comprimir-foto";
import { soltarFoto, usarSinSoltarAfuera } from "@/lib/soltar-foto";
import { mensajeDeError } from "@/lib/errores";

/**
 * CAMBIAR UNA FOTO YA CARGADA (28/10). Para la foto equivocada o repetida que
 * marca el inspector. La anterior no se pierde: queda guardada y anotada en el
 * bache, con quién la cambió y por qué (ver reemplazarFotoTrabajo).
 */
export function CambiarFoto({
  itemId,
  fotos,
}: {
  itemId: number;
  fotos: Array<{ id: number; etiqueta: string; url: string }>;
}) {
  const router = useRouter();
  const [elegida, setElegida] = useState<number | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  usarSinSoltarAfuera();
  const [enviando, iniciar] = useTransition();
  const refArchivo = useRef<HTMLInputElement>(null);

  if (fotos.length === 0) return null;

  const cancelar = () => {
    setElegida(null);
    setArchivo(null);
    setMotivo("");
    setError(null);
  };

  if (elegida == null) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-texto-3">Cambiar foto:</span>
        {fotos.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setElegida(f.id)}
            className="flex min-h-9 items-center gap-1 rounded-lg border border-borde-2 px-2.5 text-xs font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
          >
            <ImageUp size={13} /> {f.etiqueta}
          </button>
        ))}
      </div>
    );
  }

  const actual = fotos.find((f) => f.id === elegida);
  return (
    <div className="mt-2 rounded-xl border border-borde-2 bg-panel-2 p-3">
      <p className="text-sm font-bold">Cambiar la foto del {actual?.etiqueta.toLowerCase()}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-texto-3">
        La foto anterior no se borra: queda guardada para el inspector, con quién la cambió y por qué.
      </p>
      <div className="mt-2 flex items-center gap-3">
        {actual && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={actual.url} alt="Foto actual" className="h-16 w-20 rounded-md object-cover opacity-70" />
        )}
        <span className="text-texto-3">→</span>
        <button
          type="button"
          onClick={() => refArchivo.current?.click()}
          {...soltarFoto(setArchivo, setError)}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-borde-2 px-3 text-sm font-semibold text-texto-2 hover:border-celeste/60 hover:text-celeste"
        >
          <ImageUp size={15} /> {archivo ? archivo.name : "Elegir o arrastrar la foto correcta"}
        </button>
        <input
          ref={refArchivo}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        />
      </div>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="¿Por qué se cambia? (por ejemplo: era la foto de otro bache)"
        className="mt-2 w-full rounded-lg border border-borde-2 bg-panel px-3 py-2 text-sm placeholder:text-texto-3"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={enviando || !archivo || motivo.trim().length < 3}
          onClick={() => {
            if (!archivo) return;
            setError(null);
            iniciar(async () => {
              try {
                const { archivo: liviano } = await comprimirFoto(archivo);
                const fd = new FormData();
                fd.set("itemId", String(itemId));
                fd.set("fotoId", String(elegida));
                fd.set("motivo", motivo.trim());
                fd.set("foto", liviano);
                await reemplazarFotoTrabajo(fd);
                cancelar();
                router.refresh();
              } catch (e) {
                setError(mensajeDeError(e, "No se pudo cambiar la foto"));
              }
            });
          }}
          className="min-h-11 rounded-xl bg-azul px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {enviando ? "Subiendo…" : "Guardar la foto nueva"}
        </button>
        <button type="button" onClick={cancelar} className="text-sm text-texto-2 hover:text-texto">
          Cancelar
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-peligro">{error}</p>}
    </div>
  );
}
