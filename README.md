# Monely

Monely is a self-hosted web app for managing family finances: wallets, transactions and a monthly dashboard that
shows where the money goes. It is designed to be used by a single household, with a few users sharing the same data.

> **Status:** early development. v0.1 is out: M0–M5 are complete (foundations, auth and setup, wallets, transactions,
> dashboard, polish for v0.1); next up is M6.

## Guiding principles

- Use simple technologies that are easy to maintain and deploy.
- Manual entry comes first: bank imports exist only to spot missing transactions, not to replace manual entry.
- Store facts, compute everything else: balances and aggregates are always derived from transactions.

## Tech stack

| Area           | Choice                                                                                       |
|----------------|----------------------------------------------------------------------------------------------|
| Architecture   | Django REST API + Vue 3 single-page app (Vite, vue-router, vue-i18n)                         |
| Styling        | Tailwind CSS 4 + Chart.js                                                                    |
| Database       | PostgreSQL, from day one, via docker compose                                                 |
| Authentication | Django built-in authentication with email login; no 2FA and no django-allauth for now        |
| Deployment     | docker compose, also for local development; no reverse proxy                                 |
| Tooling        | `pip` (separate dev requirements), isort, black, flake8, bandit, coverage (100%), pytest + pytest-django, GitHub Actions |
| Frontend tooling | npm (exact versions), ESLint, Prettier, Vitest + Vue Test Utils (coverage 100%)            |
| Languages      | English and Italian                                                                          |
| License        | MIT                                                                                          |

## Data model

- **User**: custom user model that logs in with email (no username).
- **Wallet**: a place where money lives (bank account, cash, credit card, ...). It has a name, a single currency, one
  or more owners (users) and can be archived instead of deleted.
- **Category**: classifies transactions (e.g. groceries, rent, salary). Used for reports and budgets.
- **Budget**: how much a category can spend every month, in one currency; a category can have one budget per
  currency. What it has spent is never stored, it is computed for each month.
- **Tag**: free-form labels that can be attached to many transactions (e.g. `holiday-2026`, `car`), orthogonal to
  categories.
- **Transaction**: a single money movement on a wallet, with a date, a signed amount, a description, an optional
  category and any number of tags.
- **Transfer**: moves money between two wallets with the same currency, as a pair of transactions (outgoing and
  incoming) that share date, amount, description and notes and are edited and deleted together.
- **Recurring transaction**: a transaction that repeats every N weeks, months or years from a first due date, until an
  optional end date, with the same fields as a transaction (wallet, signed amount, description, category, tags, notes).
  It is not a real transaction: it only keeps the next due date, which moves on when an occurrence is registered or
  skipped. The transactions that register its occurrences keep a link to it, which is cleared if it is deleted.

### Key decisions

- **Amounts**: stored as `DecimalField`, never as floats.
- **Sign**: amounts are signed; negative means outgoing, positive means incoming.
- **Balance**: never stored; it is always computed from the transactions.
- **Transfers between wallets**: neither income nor expenses, so they have no category and the reports ignore them,
  while the balances include them; only between wallets with the same currency.
- **Currencies**: one currency per wallet, no conversions.
- **Permissions**: postponed; for now every user can see and edit everything.

## Features

- **Welcome flow**: on first run, create the first user and the first wallet.
- **Wallets**: create, edit, archive and assign owners.
- **Transactions**: create, edit and delete transactions; list them 500 at a time with filters (wallet,
  type: income, expenses or transfers, date range, category or no category, tags).
- **Transfers**: move money between two wallets; both transactions are listed with the others.
- **Recurring transactions**: create, edit and delete them; from 7 days before the due date until they are handled, the
  occurrences are suggested above the transaction list, to register them with the form already filled in (date, amount
  and the rest can still be changed) or to skip them. A monthly one on the 31st falls on the last day of shorter months.
- **CSV export/import**: export the filtered transactions to CSV (`date,wallet,currency,amount,description,category,
  tags,notes,transfer`, tags separated by `|`) and import them back; wallets, categories and tags are matched by name
  (case-insensitive) and created when missing, the two rows of a transfer share the value of the `transfer` column,
  and a file with any invalid row is rejected as a whole.
- **Maintenance** (admins only): technical tools, starting with deleting all the data (transactions, transfers,
  recurring transactions, wallets, budgets, categories and tags; the users are kept) after typing a confirmation word.
- **Budget**: set a monthly amount for each category and follow, month by month, how much it has spent and how much is
  left. The spent amount is net of the refunds in the same category and leaves transfers out. Recurring transactions
  count with their monthly share (e.g. a yearly bill of 1,200 counts 100 a month, one every 2 weeks 52/24 of its
  amount) in every month from their start date to their end date, even when no occurrence is due, so that their cost
  is spread over the following months; the transactions that register their occurrences are therefore left out, not to
  count them twice.
- **Monthly dashboard**: income, expenses and balance for the selected month, breakdown by category, comparison with
  the same month of the previous year. In the expenses by category, the categories with a budget show how much of it
  the month used: the bar of the month stacks what is left of the budget, or what goes over it, on what was spent
  (recurring shares included); only for all the wallets, as the budgets cover them all.

## Out of scope (on purpose)

To keep the project small, the following are not planned:

- Automatic bank synchronization (Open Banking): imports are manual file uploads (see M10).
- Currency conversion and multi-currency reports.
- Investment and asset tracking.
- Native mobile apps.
- Attachments and receipt scanning.

Tags were initially in this list and have been moved into the data model.

## Roadmap

