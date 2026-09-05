# Help Pages API — custom `?` pages (English)

Live reference with playground (EN/RU/ZH): `help-docs/index.html`, deployed to GitHub Pages.

- The admin writes one `api.*` call per line in Settings → Help button. The client parses it locally with `client/src/components/server-help/builder.ts` (`parseHelpSource`) — no `eval`, no execution on viewers' devices.
- Only the compiled JSON spec is stored on the server (`server.settings.update.helpPage`) and read back via `server.snapshot.helpPage`. It is validated server-side with `serverHelpSchema` from `@opencord/shared` (protocol v43).
- Checkbox / switch / select state is local-only, except the one `help.accept` handshake: an accept button sends the current states once so the server can check `requires` and record the acceptance.
- `api.gate("rules")` turns on the rules gate: newcomers see that page on join and cannot write until they accept. Pages take `audience` (`always`/`pending`/`accepted`) for display routing.
- Rendering mirror: `client/src/components/server-help/server-help-dialog.tsx` (`ServerHelpBody`).

## Calls

```js
api.gate("rules"); // rules gate: newcomers must accept before writing
api.page("rules", "Rules", { audience: "pending" });
api.text("Server rules", { size: "lg", weight: "bold", align: "center" });
api.text("1. No spam or flooding the chat.");
api.divider();
api.checkbox("read", "I have read the rules");
api.switch("notify", "Notify me about events");
api.select("topic", "Question topic", ["Roles", "Voice", "Files"], "Roles");
api.button("Accept the rules", { variant: "primary", accept: true, requires: ["read"] });
api.button("Open FAQ", { toPage: "faq" });

api.page("faq", "FAQ", { audience: "accepted" });
api.text("Only accepted members see this page.");
api.button("Got it"); // no options → closes the dialog
```

- `api.gate(pageId)` — enables the rules gate on that page (one line, anywhere in the script). The gate page must contain an accept button. While the gate is on, `chat.send`/`chat.pm`/`chat.apm`, `message.update`, `message.react` and `voice.join` answer `ACCEPT_REQUIRED` until `help.accept`; reading stays open. Acceptance is stored per membership and reset by leaving.
- `api.page(id, title, { audience? }?)` — starts a page. `id` matches `^[a-z0-9-]{1,40}$`, unique; `title` 1–80 chars; `audience: always|pending|accepted` (default `always`) routes display: pending viewers see `pending` pages, accepted viewers see `accepted` ones. Audience is display-only; the snapshot carries the full spec.
- `api.text(content, { size?, weight?, align? }?)` — plain text, 1–2000 chars. `size: xs|sm|md|lg` (default `sm`), `weight: normal|medium|bold` (default `normal`), `align: left|center` (default `left`).
- `api.divider()` — separator, no arguments.
- `api.button(label, { variant?, toPage?, close?, accept?, requires? }?)` — label 1–80 chars; `variant: secondary|primary`; `{ toPage: "id" }` navigates, otherwise closes; `{ close: true }` closes explicitly. `{ accept: true }` sends `help.accept` with the page's control states and (in gate mode) closes the gate; it cannot be combined with `toPage`/`close`. `{ requires: ["read"] }` (accept buttons only, same-page checkbox/switch/select ids) disables the button until confirmed and is re-checked server-side.
- `api.checkbox(id, label, defaultChecked?)` / `api.switch(id, label, defaultChecked?)` — local-only toggles.
- `api.select(id, label, options, defaultValue?)` (alias `api.combobox`) — 1–20 unique options, 1–80 chars each; `defaultValue` must be one of them.

## Limits

Max 10 pages, 30 blocks per page, compiled JSON max 16 KB UTF-8, source script max 20 000 chars. Control ids unique within a page; `requires` holds up to 30 same-page ids. The gate line must point at an existing page with an accept button. Acceptance is stored per membership and reset by leaving, kick or ban; toggling the gate keeps recorded acceptances. Errors look like `line 4: call api.page(id, title) first`.

If this file disagrees with `builder.ts` / `shared/src/protocol.ts` / `server-help-dialog.tsx` — the code wins.

---

# Help Pages API — особые страницы `?` (Русский)

Живой справочник с песочницей (EN/RU/ZH): `help-docs/index.html`, публикуется на GitHub Pages.

