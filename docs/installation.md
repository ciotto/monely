# Installation

This guide explains how to self-host Monely with docker compose, using the published production image. For local
development see [Getting started](../README.md#getting-started) instead.

The production image serves everything from a single container: the Vue SPA, the REST API under `/api/`, the Django
admin under `/admin/` and the static files under `/static/`. Next to it you only need PostgreSQL.

## Requirements

- A Linux, macOS or Windows host with Docker and the docker compose plugin (`docker compose version`).
- An `amd64` or `arm64` CPU (the image is multi-arch).
- About 1 GB of free disk space for the images, plus the space for the database.

## 1. Create the installation directory

```bash
mkdir monely && cd monely
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/ciotto/monely/main/docs/docker-compose.example.yml
```

If you prefer, download [`docker-compose.example.yml`](https://github.com/ciotto/monely/blob/main/docs/docker-compose.example.yml)
by hand and save it as `docker-compose.yml`. It defines three services:

| Service   | What it does                                                                                     |
|-----------|--------------------------------------------------------------------------------------------------|
| `db`      | PostgreSQL 17; the data lives in the `monely-db-data` volume                                     |
| `migrate` | One-shot job that applies the database migrations and exits; it runs at every `docker compose up` |
| `app`     | Monely (gunicorn + uvicorn on port `8000`); it starts only after the migrations succeeded         |

## 2. Configure the environment

Create a `.env` file next to `docker-compose.yml`; docker compose reads it automatically:

```dotenv
# Required
POSTGRES_PASSWORD=change-me
SECRET_KEY=change-me-too

# Optional
ALLOWED_HOSTS=localhost,127.0.0.1,monely.lan,192.168.1.10
MONELY_VERSION=stable
MONELY_PORT=8000
```

| Variable            | Required | Default               | Description                                                              |
|---------------------|----------|-----------------------|--------------------------------------------------------------------------|
| `POSTGRES_PASSWORD` | yes      |                       | Password of the `monely` database user                                   |
| `SECRET_KEY`        | yes      |                       | Django secret key; keep it secret and stable (it signs the sessions)     |
| `ALLOWED_HOSTS`     | no       | `localhost,127.0.0.1` | Comma-separated host names and IP addresses used to reach Monely         |
| `MONELY_VERSION`    | no       | `stable`              | Image tag: `stable` (latest release) or a specific version, e.g. `v0.1.0` |
| `MONELY_PORT`       | no       | `8000`                | Port published on the host                                               |

Generate random values for the two secrets, for example with:

```bash
openssl rand -hex 32
```

Notes:

- `POSTGRES_PASSWORD` ends up in a connection URL, so stick to letters, digits, `-` and `_` (the `openssl` command above
  is fine); other characters would have to be URL-encoded.
- `ALLOWED_HOSTS` must contain every name or address you type in the browser: a request with any other `Host` header is
  rejected with `400 Bad Request`.
- The `.env` file contains secrets: restrict its permissions with `chmod 600 .env`.

## 3. Start Monely

```bash
docker compose up -d
```

The first start downloads the images, initializes the database and applies the migrations. Check that everything is
running:

```bash
docker compose ps -a
```

`db` and `app` must be `Up` and `migrate` must be `Exited (0)`. If `migrate` failed, read its output with
`docker compose logs migrate`.

> **Image not published yet?** The image is pushed to [Docker Hub](https://hub.docker.com/r/ciotto87/monely) when a
> [GitHub release](https://github.com/ciotto/monely/releases) is published. Before the first release, build it from a
> clone of the repository and point `MONELY_VERSION` to it:
>
> ```bash
> git clone https://github.com/ciotto/monely.git && cd monely
> docker build --target production -t ciotto87/monely:local .
> ```
>
> then set `MONELY_VERSION=local` in `.env`.

## 4. First run

Open `http://<host>:8000` (or the port you set in `MONELY_PORT`). On the first visit Monely shows the setup page, where
you create the first user. That user is an administrator and can also log in to the Django admin at `/admin/`.

The setup page disappears as soon as the first user exists. Additional users can be created from the Django admin, or
from the command line:

```bash
docker compose exec app python backend/manage.py createsuperuser
```

## Upgrading

```bash
docker compose pull
docker compose up -d
```

The `migrate` service runs again and applies the new migrations before the new `app` container starts. Take a backup
first (see below). To stay on a specific version instead of following `stable`, set `MONELY_VERSION` to its tag.

## Backup and restore

The whole state of Monely is in PostgreSQL. Create a dump with:

```bash
docker compose exec -T db pg_dump -U monely -d monely --clean --if-exists > monely-$(date +%F).sql
```

Restore it, replacing the current data, with:

```bash
docker compose exec -T db psql -U monely -d monely < monely-2026-11-13.sql
```

Store the dumps outside the host as well. The transactions can also be exported to CSV from the web interface, but
the CSV does not contain users and settings, so it does not replace a database dump.

## Useful commands

| Command                                                   | Description                         |
|-----------------------------------------------------------|-------------------------------------|
| `docker compose logs -f app`                              | Follow the application logs         |
| `docker compose restart app`                              | Restart Monely                      |
| `docker compose down`                                     | Stop everything (data is kept)      |
| `docker compose down -v`                                  | Stop everything and **delete the data** |
| `docker compose exec app python backend/manage.py shell`  | Open a Django shell                 |

## Limitations

- Out of the box Monely is served over plain HTTP, so it is meant to be reached inside a trusted network (e.g. the home
  LAN or a VPN). Do not expose it on the internet as is: the traffic, passwords included, is not encrypted. To get HTTPS
  you can put it behind a reverse proxy of your choice (e.g. Caddy, Traefik or nginx); its configuration is out of the
  scope of this guide.
- Emails are written to the container log (console backend); no email delivery is configured.
