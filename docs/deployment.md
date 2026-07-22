# Развёртывание OpenCord Server

## Границы текущей реализации

Каталог `deploy/` содержит production-контейнер OpenCord Server на Node.js 24.18.0, PostgreSQL 18.4, Caddy 2.11.4 с автоматическим TLS и установщик для Ubuntu 22.04/24.04 LTS. Версии базовых образов зафиксированы до patch-релиза и должны обновляться осознанно вместе с проверкой миграций и release notes. Это фундамент будущего мастера развёртывания в Electron. SSH-подключение из клиента пока не реализовано: файлы необходимо доставить на VPS самостоятельно и запустить установщик через существующую SSH-сессию.

Локальная разработка по-прежнему использует PGlite и не требует Docker.

## Требования к VPS

- Ubuntu Server 22.04 или 24.04 LTS;
- root-доступ через `sudo`;
- DNS A/AAAA-запись домена, указывающая на VPS;
- свободные входящие TCP-порты 80 и 443;
- UDP 443 для HTTP/3 является желательным, но не обязательным для WebSocket;
- доступ к официальному apt-репозиторию Docker и registry образов.

Перед установкой проверьте настройки firewall у хостинг-провайдера. У Docker есть особенности взаимодействия с `ufw`: опубликованные контейнерные порты могут обходить часть его правил. Не следует считать локальное правило `ufw` единственным сетевым барьером.

## Установка

Передайте исходный bundle проекта на VPS без `node_modules`, `.env`, `.data` и пользовательских данных. Из корня bundle выполните:

```bash
sudo bash deploy/scripts/install-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com
```

По умолчанию файлы устанавливаются в `/opt/opencord`. Если Docker Engine и Compose plugin отсутствуют, установщик добавляет официальный apt-репозиторий Docker и устанавливает их. Convenience-скрипт `curl | sh` не используется.

Установщик:

1. проверяет ОС, bundle и занятость портов при первой установке;
2. создаёт системного пользователя `opencord` без интерактивного входа;
3. копирует только необходимые исходники и deploy-конфигурацию;
4. генерирует URL-safe пароль PostgreSQL, если он ещё не существует;
5. хранит пароль и строку подключения в `/opt/opencord/deploy/secrets/` с ограниченными правами;
6. валидирует Compose, собирает сервер и запускает контейнеры;
7. ждёт успешного server healthcheck и отдельно проверяет публичный TLS endpoint.

Секреты не печатаются в отчёт и не хранятся в `deploy/.env`. Файл `.env` содержит только домен, ACME email, метку версии и уровень логирования.

Volume PostgreSQL 18 смонтирован в `/var/lib/postgresql`, а не в устаревший путь `/var/lib/postgresql/data`. Официальный образ PostgreSQL 18 использует версионированный `PGDATA`; неверная точка монтирования может привести к созданию отдельного анонимного volume и потере ожидаемой персистентности после пересоздания контейнера.

## Повторный запуск и обновление

Тот же вызов установщика является операцией обновления. Он не пересоздаёт пароль PostgreSQL, не выполняет `docker compose down -v` и не удаляет named volumes. Исходники и контейнер приложения обновляются, после чего Compose применяет изменения.

Перед существенными обновлениями следует сделать резервную копию базы. Автоматизированный backup/restore ещё не реализован и будет добавлен до публичного production-релиза.

## Диагностика

```bash
cd /opt/opencord
sudo docker compose --env-file deploy/.env -f deploy/compose.yml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 server
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 caddy
curl https://chat.example.com/health
```

Успешный `/health` подтверждает доступность процесса сервера и подключение к базе на этапе запуска миграций. Он пока не является полной проверкой свободного места, срока сертификата или возможности записи новых сообщений.

## Использованные штатные механизмы

- [официальная установка Docker Engine на Ubuntu](https://docs.docker.com/engine/install/ubuntu/);
- [ожидание healthy-зависимостей в Docker Compose](https://docs.docker.com/compose/how-tos/startup-order/);
- [Caddy в Docker Compose](https://caddyserver.com/docs/running#docker-compose);
- [WebSocket proxy в Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy);
- [pnpm deploy для монорепозитория](https://pnpm.io/cli/deploy).
- [изменение PGDATA и volume в официальном PostgreSQL 18 image](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).