- Админ пишет по одному вызову `api.*` на строку в «Настройки → Кнопка справки». Клиент разбирает это локально через `client/src/components/server-help/builder.ts` (`parseHelpSource`) — без `eval`, код ни у кого не выполняется.
- На сервере хранится только скомпилированная JSON-спека (`server.settings.update.helpPage`), клиенты читают её из `server.snapshot.helpPage`. Проверка на сервере — `serverHelpSchema` из `@opencord/shared` (протокол v43).
- Состояние checkbox / switch / select локальное, кроме одного рукопожатия `help.accept`: accept-кнопка один раз отправляет текущие состояния, чтобы сервер проверил `requires` и записал принятие.
- `api.gate("rules")` включает гейт правил: новички видят эту страницу при входе и не могут писать, пока не примут. Страницы принимают `audience` (`always`/`pending`/`accepted`) для маршрутизации показа.
- Рендер-зеркало: `client/src/components/server-help/server-help-dialog.tsx` (`ServerHelpBody`).

## Вызовы

```js
api.gate("rules"); // гейт правил: новички принимают до писанины
api.page("rules", "Правила", { audience: "pending" });
api.text("Правила сервера", { size: "lg", weight: "bold", align: "center" });
api.text("1. Без спама и флуда.");
api.divider();
api.checkbox("read", "Я прочитал правила");
api.switch("notify", "Уведомлять о событиях");
api.select("topic", "Тема вопроса", ["Роли", "Голос", "Файлы"], "Роли");
api.button("Принимаю правила", { variant: "primary", accept: true, requires: ["read"] });
api.button("Открыть FAQ", { toPage: "faq" });

api.page("faq", "FAQ", { audience: "accepted" });
api.text("Эту страницу видят только принявшие.");
api.button("Понятно"); // без опций → закрывает диалог
```

- `api.gate(pageId)` — включает гейт правил на этой странице (одна строка в любом месте скрипта). На гейт-странице обязана быть accept-кнопка. Пока гейт включён, `chat.send`/`chat.pm`/`chat.apm`, `message.update`, `message.react` и `voice.join` отвечают `ACCEPT_REQUIRED` до `help.accept`; чтение открыто. Принятие хранится на членстве и сбрасывается выходом.
- `api.page(id, title, { audience? }?)` — новая страница. `id` — `^[a-z0-9-]{1,40}$`, уникален; `title` — 1–80 символов; `audience: always|pending|accepted` (по умолчанию `always`) маршрутизирует показ: непринявшие видят `pending`-страницы, принявшие — `accepted`. Audience — только показ, snapshot несёт полную спеку.
- `api.text(content, { size?, weight?, align? }?)` — обычный текст, 1–2000 символов. `size: xs|sm|md|lg` (по умолчанию `sm`), `weight: normal|medium|bold`, `align: left|center`.
- `api.divider()` — разделитель, без аргументов.
- `api.button(label, { variant?, toPage?, close?, accept?, requires? }?)` — подпись 1–80 символов; `variant: secondary|primary`; `{ toPage: "id" }` переходит, иначе закрывает; `{ close: true }` закрывает явно. `{ accept: true }` отправляет `help.accept` с состояниями контролов страницы и (в гейте) закрывает его; несовместим с `toPage`/`close`. `{ requires: ["read"] }` (только accept-кнопки, id чекбоксов/switch/select той же страницы) блокирует кнопку до подтверждения и перепроверяется сервером.
- `api.checkbox(id, label, defaultChecked?)` / `api.switch(id, label, defaultChecked?)` — локальные переключатели.
- `api.select(id, label, options, defaultValue?)` (алиас `api.combobox`) — 1–20 уникальных опций по 1–80 символов; `defaultValue` обязан совпадать с одной из них.

## Лимиты

Максимум 10 страниц, 30 блоков на страницу, скомпилированный JSON до 16 КБ UTF-8, исходник до 20 000 символов. Id контролов уникальны в пределах страницы; `requires` — до 30 id той же страницы. Строка гейта обязана указывать на существующую страницу с accept-кнопкой. Принятие хранится на членстве и сбрасывается выходом, киком или баном; переключение гейта сохраняет записанные принятия. Ошибки вида `line 4: call api.page(id, title) first`.

При расхождении с `builder.ts` / `shared/src/protocol.ts` / `server-help-dialog.tsx` — прав код.

---

# Help Pages API —— 自定义 `?` 页面 (中文)

