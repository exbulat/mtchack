# WikiLive

Wiki-редактор с совместной работой в реальном времени, пространствами и AI-ассистентом.

## Быстрый старт

```bash
git clone <repo-url>
cd mtchack/wikilive

# Скопируй .env и заполни обязательные значения
cp .env.example .env
# Отредактируй .env:
#   POSTGRES_PASSWORD=<придумай надёжный пароль>
#   COOKIE_SECRET=<случайная строка ≥16 символов>

docker compose up --build
```

Открой http://localhost:3000

Без `.env` тоже запустится с dev-значениями — только для локальной разработки.

## Переменные окружения

| Переменная | Обязательно | Описание |
|---|---|---|
| `POSTGRES_PASSWORD` | Для прода | Пароль базы данных |
| `COOKIE_SECRET` | Для прода | Секрет JWT-куки (≥16 символов) |
| `MWS_TABLES_TOKEN` | Нет | API-ключ MWS Tables |
| `MWS_GPT_API_KEY` | Нет | API-ключ MWS GPT (для AI) |
| `ALLOWED_ORIGIN` | Нет | CORS origin (дефолт: `http://localhost:3000`) |

Шаблон: `.env.example`

## Разработка без Docker

**Бэкенд** (требует локальный PostgreSQL):
```bash
cd wikilive/backend
npm install
npm run dev
```

**Фронтенд:**
```bash
cd wikilive/frontend
npm install
npm run dev
```

## Архитектура

- **Frontend**: React + TypeScript + Vite, TipTap редактор, Yjs коллаборация
- **Backend**: Express + Prisma + PostgreSQL, Hocuspocus WS-сервер
- **Инфра**: Docker Compose, nginx reverse proxy

## Для продакшена

⚠️ Обязательно задай в `.env`:
- `POSTGRES_PASSWORD` — надёжный пароль БД
- `COOKIE_SECRET` — длинная случайная строка
- `ALLOWED_ORIGIN` — реальный домен
- Используй HTTPS
