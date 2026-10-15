/**
 * EL NÚMERO DEL BACHE, a la vista de la empresa y del inspector. "La empresa
 * debe poder ver el número de ticket interno, y si tiene en CIDITUC también:
 * es más fácil para el inspector controlar por número de ticket" (14/10). El
 * ticket interno es el número del bache en su orden (el id del item): existe
 * siempre, también en los baches sin reclamo. El del 147 sale de los reclamos
 * de Atención Ciudadana atados al bache. En Control se busca por cualquiera
 * de los dos.
 */
export function TicketBache({
  id,
  tickets147,
  className = "",
}: {
  id: number;
  tickets147?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`num inline-flex shrink-0 items-center rounded-md bg-panel-3 px-1.5 py-0.5 text-[11px] font-semibold text-texto-2 ${className}`}
      title="El número de este bache: con este número lo busca el inspector"
    >
      Ticket {id}
      {tickets147 && <> · 147 N° {tickets147}</>}
    </span>
  );
}
