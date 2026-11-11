# syntax=docker/dockerfile:1
FROM python:3.14-slim AS base

ENV LANG=C.UTF-8

ARG APP_USER=www-data
RUN mkdir -p /var/www
RUN chown ${APP_USER}:${APP_USER} /var/www

RUN \
  apt-get update \
  && apt-get install -y --no-install-recommends gettext \
  && rm -rf /var/lib/apt/lists/*

COPY requirements /requirements

RUN pip install --no-cache-dir -r /requirements/base.txt

COPY ./backend/ /code/backend/

WORKDIR /code

# Gunicorn will listen on this port
EXPOSE 8000

ENV DJANGO_SETTINGS_MODULE=monely.settings

# Placeholder values used only to validate the project at build time
RUN SECRET_KEY=build DATABASE_URL=sqlite:////tmp/build.db python backend/manage.py compilemessages -l it -l en
RUN SECRET_KEY=build DATABASE_URL=sqlite:////tmp/build.db python backend/manage.py check

RUN chown -R ${APP_USER} /code/backend

ENV SHELL=/bin/bash


FROM base AS development

RUN pip install --no-cache-dir -r /requirements/local.txt

USER ${APP_USER}:${APP_USER}


FROM base AS production

USER ${APP_USER}:${APP_USER}

CMD ["gunicorn", "monely.asgi:application", "--chdir=backend", "--workers=1", "--threads=10", "--bind=0.0.0.0:8000", "--timeout=20", "--worker-class=uvicorn.workers.UvicornWorker", "--preload", "--access-logfile", "-", "--max-requests=2000", "--max-requests-jitter=100"]
