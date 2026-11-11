# Monely

Monely is a self-hosted web app for managing family finances: wallets, transactions and a monthly dashboard that
shows where the money goes. It is designed to be used by a single household, with a few users sharing the same data.

> **Status:** early development (milestone M0). The backend skeleton is in place; the frontend is not there yet.

## Guiding principles

- Use simple technologies that are easy to maintain and deploy.
- Manual entry comes first: bank imports exist only to spot missing transactions, not to replace manual entry.
- Store facts, compute everything else: balances and aggregates are always derived from transactions.

## Tech stack

| Area           | Choice                                                                                       |
|----------------|----------------------------------------------------------------------------------------------|
| Architecture   | Django REST API + Vue single-page app                                                        |
| Styling        | Tailwind CSS + Chart.js                                                                      |
| Database       | PostgreSQL, from day one, via docker compose                                                 |
| Authentication | Django built-in authentication with email login; no 2FA and no django-allauth for now        |
| Deployment     | docker compose, also for local development; no reverse proxy                                 |
| Tooling        | `pip` (separate dev requirements), isort, black, flake8, bandit, coverage (100%), pytest + pytest-django, GitHub Actions |
| Languages      | English and Italian                                                                          |
| License        | MIT                                                                                          |

## Data model

- **User**: custom user model that logs in with email (no username).
- **Wallet**: a place where money lives (bank account, cash, credit card, ...). It has a name, a single currency, one
  or more owners (users) and can be archived instead of deleted.
- **Category**: classifies transactions (e.g. groceries, rent, salary). Used for reports and, later, budgets.
- **Tag**: free-form labels that can be attached to many transactions (e.g. `holiday-2026`, `car`), orthogonal to
  categories.
- **Transaction**: a single money movement on a wallet, with a date, a signed amount, a description, an optional
  category and any number of tags.

### Key decisions

- **Amounts**: stored as `DecimalField`, never as floats.
- **Sign**: amounts are signed; negative means outgoing, positive means incoming.
- **Balance**: never stored; it is always computed from the transactions.
- **Transfers between wallets**: essential, but postponed (see M6).
- **Currencies**: one currency per wallet, no conversions.
- **Permissions**: postponed; for now every user can see and edit everything.

## Features

- **Welcome flow**: on first run, create the first user and the first wallet.
- **Wallets**: create, edit, archive and assign owners.
- **Transactions**: create, edit and delete transactions; list them with filters (wallet, date range, category, tags).
- **Monthly dashboard**: income, expenses and balance for the selected month, breakdown by category, and comparison with
  the same month of the previous year.

## Out of scope (on purpose)

To keep the project small, the following are not planned:

- Automatic bank synchronization (Open Banking): imports are manual file uploads (see M10).
- Currency conversion and multi-currency reports.
- Investment and asset tracking.
- Native mobile apps.
- Attachments and receipt scanning.

Tags were initially in this list and have been moved into the data model.

## Roadmap

- **M0 – Foundations**: repository, tooling, CI, custom User, Docker, base template with a minimal design system.
- **M1 – Auth and setup**: welcome flow, login/logout, invitations, profile management.
- **M2 – Wallets**: CRUD.
- **M3 – Transactions**: categories, CRUD, list with filters.
- **M4 – Dashboard**: aggregations, charts, month selector.
- **M5 – Polish for v0.1**: i18n, installation docs, backup/CSV export, published Docker image.
- **M6 – v0.2**: transfers between wallets.
- **M7 – v0.3**: recurring transactions.
- **M8 – v0.4**: budgeting by category and goals.
- **M9 – v0.5**: family balance: identify shared expenses and compute how much each family member has to transfer to
  the joint account to cover them.
- **M10 – v0.6**: CSV/xlsx import from banks: raw import, duplicate handling and reconciliation, warnings for
  transactions that were not entered (manual entry drives the data, imports help find what is missing).

## Getting started

### Requirements

- Docker with docker compose
- GNU Make
- Python 3.14 (only to run commands outside Docker)

### Run with Docker

```bash
make init
```

This builds the images, starts PostgreSQL and the backend, collects static files and applies the migrations. The app
is available at <http://localhost:8000>, and PostgreSQL is exposed on the host on port `5433`.

Create an admin user with:

```bash
make createsuperuser
```

### Run locally

Every `make` target runs inside Docker by default. Add `DEV_ENV=local` to use a local virtualenv instead (only the
database runs in Docker):

```bash
python3.14 -m venv .virtualenv
source .virtualenv/bin/activate
make start DEV_ENV=local
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

Run a single test:

```bash
make test DEV_ENV=local pytest_args="tests/test_models.py -k superuser"
```

Before opening a pull request, make sure these pass:

```bash
make lint DEV_ENV=local check_only=true
make test DEV_ENV=local
```

### Conventions

- black and isort (black profile), 120-character lines.
- User-facing strings are always translated with `gettext_lazy`.
- Every model change comes with its migration.
- New code is covered by tests: coverage stays at 100%.

## Project structure

```
backend/
  manage.py        Django entry point
  monely/          Django project (settings, urls, asgi, wsgi)
  core/            main app, including the custom User model
  locales/         IT/EN translations
frontend/          Vue SPA (coming soon)
requirements/      base.txt (runtime), local.txt (dev/test/lint), production.txt
tests/             pytest tests
```

## License

Released under the [MIT License](LICENSE).

