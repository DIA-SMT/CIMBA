"use client";

import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { alVencerSesion, linkParaVolverAEntrar, sesionVigente } from "@/lib/sesion-cliente";

/**
 * EL CARTEL DE "TU SESIÓN SE CERRÓ", en vez de la expulsión. Aparece:
 *  - cuando una acción falla por sesión (lo dispara avisarSesionVencida), y
 *  - cuando la persona vuelve a la pestaña o a la app después de un rato,
 *    que es justo cuando una sesión vieja muerde: el cartel aparece ANTES de
 *    que toque un botón y pierda lo que estaba cargando.
 *
 * "Entrar de nuevo" lleva al acceso con ?volver=, así después de entrar vuelve
 * a esta misma pantalla. Lo guardado en el teléfono (la cola sin señal) no se
 * toca: se manda solo al volver a entrar.
 */
export function AvisoSesion() {
  const [vencida, setVencida] = useState(false);

  useEffect(() => {
    const quitar = alVencerSesion(() => setVencida(true));
    let ultimo = Date.now();
    const revisar = async () => {
      if (document.visibilityState !== "visible") return;
      // No más de una consulta cada dos minutos: volver a la pestaña diez
      // veces seguidas no son diez pedidos.
      if (Date.now() - ultimo < 120_000) return;
      ultimo = Date.now();
      if (!(await sesionVigente())) setVencida(true);
    };
    document.addEventListener("visibilitychange", revisar);
    window.addEventListener("focus", revisar);
    return () => {
      quitar();
      document.removeEventListener("visibilitychange", revisar);
      window.removeEventListener("focus", revisar);
    };
  }, []);

  if (!vencida) return null;

  return (
    <div className="fixed inset-x-3 top-3 z-[90] mx-auto max-w-lg rounded-2xl border border-amarillo/60 bg-panel p-4 shadow-2xl" role="alert">
      <p className="text-sm font-bold">Tu sesión se cerró</p>
      <p className="mt-1 text-sm text-texto-2">
        Pasaron varios días sin entrar, o te suspendieron el acceso. Volvé a entrar y seguís en esta misma
        pantalla. Lo que quedó guardado en el teléfono se manda solo después.
      </p>
      <a
        href={linkParaVolverAEntrar()}
        className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-azul px-4 text-sm font-bold text-white"
      >
        <LogIn size={16} />
        Entrar de nuevo
      </a>
    </div>
  );
}
