"use client";

/**
 * LA SESIÓN, VISTA DESDE EL TELÉFONO. Cuando una acción falla, antes de
 * mostrar "Error" se pregunta si fue porque la sesión se cerró: en ese caso
 * el mensaje es otro ("volvé a entrar") y lo que estaba por mandarse no se
 * tira.
 */

const EVENTO = "cimba:sesion-vencida";

/**
 * true si la sesión sigue abierta. Ante la duda (sin red, respuesta rara)
 * contesta true: el que decide que no hay sesión es el servidor, no un corte.
 */
export async function sesionVigente(): Promise<boolean> {
  try {
    const r = await fetch("/api/auth/estado", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return true;
    const j = (await r.json()) as { sesion?: boolean };
    return j.sesion !== false;
  } catch {
    return true;
  }
}

/** Avisa a toda la pantalla (el cartel de AvisoSesion) que hay que volver a entrar. */
export function avisarSesionVencida() {
  try {
    window.dispatchEvent(new Event(EVENTO));
  } catch {
    /* sin window: nada que avisar */
  }
}

export function alVencerSesion(fn: () => void): () => void {
  window.addEventListener(EVENTO, fn);
  return () => window.removeEventListener(EVENTO, fn);
}

/** El link al acceso que después devuelve exactamente a esta pantalla. */
export function linkParaVolverAEntrar(): string {
  const aca = `${window.location.pathname}${window.location.search}`;
  return `/acceso?volver=${encodeURIComponent(aca)}`;
}

export const MENSAJE_SESION =
  "Tu sesión se cerró. Volvé a entrar y repetí este paso: no se guardó nada todavía.";
