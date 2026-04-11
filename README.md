# WikiLive

Wiki-редактор с совместной работой в реальном времени.

## Требования

- Docker Desktop (установи с https://www.docker.com/products/docker-desktop)

## Быстрый запуск

```bash
cd wikilive
docker compose up -d
```

Открой http://localhost:3000 в браузере.

## Настройка (опционально)

Для работы интеграций MWS Tables и MWS GPT создай файл `.env` в папке `wikilive`:

```bash
cd wikilive
copy .env.example .env
```

Отредактируй `.env` и добавь свои токены:
```
MWS_TABLES_TOKEN=usk_твой_токен
MWS_TABLES_SPACE_ID=твой_space_id
MWS_GPT_API_KEY=sk-твой_ключ
```

Без этих токенов приложение будет работать, но без встраивания таблиц и AI-помощника.

## Структура проекта

- `backend/` — Node.js/Express бэкенд с Prisma ORM
- `frontend/` — React/Vite фронтенд с TipTap редактором
- `docker-compose.yml` — конфигурация Docker контейнеров
