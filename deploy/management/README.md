# Управление OpenCord Server

Эта директория является административной точкой входа. Рабочие файлы намеренно разделены по системным каталогам: приложение находится в `/opt/opencord`, защищённые настройки — в `/etc/opencord` или `/opt/opencord/deploy/secrets`, а PostgreSQL управляет собственным хранилищем. В Docker-режиме серверные secret-файлы доступны root и фиксированному непривилегированному UID контейнера OpenCord Server.

Основная команда:

```bash
sudo opencordctl status
```

Доступные операции:

```bash
sudo opencordctl logs 200
sudo opencordctl restart
sudo opencordctl settings
sudo opencordctl backup
sudo opencordctl clear-messages DELETE-ALL-MESSAGES
sudo opencordctl update
sudo opencordctl uninstall
```

Аналогичные короткие сценарии находятся в `scripts/`. Резервные копии PostgreSQL создаются в `backups/` в custom-формате `pg_dump`.

Команда `clear-messages` останавливает только OpenCord Server, создаёт обязательную резервную копию базы, удаляет всю историю из таблицы сообщений и запускает сервер снова. Каналы, пользователи, роли и настройки не удаляются. Для защиты от случайного запуска требуется точная фраза `DELETE-ALL-MESSAGES`.

Обычный `uninstall` останавливает и отключает OpenCord, но сохраняет приложение, настройки, базу и резервные копии для восстановления. Полное удаление необратимо и требует точной команды:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

Полное удаление уничтожает также локальные резервные копии из `/home/opencord/backups`. Перед его запуском скопируйте нужные `.dump` на другой компьютер или носитель.

Сетевой режим, домен и TLS пока изменяются повторным развёртыванием из OpenCord Client: такой путь повторно проверяет окружение и выполняет healthcheck перед завершением обновления.