- [x] **M0 – Foundations**: repository, tooling, CI, custom User, Docker, base template with a minimal design system.
- [x] **M1 – Auth and setup**: ~~welcome~~setup flow, login/logout, ~~invitations~~, profile management.
- [x] **M2 – Wallets**: CRUD (archive instead of delete).
- [x] **M3 – Transactions**: categories, CRUD, list with filters.
- [x] **M4 – Dashboard**: aggregations, charts, month selector.
- [x] **M5 – Polish for v0.1**: i18n, installation docs, backup/CSV export, published Docker image.
- [x] **M6 – v0.2**: transfers between wallets.
- [x] **M7 – v0.3**: recurring transactions.
- [x] **M8 – v0.4**: budgeting by category.
- [ ] **M9 – v0.5**: family balance: identify shared expenses and compute how much each family member has to transfer to
  the joint account to cover them.
- [ ] **M10 – v0.6**: CSV/xlsx import from banks: raw import, duplicate handling and reconciliation, warnings for
  transactions that were not entered (manual entry drives the data, imports help find what is missing).

## Getting started

To self-host Monely with the published Docker image, follow the [installation guide](docs/installation.md). The rest of
this section covers the development setup.

### Requirements

- Docker with docker compose
- GNU Make
- Python 3.14 and Node.js >= 22.12 (only to run commands outside Docker; see `frontend/.nvmrc`)

### Run with Docker

```bash
make init
```

This builds the images, starts PostgreSQL, the backend and the frontend dev server, collects static files and applies
the migrations. The SPA is available at <http://localhost:5173>, the Django backend at <http://localhost:8000>, and
PostgreSQL is exposed on the host on port `5433`.

The Vite dev server proxies `/api`, `/admin` and `/static` to Django, so during development you only need to open the
frontend URL. The backend address is read from `BACKEND_URL` (default `http://localhost:8000`; inside docker compose it
points to the `backend` service).

Create an admin user with:

```bash
make createsuperuser
```

### Run locally

Every `make` target runs inside Docker by default. Add `DEV_ENV=local` to use a local virtualenv and the local Node.js
instead (only the database runs in Docker):

```bash
python3.14 -m venv .virtualenv
source .virtualenv/bin/activate
make start DEV_ENV=local
```

In another terminal, start the frontend:

```bash
make frontend-install DEV_ENV=local
make frontend-dev
```

## Configuration

Environment variables are read with `django-environ` from these files:

- `.env`: generic values for local development (committed, no real secrets).
- `.env.secrets`: local secrets, ignored by git (`make touch` creates it empty).
- `.env.docker`: overrides for the containers (e.g. `DATABASE_URL` pointing to the `db` host).

| Variable        | Required | Description                                                 |
|-----------------|----------|-------------------------------------------------------------|
| `DATABASE_URL`  | yes      | PostgreSQL connection URL                                   |
| `SECRET_KEY`    | no       | Django secret key (random if missing; set it in production) |
| `DEBUG`         | no       | Enables debug mode (default `False`)                        |
| `ALLOWED_HOSTS` | no       | Comma-separated list of allowed hosts                       |
| `EMAIL_BACKEND` | no       | Django email backend (default: console)                     |

## Development

Run `make help` to list all targets. The most common ones:

| Command                   | Description                                                          |
|---------------------------|----------------------------------------------------------------------|
| `make start`              | Build and start the containers                                       |
| `make migrate`            | Apply the migrations                                                 |
| `make make-migration`     | Create new migrations after model changes                            |
| `make shell`              | Open a Django shell                                                  |
| `make test`               | Run pytest with coverage (the build fails below 100%)                |
| `make lint`               | Run Django check, isort, black, flake8 and bandit                    |
| `make build-translations` | Extract and compile the IT/EN translations                           |
| `make frontend-install`   | Install the frontend dependencies (`npm ci`)                         |
| `make frontend-dev`       | Start the Vite dev server on port `5173` (outside Docker)            |
| `make frontend-lint`      | Run ESLint and Prettier                                              |
| `make frontend-test`      | Run Vitest with coverage (the build fails below 100%)                |
| `make frontend-build`     | Build the frontend for production in `frontend/dist`                 |

Run a single test:

```bash
make test DEV_ENV=local pytest_args="tests/test_models.py -k superuser"
```

Before opening a pull request, make sure these pass:

```bash
make lint DEV_ENV=local check_only=true
make test DEV_ENV=local
```

If you changed the frontend, also run:

```bash
make frontend-lint check_only=true
make frontend-test
```

### Conventions

- black and isort (black profile), 120-character lines.
- User-facing strings are always translated with `gettext_lazy`; in the frontend with `$t()`, with keys in both
  `frontend/src/locales/it.json` and `en.json`.
- Frontend: plain JavaScript (no TypeScript), `<script setup>` components, Prettier with 120-character lines, npm
  dependencies pinned to exact versions.
- Every model change comes with its migration.
- New code is covered by tests: coverage stays at 100%.

## Project structure

```
backend/
  manage.py        Django entry point
  monely/          Django project (settings, urls, asgi, wsgi)
  core/            main app, including the custom User model
  locales/         IT/EN translations
frontend/
  src/             Vue SPA: main.js, App.vue, router/, i18n/, locales/, views/, components/
  src/assets/      main.css, with the design system tokens in Tailwind's @theme
  tests/           Vitest tests
requirements/      base.txt (runtime), local.txt (dev/test/lint), production.txt
tests/             pytest tests
```

## License

Released under the [MIT License](LICENSE).

