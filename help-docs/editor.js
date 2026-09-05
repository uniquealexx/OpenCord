/* Lightweight syntax highlighter + code-editor behaviour for the Help API page.
 * Dependency-free, no eval: token classes mirror the one-call-per-line api.*
 * grammar parsed by help-api.js. Source of truth:
 * client/src/components/server-help/builder.ts
 */
(function () {
  "use strict";

  var ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  function escapeHtml(text) {
    return text.replace(/[&<>]/g, function (ch) { return ESCAPE_MAP[ch]; });
  }

  var KNOWN_METHODS = { gate: 1, page: 1, text: 1, divider: 1, button: 1, checkbox: 1, switch: 1, select: 1, combobox: 1 };
  var LITERALS = { "true": 1, "false": 1, "null": 1 };
  var IDENT_START = /[A-Za-z_$]/;
  var PUNCT = "{}[](),;:.";
  var LINE_HEIGHT = 20; /* должно совпадать с line-height редактора в styles.css */

  function span(cls, text) {
    return '<span class="' + cls + '">' + escapeHtml(text) + "</span>";
  }

  function highlightLine(line) {
    var out = [];
    var i = 0;
    var expectMethod = false; /* после "api." ждём имя метода */

    function lastIsApi() {
      return out.length > 0 && out[out.length - 1].indexOf('class="tok-api"') !== -1;
    }

    while (i < line.length) {
      var ch = line[i];

      // комментарий до конца строки
      if (ch === "/" && line[i + 1] === "/") {
        out.push(span("tok-c", line.slice(i)));
        return out.join("");
      }

      // строковый литерал: "…" или '…' с \-экранами
      if (ch === '"' || ch === "'") {
        var j = i + 1;
        var closed = false;
        while (j < line.length) {
          if (line[j] === "\\") { j += 2; continue; }
          if (line[j] === ch) { closed = true; break; }
          j += 1;
        }
        if (closed) out.push(span("tok-str", line.slice(i, j + 1)));
        else out.push(span("tok-str tok-unterminated", line.slice(i)));
        i = closed ? j + 1 : line.length;
        expectMethod = false;
        continue;
      }

      // число (в том числе отрицательное)
      if (ch >= "0" && ch <= "9" || (ch === "-" && line[i + 1] >= "0" && line[i + 1] <= "9")) {
        var k = i + 1;
        while (k < line.length && ((line[k] >= "0" && line[k] <= "9") || line[k] === ".")) k += 1;
        out.push(span("tok-num", line.slice(i, k)));
        i = k;
        expectMethod = false;
        continue;
      }

      // идентификатор: api, метод, литерал, ключ объекта
      if (IDENT_START.test(ch)) {
        var m = i + 1;
        while (m < line.length && (IDENT_START.test(line[m]) || (line[m] >= "0" && line[m] <= "9"))) m += 1;
        var word = line.slice(i, m);
        if (expectMethod) {
          out.push(span(KNOWN_METHODS[word] ? "tok-method" : "tok-method tok-unknown", word));
          expectMethod = false;
        } else if (word === "api") {
          var p = m;
          while (p < line.length && line[p] === " ") p += 1;
          if (line[p] === ".") out.push(span("tok-api", word));
          else out.push(span("tok-plain", word));
        } else if (LITERALS[word]) {
          out.push(span("tok-lit", word));
        } else {
          var q = m;
          while (q < line.length && line[q] === " ") q += 1;
          if (line[q] === ":") out.push(span("tok-key", word));
          else out.push(span("tok-plain", word));
        }
        i = m;
        continue;
      }

      if (ch === ".") {
        if (lastIsApi()) expectMethod = true;
        out.push(span("tok-punct", "."));
        i += 1;
        continue;
      }

      if (PUNCT.indexOf(ch) >= 0) {
        out.push(span("tok-punct", ch));
        i += 1;
        expectMethod = false;
        continue;
      }

      out.push(escapeHtml(ch));
      i += 1;
    }
    return out.join("");
  }

  function highlightHelpSource(source) {
    var lines = String(source).split("\n");
    var html = [];
    for (var i = 0; i < lines.length; i += 1) html.push(highlightLine(lines[i]));
    /* хвостовой \n: последний пустой слой строки совпадает с видом textarea */
    return html.join("\n") + "\n";
  }

  /**
   * Оверлей-редактор: прозрачный textarea поверх подсвеченного <pre> с той же
   * метрикой шрифта. Ввод, undo/копирование остаются нативными; подсветка и
   * гуттер — декор. Ошибка парсера подсвечивает строку в гуттере («line N: …»).
   */
  function createHelpEditor(options) {
    var root = document.getElementById(options.root);
    var textarea = root.querySelector("textarea");
    var highlight = root.querySelector(".code-highlight");
    var code = root.querySelector("code");
    var gutter = root.querySelector(".code-gutter");
    var errorLine = 0;

    function caretLine() {
      return textarea.value.slice(0, textarea.selectionStart).split("\n").length;
    }

    function render() {
      var value = textarea.value;
      code.innerHTML = highlightHelpSource(value);
      var total = value.split("\n").length;
      var current = caretLine();
      var rows = [];
      for (var n = 1; n <= total; n += 1) {
        rows.push('<div class="ln' + (n === errorLine ? " err" : "") + (n === current ? " cur" : "") + '">' + n + "</div>");
      }
      gutter.innerHTML = rows.join("");
      syncScroll();
    }

    function syncScroll() {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    }

    function insertText(text) {
      textarea.focus();
      var ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
      if (!ok) {
        var start = textarea.selectionStart;
        var end = textarea.selectionEnd;
        textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
        textarea.setSelectionRange(start + text.length, start + text.length);
      }
      render();
    }

    textarea.addEventListener("input", render);
    textarea.addEventListener("scroll", syncScroll);
    textarea.addEventListener("keyup", render);
    textarea.addEventListener("click", render);
    textarea.addEventListener("select", render);

    textarea.addEventListener("keydown", function (event) {
      if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        insertText("  ");
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (options.onRun) options.onRun();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        var start = textarea.selectionStart;
        var lineStart = textarea.value.lastIndexOf("\n", start - 1) + 1;
        var indent = (/^[ \t]*/.exec(textarea.value.slice(lineStart, start)) || [""])[0];
        insertText("\n" + indent);
      }
    });

    function setErrorLine(line) {
      errorLine = line || 0;
      render();
      if (errorLine > 0) {
        var top = (errorLine - 1) * LINE_HEIGHT;
        var bottom = errorLine * LINE_HEIGHT;
        if (textarea.scrollTop > top || textarea.scrollTop + textarea.clientHeight < bottom) {
          textarea.scrollTop = Math.max(0, (errorLine - 4) * LINE_HEIGHT);
        }
      }
    }

    render();
    return { render: render, setErrorLine: setErrorLine, textarea: textarea };
  }

  /* Прогрессивное улучшение статичных примеров: <pre> и .sig получают ту же подсветку. */
  function enhanceStatic() {
    var samples = document.querySelectorAll("pre.code-sample, .sig");
    for (var i = 0; i < samples.length; i += 1) {
      samples[i].innerHTML = highlightHelpSource(samples[i].textContent);
    }
  }

  enhanceStatic();

  window.OpenCordHelpEditor = {
    highlightHelpSource: highlightHelpSource,
    create: createHelpEditor,
  };
})();
