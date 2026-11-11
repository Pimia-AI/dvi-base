-- Datos de ejemplo del módulo de notas, para el arranque local con el doble de Pimia (instancia `demo`, empresas 1 y 2
-- de Lucía y 3 de otra persona). Solo desarrollo: nunca en una instancia real. Se pueden aplicar varias veces.
INSERT INTO notes (tenant_id, company_id, id, title, body, created_by, updated_at) VALUES
  ('demo', '1', '6f1c2a3e-1b2c-4d5e-8f90-0a1b2c3d4e01', 'Revisar el presupuesto de la reforma del portal', 'Comparar las tres ofertas antes del jueves.', '7', now() - interval '2 hours'),
  ('demo', '1', '6f1c2a3e-1b2c-4d5e-8f90-0a1b2c3d4e02', 'Llamar al proveedor de la caldera', 'Preguntar por la garantía de la pieza cambiada.', '7', now() - interval '1 day'),
  ('demo', '1', '6f1c2a3e-1b2c-4d5e-8f90-0a1b2c3d4e03', 'Acta de la reunión de octubre', 'Subida al espacio compartido de la empresa.', '9', now() - interval '3 days'),
  ('demo', '2', '6f1c2a3e-1b2c-4d5e-8f90-0a1b2c3d4e04', 'Renovar el seguro del local', 'Vence a final de mes; pedir dos presupuestos.', '7', now() - interval '5 hours'),
  ('demo', '3', '6f1c2a3e-1b2c-4d5e-8f90-0a1b2c3d4e05', 'Nota de otra empresa', 'Solo la ve quien trabaja con la Empresa Tres.', '8', now() - interval '1 hour')
ON CONFLICT DO NOTHING;
