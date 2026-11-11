RED=\033[0;31m
BLUE=\033[0;34m
NC=\033[0m # No Color
REPOSITORY_ROOT=${PWD}


#: Print this message
help:
	@grep -B1 -E "^[a-zA-Z0-9_-]+\:([^\=]|$$)" Makefile \
     | grep -v -- -- \
     | sed 'N;s/\n/###/' \
     | sed -n 's/^#: \(.*\)###\(.*\):.*/\2###\1/p' \
     | column -t -s '###'

ifndef DEV_ENV
# can be "docker" or "local"
DEV_ENV=docker
endif

#: Initialize the project and start the development server
init: start migrate

#: Create required files and folders
touch:
	@echo "\n${BLUE}Create .env.secrets file...${NC}\n"
	@touch .env.secrets

#: Start the development server
start: touch
ifeq ($(DEV_ENV),docker)
	@make build up collect-static
else
	@make build up
	@pip install -r requirements/local.txt
	@python backend/manage.py runserver 0:8000
endif

#: Run linting and security tests
lint: touch django-check isort black flake8 bandit

#: Run unit and integration tests using pytest
test: touch
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend coverage erase
	@docker compose exec backend coverage run -m pytest ${pytest_args}
	@docker compose exec backend coverage report --skip-covered
	@docker compose exec backend coverage html
	@docker compose exec backend coverage xml
else
	@coverage erase
	coverage run -m pytest ${pytest_args}
	@coverage report --skip-covered
	@coverage html
	@coverage xml
endif

#: Build translations files
build-translations:
	@echo "\n${BLUE}Building translations...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend sh -c "cd backend && python manage.py makemessages --locale it --locale en"
	@docker compose exec backend python backend/manage.py compilemessages --locale it --locale en
else
	@cd backend && python manage.py makemessages --locale it --locale en
	@python backend/manage.py compilemessages --locale it --locale en
endif

#: Apply migrations
migrate:
	@echo "\n${BLUE}Apply migrations...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py migrate
else
	@python backend/manage.py migrate
endif

#: Create a new migration
make-migration:
	@echo "\n${BLUE}Create migrations...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py makemigrations
else
	@python backend/manage.py makemigrations
endif

#: Collect static files
collect-static:
	@echo "\n${BLUE}Collect static files in ${REPOSITORY_ROOT}/static ...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py collectstatic --noinput --link --clear
else
	@python backend/manage.py collectstatic --noinput --link --clear
endif

#: Create a superuser
createsuperuser:
	@echo "\n${BLUE}Create superuser...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py createsuperuser
else
	@python backend/manage.py createsuperuser
endif

#: Open a Django shell
shell:
	@echo "\n${BLUE}Open shell...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py shell
else
	@python backend/manage.py shell
endif

#: Run Django check
django-check:
	@echo "\n${BLUE}Validating django...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py check
else
	@python backend/manage.py check
endif

#: Compile the translations
compilemessages:
	@echo "\n${BLUE}Compile the translations...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend python backend/manage.py compilemessages --locale it --locale en
else
	@python backend/manage.py compilemessages --locale it --locale en
endif

# Linting and security

#: Run isort (import sorter). Use check_only=true to prevent changes
isort:
	@echo "\n${BLUE}Running isort...${NC}\n"
ifeq ($(DEV_ENV),docker)
ifdef check_only
	@docker compose exec backend isort . --check-only
else
	@docker compose exec backend isort .
endif
else
ifdef check_only
	@isort . --check-only
else
	@isort .
endif
endif

#: Run black (code formatter). Use check_only=true to prevent changes
black:
	@echo "\n${BLUE}Running black...${NC}\n"
ifeq ($(DEV_ENV),docker)
ifdef check_only
	@docker compose exec backend black . --check
else
	@docker compose exec backend black .
endif
else
ifdef check_only
	@black . --check
else
	@black .
endif
endif

#: Run flake8 (code linter)
flake8:
	@echo "\n${BLUE}Running flake8...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend flake8
else
	@flake8
endif

#: Run bandit (security linter)
bandit:
	@echo "\n${BLUE}Running bandit...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose exec backend bandit -c pyproject.toml -r .
else
	@bandit -c pyproject.toml -r .
endif

# Frontend

ifeq ($(DEV_ENV),docker)
FRONTEND_RUN=docker compose run --rm --no-deps frontend
else
FRONTEND_RUN=cd frontend &&
endif

#: Install the frontend dependencies
frontend-install:
	@echo "\n${BLUE}Installing frontend dependencies...${NC}\n"
	@$(FRONTEND_RUN) npm ci

#: Start the frontend development server (outside docker)
frontend-dev:
	@cd frontend && npm run dev

#: Run frontend linting (eslint, prettier). Use check_only=true to prevent changes
frontend-lint:
	@echo "\n${BLUE}Running eslint and prettier...${NC}\n"
ifdef check_only
	@$(FRONTEND_RUN) npm run lint:check
else
	@$(FRONTEND_RUN) npm run lint
endif

#: Run frontend tests with coverage using vitest
frontend-test:
	@echo "\n${BLUE}Running vitest...${NC}\n"
	@$(FRONTEND_RUN) npm test

#: Build the frontend for production in frontend/dist
frontend-build:
	@echo "\n${BLUE}Building frontend...${NC}\n"
	@$(FRONTEND_RUN) npm run build

# Docker
#: Build the doker containers
build:
	@echo "\n${BLUE}Building Docker Compose images...${NC}\n"
	@docker compose build

#: Run the Docker containers
up:
	@echo "\n${BLUE}Run Docker Compose containers...${NC}\n"
ifeq ($(DEV_ENV),docker)
	@docker compose up -d --remove-orphans
else
	@docker compose up -d --remove-orphans --scale backend=0 --scale frontend=0
endif