带试验场的在线参考（EN/RU/ZH）：`help-docs/index.html`，发布到 GitHub Pages。

- 服主在「设置 → 帮助按钮」里每行写一个 `api.*` 调用。客户端用 `client/src/components/server-help/builder.ts`（`parseHelpSource`）在本地解析——无 `eval`，不会在任何浏览者设备上执行代码。
- 服务器只保存编译好的 JSON 规范（`server.settings.update.helpPage`），客户端从 `server.snapshot.helpPage` 读取。服务端以 `@opencord/shared` 的 `serverHelpSchema` 校验（协议 v43）。
- checkbox / switch / select 的状态只保存在本地，但有一次 `help.accept` 握手例外：accept 按钮会一次性发送当前状态，以便服务器检查 `requires` 并记录接受。
- `api.gate("rules")` 开启规则门禁：新成员进入时看到该页面，接受之前不能发言。页面支持 `audience`（`always`/`pending`/`accepted`）用于展示路由。
- 渲染对照：`client/src/components/server-help/server-help-dialog.tsx`（`ServerHelpBody`）。

## 调用

```js
api.gate("rules"); // 规则门禁：新成员先接受再发言
api.page("rules", "规则", { audience: "pending" });
api.text("服务器规则", { size: "lg", weight: "bold", align: "center" });
api.text("1. 不要刷屏。");
api.divider();
api.checkbox("read", "我已阅读规则");
api.switch("notify", "有活动时通知我");
api.select("topic", "问题主题", ["身份组", "语音", "文件"], "身份组");
api.button("接受规则", { variant: "primary", accept: true, requires: ["read"] });
api.button("打开 FAQ", { toPage: "faq" });

api.page("faq", "FAQ", { audience: "accepted" });
api.text("只有已接受的成员能看到本页。");
api.button("知道了"); // 无选项 → 关闭对话框
```

- `api.gate(pageId)`——在该页面开启规则门禁（脚本中任意位置写一行即可）。门禁页必须包含 accept 按钮。门禁开启期间，`chat.send`/`chat.pm`/`chat.apm`、`message.update`、`message.react` 和 `voice.join` 会返回 `ACCEPT_REQUIRED`，直到 `help.accept`；阅读保持开放。接受状态保存在成员资格行，退出即清零。
- `api.page(id, title, { audience? }?)`——新页面。`id` 为 `^[a-z0-9-]{1,40}$` 且唯一；`title` 为 1–80 字符；`audience: always|pending|accepted`（默认 `always`）控制展示路由：未接受者看到 `pending` 页，已接受者看到 `accepted` 页。Audience 仅控制展示——snapshot 仍携带完整规范。
- `api.text(content, { size?, weight?, align? }?)`——纯文本，1–2000 字符。`size: xs|sm|md|lg`（默认 `sm`）、`weight: normal|medium|bold`、`align: left|center`。
- `api.divider()`——分隔线，无参数。
- `api.button(label, { variant?, toPage?, close?, accept?, requires? }?)`——标签 1–80 字符；`variant: secondary|primary`；`{ toPage: "id" }` 跳转，否则关闭；`{ close: true }` 显式关闭。`{ accept: true }` 会发送带本页控件状态的 `help.accept`，并在门禁中关闭它；不可与 `toPage`/`close` 同用。`{ requires: ["read"] }`（仅 accept 按钮，同页 checkbox/switch/select 的 id）在确认前禁用按钮，服务器会再次校验。
- `api.checkbox(id, label, defaultChecked?)` / `api.switch(id, label, defaultChecked?)`——本地开关。
- `api.select(id, label, options, defaultValue?)`（别名 `api.combobox`）——1–20 个唯一选项，各 1–80 字符；`defaultValue` 必须是其中之一。

## 限制

最多 10 页，每页最多 30 个 block，编译后 JSON 最大 16 KB UTF-8，源脚本最大 20 000 字符。控件 id 在页内唯一；`requires` 最多 30 个同页 id。门禁行必须指向带 accept 按钮的已存在页面。接受状态按成员资格保存，退出、移出或封禁即清零；开关门禁会保留已记录的接受。报错形如 `line 4: call api.page(id, title) first`。

若本文与 `builder.ts` / `shared/src/protocol.ts` / `server-help-dialog.tsx` 不一致，以代码为准。
