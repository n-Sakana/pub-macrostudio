(function (global) {
  "use strict";

  // One way of showing code with places marked in it.
  //
  // Two screens need the same thing: the replacement table, where the
  // reader decides about a string and needs the code around it, and the
  // diagnosis result, where a finding names lines and the reader wants to
  // see them. Before this they had a list of line numbers on one screen
  // and the whole module printed on the other, and neither could be
  // searched. This is the one component both use, with the toolbar the
  // diff already had: only the marked places, and a way to step through
  // them.
  //
  // It renders once, on demand, and every control after that is a class
  // on a row. Rebuilding the block per keystroke is what made a workbook
  // with forty candidates stop responding.
  var CONTEXT_LINES = 3;
  var HIT_ATTRIBUTE = "data-code-hit";
  var HOST_ATTRIBUTE = "data-code-view-host";

  function element(tagName, className, text) {
    var node = global.document.createElement(tagName);

    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function splitCode(code) {
    return String(code === undefined || code === null ? "" : code)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
  }

  // The same range walk diff-view does over its own tokens: highlight the
  // whole line once, then cut the coloured runs at the mark boundaries so
  // the marked part keeps its colours instead of losing them.
  function appendRange(container, tokens, start, end) {
    var offset = 0;

    tokens.forEach(function (token) {
      var tokenStart = offset;
      var tokenEnd = offset + token.text.length;
      var from = Math.max(start, tokenStart);
      var to = Math.min(end, tokenEnd);
      var text;
      var span;

      offset = tokenEnd;
      if (from >= to) {
        return;
      }
      text = token.text.substring(from - tokenStart, to - tokenStart);
      if (token.type === "plain") {
        container.appendChild(global.document.createTextNode(text));
        return;
      }
      span = element("span", "vba-token vba-token--" + token.type, text);
      container.appendChild(span);
    });
  }

  // Colouring is optional, and off by default on purpose.
  //
  // Where the marks say which characters a machine is about to replace,
  // nothing but the product lexer may have an opinion about the text: a
  // display-only tokenizer that disagrees with it would draw the mark in
  // the wrong place. That view asks for plain text. The diagnosis view
  // marks whole lines and replaces nothing, so it can be coloured.
  function appendCode(cell, text, marks, highlight) {
    var tokens = highlight
      ? global.MacroStudioVbaHighlight.tokenizeLine(text)
      : [{type: "plain", text: String(text)}];
    var cursor = 0;
    var spans = (marks || []).filter(function (mark) {
      return typeof mark.column === "number" &&
        typeof mark.endColumn === "number" &&
        mark.endColumn > mark.column;
    }).sort(function (left, right) {
      return left.column - right.column;
    });

    if (spans.length === 0) {
      appendRange(cell, tokens, 0, text.length);
      return;
    }
    spans.forEach(function (span) {
      var mark;

      if (span.column < cursor) {
        return;
      }
      appendRange(cell, tokens, cursor, span.column);
      mark = element("mark", "path-evidence-mark");
      appendRange(mark, tokens, span.column, span.endColumn);
      cell.appendChild(mark);
      cursor = span.endColumn;
    });
    appendRange(cell, tokens, cursor, text.length);
  }

  // Hits arrive either as a span inside a line (the replacement table,
  // which knows the exact token) or as a whole line (a diagnosis, which
  // names lines and nothing finer). Both end up here as "line N, and
  // optionally these columns of it".
  function collectHits(hits) {
    var byLine = {};
    var numbers = [];

    (Array.isArray(hits) ? hits : []).forEach(function (hit) {
      var line = Number(hit && hit.line);

      if (!isFinite(line) || line < 1) {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(byLine, line)) {
        byLine[line] = [];
        numbers.push(line);
      }
      if (typeof hit.column === "number" &&
          typeof hit.endColumn === "number") {
        byLine[line].push({column: hit.column, endColumn: hit.endColumn});
      }
    });
    numbers.sort(function (left, right) { return left - right; });
    return {byLine: byLine, numbers: numbers};
  }

  // Runs of adjacent marked lines are one place to step to. Thirteen
  // lines of one procedure is one thing to look at, not thirteen.
  function toBlocks(numbers) {
    var blocks = [];

    numbers.forEach(function (line) {
      var last = blocks.length > 0 ? blocks[blocks.length - 1] : null;

      if (last && line - last.end <= 1) {
        last.end = line;
        return;
      }
      blocks.push({start: line, end: line});
    });
    return blocks;
  }

  function isNear(blocks, line) {
    return blocks.some(function (block) {
      return line >= block.start - CONTEXT_LINES &&
        line <= block.end + CONTEXT_LINES;
    });
  }

  function createLine(number, text, marks, hitIndex, highlight) {
    var line = element("div", "path-evidence-line");
    var code = element("code", "path-evidence-text");

    line.appendChild(element(
      "span",
      "path-evidence-number",
      String(number)));
    appendCode(code, text, marks, highlight);
    line.appendChild(code);
    if (hitIndex >= 0) {
      line.classList.add("is-match");
      line.setAttribute(HIT_ATTRIBUTE, String(hitIndex));
    }
    return line;
  }

  function createGap(count, group) {
    var gap = element("div", "code-view-gap");
    var button = element(
      "button",
      "code-view-gap-button",
      "…" + count + " 行を表示");

    button.type = "button";
    button.setAttribute("data-action", "code-view-expand");
    button.setAttribute("data-fold-group", String(group));
    // The gap carries the group too, so opening the run can find it and
    // take it off the page in the same pass.
    gap.setAttribute("data-fold-group", String(group));
    gap.setAttribute("data-fold-gap", String(group));
    gap.appendChild(button);
    return gap;
  }

  function createModuleBlock(module, state) {
    var box = element("div", "code-view-module");
    var block = element("div", "path-evidence-code");
    var lines = splitCode(module.code);
    var hits = collectHits(module.hits);
    var blocks = toBlocks(hits.numbers);
    var folded = 0;
    var pending = [];

    box.appendChild(element("h3", "path-module-name", module.name));
    function flush() {
      if (pending.length === 0) {
        return;
      }
      block.appendChild(createGap(pending.length, state.foldGroup));
      pending.forEach(function (node) {
        node.classList.add("is-folded");
        node.setAttribute("data-fold-group", String(state.foldGroup));
        block.appendChild(node);
      });
      state.foldGroup += 1;
      folded += pending.length;
      pending = [];
    }
    lines.forEach(function (text, index) {
      var number = index + 1;
      var marks = hits.byLine[number];
      var hitIndex = -1;
      var node;

      if (marks !== undefined) {
        blocks.some(function (item, position) {
          if (number >= item.start && number <= item.end) {
            hitIndex = state.blockBase + position;
            return true;
          }
          return false;
        });
      }
      node = createLine(number, text, marks, hitIndex, state.highlight);
      if (isNear(blocks, number)) {
        flush();
        block.appendChild(node);
        return;
      }
      pending.push(node);
    });
    flush();
    state.blockBase += blocks.length;
    state.foldedLines += folded;
    box.appendChild(block);
    return box;
  }

  function toolbarButton(label, action, key, className) {
    var button = element(
      "button",
      "code-view-button" + (className ? " " + className : ""),
      label);

    button.type = "button";
    button.setAttribute("data-action", action);
    button.setAttribute("data-code-view", key);
    return button;
  }

  // options: {key, modules:[{name, code, hits:[{line, column, endColumn}]}],
  //           matchesOnly, note}
  function create(options) {
    var settings = options || {};
    var key = String(settings.key || "code-view");
    var host = element("div", "code-view");
    var toolbar = element("div", "code-view-toolbar");
    var body = element("div", "code-view-body");
    var counter = element("span", "code-view-counter");
    var matchesOnly = settings.matchesOnly !== false;
    var state = {
      blockBase: 0,
      foldGroup: 0,
      foldedLines: 0,
      highlight: settings.highlight === true
    };
    var previous;
    var next;
    var toggle;

    host.setAttribute(HOST_ATTRIBUTE, key);
    (Array.isArray(settings.modules) ? settings.modules : []).forEach(
      function (module) {
        if (!module || typeof module.code !== "string") {
          body.appendChild(element(
            "p",
            "code-view-missing",
            (module && module.name ? module.name + " は" : "") +
              "このモジュールを読み取れませんでした。"));
          return;
        }
        body.appendChild(createModuleBlock(module, state));
      });

    previous = toolbarButton("↑ 前へ", "code-view-previous", key);
    next = toolbarButton("↓ 次へ", "code-view-next", key);
    toggle = toolbarButton(
      "該当箇所のみ",
      "code-view-matches",
      key,
      "code-view-toggle");
    previous.disabled = state.blockBase === 0;
    next.disabled = state.blockBase === 0;
    toggle.disabled = state.foldedLines === 0;
    toggle.setAttribute("aria-pressed", matchesOnly ? "true" : "false");
    toggle.classList.toggle("is-active", matchesOnly);
    counter.textContent = state.blockBase > 0
      ? "1/" + state.blockBase
      : "0/0";
    toolbar.appendChild(element(
      "span",
      "code-view-label",
      settings.note || "該当箇所"));
    toolbar.appendChild(counter);
    toolbar.appendChild(previous);
    toolbar.appendChild(next);
    toolbar.appendChild(toggle);
    host.appendChild(toolbar);
    host.appendChild(body);
    host.setAttribute("data-code-hit-count", String(state.blockBase));
    host.setAttribute("data-code-hit-current", "0");
    host.classList.toggle("is-matches-only", matchesOnly);
    return host;
  }

  function findHost(key) {
    if (!global.document || !global.document.querySelector) {
      return null;
    }
    return global.document.querySelector(
      "[" + HOST_ATTRIBUTE + "=\"" + String(key) + "\"]");
  }

  function jump(key, direction) {
    var host = findHost(key);
    var count;
    var current;
    var target;
    var rows;
    var counter;

    if (!host) {
      return false;
    }
    count = Number(host.getAttribute("data-code-hit-count")) || 0;
    if (count === 0) {
      return false;
    }
    current = Number(host.getAttribute("data-code-hit-current")) || 0;
    target = Math.max(0, Math.min(count - 1, current + direction));
    host.setAttribute("data-code-hit-current", String(target));
    rows = host.querySelectorAll("[" + HIT_ATTRIBUTE + "]");
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.remove("is-current");
    });
    rows = host.querySelectorAll(
      "[" + HIT_ATTRIBUTE + "=\"" + target + "\"]");
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.add("is-current");
    });
    if (rows.length > 0 && rows[0].scrollIntoView) {
      rows[0].scrollIntoView({block: "center", inline: "nearest"});
    }
    counter = host.querySelector(".code-view-counter");
    if (counter) {
      counter.textContent = (target + 1) + "/" + count;
    }
    return true;
  }

  function toggleMatchesOnly(key) {
    var host = findHost(key);
    var button;
    var on;

    if (!host) {
      return false;
    }
    on = !host.classList.contains("is-matches-only");
    host.classList.toggle("is-matches-only", on);
    button = host.querySelector(".code-view-toggle");
    if (button) {
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.classList.toggle("is-active", on);
    }
    return true;
  }

  // The hidden run is already in the page, so showing it is a class
  // change rather than a rebuild.
  function expand(button) {
    var group = button.getAttribute("data-fold-group");
    var host = button.parentNode;
    var rows;

    while (host && host.getAttribute &&
        host.getAttribute(HOST_ATTRIBUTE) === null) {
      host = host.parentNode;
    }
    if (!host || group === null) {
      return false;
    }
    rows = host.querySelectorAll("[data-fold-group=\"" + group + "\"]");
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.remove("is-folded");
      if (row.getAttribute("data-fold-gap") !== null) {
        row.classList.add("is-expanded");
      }
    });
    return true;
  }

  global.MacroStudioCodeView = {
    contextLines: CONTEXT_LINES,
    create: create,
    jump: jump,
    toggleMatchesOnly: toggleMatchesOnly,
    expand: expand
  };
}(window));
