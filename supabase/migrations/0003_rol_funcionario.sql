-- ── Rol "funcionario" ─────────────────────────────────────────────────────────
-- Funcionarios municipales que recorren su distrito y cargan pedidos desde el
-- territorio (módulo "Pedidos Funcionarios"). Sus pedidos entran como demandas
-- con fuente 'secretaria' y distrito/área en metadata.
alter type rol_usuario add value if not exists 'funcionario';
