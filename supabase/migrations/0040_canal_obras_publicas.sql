-- ═══════════════════════════════════════════════════════════════════════════
-- EL CANAL OBRAS PÚBLICAS
--
-- Lo que carga el personal de la Secretaría de Obras Públicas en la pantalla
-- Carga rápida entraba como "Carga manual", mezclado en los conteos con
-- cualquier otra carga a mano. El usuario pidió que figure como un canal
-- propio (14/10/2026), igual que el Concejo o la S.A.T.
--
-- Solo agrega un valor al enum, al final. No cambia ni mueve ninguna fila.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter type fuente_demanda add value if not exists 'obras_publicas';
