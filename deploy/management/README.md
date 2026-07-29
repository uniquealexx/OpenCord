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
sudo opencordctl check-update
sudo opencordctl update --channel stable
sudo opencordctl update --bundle-url https://releases.example/opencord-server.tar.gz --sha256 '<SHA256>'
sudo opencordctl uninstall
```

`check-update` и `update --channel stable` используют последний публичный stable GitHub Release
`uniquealexx/OpenCord`. Перед обновлением проверяются release manifest, версия протокола,
канонический HTTPS URL, размер и SHA-256 server bundle. Если новая версия найдена, `update`
создаёт обязательную резервную копию и запускает существующий безопасный установщик.

Ручные `--bundle-url` и `--bundle-file` сохранены для аварийного восстановления. Для них
SHA-256 нужно получить из отдельного доверенного источника.

Аналогичные короткие сценарии находятся в `scripts/`. Команда `backup` создаёт в `backups/` пару файлов: PostgreSQL в custom-формате `pg_dump` и архив `.attachments.tar` с вложениями. Оба файла нужны для полного восстановления.

Команда `update` принимает release bundle только по HTTPS либо из явно указанного локального файла и требует ожидаемую SHA-256 сумму. После проверки архива она создаёт обязательную резервную копию и запускает идемпотентный установщик текущего режима. PostgreSQL и вложения сохраняются. Пока официальный канал релизов не опубликован, URL и SHA-256 должны браться из конкретной доверенной публикации релиза; команда намеренно не скачивает «latest» из незафиксированного источника.

Команда `clear-messages` останавливает только OpenCord Server, создаёт обязательную резервную копию базы, удаляет всю историю из таблицы сообщений и запускает сервер снова. Каналы, пользователи, роли и настройки не удаляются. Для защиты от случайного запуска требуется точная фраза `DELETE-ALL-MESSAGES`.

Обычный `uninstall` останавливает и отключает OpenCord, но сохраняет приложение, настройки, базу и резервные копии для восстановления. Полное удаление необратимо и требует точной команды:

```bash
sudo opencordctl uninstall --purge-data DELETE-OPENCORD-DATA
```

Полное удаление уничтожает также вложения и локальные резервные копии из `/home/opencord/backups`. Перед его запуском скопируйте нужные `.dump` и `.attachments.tar` на другой компьютер или носитель.

Сетевой режим, домен и TLS пока изменяются повторным развёртыванием из OpenCord Client: такой путь повторно проверяет окружение и выполняет healthcheck перед завершением обновления.
