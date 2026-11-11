-- Notas del módulo de ejemplo (dominio neutro de las pruebas de la base). PostgreSQL estándar, sin RLS: el ámbito
-- (instancia, empresa) lo pone el repositorio en cada consulta a partir de la sesión comprobada en Pimia ERP.
-- La aplica el migrador, en su transacción y con search_path en el esquema del módulo.
CREATE TABLE notes (
  tenant_id text NOT NULL CHECK (length(tenant_id) > 0),
  company_id text NOT NULL CHECK (length(company_id) > 0),
  id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 4000),
  -- Usuario de Pimia (id de /me) que dio de alta la nota.
  created_by text NOT NULL CHECK (length(created_by) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, company_id, id)
);
CREATE INDEX notes_list ON notes (tenant_id, company_id, lower(title), id);
