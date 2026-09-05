/* OpenCord Help Pages — browser preview parser.
 *
 * Source of truth (do not diverge silently):
 * - client/src/components/server-help/builder.ts (syntax, errors, specToSource)
 * - shared/src/protocol.ts (serverHelpSchema, limits)
 * - client/src/components/server-help/server-help-dialog.tsx (rendering)
 *
 * This file is PREVIEW-ONLY for GitHub Pages. Real validation is Zod
 * (serverHelpSchema) on the server + parseHelpSource in the client.
 * Protocol: v42.
 */

(function () {
  "use strict";

  var LIMITS = {
    protocolVersion: 43,
    pagesMax: 10,
    blocksMax: 30,
    textMax: 2000,
    labelMax: 80,
    optionsMax: 20,
    requiresMax: 30,
    jsonMaxBytes: 16384,
    sourceMax: 20000,
    idPattern: "^[a-z0-9-]{1,40}$",
  };

  var ID_RE = /^[a-z0-9-]{1,40}$/;
  var TEXT_SIZES = ["xs", "sm", "md", "lg"];
  var TEXT_WEIGHTS = ["normal", "medium", "bold"];
  var TEXT_ALIGNS = ["left", "center"];

  function fail(line, message) {
    return { ok: false, error: "line " + line + ": " + message };
  }

  function stripLineComment(line) {
    var quote = null;
    var escaped = false;
    for (var i = 0; i < line.length - 1; i += 1) {
      var ch = line[i];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
    }
    return line;
  }

  function splitTopLevel(input) {
    var parts = [];
    var depth = 0;
    var quote = null;
    var escaped = false;
    var current = "";
    for (var k = 0; k < input.length; k += 1) {
      var ch = input[k];
      if (quote !== null) {
        current += ch;
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
      } else if (ch === "[" || ch === "{") {
        depth += 1;
        current += ch;
      } else if (ch === "]" || ch === "}") {
        depth -= 1;
        if (depth < 0) return null;
        current += ch;
      } else if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (quote !== null || depth !== 0) return null;
    parts.push(current);
    return parts;
  }

  function parseStringLiteral(token) {
    var t = token.trim();
    if (t.length < 2) return null;
    var q = t[0];
    if ((q !== '"' && q !== "'") || t[t.length - 1] !== q) return null;
    var out = "";
    var escaped = false;
    var inner = t.slice(1, -1);
    for (var i = 0; i < inner.length; i += 1) {
      var ch = inner[i];
      if (escaped) {
        if (ch === "n") out += "\n";
        else if (ch === "t") out += "\t";
        else out += ch;
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else {
        out += ch;
      }
    }
    return escaped ? null : out;
  }

  function parseValue(token) {
    var t = token.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (/^-?\d+$/.test(t)) return Number(t);
    var asString = parseStringLiteral(t);
    if (asString !== null) return asString;
    if (t[0] === "[" && t[t.length - 1] === "]") {
      var inner = t.slice(1, -1).trim();
      if (!inner) return [];
      var items = splitTopLevel(inner);
      if (!items) return undefined;
      var parsed = [];
      for (var i = 0; i < items.length; i += 1) {
        var v = parseStringLiteral(items[i]);
        if (v === null) return undefined;
        parsed.push(v);
      }
      return parsed;
    }
    if (t[0] === "{" && t[t.length - 1] === "}") {
      var body = t.slice(1, -1).trim();
      var record = {};
      if (!body) return record;
      var entries = splitTopLevel(body);
      if (!entries) return undefined;
      for (var e = 0; e < entries.length; e += 1) {
        var colon = entries[e].indexOf(":");
        if (colon < 0) return undefined;
        var rawKey = entries[e].slice(0, colon).trim();
        var key = /^[A-Za-z_$][\w$]*$/.test(rawKey) ? rawKey : parseStringLiteral(rawKey);
        if (key === null || key === undefined) return undefined;
        var val = parseValue(entries[e].slice(colon + 1));
        if (val === undefined || (typeof val === "object" && val !== null && !Array.isArray(val))) return undefined;
        record[key] = val;
      }
      return record;
    }
    return undefined;
  }

  function parseCall(text) {
    var m = /^api\.([A-Za-z_$][\w$]*)\s*\(/.exec(text);
    if (!m || !m[1]) return null;
    var method = m[1];
    var quote = null;
    var escaped = false;
    var depth = 0;
    for (var i = m[0].length - 1; i < text.length; i += 1) {
      var ch = text[i];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          var argsText = text.slice(m[0].length, i).trim();
          var rest = text.slice(i + 1).trim();
          if (rest !== "" && rest !== ";") return null;
          if (!argsText) return { method: method, args: [] };
          var parts = splitTopLevel(argsText);
          if (!parts) return null;
          var args = [];
          for (var a = 0; a < parts.length; a += 1) {
            var v = parseValue(parts[a]);
            if (v === undefined) return null;
            args.push(v);
          }
          return { method: method, args: args };
        }
      }
    }
    return null;
  }

  function isObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function checkOptions(line, options, allowed) {
    if (options === undefined) return {};
    if (!isObject(options)) return fail(line, 'options must be an object like { size: "lg" }');
    var keys = Object.keys(options);
    for (var i = 0; i < keys.length; i += 1) {
      if (allowed.indexOf(keys[i]) < 0) return fail(line, 'unknown option "' + keys[i] + '"');
    }
    return options;
  }

  function isFail(r) {
    return r && typeof r.error === "string";
  }

  function applyCall(line, pages, current, method, args) {
    var i, page, target, content, rawOptions, options, opts, size, weight, align;
    if (method === "page") {
      if ((args.length !== 2 && args.length !== 3) || typeof args[0] !== "string" || typeof args[1] !== "string") {
        return fail(line, 'page expects (id, title, options?), e.g. api.page("rules", "Rules")');
      }
      var id = args[0];
      var title = args[1];
      if (!ID_RE.test(id)) return fail(line, 'page id must match /^[a-z0-9-]{1,40}$/');
      if (!title.trim() || title.trim().length > LIMITS.labelMax) {
        return fail(line, "page title must be 1-80 characters");
      }
      for (i = 0; i < pages.length; i += 1) {
        if (pages[i].id === id) return fail(line, 'duplicate page id "' + id + '"');
      }
      var pageOpts = checkOptions(line, args[2], ["audience"]);
      if (isFail(pageOpts)) return pageOpts;
      var audience = pageOpts.audience === undefined ? "always" : pageOpts.audience;
      if (audience !== "always" && audience !== "pending" && audience !== "accepted") {
        return fail(line, 'page audience must be one of "always", "pending", "accepted"');
      }
      var draft = { id: id, title: title.trim(), audience: audience, blocks: [] };
      return { ok: true, page: draft };
    }
    if (!current) return fail(line, "call api.page(id, title) first");
    page = current;
    if (method === "text") {
      if (args.length < 1 || args.length > 2 || typeof args[0] !== "string") {
        return fail(line, 'text expects (content, options?), e.g. api.text("No spam", { size: "lg" })');
      }
      content = args[0];
      rawOptions = args[1];
      options = checkOptions(line, rawOptions, ["size", "weight", "align"]);
      if (isFail(options)) return options;
      opts = options;
      size = opts.size === undefined ? "sm" : opts.size;
      weight = opts.weight === undefined ? "normal" : opts.weight;
      align = opts.align === undefined ? "left" : opts.align;
      if (TEXT_SIZES.indexOf(size) < 0) return fail(line, 'text size must be one of "xs", "sm", "md", "lg"');
      if (TEXT_WEIGHTS.indexOf(weight) < 0) return fail(line, 'text weight must be one of "normal", "medium", "bold"');
      if (TEXT_ALIGNS.indexOf(align) < 0) return fail(line, 'text align must be "left" or "center"');
      if (!content.trim() || content.trim().length > LIMITS.textMax) {
        return fail(line, "text must be 1-2000 characters");
      }
      page.blocks.push({ kind: "text", text: content, size: size, weight: weight, align: align });
      return { ok: true };
    }
    if (method === "divider") {
      if (args.length !== 0) return fail(line, "divider takes no arguments");
      page.blocks.push({ kind: "divider" });
      return { ok: true };
    }
    if (method === "button") {
      if (args.length < 1 || args.length > 2 || typeof args[0] !== "string") {
        return fail(line, 'button expects (label, options?), e.g. api.button("FAQ", { toPage: "faq" })');
      }
      var label = args[0];
      if (!label.trim() || label.trim().length > LIMITS.labelMax) {
        return fail(line, "button label must be 1-80 characters");
      }
      options = checkOptions(line, args[1], ["variant", "toPage", "close", "accept", "requires"]);
      if (isFail(options)) return options;
      opts = options;
      var variant = opts.variant === undefined ? "secondary" : opts.variant;
      if (variant !== "primary" && variant !== "secondary") {
        return fail(line, 'button variant must be "primary" or "secondary"');
      }
      var close = opts.close === undefined ? false : opts.close;
      if (typeof close !== "boolean") return fail(line, "button close must be true or false");
      var accept = opts.accept === undefined ? false : opts.accept;
      if (typeof accept !== "boolean") return fail(line, "button accept must be true or false");
      var toPage = opts.toPage === undefined ? null : opts.toPage;
      if (opts.toPage !== undefined && typeof toPage !== "string") {
        return fail(line, "button toPage must be a page id string");
      }
      if (toPage !== null && close) return fail(line, "button cannot combine toPage with close: true");
      if (accept && (toPage !== null || close)) return fail(line, "accept button cannot combine toPage with close");
      var requires = opts.requires === undefined ? [] : opts.requires;
      if (!Array.isArray(requires) || !requires.every(function (entry) { return typeof entry === "string"; })) {
        return fail(line, "button requires must be an array of control ids");
      }
      if (requires.length > 0 && !accept) return fail(line, "button requires needs accept: true");
      if (requires.length > LIMITS.requiresMax) return fail(line, "button requires too many controls");
      page.blocks.push({
        kind: "button",
        label: label.trim(),
        variant: variant,
        action: accept ? { kind: "accept" } : toPage !== null ? { kind: "page", pageId: toPage } : { kind: "close" },
        requires: requires.slice(),
      });
      return { ok: true };
    }
    if (method === "checkbox" || method === "switch") {
      if (args.length < 2 || args.length > 3 || typeof args[0] !== "string" || typeof args[1] !== "string") {
        return fail(line, method + ' expects (id, label, defaultChecked?), e.g. api.' + method + '("read", "I read the rules")');
      }
      var cid = args[0];
      var clabel = args[1];
      var checked = args[2] === undefined ? false : args[2];
      if (!ID_RE.test(cid)) return fail(line, "control id must match /^[a-z0-9-]{1,40}$/");
      if (!clabel.trim() || clabel.trim().length > LIMITS.labelMax) {
        return fail(line, "label must be 1-80 characters");
      }
      if (typeof checked !== "boolean") return fail(line, method + " defaultChecked must be true or false");
      page.blocks.push({ kind: method, id: cid, label: clabel.trim(), defaultChecked: checked });
      return { ok: true };
    }
    if (method === "select" || method === "combobox") {
      if (args.length < 3 || args.length > 4 || typeof args[0] !== "string" || typeof args[1] !== "string" || !Array.isArray(args[2])) {
        return fail(line, 'select expects (id, label, options, defaultValue?), e.g. api.select("topic", "Topic", ["Roles", "Voice"])');
      }
      var sid = args[0];
      var slabel = args[1];
      var soptions = args[2];
      var def = args[3];
      if (!ID_RE.test(sid)) return fail(line, "control id must match /^[a-z0-9-]{1,40}$/");
      if (!slabel.trim() || slabel.trim().length > LIMITS.labelMax) {
        return fail(line, "label must be 1-80 characters");
      }
      if (soptions.length < 1 || soptions.length > LIMITS.optionsMax) {
        return fail(line, "select options must be 1-20 items");
      }
      var seen = {};
      for (i = 0; i < soptions.length; i += 1) {
        var op = soptions[i];
        if (typeof op !== "string" || !op.trim() || op.trim().length > LIMITS.labelMax) {
          return fail(line, "select options must be 1-80 characters each");
        }
        if (seen[op]) return fail(line, "Select options must be unique");
        seen[op] = true;
      }
      if (def !== undefined && typeof def !== "string") return fail(line, "select defaultValue must be a string");
      if (def !== undefined && soptions.indexOf(def) < 0) {
        return fail(line, "Select default value must be one of its options");
      }
      page.blocks.push({ kind: "select", id: sid, label: slabel.trim(), options: soptions.slice(), defaultValue: def });
      return { ok: true };
    }
    return fail(line, "unknown call api." + method + " — use gate, page, text, divider, button, checkbox, switch, select");
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str).length;
    var s = unescape(encodeURIComponent(str));
    return s.length;
  }

  function parseHelpSource(source) {
    if (typeof source !== "string" || !source.trim()) return { ok: false, error: "script is empty" };
    if (source.length > LIMITS.sourceMax) {
      return { ok: false, error: "script exceeds " + LIMITS.sourceMax + " characters" };
    }
    var pages = [];
    var current = null;
    var gatePageId = null;
    var lines = source.split("\n");
    for (var index = 0; index < lines.length; index += 1) {
      var lineNo = index + 1;
      var text = stripLineComment(lines[index] || "").trim();
      if (!text) continue;
      var call = parseCall(text);
      if (!call) return fail(lineNo, "expected api.method(...) — one call per line");
      if (call.method === "gate") {
        if (call.args.length !== 1 || typeof call.args[0] !== "string") {
          return fail(lineNo, 'gate expects (pageId), e.g. api.gate("rules")');
        }
        if (gatePageId !== null) return fail(lineNo, "duplicate gate");
        gatePageId = call.args[0];
        continue;
      }
      var result = applyCall(lineNo, pages, current, call.method, call.args);
      if (isFail(result)) return result;
      if (result.page) {
        current = result.page;
        pages.push(current);
      }
    }
    if (!pages.length) return { ok: false, error: "add at least one api.page(id, title)" };
    if (pages.length > LIMITS.pagesMax) return { ok: false, error: "too many pages (max " + LIMITS.pagesMax + ")" };
    var pageIds = {};
    for (var p = 0; p < pages.length; p += 1) {
      var pg = pages[p];
      if (pageIds[pg.id]) return { ok: false, error: 'duplicate page id "' + pg.id + '"' };
      pageIds[pg.id] = true;
      if (pg.blocks.length > LIMITS.blocksMax) {
        return { ok: false, error: "page \"" + pg.id + "\" exceeds " + LIMITS.blocksMax + " blocks" };
      }
      var controls = {};
      for (var b = 0; b < pg.blocks.length; b += 1) {
        var blk = pg.blocks[b];
        if (blk.kind === "checkbox" || blk.kind === "switch" || blk.kind === "select") {
          if (controls[blk.id]) return { ok: false, error: "Control ids must be unique within a page" };
          controls[blk.id] = true;
        }
      }
      for (var c = 0; c < pg.blocks.length; c += 1) {
        var btn = pg.blocks[c];
        if (btn.kind !== "button") continue;
        if (btn.action.kind === "page") {
          var exists = false;
          for (var q = 0; q < pages.length; q += 1) {
            if (pages[q].id === btn.action.pageId) exists = true;
          }
          if (!exists) return { ok: false, error: "Button target page does not exist" };
        }
        if (btn.requires.length > 0 && btn.action.kind !== "accept") {
          return { ok: false, error: "Only accept buttons may require controls" };
        }
        var seenReq = {};
        for (var r = 0; r < btn.requires.length; r += 1) {
          if (seenReq[btn.requires[r]] || !controls[btn.requires[r]]) {
            return { ok: false, error: "Required control does not exist on this page" };
          }
          seenReq[btn.requires[r]] = true;
        }
      }
    }
    var gate = gatePageId === null ? { enabled: false, pageId: null } : { enabled: true, pageId: gatePageId };
    if (gate.enabled) {
      var gatePage = null;
      for (var g = 0; g < pages.length; g += 1) {
        if (pages[g].id === gate.pageId) gatePage = pages[g];
      }
      if (!gatePage) return { ok: false, error: "Gate page does not exist" };
      var hasAccept = false;
      for (var a = 0; a < gatePage.blocks.length; a += 1) {
        if (gatePage.blocks[a].kind === "button" && gatePage.blocks[a].action.kind === "accept") hasAccept = true;
      }
      if (!hasAccept) return { ok: false, error: "Gate page needs an accept button" };
    }
    var spec = { enabled: false, gate: gate, pages: pages };
    if (utf8Bytes(JSON.stringify(spec)) > LIMITS.jsonMaxBytes) {
      return { ok: false, error: "Help pages exceed the size limit (16 KB JSON)" };
    }
    return { ok: true, spec: spec };
  }

  var SIZE_CLASS = { xs: "hlp-text-xs", sm: "hlp-text-sm", md: "hlp-text-md", lg: "hlp-text-lg" };
  var WEIGHT_CLASS = { normal: "hlp-w-normal", medium: "hlp-w-medium", bold: "hlp-w-bold" };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Mirror of ServerHelpBody: tabs + bounded box, local-only control state. */
  function visiblePages(spec, viewer) {
    if (viewer === "all") return spec.pages;
    var accepted = viewer === "accepted";
    return spec.pages.filter(function (page) {
      var audience = page.audience || "always";
      return audience === "always" || (accepted ? audience === "accepted" : audience === "pending");
    });
  }

  function unmetRequires(page, controls) {
    var required = {};
    for (var i = 0; i < page.blocks.length; i += 1) {
      var block = page.blocks[i];
      if (block.kind === "button" && block.action.kind === "accept") {
        for (var r = 0; r < block.requires.length; r += 1) required[block.requires[r]] = true;
      }
    }
    var unmet = [];
    for (var id in required) {
      if (!Object.prototype.hasOwnProperty.call(required, id)) continue;
      var control = null;
      for (var c = 0; c < page.blocks.length; c += 1) {
        var cand = page.blocks[c];
        if ((cand.kind === "checkbox" || cand.kind === "switch" || cand.kind === "select") && cand.id === id) control = cand;
      }
      if (!control) { unmet.push(id); continue; }
      var value = controls[id];
      if (control.kind === "select") {
        if (typeof value !== "string" || control.options.indexOf(value) < 0) unmet.push(id);
      } else if (value !== true) {
        unmet.push(id);
      }
    }
    return unmet;
  }

  function requiredIds(page) {
    var ids = {};
    for (var i = 0; i < page.blocks.length; i += 1) {
      var block = page.blocks[i];
      if (block.kind === "button" && block.action.kind === "accept") {
        for (var r = 0; r < block.requires.length; r += 1) ids[block.requires[r]] = true;
      }
    }
    return ids;
  }

  function renderPreview(container, spec, viewer, onAccept) {
    container.innerHTML = "";
    var list = spec && spec.pages ? visiblePages(spec, viewer || "all") : [];
    if (!list.length) {
      container.appendChild(el("p", "hlp-empty", "No pages for this viewer."));
      return;
    }
    var state = { activeId: list[0].id, controls: {} };
    var tabs = el("div", "hlp-tabs");
    tabs.setAttribute("role", "tablist");
    var body = el("div", "hlp-body");
    container.appendChild(tabs);
    container.appendChild(body);

    function controlKey(pageId, controlId) {
      return pageId + ":" + controlId;
    }

    function draw() {
      tabs.innerHTML = "";
      body.innerHTML = "";
      var active = null;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === state.activeId) active = list[i];
      }
      if (!active) active = list[0];
      state.activeId = active.id;
      if (list.length > 1) {
        for (var t = 0; t < list.length; t += 1) {
          (function (pg) {
            var b = el("button", "hlp-tab" + (pg.id === active.id ? " hlp-tab-active" : ""), pg.title);
            b.setAttribute("type", "button");
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", pg.id === active.id ? "true" : "false");
            b.addEventListener("click", function () {
              state.activeId = pg.id;
              draw();
            });
            tabs.appendChild(b);
          })(list[t]);
        }
      } else {
        var only = el("div", "hlp-tab-single", active.title);
        tabs.appendChild(only);
      }
      if (!active.blocks.length) {
        body.appendChild(el("p", "hlp-empty", "Empty page."));
        return;
      }
      for (var k = 0; k < active.blocks.length; k += 1) {
        body.appendChild(renderBlock(active, active.blocks[k]));
      }
    }

    function pageControls(pageId) {
      var slice = {};
      for (var key in state.controls) {
        if (!Object.prototype.hasOwnProperty.call(state.controls, key)) continue;
        var sep = key.indexOf(":");
        if (sep > 0 && key.slice(0, sep) === pageId) slice[key.slice(sep + 1)] = state.controls[key];
      }
      return slice;
    }

    function renderBlock(page, block) {
      var pageId = page.id;
      var required = requiredIds(page);
      if (block.kind === "text") {
        var p = el("p", "hlp-text " + (SIZE_CLASS[block.size] || "hlp-text-sm") + " " + (WEIGHT_CLASS[block.weight] || "") + (block.align === "center" ? " hlp-center" : ""), block.text);
        return p;
      }
      if (block.kind === "divider") {
        return el("hr", "hlp-divider");
      }
      if (block.kind === "button") {
        if (block.action.kind === "accept") {
          var unmet = unmetRequires(page, pageControls(pageId));
          var acceptBtn = el("button", "hlp-btn" + (block.variant === "primary" ? " hlp-btn-primary" : ""), block.label);
          acceptBtn.setAttribute("type", "button");
          if (unmet.length > 0 || !onAccept) {
            acceptBtn.disabled = true;
            acceptBtn.title = unmet.length > 0 ? "Confirm the required items first (*)" : "";
          }
          acceptBtn.addEventListener("click", function () {
            if (onAccept) onAccept(pageControls(pageId));
          });
          return acceptBtn;
        }
        var btn = el("button", "hlp-btn" + (block.variant === "primary" ? " hlp-btn-primary" : ""), block.label);
        btn.setAttribute("type", "button");
        btn.addEventListener("click", function () {
          if (block.action.kind === "page") {
            state.activeId = block.action.pageId;
            draw();
          } else {
            body.innerHTML = "";
            body.appendChild(el("p", "hlp-empty", "Dialog closed (preview). Pick a tab to reopen."));
          }
        });
        return btn;
      }
      if (block.kind === "checkbox") {
        var key = controlKey(pageId, block.id);
        var label = el("label", "hlp-check");
        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = state.controls[key] === undefined ? !!block.defaultChecked : state.controls[key] === true;
        input.addEventListener("change", function () {
          state.controls[key] = input.checked;
          draw();
        });
        var span = el("span", "", block.label);
        if (required[block.id]) span.appendChild(el("span", "hlp-req", " *"));
        label.appendChild(input);
        label.appendChild(span);
        return label;
      }
      if (block.kind === "switch") {
        var row = el("div", "hlp-switch-row");
        var lab = el("span", "hlp-switch-label", block.label);
        if (required[block.id]) lab.appendChild(el("span", "hlp-req", " *"));
        var sw = el("button", "hlp-switch", "");
        sw.setAttribute("type", "button");
        sw.setAttribute("role", "switch");
        var skey = controlKey(pageId, block.id);
        var son = state.controls[skey] === undefined ? !!block.defaultChecked : state.controls[skey] === true;
        sw.setAttribute("aria-checked", son ? "true" : "false");
        if (son) sw.classList.add("hlp-switch-on");
        sw.appendChild(el("span", "hlp-switch-dot", ""));
        sw.addEventListener("click", function () {
          var cur = state.controls[skey] === undefined ? !!block.defaultChecked : state.controls[skey] === true;
          state.controls[skey] = !cur;
          draw();
        });
        row.appendChild(lab);
        row.appendChild(sw);
        return row;
      }
      if (block.kind === "select") {
        var wrap = el("label", "hlp-select-wrap");
        var selectLabel = el("span", "hlp-select-label", block.label);
        if (required[block.id]) selectLabel.appendChild(el("span", "hlp-req", " *"));
        wrap.appendChild(selectLabel);
        var sel = document.createElement("select");
        sel.className = "hlp-select";
        var skey2 = controlKey(pageId, block.id);
        var stored = state.controls[skey2];
        var value = typeof stored === "string" ? stored : block.defaultValue || "";
        if (!value) {
          var ph = document.createElement("option");
          ph.value = "";
          ph.textContent = block.label;
          ph.disabled = true;
          ph.selected = true;
          sel.appendChild(ph);
        }
        for (var i = 0; i < block.options.length; i += 1) {
          var opt = document.createElement("option");
          opt.value = block.options[i];
          opt.textContent = block.options[i];
          if (block.options[i] === value) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", function () {
          state.controls[skey2] = sel.value;
          draw();
        });
        wrap.appendChild(sel);
        return wrap;
      }
      return el("p", "hlp-empty", "Unknown block.");
    }

    draw();
  }

  window.OpenCordHelp = {
    LIMITS: LIMITS,
    parseHelpSource: parseHelpSource,
    renderPreview: renderPreview,
    byteLength: utf8Bytes,
  };
})();
