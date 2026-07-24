# Развёртывание OpenCord Server

## Границы текущей реализации

Каталог `deploy/` содержит два production-способа установки на Ubuntu 22.04/24.04 LTS. Рекомендуемый вариант использует контейнеры Node.js 24.18.0, PostgreSQL 18.4 и Caddy 2.11.4. Нативный вариант устанавливает проверенный Node.js 24.18.0, PostgreSQL из репозитория Ubuntu, официальный пакет Caddy и systemd-службу OpenCord. Electron-клиент проверяет окружение, доставляет ограниченный комплект по SSH и запускает выбранный установщик.

Локальная разработка по-прежнему использует PGlite и не требует Docker.

## Требования к VPS

- Ubuntu Server 22.04 или 24.04 LTS;
- root-доступ через `sudo`;
- DNS A/AAAA-запись домена, указывающая на VPS;
- свободные входящие TCP-порты 80 и 443;
- UDP 443 для HTTP/3 является желательным, но не обязательным для WebSocket;
- доступ к необходимым официальным apt-репозиториям и registry образов для Docker-режима.

Перед установкой проверьте настройки firewall у хостинг-провайдера. У Docker есть особенности взаимодействия с `ufw`: опубликованные контейнерные порты могут обходить часть его правил. Не следует считать локальное правило `ufw` единственным сетевым барьером.

### Режим без домена для WSL и локальных тестов

Домен и ACME email можно оставить пустыми. В этом случае мастер показывает предупреждение и требует явного подтверждения, после чего запускает установщик с `--insecure`. Сервер слушает `0.0.0.0:3210`, Caddy и TLS не настраиваются, а клиент подключается к `http://<SSH-адрес>:3210`.

Этот режим не защищает сообщения, профиль, токены сессии и другой трафик от перехвата или изменения в сети. Он предназначен только для WSL, тестовой виртуальной машины или другой доверенной локальной среды. Не публикуйте порт 3210 в интернет. Для реального VPS используйте домен и HTTPS.

## Установка

### Из OpenCord Client

1. Для публичного VPS заранее направьте DNS A/AAAA-запись домена на его адрес и откройте входящие TCP 80/443 (рекомендуется также UDP 443). Для локального теста без домена освободите TCP 3210.
2. Нажмите `+` в списке серверов.
3. Укажите SSH-адрес, порт и пользователя. Домен и email для ACME указываются вместе либо оба остаются пустыми.
4. Предпочтительно выберите приватный SSH-ключ. Парольный вход поддерживается как запасной вариант.
5. Сравните показанный SHA256 fingerprint с fingerprint в панели провайдера или в консоли VPS и подтвердите совпадение.
6. Клиент авторизуется по SSH и проверит ОС, архитектуру, `systemd`, Docker Compose и занятые порты.
7. Выберите предложенный вариант: существующий/устанавливаемый Docker либо нативную установку.
8. Дождитесь успешного `/health`: HTTPS с доменом или HTTP на порту 3210 в подтверждённом небезопасном режиме.

Renderer не получает путь к выбранному ключу и не имеет доступа к файловой системе. Electron main хранит соответствие идентификатора и пути только в памяти, пока открыт мастер, и освобождает его при смене ключа или закрытии. Пароль SSH, passphrase ключа и пароль `sudo` не сохраняются в локальном JSON и очищаются из состояния формы после завершения/закрытия. Вывод установщика проходит редактирование известных секретов, однако на ранней стадии не следует использовать мастер на недоверенном или уже скомпрометированном VPS.

Для пользователя `root` установщик запускается напрямую. Для другого пользователя нужен разрешённый `sudo`: либо passwordless `sudo`, либо пароль, указанный в отдельном поле. Клиент не сохраняет постоянный SSH-доступ. Отсутствие Docker не вызывает скрытого переключения на native: решение всегда принимает пользователь.

### Docker Compose вручную

Передайте исходный bundle проекта на VPS без `node_modules`, `.env`, `.data` и пользовательских данных. Из корня bundle выполните:

```bash
sudo bash deploy/scripts/install-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Только для доверенного локального теста без TLS:

```bash
sudo bash deploy/scripts/install-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
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

### Нативная установка вручную

Из корня переданного bundle выполните:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh \
  --domain chat.example.com \
  --email admin@example.com \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Только для доверенного локального теста без TLS:

```bash
sudo bash deploy/scripts/install-native-ubuntu.sh --insecure \
  --owner-public-key '<публичный ключ OpenCord>' \
  --server-name 'Команда OpenCord'
```

Нативный установщик:

