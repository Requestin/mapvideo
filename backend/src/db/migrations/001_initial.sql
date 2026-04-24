-- 001_initial.sql
-- Начальная схема: пользователи, сессии, задачи рендера, одноразовые render-токены.
-- gen_random_uuid() входит в ядро PostgreSQL 13+, дополнительное расширение не нужно.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Сессии: в БД хранится только sha256-хэш opaque-токена из cookie.
-- При утечке БД угнать сессии нельзя.
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Очередь рендера и история «Моя история» живут в одной таблице.
-- История = SELECT ... WHERE status='done' ORDER BY updated_at DESC.
CREATE TABLE render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  state_json JSONB NOT NULL,
  output_path VARCHAR(255),
  thumbnail_path VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON sessions (token_hash);
CREATE INDEX ON sessions (user_id);
CREATE INDEX ON render_jobs (user_id, status);
CREATE INDEX ON render_jobs (user_id, updated_at DESC) WHERE status = 'done';

-- Одноразовые токены, которые Puppeteer использует для /api/render/state/:jobId.
CREATE TABLE render_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON render_tokens (job_id);
CREATE INDEX ON render_tokens (expires_at);
