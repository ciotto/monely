# CLAUDE.md

Guide for Claude Code on this repository. Vision, data model and roadmap are in `README.md`.

## Project

Monely: an app for managing family finances (wallets, transactions, monthly dashboard).

- Backend Django 6.1 on Python 3.14, PostgreSQL 17 via docker compose.
- Frontend in `frontend/`: Vue 3 + Vite + Tailwind 4 SPA, vue-router, vue-i18n, Chart.js (wrapped by `components/BarChart.vue`; mocked in the tests, jsdom has no canvas); Node >= 22.12 (`frontend/.nvmrc`).
- MIT license.

## Structure

- `backend/manage.py`: Django entry point; `DJANGO_SETTINGS_MODULE=monely.settings`.
- `backend/monely/`: Django project (a single `settings.py`, `urls.py`, `asgi.py`, `wsgi.py`).
- `backend/core/`: main app; contains the custom `User` (email login, no `username`).
- `backend/locales/`: IT/EN translations.
- `tests/`: pytest tests (`test_*.py`); `backend/` is on the `pythonpath`, so import `core.models`, not `backend.core.models`.
- `frontend/src/`: `main.js`, `App.vue`, `router/`, `i18n/` + `locales/{it,en}.json`, `views/`, `components/`, `assets/main.css` (design system tokens in `@theme`).
- `frontend/tests/`: vitest tests (`*.test.js`); alias `@` = `frontend/src`.
- `requirements/`: `base.txt` (runtime), `local.txt` (dev/test/lint), `production.txt`.

## Configuration

Environment variables are read with `django-environ`:

- `.env`: generic values for local development (committed, no real secrets).
- `.env.secrets`: local secrets, ignored by git (`make touch` creates it empty).
- `.env.docker`: overrides for the containers (e.g. `DATABASE_URL` with host `db`).

Required variables: `DATABASE_URL`. Used: `SECRET_KEY`, `DEBUG` (bool), `ALLOWED_HOSTS` (list), `EMAIL_BACKEND`.

## Commands

All `make` targets run in docker by default; add `DEV_ENV=local` to use the `.virtualenv` virtualenv.

- `make init`: build, start containers, collectstatic and migrate.
- `make start` / `make up` / `make build`
- `make migrate`, `make make-migration`, `make createsuperuser`, `make shell`
- `make test`: pytest with coverage; the threshold is **100%** (`fail_under = 100`).
- `make lint`: Django check, isort, black, flake8, bandit. With `check_only=true` it does not modify files.
- `make build-translations` / `make compilemessages`
- A single test: `make test DEV_ENV=local pytest_args="tests/test_models.py -k superuser"`

Frontend (in docker by default, `DEV_ENV=local` uses the local Node):

- `make frontend-install`, `make frontend-dev` (local dev server on `:5173`)
- `make frontend-lint` (eslint + prettier, supports `check_only=true`), `make frontend-test` (vitest, coverage **100%**), `make frontend-build`
- The Vite dev server proxies `/api`, `/admin`, `/static` to Django (`BACKEND_URL`, default `http://localhost:8000`).

Before considering a task done: `make lint DEV_ENV=local check_only=true` and `make test DEV_ENV=local` must pass; if you touch the frontend, also `make frontend-lint check_only=true` and `make frontend-test`.

## Conventions

- Formatting: black and isort with the black profile, 120-character lines.
- User-facing strings are always translated with `gettext_lazy as _`; supported languages `it` and `en`. In the frontend with `$t()` and keys in both `locales/*.json` files.
- Frontend: JavaScript (no TypeScript), `<script setup>`, Prettier at 120 characters, npm dependencies pinned to exact versions.
- Every model change requires a migration (`make make-migration`); `makemigrations --check` must be clean.
- All new code must be covered by tests: coverage stays at 100%. Use `# pragma: no cover` only when truly justified.
- Monetary amounts as signed `DecimalField` (negative = expense); the balance is never stored, it is computed.
- One currency per wallet, no conversion.
- No per-object permissions for now: all users see and edit everything.
- API with Django REST framework under `/api/` (`core/urls.py`, namespace `api`): session authentication (same origin as the SPA via the Vite proxy), `IsAuthenticated` by default; public views declare `AllowAny`. Write requests from an authenticated user require the `X-CSRFToken` header (`csrftoken` cookie).

## Docker

- The `Dockerfile` has three stages: `base`, `development` (used by docker compose, with the code mounted in `/code`) and `production` (gunicorn + uvicorn on `monely.asgi:application`, port 8000).
- Postgres is exposed on the host on port `5433`.
- No reverse proxy planned.