1. проверяет Ubuntu, `systemd`, архитектуру, комплект и порты;
2. загружает архив Node.js 24.18.0 с `nodejs.org` и сверяет его по `SHASUMS256.txt`;
3. устанавливает PostgreSQL из репозитория конкретной версии Ubuntu;
4. создаёт БД, роль и отдельный случайный пароль в `/etc/opencord/`;
5. устанавливает Caddy из официального apt-репозитория;
6. собирает новый versioned release в `/opt/opencord/releases/`;
7. атомарно переключает `/opt/opencord/current` и запускает защищённую `opencord-server.service`;
8. при неудачном старте или локальном healthcheck возвращает предыдущий release;
9. настраивает TLS reverse proxy и проверяет публичный endpoint.

Старые release-каталоги автоматически не удаляются, чтобы не уничтожить возможность ручного отката. Резервную копию PostgreSQL можно создать через `opencordctl backup`; политика ротации и автоматическое расписание будут добавлены отдельно.

## Повторный запуск и обновление

Тот же вызов Docker-установщика является операцией обновления. Он не пересоздаёт пароль PostgreSQL, не выполняет `docker compose down -v` и не удаляет named volumes. Нативный установщик также сохраняет PostgreSQL и пароль, создаёт новый release и переключает systemd-службу только после сборки. Каждое успешное развёртывание записывает новое поколение экземпляра и общее имя сервера. Это позволяет безопасно активировать ранее удалённый tombstone и заменить локальную запись клиента по тому же нормализованному адресу без создания дубликата.

Перед существенными обновлениями следует выполнить `sudo opencordctl backup` и скопировать полученный файл с VPS. Проверенная команда восстановления и автоматическое расписание ещё не реализованы и будут добавлены до публичного production-релиза.

## Управление установленным сервером

После успешной Docker- или нативной установки создаётся административная директория `/home/opencord`. Системный пользователь `opencord` не получает интерактивный shell, а содержимое доступно только `root` и группе `opencord`.

```text
/home/opencord/
├── README.md
├── opencordctl
├── backups/
├── data/README.md
├── settings/server.env
└── scripts/
    ├── backup.sh
    ├── logs.sh
    ├── restart.sh
    ├── settings.sh
    ├── status.sh
    └── uninstall.sh
```

Основные команды:

```bash
sudo opencordctl status
sudo opencordctl logs 200
sudo opencordctl restart
sudo opencordctl settings
sudo opencordctl backup
sudo opencordctl clear-messages DELETE-ALL-MESSAGES
sudo opencordctl uninstall
```

Резервная копия создаётся атомарно в `/home/opencord/backups/` через `pg_dump` в custom-формате. Обычный `uninstall` отключает сервер, но сохраняет приложение, конфигурацию, базу и копии. Необратимое удаление требует точной фразы `--purge-data DELETE-OPENCORD-DATA` и удаляет также локальные копии.

`clear-messages` временно останавливает процесс OpenCord Server, автоматически создаёт backup, удаляет все строки только из таблицы `messages` и снова запускает сервер. Каналы, участники, роли и настройки сохраняются. Команда требует точной защитной фразы `DELETE-ALL-MESSAGES`; без успешно созданной резервной копии очистка не выполняется.

Рабочую базу и секреты намеренно не переносятся в home. Docker хранит PostgreSQL в named volume и секреты в `/opt/opencord/deploy/secrets`; нативный режим использует системный PostgreSQL и `/etc/opencord`. Файл `settings/server.env` содержит только режим, публичный endpoint и фиксированные пути, но не пароли или приватные ключи.

## Локальная Docker-проверка

При запущенном Docker Desktop из корня репозитория:

```bash
pnpm docker:up
curl http://127.0.0.1:3210/health
pnpm docker:down
```

Команда создаёт локальные игнорируемые secrets в `deploy/secrets/`, запускает PostgreSQL и сервер, затем ждёт healthcheck. Caddy в локальном override не запускается, поэтому домен и публичный TLS для этой проверки не требуются.

## Диагностика

Docker Compose:

```bash
cd /opt/opencord
sudo docker compose --env-file deploy/.env -f deploy/compose.yml ps
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 server
sudo docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail 200 caddy
curl https://chat.example.com/health
```

Нативная установка:

```bash
sudo systemctl status opencord-server postgresql caddy --no-pager
sudo journalctl -u opencord-server -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
curl http://127.0.0.1:3210/health
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
- [официальные пакеты Caddy для Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian);
- [официальные файлы Node.js 24.18.0](https://nodejs.org/dist/v24.18.0/).
