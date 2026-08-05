(function (global) {
  "use strict";

  var CRLF = "\r\n";
  var DIVIDER = new Array(81).join("-");
  // The one file the chat is handed. It names itself, so nobody mistakes
  // it for the record of the code as it was read. screens.js owns the name
  // because its status line says it too; keeping a second copy here is what
  // let the body and the status line name different files.
  var AI_CODE_FILE = global.MacroStudioScreens.AI_CODE_FILE;
  // A repair answer is the changed code or a refusal. These are the
  // three refusals the contract allows; none of them is a question.
  var NO_CHANGE_TITLES = {
    UNNECESSARY: "改修は不要という回答です",
    IMPOSSIBLE: "この方法では改修できないという回答です",
    UNCLEAR: "依頼の内容を決められないという回答です"
  };
  var disclosureState = {};
  // Content a closed row has not needed yet. A workbook with forty
  // candidates was building every module of every candidate on every
  // render - including one per keystroke in the value field - and the
  // window stopped answering. Nothing is built until the row is opened.
  var lazyContent = {};
  var entering = false;
  var lastEnteredScreen = null;
  // What the reader has to do about a problem, in one letter. Worst
  // first, because a workbook that cannot be made to run at all is the
  // thing to read before a list of things that can be fixed.
  var GRADE_ORDER = ["D", "C", "B", "A"];
  var GRADE_LABELS = {
    A: "支障なし",
    B: "要改修",
    C: "不明",
    D: "改修不可"
  };
  var GRADE_NOTES = {
    A: "動作に支障はありません。読むだけで結構です。",
    B: "動きません。このツールのひな形で改修を依頼できます。",
    C: "動きません。原因がコードの外にあるので、このツールでは直せません。" +
      "環境の側で手を打つことになります。",
    D: "動きません。置き換え先が無いことが確定しています。" +
      "このマクロをこの環境で動かすことはできません。"
  };
  // The refactoring diagnosis grades the workbook as a whole, and the
  // letters mean something else there: how much there is to gain.
  var VALUE_LABELS = {
    A: "直すところは見当たらない",
    B: "少しある",
    C: "ある",
    D: "大きい"
  };
  var CONFIDENCE_LABELS = {
    CONFIRMED: "確認済み",
    LIKELY: "可能性高",
    UNVERIFIED: "未確認"
  };

  function element(tagName, className, text) {
    var node = document.createElement(tagName);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function actionButton(label, action, primary) {
    var button = element(
      "button",
      "button" + (primary ? " button--primary" : ""),
      label);
    button.type = "button";
    button.setAttribute("data-action", action);
    return button;
  }

  // β1 draws every icon from one sprite. Reusing it keeps the chevron
  // and the check identical to the shapes the rest of the flow uses.
  function icon(name, className) {
    return global.MacroStudioIcons.create(name, className);
  }

  // A button is never a direct child of .task: that column stretches its
  // children, which is what turned every action into a full-width bar.
  // Actions always sit in a row that keeps them at their own width.
  function actionRow() {
    var row = element("div", "step-actions");
    var index;

    for (index = 0; index < arguments.length; index += 1) {
      if (arguments[index]) {
        row.appendChild(arguments[index]);
      }
    }
    return row;
  }

  // The β1 structure for an optional switch. .option-checkbox is the
  // size of the box itself, so it belongs on the input; putting it on
  // the label shrank the label to 28px and stood the text on end.
  function optionRow(id, label, checked, disabled, inputName, extraClass) {
    var row = element("div", "option-row" + (extraClass ? " " + extraClass : ""));
    var wrap = element("label", "option-label");
    var box = element("input", "option-checkbox");

    box.type = "checkbox";
    box.id = id;
    box.checked = checked === true;
    box.disabled = disabled === true;
    box.setAttribute("data-workflow-input", inputName);
    wrap.setAttribute("for", id);
    wrap.appendChild(box);
    wrap.appendChild(element("span", "option-text", label));
    row.appendChild(wrap);
    return row;
  }

  // What the last action actually did. One line, no card: a result is
  // not a message that deserves its own bordered box.
  function statusLine(text) {
    var line = element("p", "task-status");

    line.appendChild(icon("check", "flow-icon--small task-status-icon"));
    line.appendChild(element("span", "", text));
    return line;
  }

  function task(wide) {
    return element("div", "task" + (wide ? " task--wide" : ""));
  }

  // Text the app did not write, shown the way it was written. The
  // environment the diagnosis assumes and the memo handed over at the end
  // are both files; both are shown through this, so the reader learns one
  // shape and meets it everywhere rather than a different arrangement of
  // headings and bullets each time.
  function sourceBlock(text) {
    return element("pre", "source-block", String(text || ""));
  }

  // One section of a Markdown document, from its "## " heading to the
  // next one. Used to show the part of a memo that answers the question
  // on this screen, without rebuilding the memo in code.
  function markdownSection(markdown, heading) {
    var lines = String(markdown || "").split(/\r\n|\n|\r/);
    var collected = [];
    var inside = false;
    var index;

    for (index = 0; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) {
        if (inside) {
          break;
        }
        inside = lines[index].replace(/^##\s+/, "").trim() === heading;
        if (inside) {
          collected.push(lines[index]);
        }
        continue;
      }
      if (inside) {
        collected.push(lines[index]);
      }
    }
    while (collected.length && collected[collected.length - 1].trim() === "") {
      collected.pop();
    }
    return collected.join(CRLF);
  }

  function intro(text) {
    return element("p", "task-intro", text);
  }

  function section(title, className) {
    var box = element("section", "workflow-section " + (className || ""));
    box.appendChild(element("h2", "workflow-section-title", title));
    return box;
  }

  // β1's progressive disclosure, unchanged: a chevron that turns, a
  // label that says what opens, and an optional note on the right. A
  // plain bordered box with no chevron reads as a card, and nobody can
  // tell a card is going to open.
  function createDisclosure(key, label, content, openByDefault, note, writein) {
    var box = element("div", "disclosure" + (writein ? " disclosure--writein" : ""));
    var trigger = element("button", "disclosure-trigger");
    var body = element("div", "disclosure-body");
    var inner = element("div", "disclosure-inner");
    var panelId = "workflow-disclosure-" + key.replace(/[^A-Za-z0-9_-]/g, "-");
    var open = Object.prototype.hasOwnProperty.call(disclosureState, key)
      ? disclosureState[key]
      : openByDefault === true;

    // A caller may hand a function instead of an element when building
    // the content is expensive. It is called on the render that first
    // shows the row open, and not before.
    delete lazyContent[key];
    if (typeof content === "function") {
      if (open) {
        content = content();
      } else {
        lazyContent[key] = {factory: content, panelId: panelId};
        content = element("div", "disclosure-placeholder");
      }
    }

    trigger.type = "button";
    trigger.setAttribute("data-action", "toggle-workflow-disclosure");
    trigger.setAttribute("data-disclosure-key", key);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    trigger.setAttribute("aria-controls", panelId);
    // A row that opens onto a text field says so while it is closed. A
    // chevron promises more reading; a pencil promises somewhere to
    // write, and the reader should not have to open it to find out.
    trigger.appendChild(writein
      ? icon("edit", "flow-icon--small disclosure-pencil")
      : icon("chevron", "flow-icon--small disclosure-chevron"));
    trigger.appendChild(element("span", "disclosure-label", label));
    if (note) {
      trigger.appendChild(element("span", "disclosure-note", note));
    }
    box.setAttribute("data-open", open ? "true" : "false");
    box.setAttribute("data-disclosure-box", key);
    inner.id = panelId;
    inner.appendChild(content);
    body.appendChild(inner);
    box.appendChild(trigger);
    box.appendChild(body);
    return box;
  }

  function fillRequestId(text, requestId) {
    return String(text === undefined || text === null ? "" : text)
      .split("{{REQUEST_ID}}")
      .join(requestId || "");
  }

  function firstLine(text) {
    return String(text || "").replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n").split("\n")[0];
  }

  // The headline gives one statement per section, and a statement that
  // stops at a comma is not one. The physical first line of a wrapped
  // paragraph cuts wherever the writer happened to break the line
  // ("...入力の不備を見つけ、"), with no ellipsis and no sign that more
  // follows, so it reads as a finished thought that makes no sense.
  // Cutting at the end of the first sentence instead costs nothing: the
  // accordion below already holds the section in full either way.
  function firstSentence(text) {
    var normalised = String(text || "").replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n").trim();
    if (!normalised) {
      return "";
    }
    var stop = normalised.search(/[。！？!?]/);
    if (stop < 0) {
      // No sentence end to cut at - a heading, a bullet, a fragment.
      // Keep the writer's own line rather than inventing a boundary.
      return normalised.split("\n")[0];
    }
    // A sentence may be wrapped across lines; join it back up. Japanese
    // needs no separator at the join, and a line break inside one
    // sentence is a layout artifact, not part of the text.
    return normalised.slice(0, stop + 1).replace(/\n/g, "");
  }

  function padFinding(value) {
    var text = String(value || "");
    return text.length >= 2 ? text : "0" + text;
  }

  function sortedFindings(diagnosis) {
    var findings = diagnosis && Array.isArray(diagnosis.findings)
      ? diagnosis.findings.slice()
      : [];
    findings.sort(function (left, right) {
      var gradeDifference = GRADE_ORDER.indexOf(left.grade) -
        GRADE_ORDER.indexOf(right.grade);
      return gradeDifference || Number(left.number) - Number(right.number);
    });
    return findings;
  }

  // The改修ガイド sorts everything that can go wrong into five kinds of
  // work. The canonical environment already carries an axis per key that
  // lines up with them, so the grouping is read from the環境 file rather
  // than invented here.
  var AXIS_ORDER = ["execution", "storage", "components", "host", ""];
  var AXIS_LABELS = {
    execution: "Win32 API・外部プログラム・スクリプト",
    storage: "パス・ファイル・フォルダー操作",
    components: "参照ライブラリ・古い部品",
    host: "接続先・機器",
    "": "対象環境の指定がない指摘"
  };

  function environmentConstraint(state, key) {
    var constraints = state.targetEnvironment &&
      Array.isArray(state.targetEnvironment.constraints)
      ? state.targetEnvironment.constraints
      : [];
    var found = null;

    constraints.some(function (constraint) {
      if (constraint.key === key) {
        found = constraint;
        return true;
      }
      return false;
    });
    return found;
  }

  function worstGrade(findings) {
    var best = GRADE_ORDER.length - 1;

    findings.forEach(function (finding) {
      var index = GRADE_ORDER.indexOf(finding.grade);
      if (index >= 0 && index < best) {
        best = index;
      }
    });
    return GRADE_ORDER[best];
  }

  // One problem, however many places it shows up in. Thirteen findings
  // that all say "this macro calls Sleep" are one thing to decide about
  // and thirteen places to look at, so they are shown that way.
  function groupFindings(state, findings) {
    var byKey = {};
    var order = [];
    var byAxis = {};
    var axisOrder = [];

    findings.forEach(function (finding) {
      var key = finding.environmentKey === "-" ? "" : finding.environmentKey;

      if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
        byKey[key] = [];
        order.push(key);
      }
      byKey[key].push(finding);
    });
    order.forEach(function (key) {
      var constraint = key ? environmentConstraint(state, key) : null;
      var axis = constraint && constraint.axis ? constraint.axis : "";
      var group = {
        key: key,
        axis: axis,
        title: constraint && constraint.title
          ? constraint.title
          : firstLine(byKey[key][0].texts.title),
        grade: worstGrade(byKey[key]),
        findings: byKey[key]
      };

      if (!Object.prototype.hasOwnProperty.call(byAxis, axis)) {
        byAxis[axis] = [];
        axisOrder.push(axis);
      }
      byAxis[axis].push(group);
    });
    axisOrder.sort(function (left, right) {
      return AXIS_ORDER.indexOf(left) - AXIS_ORDER.indexOf(right);
    });
    return axisOrder.map(function (axis) {
      byAxis[axis].sort(function (left, right) {
        return GRADE_ORDER.indexOf(left.grade) -
          GRADE_ORDER.indexOf(right.grade);
      });
      return {
        axis: axis,
        label: AXIS_LABELS[axis] || AXIS_LABELS[""],
        groups: byAxis[axis]
      };
    });
  }

  // The grade the diagnosis gave, grouped. The tool works nothing out
  // here: the AI named A, B, C or D against a definition written in the
  // template, and this only sorts by it. Deciding the verdict from which
  // templates happen to exist was tried and dropped - it could not
  // express a defect that owes nothing to the target environment,
  // because that finding names no environment key.
  function gradesOf(categories) {
    var buckets = {};

    GRADE_ORDER.forEach(function (name) { buckets[name] = []; });
    allGroups(categories).forEach(function (group) {
      buckets[group.grade].push(group);
    });
    return GRADE_ORDER.map(function (name) {
      return {
        grade: name,
        label: GRADE_LABELS[name],
        note: GRADE_NOTES[name],
        groups: buckets[name]
      };
    });
  }

  function allGroups(categories) {
    var groups = [];

    categories.forEach(function (category) {
      category.groups.forEach(function (group) {
        groups.push(group);
      });
    });
    return groups;
  }

  function countGroupGrades(categories) {
    var counts = {};

    GRADE_ORDER.forEach(function (name) { counts[name] = 0; });
    allGroups(categories).forEach(function (group) {
      counts[group.grade] += 1;
    });
    return counts;
  }

  function environmentConstraint(state, key) {
    var constraints = state.targetEnvironment &&
      Array.isArray(state.targetEnvironment.constraints)
      ? state.targetEnvironment.constraints
      : [];
    var found = null;

    constraints.some(function (constraint) {
      if (constraint.key === key) {
        found = constraint;
        return true;
      }
      return false;
    });
    return found;
  }

  // SPEC 4.4.2: what the AI read and what we assume about the terminal
  // are two different certainties. A finding that stops the macro, resting
  // on an assumption nobody measured on the target machine, says so.
  function notMeasuredNote(state, finding) {
    var constraint;

    if (!finding || finding.grade !== "B" ||
        finding.environmentKey === "-") {
      return "";
    }
    constraint = environmentConstraint(state, finding.environmentKey);
    if (!constraint || constraint.basis === "observed") {
      return "";
    }
    return "この環境前提は実測ではありません。" +
      "対象の端末で確かめるまでは、そうなると決まってはいません。";
  }

  function formatLocation(finding) {
    return "module: " + finding.module + " / proc: " +
      finding.procedure + " / lines: " + finding.lines;
  }

  // The lines a finding names, as numbers. The contract already refused
  // anything that is not a comma list of numbers and ranges inside the
  // module, so reading it is all that is left to do.
  function findingLines(finding) {
    var numbers = [];

    if (!finding || !finding.lines || finding.lines === "-") {
      return numbers;
    }
    String(finding.lines).split(",").forEach(function (item) {
      var parts = item.split("-");
      var start = Number(parts[0]);
      var end = Number(parts.length === 2 ? parts[1] : parts[0]);
      var line;

      if (!isFinite(start) || !isFinite(end) || start < 1 || end < start) {
        return;
      }
      for (line = start; line <= end; line += 1) {
        numbers.push({line: line});
      }
    });
    return numbers;
  }

  function findModule(state, name) {
    var found = null;

    (state.modules || []).some(function (module) {
      if (module.name === name) {
        found = module;
        return true;
      }
      return false;
    });
    return found;
  }

  function formatDiagnosisForPrompt(diagnosis) {
    var lines = [];
    var sections = diagnosis && diagnosis.sections ? diagnosis.sections : {};

    ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"].forEach(
      function (name) {
        lines.push("## " + name);
        lines.push(String(sections[name] || ""));
        lines.push("");
      });
    sortedFindings(diagnosis).forEach(function (finding) {
      lines.push(
        "#" + padFinding(finding.number) + " [" + finding.grade + "/" +
        finding.confidence + "] " + finding.texts.title);
      lines.push("    成立条件: " + finding.texts.condition);
      lines.push("    影響: " + finding.texts.impact);
      lines.push("    該当箇所: " + formatLocation(finding));
      lines.push("    根拠: " + finding.texts.evidence);
      lines.push("");
    });
    if (diagnosis && diagnosis.findings && diagnosis.findings.length === 0) {
      lines.push("（指摘 0 件: " +
        String(diagnosis.noFinding || diagnosis.noFindings || "") + "）");
      lines.push("");
    }
    return lines.join(CRLF).replace(/(?:\r\n)+$/, "");
  }

  function findDiagnosisFinding(state, id) {
    var found = null;
    sortedFindings(state.diagnosis).some(function (finding) {
      if (String(finding.number) === String(id)) {
        found = finding;
        return true;
      }
      return false;
    });
    return found;
  }

  function formatSelectedFindings(state) {
    var ids = Array.isArray(state.selectedFindings)
      ? state.selectedFindings.slice().sort(function (left, right) {
        return Number(left) - Number(right);
      })
      : [];
    var lines = [DIVIDER, " REQUESTED CHANGES", DIVIDER];

    if (ids.length === 0) {
      lines.push("（指摘の選択なし。追加の要望のみ）");
      lines.push(DIVIDER);
      return lines.join(CRLF);
    }
    // The finding itself carries the problem, where it is, and what has
    // to hold afterwards. Restating it in the reader's words added a form
    // to fill in and nothing the chat did not already have.
    ids.forEach(function (id) {
      var finding = findDiagnosisFinding(state, id);
      if (!finding) {
        return;
      }
      lines.push(
        "#" + padFinding(finding.number) + " [" + finding.grade + "] " +
        finding.texts.title);
      lines.push("    " + formatLocation(finding));
      lines.push("    成立条件: " + finding.texts.condition);
      lines.push("    影響: " + finding.texts.impact);
      lines.push("");
    });
    lines.push(DIVIDER);
    return lines.join(CRLF);
  }

  function composeDiagnosisRequestText(instruction, concern) {
    var text = String(instruction || "");
    var extra = String(concern || "").trim();
    if (!extra) {
      return text;
    }
    return global.MacroStudioPrompt.appendPreset(
      text,
      "【ほかに気になっていること】" + CRLF + extra);
  }

  // Every template the reader chose, in the order they are offered. One
  // request carries the whole job; the chat is not asked once per
  // template. A single choice reads exactly as it did before.
  function composeInstructions(state, requestId) {
    var chosen = Array.isArray(state.presets) ? state.presets : [];
    var bodies = chosen.filter(function (entry) {
      return entry.parsed && entry.parsed.instruction;
    });

    if (bodies.length <= 1) {
      return bodies.length === 1
        ? fillRequestId(bodies[0].parsed.instruction.body, requestId)
        : "";
    }
    return bodies.map(function (entry) {
      return "【" + entry.name + "】" + CRLF +
        fillRequestId(entry.parsed.instruction.body, requestId);
    }).join(CRLF + CRLF);
  }

  // On the route where the table ran first, the chat is looking at code
  // a machine already rewrote. It has to be told, or it will "fix" those
  // lines back to what the workbook used to say.
  function machineReplacementNote(state) {
    var rows = state.pathMap && Array.isArray(state.pathMap.rows)
      ? state.pathMap.rows.filter(function (row) {
        return row.applied === true;
      })
      : [];
    var lines;

    if (!hasMachineReplacement(state) || rows.length === 0) {
      return "";
    }
    lines = ["【このコードは一部を置き換え済みです】"];
    lines.push(
      "添付したコードは、次の文字列を機械的に置き換えたあとのものです。" +
        "置き換えは確認済みなので、**元の値へ戻さないでください。**");
    rows.forEach(function (row) {
      lines.push("- " + row.from + " → " + row.to);
    });
    lines.push(
      "これらの新しい値はそのまま残し、依頼された改修だけを行ってください。");
    return lines.join(CRLF);
  }

  // How far the code may change, in the chosen template's own words. The
  // heading travels with the text so a build whose 03_変更範囲 folder is
  // empty sends no empty heading - and cannot get that far anyway,
  // because the screen refuses to advance without a scope.
  function changeScopeText(state) {
    var scope = state && state.changeScope ? state.changeScope : null;

    if (!scope || !scope.instruction) {
      return "";
    }
    return "【変更範囲】" + CRLF +
      String(scope.instruction.body || "") + CRLF + CRLF;
  }

  function composeRepairRequestText(parsed, state, requestId) {
    var text = composeInstructions(state, requestId);
    var answers = [];

    (parsed.questions || []).forEach(function (question, index) {
      var label = typeof question === "string"
        ? question
        : String(question.text || "");
      answers.push("Q: " + label);
      answers.push("A: " + String(state.answers[String(index)] || ""));
    });
    if (answers.length) {
      text = global.MacroStudioPrompt.appendPreset(
        text,
        "【質問への回答】" + CRLF + answers.join(CRLF));
    }
    if (String(state.extraRequest || "").trim()) {
      text = global.MacroStudioPrompt.appendPreset(
        text,
        "【追加の要望】" + CRLF + String(state.extraRequest).trim());
    }
    if (machineReplacementNote(state)) {
      text = global.MacroStudioPrompt.appendPreset(
        text,
        machineReplacementNote(state));
    }
    return text;
  }

  // The product log, through the same door the identity fallback uses.
  // Nothing here carries reply text, diagnosis text or path values.
  function writeLog(level, message) {
    if (!global.hostBridge) {
      return;
    }
    global.hostBridge.request("writeLog", {
      level: level,
      message: message
    }).then(function () { return null; }, function () { return null; });
  }

  function createIdentity() {
    var identity = global.MacroStudioResponse.createRequestIdentity();
    if (!identity.secure) {
      writeLog(
        "WARN",
        "request identity used Math.random because secure random was unavailable");
    }
    return identity.id;
  }

  // The code file the chat is given for this request.
  //
  // On the route where the replacement table ran first, the chat has to
  // work on the code the machine already rewrote - otherwise it is
  // repairing lines that no longer exist, and its answer would put the
  // old paths back. The workbook as it was read stays in source-code.md;
  // only this copy moves.
  function composeAiCodeFile(state) {
    return global.MacroStudioPrompt.buildCodeFile({
      book: state.book,
      modules: state.modules.map(function (module) {
        return {
          name: module.name,
          type: module.type,
          typeLabel: module.typeLabel,
          ext: module.ext,
          lineCount: module.lineCount,
          code: hasMachineReplacement(state) &&
            typeof module.pastedCode === "string"
            ? module.pastedCode
            : String(module.code || "")
        };
      }),
      generatedAt: global.MacroStudioApp.createCodeFileTimestamp(new Date())
    });
  }

  // True once the replacement table has rewritten the code in this run,
  // whatever happened afterwards. What the chat is handed, and what the
  // request says about it, both depend on this having happened.
  function hasMachineReplacement(state) {
    return Boolean(state.appliedMapping);
  }

  // The facts the tool read out of the workbook that are not code, put
  // into the request itself. The reader is not asked to look them up or
  // paste them in: the tool already has them, so it hands them over.
  // Empty when there is nothing to say, so no empty heading is sent.
  function composeOutsideCode(state) {
    var facts = global.MacroStudioHandover
      ? global.MacroStudioHandover.outsideCodeFacts(state)
      : [];
    var lines;

    if (facts.length === 0) {
      return "";
    }
    lines = ["【コードの外にあるもの】" +
      "※ MacroStudio がブックから読み取った事実です。VBA には現れません"];
    facts.forEach(function (fact) {
      lines.push("- " + fact.label + ": " + fact.value);
    });
    lines.push("");
    return lines.join(CRLF) + CRLF;
  }

  // The whole presets folder, already described by preset-document.js.
  // The app never reads what is inside the files.
  function catalog(state) {
    return state && state.appInfo && state.appInfo.catalog
      ? state.appInfo.catalog
      : null;
  }

  function repairPresets(state) {
    var described = catalog(state);

    return described && Array.isArray(described.repair)
      ? described.repair
      : [];
  }

  function scopePresets(state) {
    var described = catalog(state);

    return described && Array.isArray(described.scope)
      ? described.scope
      : [];
  }

  // The headings the repair templates stand under, in the order the
  // folder offers them. Written in the files, never here.
  function repairCategories(state) {
    var described = catalog(state);

    return described && Array.isArray(described.categories)
      ? described.categories
      : [];
  }

  // The one diagnosis template, with the raw file beside it. The folder
  // must hold exactly one usable file; zero or two is E-PRESET-02 and the
  // screen says so rather than picking one.
  function diagnosisPreset(state) {
    var described = catalog(state);
    var valid = described && Array.isArray(described.diagnose)
      ? described.diagnose.filter(function (entry) {
        return entry.valid;
      })
      : [];

    if (valid.length !== 1) {
      return null;
    }
    return {
      entry: valid[0],
      raw: {file: valid[0].file, content: valid[0].content}
    };
  }

  // What the diagnosis calls itself, for the one screen that has to name
  // the question it answered.
  function diagnosisName(state) {
    var selected = diagnosisPreset(state);

    return selected ? String(selected.entry.name || "") : "";
  }

  // The reply did not come back in the shape the request asked for. The
  // chat can usually fix that if it is told again, so the first failure
  // puts the asking back on the clipboard rather than leaving the reader
  // to compose it. The output rules come from the template that made the
  // request - this is not the place to re-author the contract.
  function retryText(stage) {
    var state = global.MacroStudioState.getState();
    var rules = null;
    var selected;
    var parsed;

    if (stage === "repair") {
      rules = state.outputRules;
    } else {
      selected = diagnosisPreset(state);
      if (selected) {
        parsed = global.MacroStudioPreset.parse(
          selected.raw.content,
          "diagnose");
        if (parsed.valid && parsed.output) {
          rules = fillRequestId(
            parsed.output.body,
            state.diagnosisRequestId);
        }
      }
    }
    if (!rules) {
      return "";
    }
    return "さきほどの返答をそのまま取り込めませんでした。" +
      "内容は変えず、次の書き方のとおりにもう一度返してください。" +
      CRLF + CRLF + rules;
  }

  // What a refusal is recorded as: the stage, the contract's own check
  // number and reason code, and how many times in a row it has happened.
  // Never the reply itself (SPEC 8.4).
  function recordIntakeRefusal(stage, detail) {
    var parts = ["intake refused", "stage=" + String(stage)];
    var source = detail || {};

    if (source.validationId) {
      parts.push("check=" + String(source.validationId));
    }
    if (source.reason) {
      parts.push("reason=" + String(source.reason));
    }
    if (source.code) {
      parts.push("code=" + String(source.code));
    }
    parts.push("consecutive=" + String(source.count || 1));
    writeLog("WARN", parts.join(" "));
  }

  // Twice in a row means the chat is not going to produce the shape this
  // request needs, so asking it the same way a third time wastes the
  // reader's turn. Say why, and point somewhere else.
  function handleIntakeFailure(stage, message, detail) {
    var store = global.MacroStudioState;
    var count = store.noteIntakeFailure(stage);
    var text;

    recordIntakeRefusal(stage, {
      validationId: detail && detail.validationId,
      reason: detail && detail.reason,
      code: detail && detail.code,
      count: count
    });
    // The same refusal, written where it can still be read while the
    // paste is being fixed. A toast is gone by then, which is how the
    // same reply came to be pasted four times in a row.
    store.setIntakeError(stage, {
      code: detail && detail.code,
      validationId: detail && detail.validationId,
      reason: detail && detail.reason,
      message: message,
      detail: detail && detail.detail,
      count: count
    });
    if (count >= 2) {
      global.MacroStudioApp.showToast(
        message + CRLF +
          "同じAIで2回続けて形が崩れました。返答の形を直せないAIもあります。" +
          "別のAIに、同じ依頼文をそのまま渡してみてください。",
        "error");
      return false;
    }
    text = retryText(stage);
    if (!text) {
      global.MacroStudioApp.showToast(message, "error");
      return false;
    }
    return global.hostBridge.request("writeClipboard", {text: text}).then(
      function () {
        global.MacroStudioApp.showToast(
          message + CRLF +
            "言い直す文をクリップボードに入れました。" +
            "同じチャットにそのまま貼り付けてください。",
          "error");
        return false;
      },
      function () {
        global.MacroStudioApp.showToast(message, "error");
        return false;
      });
  }

  function failHost(error, toastAction) {
    global.MacroStudioApp.handleHostError(
      error || {code: "E-SYS-02"},
      "",
      toastAction || null);
    global.MacroStudioState.setBusyAction(null);
    return null;
  }

  // What the diagnosis is asked to grade against. It is not written here
  // and not written in the diagnosis template either: it is the repair
  // template's own 改修指示. An install with one repair template has one
  // basis; an install with several has no single basis to name, and its
  // diagnosis does not ask for one - which is the shipped case, because
  // the shipped diagnosis grades on "does it run" and needs no template
  // to say so.
  //
  // Keeping the criteria in one file is the point. Copying them into the
  // diagnosis template would let the two stages drift apart, and the
  // reader would be told the code was graded against something the
  // repair does not do.
  function gradingBasis(state) {
    var valid = repairPresets(state).filter(function (entry) {
      return entry.valid && entry.instruction;
    });

    if (valid.length !== 1) {
      return "";
    }
    // The heading travels with the text so an install without a single
    // basis sends no empty heading, the same way the outside-code block
    // disappears when there is nothing outside the code.
    return "【改修の基準】" + CRLF +
      String(valid[0].instruction.body || "") + CRLF + CRLF;
  }

  function prepareDiagnosisRequest(force) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var selected = diagnosisPreset(state);
    var environment = state.targetEnvironment;
    var timestamp;
    var requestId;
    var parsed;
    var requestText;
    var outputRules;
    var code;

    if (state.busyAction || !selected || !environment ||
        !state.targetEnvironmentSnapshot ||
        (state.diagnosisRequestId && force !== true)) {
      return Promise.resolve(null);
    }
    parsed = global.MacroStudioPreset.parse(selected.raw.content, "diagnose");
    if (!parsed.valid) {
      return Promise.resolve(null);
    }
    requestId = createIdentity();
    timestamp = state.outputTimestamp ||
      global.MacroStudioApp.createOutputTimestamp(new Date());
    requestText = composeDiagnosisRequestText(
      fillRequestId(parsed.instruction.body, requestId),
      state.diagnosisConcern);
    outputRules = state.diagnosisSplit && parsed.splitDiagnosisOutput
      ? parsed.splitDiagnosisOutput
      : parsed.output;
    outputRules = {
      title: outputRules.title,
      body: fillRequestId(outputRules.body, requestId)
    };

    store.setBusyAction("prepareDiagnosisRequest");
    return global.hostBridge.request("readRequestTemplate", {
      name: "diagnose-template"
    }).then(function (templateResult) {
      var prompt;
      try {
        prompt = fillRequestId(global.MacroStudioPrompt.buildRequestPrompt({
          template: templateResult.content,
          requestText: requestText,
          outputRules: outputRules,
          requestId: requestId,
          book: state.book,
          modules: state.modules,
          codeFileName: AI_CODE_FILE,
          targetEnvironment: state.targetEnvironmentSnapshot,
          outsideCode: composeOutsideCode(state),
          gradingBasis: gradingBasis(state)
        }), requestId);
        code = global.MacroStudioPrompt.buildCodeFile({
          book: state.book,
          modules: state.modules,
          generatedAt: global.MacroStudioApp.createCodeFileTimestamp(new Date())
        });
      } catch (error) {
        return failHost({code: "E-GEN-02", message: error.message});
      }
      return global.hostBridge.request("writeRequestFiles", {
        stage: "diagnose",
        outputTimestamp: timestamp,
        request: prompt,
        code: code,
        aiCode: code
      }).then(function (result) {
        store.commitDiagnosisRequest({
          requestId: requestId,
          requestText: requestText,
          prompt: prompt,
          requestPath: result.requestPath,
          runFolder: result.folderPath,
          handoffFolder: result.handoffFolderPath,
          outputTimestamp: timestamp
        });
        store.setBusyAction(null);
        global.MacroStudioApp.showToast(
          "診断依頼とコード全文ファイルを用意しました。",
          "success");
        return result;
      }, failHost);
    }, failHost);
  }

  function completeDiagnosis(diagnosis) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var markdown = global.MacroStudioDiagnosis.formatForRecord(diagnosis);

    // The reply answers the request as it was written. If the screen no longer
    // holds the inputs that request was built from, commitDiagnosis refuses it,
    // so refuse before writing and say why. Writing first and ignoring the
    // refusal left diagnosis.md on disk, "取り込みました" on screen, and [次へ]
    // disabled with nothing to read and nothing to fix.
    if (store.isDiagnosisRequestDirty()) {
      store.noteIntakeFailure("diagnose");
      store.setIntakeError("diagnose", {
        code: "E-DIAG-01",
        reason: "requestDirty",
        message: "依頼文を作ったあとで入力が変わっているため、" +
          "この回答は取り込めません。",
        detail: "［依頼を作り直す］で依頼文を作り直し、" +
          "その依頼への回答を取り込んでください。"
      });
      global.MacroStudioApp.showToast(
        "依頼文を作ったあとで入力が変わっているため、この回答は取り込めません。" +
          "［依頼を作り直す］で依頼文を作り直し、その依頼への回答を取り込んでください。",
        "error");
      return Promise.resolve(null);
    }

    store.setBusyAction("writeDiagnosisFile");
    return global.hostBridge.request("writeDiagnosisFile", {
      outputTimestamp: state.outputTimestamp,
      markdown: markdown
    }).then(function (result) {
      if (!store.commitDiagnosis(diagnosis, result.path)) {
        store.setBusyAction(null);
        store.noteIntakeFailure("diagnose");
        store.setIntakeError("diagnose", {
          code: "E-DIAG-01",
          reason: "notCurrent",
          message: "AIの回答を取り込めませんでした。",
          detail: "いま画面にある依頼への回答か確認してください。"
        });
        global.MacroStudioApp.showToast(
          "AIの回答を取り込めませんでした。この依頼への回答か確認してください。",
          "error");
        return null;
      }
      store.clearIntakeFailures("diagnose");
      store.setBusyAction(null);
      global.MacroStudioApp.showToast("AIの回答を取り込みました。", "success");
      return diagnosis;
    }, failHost);
  }

  function applyDiagnosisText(text) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var selected = diagnosisPreset(state);
    // Which sections and which shape to expect are the template's
    // answer, so the reply is checked against what was actually asked.
    var options = {
      requestId: state.diagnosisRequestId,
      shape: selected ? selected.entry.shape : null,
      sections: selected ? selected.entry.returnSections : null,
      modules: state.modules,
      environment: state.targetEnvironment
    };
    var parsed;
    var added;

    if (state.busyAction || !state.diagnosisRequestId) {
      return Promise.resolve(null);
    }
    parsed = state.diagnosisSplit
      ? global.MacroStudioDiagnosis.parsePart(text, options)
      : global.MacroStudioDiagnosis.parse(text, options);
    if (!parsed.ok) {
      return Promise.resolve(handleIntakeFailure(
        "diagnose",
        "AIの回答を取り込めませんでした。" + String(parsed.message || ""),
        parsed));
    }
    // A reply whose line breaks the chat folded away is importable, but
    // the reader is told it was rebuilt rather than left to assume the
    // chat answered in the requested form.
    if (parsed.recovered === true) {
      global.MacroStudioApp.showToast(
        "返答の改行が失われていたため、区切り行から組み直して取り込みました。" +
          "次からは依頼文どおり、コードブロックのまま貼り付けてください。",
        "info");
    }
    if (!state.diagnosisSplit) {
      return completeDiagnosis(parsed.diagnosis);
    }
    added = global.MacroStudioDiagnosis.addPart(
      state.diagnosisParts || global.MacroStudioDiagnosis.createPartCollection(),
      parsed);
    if (!added.ok) {
      return Promise.resolve(handleIntakeFailure(
        "diagnose",
        "AIの回答を取り込めませんでした。" +
          String(added.message || "届いた番号を確認してください。"),
        added));
    }
    store.clearIntakeFailures("diagnose");
    store.setDiagnosisParts(added.collection);
    if (!added.complete) {
      global.MacroStudioApp.showToast(
        "診断結果の一部を取り込みました。あと " +
          added.missing.map(function (value) { return value + 1; }).join("、") +
          " 番が必要です。",
        "info");
      return Promise.resolve(added);
    }
    return completeDiagnosis(added.diagnosis);
  }

  function importDiagnosisFromClipboard() {
    if (global.MacroStudioState.getState().busyAction) {
      return Promise.resolve(null);
    }
    global.MacroStudioState.setBusyAction("readDiagnosisClipboard");
    return global.hostBridge.request("readClipboard").then(function (result) {
      global.MacroStudioState.setBusyAction(null);
      return applyDiagnosisText(result && result.text || "");
    }, failHost);
  }

  // How far the code may change. The choice belongs to the same screen as
  // the work itself, and switching it makes a request written under the
  // old answer stale - both because the request text carries the scope
  // and because the intake enforces it.
  function selectChangeScope(file) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var chosen = null;

    if (!file || state.busyAction) {
      return false;
    }
    scopePresets(state).some(function (entry) {
      if (entry.file === file) {
        chosen = entry;
        return true;
      }
      return false;
    });
    if (!chosen || !chosen.valid) {
      return false;
    }
    return store.setChangeScope(chosen);
  }

  function selectRepairPreset(file) {
    var store = global.MacroStudioState;
    var state = store.getState();
    if (!file || state.busyAction) {
      return Promise.resolve(null);
    }
    store.setBusyAction("readRepairPreset");
    return global.hostBridge.request("readPreset", {file: file}).then(
      function (result) {
        var parsed = global.MacroStudioPreset.parse(result.content, "repair");
        var changed;
        if (!parsed.valid) {
          return failHost({
            code: "E-PRESET-01",
            message: parsed.message,
            data: {userMessage: file + " を読み取れませんでした。" + parsed.message}
          });
        }
        changed = store.setRepairPreset({
          file: file,
          name: parsed.name,
          content: result.content,
          parsed: parsed
        });
        // The templates said what to look for; the app looks, and
        // nothing in the app decides what a candidate is. The rules of
        // every chosen template are applied together, so ticking a
        // second template does not drop the first one's candidates.
        detectFromChosenRules(changed);
        store.setBusyAction(null);
        global.MacroStudioApp.showToast(parsed.name + " を選びました。", "success");
        return result;
      },
      failHost);
  }

  function syncSelectedPreset(state) {
    var raw = null;
    var parsed;
    if (!state.presetFile) {
      return false;
    }
    repairPresets(state).some(function (entry) {
      if (entry.file === state.presetFile) {
        raw = entry;
        return true;
      }
      return false;
    });
    if (!raw || raw.content === state.presetContent) {
      return false;
    }
    parsed = global.MacroStudioPreset.parse(raw.content, "repair");
    if (!parsed.valid) {
      return false;
    }
    var changed = global.MacroStudioState.setRepairPreset({
      file: raw.file,
      name: parsed.name,
      content: raw.content,
      parsed: parsed
    });
    detectFromChosenRules(changed);
    return true;
  }

  // Candidates come from the rules of everything chosen, read out of the
  // workbook as it was attached. Choosing another template re-reads them
  // rather than leaving the table empty.
  function detectFromChosenRules(changed) {
    var store = global.MacroStudioState;
    var rules = store.getState().presetReplaceRules;
    var basis;

    if (!rules) {
      return false;
    }
    if (!changed && global.MacroStudioPathMap.isProductResult(
      store.getState().pathMap)) {
      return false;
    }
    basis = store.getBookModules();
    store.setPathMap(
      global.MacroStudioPathMap.detect(basis, rules),
      basis);
    return true;
  }

  function prepareRepairRequest() {
    var store = global.MacroStudioState;
    var state = store.getState();
    var parsed;
    var requestId;
    var requestText;
    var diagnosisText;
    var selectedText;
    var outputRules;
    var timestamp;

    if (state.busyAction || state.presetEngine !== "AI" ||
        !global.MacroStudioScreens.isRepairInputReady(state)) {
      return Promise.resolve(null);
    }
    // Walking back to look at something and walking forward again is not
    // a new request. The diagnosis side has always had this gate; without
    // it here, a round trip minted a new id and the answer that had
    // already come back stopped belonging to it (SPEC 2.6: only a change
    // of input invalidates).
    //
    // A reply that ended the exchange without a package is the exception.
    // "I need a decision" and "nothing to change" are answers; coming
    // back through screen 4 after one of them is a fresh ask, and the
    // question that was quoted back has to stop being current (SPEC 5.4.1).
    if (state.repairRequestId &&
        !global.MacroStudioScreens.isNoChange(state) &&
        state.repairRequestSnapshot === state.repairInputSnapshot) {
      store.goNext();
      return Promise.resolve(null);
    }
    parsed = global.MacroStudioPreset.parse(state.presetContent, "repair");
    if (!parsed.valid) {
      return Promise.resolve(null);
    }
    requestId = createIdentity();
    // The run folder was named by the diagnosis request and this reuses
    // it. The fallback stays because a repair request must never write
    // into nowhere, whatever order a future stage arrives in.
    timestamp = state.outputTimestamp ||
      global.MacroStudioApp.createOutputTimestamp(new Date());
    requestText = composeRepairRequestText(parsed, state, requestId);
    diagnosisText = formatDiagnosisForPrompt(state.diagnosis);
    selectedText = formatSelectedFindings(state);
    outputRules = state.splitOutput && parsed.splitOutput
      ? parsed.splitOutput
      : parsed.output;
    outputRules = {
      title: outputRules.title,
      body: fillRequestId(outputRules.body, requestId)
    };
    store.setBusyAction("prepareRepairRequest");
    return global.hostBridge.request("readRequestTemplate", {
      name: "repair-template"
    }).then(function (templateResult) {
      var prompt;
      try {
        prompt = fillRequestId(global.MacroStudioPrompt.buildRequestPrompt({
          template: templateResult.content,
          requestText: requestText,
          outputRules: outputRules,
          requestId: requestId,
          book: state.book,
          modules: state.modules,
          codeFileName: AI_CODE_FILE,
          targetEnvironment: state.targetEnvironmentSnapshot,
          changeScope: changeScopeText(state),
          diagnosis: diagnosisText,
          selectedFindings: selectedText
        }), requestId);
      } catch (error) {
        return failHost({code: "E-GEN-02", message: error.message});
      }
      return global.hostBridge.request("writeRequestFiles", {
        stage: "repair",
        outputTimestamp: timestamp,
        request: prompt,
        // The workbook as it was read. The host keeps the first one a
        // run writes and never replaces it, so this is the copy the
        // diagnosis already recorded.
        code: global.MacroStudioPrompt.buildCodeFile({
          book: state.book,
          modules: state.modules,
          generatedAt: global.MacroStudioApp.createCodeFileTimestamp(new Date())
        }),
        // What the chat is given for this stage. On the route that
        // replaced fixed paths first, this is the code the machine
        // already rewrote; source-code.md keeps the workbook as read.
        aiCode: composeAiCodeFile(state)
      }).then(function (result) {
        // Whatever a chat sent back answered the request that existed
        // before this one. Dropping it is correct, but it is not
        // something to do without saying so. What the tool replaced
        // itself is not a chat answer and is not dropped, so a run that
        // only did the replacement has nothing to announce.
        var previous = store.getState();
        var replaced = global.MacroStudioScreens.countImported(previous) > 0 &&
          (Boolean(previous.repairIntakeRequestId) ||
            Boolean(previous.noChangeResult));
        store.commitRepairRequest({
          requestId: requestId,
          requestText: requestText,
          prompt: prompt,
          requestPath: result.requestPath,
          runFolder: result.folderPath,
          handoffFolder: result.handoffFolderPath,
          outputTimestamp: timestamp
        });
        store.setBusyAction(null);
        if (replaced) {
          global.MacroStudioApp.showToast(
            "改修する内容が変わったので、新しい依頼文を作りました。" +
              "前の回答はこの依頼の答えではないため、取り込み直します。",
            "info");
          writeLog(
            "INFO",
            "repair request re-minted after input change; previous intake dropped");
        }
        store.goNext();
        return result;
      }, failHost);
    }, failHost);
  }

  // Whether this run may add modules, and under which scope name. Both
  // are read off files: the scope template's own 構造変更 word, and the
  // 認める構造変更 of whatever repair templates the reader ticked. An
  // operation that needs a module to put a wrapper in says so in its own
  // file; nothing here knows which operations those are.
  function structureOptions(state) {
    var screens = global.MacroStudioScreens;
    var scope = state.changeScope;

    if (!screens.isStructureForbidden(state)) {
      return null;
    }
    return {
      scopeName: scope ? String(scope.name || "") : "",
      allowNewModules: (state.presets || []).some(function (entry) {
        var allowed = entry.parsed && entry.parsed.allowedStructures
          ? entry.parsed.allowedStructures
          : [];

        return allowed.indexOf("モジュール追加") >= 0;
      })
    };
  }

  // The scope guard runs on the whole package, after the wire contract
  // passed and before anything is imported. A reply that trips it is
  // refused outright: nothing is half-applied, and the reason names what
  // was found so the reader can either fix the request or allow the
  // change deliberately.
  function guardStructure(state, described) {
    var options = structureOptions(state);

    if (!options) {
      return described;
    }
    return global.MacroStudioResponse.checkStructure(
      described,
      state.modules,
      options);
  }

  function applyWholeRepairPackage(parsed) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var described = guardStructure(state, global.MacroStudioResponse.describe(
      parsed,
      state.modules,
      state.diagnosis));

    if (!described.ok) {
      return showRepairIntakeError(described.message, described);
    }
    store.setLastError(null);
    if (described.noChange) {
      store.setNoChangeResult(described);
      global.MacroStudioApp.showToast(
        "AIは改修できないと回答しました。理由を確認してください。",
        "info");
      return true;
    }
    store.importPackage(described);
    store.clearIntakeFailures("repair");
    // One sentence, and only the affirmative one. What came in and what
    // to do about it are the next screen's job, not this notice's.
    global.MacroStudioApp.showToast("AIの回答を取り込みました。", "success");
    return true;
  }

  // One sentence that says the reply was not taken in, then the reason
  // the contract gave. Nothing here reads as a partial success.
  function showRepairIntakeError(message, detail) {
    var reason = String(message || "");
    var text = "AIの回答を取り込めませんでした。" + reason;

    global.MacroStudioState.setLastError({
      code: "E-INTAKE-01",
      message: text
    });
    handleIntakeFailure("repair", text, detail);
    return false;
  }

  function applyRepairText(text) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var parsed;
    var added;
    var merged;

    if (state.busyAction || !state.repairRequestId) {
      return false;
    }
    parsed = global.MacroStudioResponse.parse(text, state.repairRequestId);
    if (!parsed.ok) {
      return showRepairIntakeError(parsed.message, parsed);
    }
    if (!state.splitOutput) {
      if (parsed.part) {
        return showRepairIntakeError(
          global.MacroStudioResponse.messages.partUnexpected,
          {reason: "partUnexpected"});
      }
      return applyWholeRepairPackage(parsed);
    }
    // A refusal is one complete answer even when module-by-module output
    // was requested. It never has PART.
    if (parsed.noChange) {
      return applyWholeRepairPackage(parsed);
    }
    added = global.MacroStudioResponse.addPart(
      state.repairIntakeParts ||
        global.MacroStudioResponse.createPartCollection(),
      parsed);
    if (!added.ok) {
      return showRepairIntakeError(added.message, added);
    }
    store.setRepairIntakeParts(added.collection);
    if (!added.complete) {
      global.MacroStudioApp.showToast(
        global.MacroStudioResponse.describeMissingParts(added.collection),
        "info");
      return true;
    }
    merged = global.MacroStudioResponse.mergeParts(added.collection);
    return applyWholeRepairPackage(merged);
  }

  function restartRepairIntake() {
    var store = global.MacroStudioState;
    if (store.getState().busyAction) {
      return false;
    }
    store.discardImportedModules();
    store.setLastError(null);
    global.MacroStudioApp.showToast(
      "改修結果の取り込みを最初からやり直します。",
      "info");
    return true;
  }

  function importRepairFromClipboard() {
    if (global.MacroStudioState.getState().busyAction) {
      return Promise.resolve(null);
    }
    global.MacroStudioState.setBusyAction("readRepairClipboard");
    return global.hostBridge.request("readClipboard").then(function (result) {
      global.MacroStudioState.setBusyAction(null);
      return applyRepairText(result && result.text || "");
    }, failHost);
  }

  function copyStagePrompt(stage) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var diagnosis = stage === "diagnose";
    var prompt = diagnosis ? state.diagnosisPrompt : state.repairPrompt;
    if (!prompt || state.busyAction) {
      return Promise.resolve(null);
    }
    store.setBusyAction("copyPrompt");
    return global.hostBridge.request("writeClipboard", {text: prompt}).then(
      function (result) {
        if (diagnosis) {
          store.setDiagnosisHandoffProgress(true, null);
        } else {
          store.setRepairHandoffProgress(true, null);
        }
        store.setBusyAction(null);
        global.MacroStudioApp.showToast("依頼文をコピーしました。", "success");
        return result;
      },
      function (error) {
        return failHost(error, {
          name: "retry-copy-request",
          label: "もう一度コピー"
        });
      });
  }

  function retryCopyPrompt() {
    var state = global.MacroStudioState.getState();
    if (state.screen === global.MacroStudioScreens.diagnoseScreen) {
      return copyStagePrompt("diagnose");
    }
    if (state.screen === global.MacroStudioScreens.repairScreen) {
      return copyStagePrompt("repair");
    }
    return false;
  }

  // The folder this opens is the one holding the file to attach, not
  // the one holding the deliverables. The button says "the file to give
  // the AI", so it has to land where that file is.
  function openRunFolder(stage) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var folder = state.handoffFolder || state.runFolder;
    if (!folder || state.busyAction) {
      return Promise.resolve(null);
    }
    store.setBusyAction("openRunFolder");
    return global.hostBridge.request("revealPath", {path: folder})
      .then(function (result) {
        if (stage === "diagnose") {
          store.setDiagnosisHandoffProgress(null, true);
        } else {
          store.setRepairHandoffProgress(null, true);
        }
        store.setBusyAction(null);
        return result;
      }, failHost);
  }

  // β1 keeps this screen in the narrow column. A drop target as wide as
  // the window reads as a page background, not as something to drop on.
  function createBookScreen(state) {
    var root = task(false);
    var loaded;
    var details;
    var moduleList;
    var read;

    root.appendChild(intro(state.book
      ? "対象ブックと読み取り結果を確認してください。"
      : "対象のブックを、ここへドラッグするか選んでください。"));
    if (global.MacroStudioApp.isBlockingAttachError(state.lastError)) {
      root.appendChild(global.MacroStudioApp.createAttachErrorCard(
        state.lastError,
        state.book));
    }
    if (!state.book) {
      var zone = element("button", "drop-zone");
      zone.type = "button";
      zone.setAttribute("data-action", "pick-book");
      zone.disabled = state.busyAction !== null;
      zone.appendChild(icon("drop", "drop-icon"));
      zone.appendChild(element(
        "h2",
        "",
        state.busyAction === "attachBook"
          ? "読み込んでいます"
          : "Excelブックをここにドロップ"));
      zone.appendChild(element("p", "", "またはクリックしてファイルを選ぶ"));
      root.appendChild(zone);
      return root;
    }
    loaded = element("div", "loaded-zone");
    details = element("div", "loaded-zone-details");
    details.appendChild(element("h2", "", state.book.name));
    details.appendChild(element("p", "loaded-zone-path", state.book.path));
    loaded.appendChild(icon("drop", "drop-icon"));
    loaded.appendChild(details);
    var replace = actionButton("選び直す", "pick-book", false);
    replace.className += " button--compact";
    replace.disabled = state.busyAction !== null;
    loaded.appendChild(replace);
    root.appendChild(loaded);

    read = element("div", "read-detail");
    read.appendChild(element(
      "p",
      "read-summary",
      state.modules.length + "モジュール・" + state.book.totalLines +
        "行を読み込みました。"));
    if (state.book.read) {
      read.appendChild(element(
        "p",
        state.book.read.level === "sourceDoubt"
          ? "headline-warning"
          : "headline-note",
        state.book.read.headline + state.book.read.detail));
    }
    // A signed workbook is the one case where finishing the run costs
    moduleList = element("ul", "read-module-list");
    state.modules.forEach(function (module) {
      moduleList.appendChild(element(
        "li",
        "read-module-item",
        module.name + " — " + module.lineCount + " 行"));
    });
    read.appendChild(moduleList);
    // Three rows, side by side, one tier deep. What was read out of the
    // code, what the workbook carries besides code, and what this
    // terminal is - three different questions, so three rows, and none
    // of them opens onto another row to open.
    root.appendChild(createDisclosure(
      "book-read-result",
      "読み取ったコード",
      read,
      false,
      state.modules.length + " モジュール・" + state.book.totalLines + " 行"));
    appendOutsideCode(root, state);
    // A signed workbook is the one case where finishing this run costs
    // the reader something they have to arrange elsewhere: the output
    // cannot carry the signature, because the signature signs the code
    // this run is about to rewrite.
    //
    // It sits out here rather than inside "コードの外にあるもの", where
    // the fact is also listed. That list starts closed, and a closed
    // list is not a warning - the first version of this went in there
    // and the real screen showed nothing at all.
    if (state.bookInventory &&
        state.bookInventory.hasVbaSignature === true) {
      root.appendChild(element(
        "p",
        "signature-warning",
        "このブックの VBA プロジェクトにはコード署名が付いています。" +
          "コードを書き換えると署名は内容と一致しなくなるため、" +
          "改修済みブックからは署名を外します。" +
          "配布する前に署名し直してください。"));
    }
    return root;
  }

  // What the workbook carries that is not VBA.
  //
  // A row has to earn its place. The reader is one press from the
  // diagnosis and will ask "so what do I do?", so each row says what was
  // found and why it matters somewhere else. What to do about it is
  // answered once, underneath, for all of them: nothing, here.
  // The wording of each fact belongs to handover.js; this lays them out.
  // Nothing is coloured as a warning: having a reference is not a fault.
  function appendOutsideCode(root, state) {
    var facts = global.MacroStudioHandover
      ? global.MacroStudioHandover.outsideCodeFacts(state)
      : [];
    var body = element("div", "outside-code");
    var rows = element("ul", "outside-code-list");

    if (facts.length === 0) {
      return root;
    }
    facts.forEach(function (fact) {
      var row = element("li", "outside-code-item");

      row.appendChild(element(
        "span",
        "outside-code-fact",
        fact.label + ": " + fact.value));
      if (fact.why) {
        row.appendChild(element("span", "outside-code-why", fact.why));
      }
      rows.appendChild(row);
    });
    body.appendChild(rows);
    body.appendChild(element(
      "p",
      "task-note",
      "どれも VBA のコードの外にあるので、このツールは直しません。" +
        "次の診断の依頼文へ自動で入れて、AIの判断材料にします。" +
        "ここで操作することはありません。"));
    root.appendChild(createDisclosure(
      "book-outside-code",
      "コードの外にあるもの",
      body,
      false,
      facts.length + " 件・" + facts.slice(0, 3).map(function (fact) {
        return fact.label;
      }).join("・")));
    return root;
  }

  function environmentChip(state) {
    var profile = state.targetEnvironment;
    return profile
      ? profile.displayName + "（" + profile.revision + " 版）"
      : "想定動作環境を読み込み中";
  }

  function createHandoffActions(state, stage) {
    var actions = element("div", "handoff-actions");
    var diagnosis = stage === "diagnose";
    var copied = diagnosis
      ? Boolean(state.diagnosisPromptCopied)
      : Boolean(state.repairPromptCopied);
    var copy = actionButton(
      copied ? "依頼文をコピー済み" : "依頼文をコピー",
      diagnosis ? "copy-diagnosis-prompt" : "copy-repair-prompt",
      !copied);
    var open = actionButton(
      diagnosis && state.diagnosisFolderOpened ||
        !diagnosis && state.repairFolderOpened
        ? "ファイルの場所を開きました"
        : "ファイルの場所を開く",
      diagnosis ? "open-diagnosis-folder" : "open-repair-folder",
      false);
    copy.disabled = state.busyAction !== null;
    open.disabled = state.busyAction !== null;
    actions.appendChild(copy);
    actions.appendChild(open);
    return actions;
  }

  // The chat is given the code and the assumed environment. Anything
  // else the reader happens to have - the specification the macro was
  // written from, a screenshot of the error, the sheet it reads - is
  // theirs to add, and it is worth saying so, because a chat that has
  // seen them writes a better diagnosis. The templates say the same
  // thing to the AI, so the offer and the instruction agree.
  function attachmentHint() {
    return element(
      "p",
      "attachment-hint",
      "仕様書、手順書、エラーの画面など、参考になる資料が手元にあれば" +
        "いっしょに添付してください。AIはそれも踏まえて答えます。");
  }

  // What the reader has to know to hand the request over, and nothing
  // else. The environment the diagnosis assumes, the extra concern and
  // the long-reply switch are all optional reading, so they fold away
  // under labels that say what they open.
  function createDiagnoseScreen(state) {
    var root = task(true);
    var concern = element("textarea", "form-textarea");
    var optional = element("div", "optional-details");
    var environment = element("div", "environment-detail");
    var concernBox = element("div", "concern-detail");

    // The header above already says what this screen is for, and the two
    // numbered steps say what to do. An opening line that repeated both
    // was a third copy of the same sentence.
    root.appendChild(element("h2", "task-step", "1. 依頼をAIへ渡す"));
    if (state.diagnosisRequestId) {
      root.appendChild(element(
        "p",
        "task-note",
        "依頼文をコピーして貼り付け、開いたフォルダの " + AI_CODE_FILE + " を" +
          "添付します。"));
      root.appendChild(attachmentHint());
      root.appendChild(createHandoffActions(state, "diagnose"));
    } else if (state.busyAction) {
      root.appendChild(element("p", "inline-status", "診断依頼を作成しています…"));
    }

    appendDiagnoseIntake(root, state);

    // ---- everything below is optional reading ----
    // What the AI is actually being told, word for word. Showing a
    // shorter version here would mean the screen and the request disagree
    // about what this diagnosis assumes.
    if (state.targetEnvironmentSnapshot) {
      environment.appendChild(sourceBlock(state.targetEnvironmentSnapshot));
    }
    optional.appendChild(createDisclosure(
      "diagnose-environment",
      "この診断が前提にしている環境",
      environment,
      false,
      environmentChip(state)));

    concern.id = "diagnosis-concern";
    concern.rows = 3;
    concern.value = state.diagnosisConcern;
    concern.disabled = state.busyAction !== null;
    concern.setAttribute("data-workflow-input", "diagnosis-concern");
    concernBox.appendChild(concern);
    if (state.diagnosisRequestId &&
        global.MacroStudioState.isDiagnosisRequestDirty()) {
      var rebuild = actionButton(
        "依頼を作り直す",
        "rebuild-diagnosis-request",
        false);
      rebuild.disabled = state.busyAction !== null;
      concernBox.appendChild(actionRow(rebuild));
    }
    optional.appendChild(createDisclosure(
      "diagnose-concern",
      "気になっていることを書き足す",
      concernBox,
      global.MacroStudioState.isDiagnosisRequestDirty() === true,
      state.diagnosisConcern ? "記入あり" : "任意",
      true));

    root.appendChild(optional);
    return root;
  }

  // Why the last paste was refused, written on the screen and left there
  // until one is taken in.
  //
  // The contract has always known which check failed; only the log was
  // told. The reader saw "取り込めませんでした" and nothing else, so the
  // same reply went round again - which is the single most frustrating
  // thing this tool does. The check number is printed too: it is the
  // thing to quote when reporting that a chat cannot be made to comply.
  function appendIntakeError(root, state, stage) {
    var error = state.intakeError ? state.intakeError[stage] : null;
    var box;
    var steps;

    if (!error) {
      return root;
    }
    box = element("div", "intake-error");
    box.setAttribute("role", "alert");
    box.appendChild(element(
      "h3",
      "intake-error-title",
      "この返答は取り込めませんでした"));
    if (error.detail) {
      box.appendChild(element("p", "intake-error-detail", error.detail));
    }
    if (error.message) {
      box.appendChild(element("p", "intake-error-message", error.message));
    }
    steps = element("ul", "intake-error-steps");
    [
      "AIの返答のコードブロックを、先頭から末尾まで全部コピーし直す",
      "うまくいかないときは、依頼文をもう一度そのまま渡してやり直す",
      "それでも同じなら、同じ依頼文を別のAIへ渡す"
    ].forEach(function (text) {
      steps.appendChild(element("li", "", text));
    });
    box.appendChild(steps);
    box.appendChild(element(
      "p",
      "intake-error-check",
      "検査番号 " + (error.validationId || "-") +
        "／" + error.count + " 回目"));
    root.appendChild(box);
    return root;
  }

  // The second half of the same screen: what comes back from the chat.
  function appendDiagnoseIntake(root, state) {
    var button;

    root.appendChild(element("h2", "task-step", "2. 返答を取り込む"));
    root.appendChild(element(
      "p",
      "task-note",
      "AIの返答にあるコードブロック全体をコピーして、下のボタンを押します。"));
    appendIntakeError(root, state, "diagnose");
    // The same feedback as the hand-off buttons above: the control says
    // what it did. A second line underneath, naming a file the reader
    // never asked about, is one message too many.
    //
    // One filled button at a time. Until the request has gone out there
    // is nothing to bring back, so this is the quieter of the two; once
    // it has, this becomes the action and the copy above steps down.
    // After the reply is in, neither is: [次へ] is.
    button = actionButton(
      state.diagnosis
        ? "AIの回答を取り込みました"
        : "クリップボードから診断結果を取り込む",
      "import-diagnosis",
      Boolean(state.diagnosisPromptCopied) && !state.diagnosis);
    button.disabled = state.busyAction !== null;
    root.appendChild(actionRow(button));
    return root;
  }

  // The three things the finding says about itself. Where it is was
  // printed twice - once at the head of the row and once here under
  // 該当箇所 - and so was the environment constraint, whose title is
  // already the name of the group this row sits in. Both copies are
  // gone; the key stays, because that is the part nothing else carries.
  function createFindingDetails(state, finding) {
    var detail = element("div", "finding-detail");
    var evidence = element("div", "finding-detail-block");

    detail.appendChild(element("p", "finding-condition",
      "成立条件: " + finding.texts.condition));
    detail.appendChild(element("p", "finding-impact",
      "影響: " + finding.texts.impact));
    evidence.appendChild(element("strong", "", "根拠"));
    evidence.appendChild(element("p", "", finding.texts.evidence));
    detail.appendChild(evidence);
    if (finding.environmentKey !== "-") {
      detail.appendChild(element(
        "p",
        "finding-environment",
        "環境キー: " + finding.environmentKey));
    }
    var notMeasured = notMeasuredNote(state, finding);
    if (notMeasured) {
      detail.appendChild(element("p", "finding-unmeasured", notMeasured));
    }
    return detail;
  }

  // One occurrence of a grouped problem: where it is and why it counts.
  // Flat, not a second thing to open. One accordion opens onto a box and
  // the box scrolls; two tiers of accordion is a maze.
  //
  // The code is the exception. "lines 42-47 of MonthlyReport" tells the
  // reader where to look without showing them anything, and the module
  // is already on this machine, so it opens here in the same block the
  // replacement table uses.
  function createOccurrenceRow(state, finding) {
    var row = element("div", "occurrence-row");
    var head = element("div", "occurrence-head");
    var module = finding.module === "-"
      ? null
      : findModule(state, finding.module);
    var hits = findingLines(finding);
    var key;

    head.appendChild(element("code", "occurrence-location",
      formatLocation(finding)));
    head.appendChild(element("span", "confidence-chip",
      CONFIDENCE_LABELS[finding.confidence]));
    row.appendChild(head);
    row.appendChild(createFindingDetails(state, finding));
    if (module && global.MacroStudioCodeView) {
      key = "finding-code-" + finding.number;
      row.appendChild(createDisclosure(
        key,
        "このコードを見る（" + finding.module + "）",
        function () {
          return global.MacroStudioCodeView.create({
            key: key,
            note: hits.length > 0 ? "指摘の該当行" : "モジュール全体",
            matchesOnly: hits.length > 0,
            highlight: true,
            modules: [{
              name: finding.module,
              code: String(module.code || ""),
              hits: hits
            }]
          });
        },
        false,
        hits.length > 0 ? finding.lines + " 行目" : ""));
    }
    return row;
  }

  // The middle tier: one row per problem, closed, carrying how many
  // places it was found in. Opening it lists those places.
  function createGroupRow(state, group, prefix) {
    var key = prefix + "-group-" + (group.key || "none");
    var open = disclosureState[key] === true;
    var row = element("div", "group-row" + (open ? " is-open" : ""));
    var button = element("button", "group-toggle");
    var panel = element("div", "group-panel");
    var id = "group-panel-" + prefix + "-" + (group.key || "none");

    button.type = "button";
    button.setAttribute("data-action", "toggle-finding");
    button.setAttribute("data-finding-key", key);
    button.setAttribute("data-finding-toggle", "true");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-controls", id);
    button.appendChild(icon("chevron", "flow-icon--small disclosure-chevron"));
    button.appendChild(element("span", "grade-chip grade-chip--" +
      group.grade.toLowerCase(), group.grade));
    button.appendChild(element("span", "group-title", group.title));
    button.appendChild(element("span", "group-count",
      "該当 " + group.findings.length + " か所"));
    row.setAttribute("data-grade", group.grade);
    panel.id = id;
    panel.hidden = !open;
    group.findings.forEach(function (finding) {
      panel.appendChild(createOccurrenceRow(state, finding));
    });
    row.appendChild(button);
    row.appendChild(panel);
    return row;
  }

  // One block per grade: the letter, what it means in a sentence, then
  // the problems that carry it. Worst first, so a workbook that cannot
  // be made to run is read before a list of things that can be fixed.
  function createGradeSection(state, bucket, prefix) {
    var box = element("div", "grade-block grade-block--" +
      bucket.grade.toLowerCase());
    var head = element("div", "grade-head");
    var list = element("div", "findings-list findings-list--result");

    head.appendChild(element(
      "span",
      "grade-badge grade-badge--" + bucket.grade.toLowerCase(),
      bucket.grade));
    head.appendChild(element("h2", "grade-title", bucket.label));
    head.appendChild(element(
      "span",
      "grade-count",
      bucket.groups.length + " 件"));
    box.appendChild(head);
    box.appendChild(element("p", "grade-note", bucket.note));
    bucket.groups.forEach(function (group) {
      list.appendChild(createGroupRow(state, group, prefix));
    });
    box.appendChild(list);
    return box;
  }

  var NO_FINDING_NOTES = {
    SCOPE_CLEAR: "診断の範囲は確認できた、というのがAIの結論です。",
    INSUFFICIENT: "判断材料が足りず、確認しきれなかったとAIは言っています。" +
      "気になる点を書き足して、もう一度診断を依頼できます。"
  };

  // The conclusion above already said there was nothing. What is left to
  // say is which of the two zeros this is: the diagnosis covered its
  // ground, or it ran out of material. Repeating the first sentence here
  // would be the same line twice on one screen.
  function createEmptyFindings(state) {
    var reason = state.diagnosis ? state.diagnosis.noFinding : null;
    var box;

    if (!reason || !NO_FINDING_NOTES[reason]) {
      return null;
    }
    box = element("div", "findings-empty-box");
    box.appendChild(element(
      "p",
      "findings-empty",
      NO_FINDING_NOTES[reason]));
    return box;
  }

  // A template is recommended only when the accepted diagnosis names an
  // environment constraint the template declares it addresses. No finding
  // with that key, no star: a recommendation the reader cannot trace back
  // to the diagnosis is a guess wearing a badge.
  function recommendedBy(state, entry) {
    var keys = entry && Array.isArray(entry.recommendKeys)
      ? entry.recommendKeys
      : [];

    if (keys.length === 0) {
      return [];
    }
    return sortedFindings(state.diagnosis).filter(function (finding) {
      return finding.environmentKey !== "-" &&
        keys.indexOf(finding.environmentKey) >= 0;
    });
  }

  function createPresetCard(state, entry) {
    var card;

    if (!entry.valid) {
      return element(
        "p",
        "preset-invalid-item",
        entry.file + " — " + entry.message);
    }
    {
      // More than one may be chosen, so the card carries a checkbox and
      // looks like one. A card that only changed colour when pressed did
      // not say that a second one could be pressed too.
      //
      // Four columns, and each holds what it was sized for: the box, the
      // icon, the words, the mark. The mark column is sized to its own
      // text - putting a label in a column sized for an icon is what
      // pushed 推奨 off the edge.
      var selected = (state.presetFiles || []).indexOf(entry.file) >= 0;
      var body = element("span", "choice-body");
      var mark = element("span", "choice-state");
      var box = element("span", "option-checkbox choice-checkbox");
      var basis = recommendedBy(state, entry);

      card = element("button", "choice-card");
      card.type = "button";
      card.setAttribute("data-action", "select-repair-preset");
      card.setAttribute("data-preset-file", entry.file);
      card.setAttribute("role", "checkbox");
      card.setAttribute("aria-checked", selected ? "true" : "false");
      if (selected) {
        card.classList.add("is-selected");
      }
      card.disabled = state.busyAction !== null;
      if (basis.length > 0) {
        card.classList.add("is-recommended");
      }
      if (selected) {
        box.appendChild(icon("check", "flow-icon--small"));
      }
      card.appendChild(box);
      card.appendChild(icon("template", "choice-icon"));
      body.appendChild(element("span", "choice-title", entry.name));
      if (entry.description) {
        body.appendChild(element("span", "choice-description", entry.description));
      }
      card.appendChild(body);
      // The mark says only that the diagnosis points here. The reasons
      // are the page before.
      if (basis.length > 0) {
        mark.appendChild(element("span", "choice-recommended", "★ 推奨"));
      }
      card.appendChild(mark);
      return card;
    }
  }

  // The operations, drawn under the headings the files declare. Grouping
  // is display only: each card is still its own template, still ticked
  // one at a time, and still reaches the request as its own instruction
  // under its own name. Two operations sharing a heading never become one
  // instruction - what the reader sees as one row of work stays two
  // traceable items in the request, the diff and the run manifest.
  function createPresetCards(state) {
    var root = element("div", "category-list");
    var entries = repairPresets(state);
    var categories = repairCategories(state);
    var placed = {};

    categories.forEach(function (name) {
      var group = element("div", "category-group");
      var cards = element("div", "choice-list");

      group.appendChild(element("h3", "category-heading", name));
      entries.forEach(function (entry) {
        if (!entry.valid || entry.category !== name) {
          return;
        }
        placed[entry.file] = true;
        cards.appendChild(createPresetCard(state, entry));
      });
      group.appendChild(cards);
      root.appendChild(group);
    });
    // A file that could not be read has no heading to stand under, so it
    // is listed on its own rather than dropped. A card nobody can see is
    // how an editing mistake becomes invisible.
    entries.forEach(function (entry) {
      if (entry.valid && placed[entry.file]) {
        return;
      }
      root.appendChild(createPresetCard(state, entry));
    });
    return root;
  }

  // A heading for each section a diagnosis template may declare. A name
  // with no heading here is shown under its own name rather than hidden:
  // the template decides what it returns, so the app cannot refuse to
  // display something it has no word for.
  var SUMMARY_LABELS = {
    PURPOSE: "このマクロは何をするものか",
    FLOW: "どう動いているか",
    DEPENDENCY: "何に頼っているか",
    ENVIRONMENT: "対象の環境で何が起きるか",
    REASON: "そう判断した理由"
  };

  // One row that opens, drawn the same way a finding row is, so the two
  // lists on this page behave and read alike.
  function createSummaryRow(state, name) {
    var key = "summary-" + name;
    var open = disclosureState[key] === true;
    var row = element("div", "summary-row" + (open ? " is-open" : ""));
    var button = element("button", "summary-toggle");
    var panel = element("div", "summary-panel");
    var id = "summary-panel-" + name;

    button.type = "button";
    button.setAttribute("data-action", "toggle-finding");
    button.setAttribute("data-finding-key", key);
    button.setAttribute("data-finding-toggle", "true");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-controls", id);
    button.appendChild(icon("chevron", "flow-icon--small disclosure-chevron"));
    button.appendChild(element(
      "span",
      "summary-label",
      SUMMARY_LABELS[name] || name));
    panel.id = id;
    panel.hidden = !open;
    panel.appendChild(element("p", "summary-full",
      state.diagnosis.sections[name]));
    row.appendChild(button);
    row.appendChild(panel);
    return row;
  }

  function createGradeTile(bucket) {
    var tile = element(
      "div",
      "grade-tile grade-tile--" + bucket.grade.toLowerCase());

    tile.appendChild(element("span", "grade-tile-letter", bucket.grade));
    tile.appendChild(element(
      "span",
      "grade-tile-count",
      String(bucket.groups.length)));
    tile.appendChild(element("span", "grade-tile-label", bucket.label));
    return tile;
  }

  // Two lines that give the whole diagnosis, then the four letters. All
  // four are shown even at zero: the reader is asking "what do I have to
  // do", and "要改修 0" answers that question where "不具合 0" only
  // described a category.
  function createDiagnosisHeadline(state, occurrences, buckets) {
    var box = element("div", "diagnosis-conclusion");
    var tiles = element("div", "grade-tiles");
    var worst = null;

    (buckets || []).some(function (bucket) {
      if (bucket.groups.length > 0) {
        worst = bucket;
        return true;
      }
      return false;
    });
    box.setAttribute("aria-live", "polite");
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-text",
      firstSentence(state.diagnosis.sections.PURPOSE)));
    if (state.diagnosis.sections.ENVIRONMENT) {
      box.appendChild(element(
        "p",
        "diagnosis-conclusion-text",
        firstSentence(state.diagnosis.sections.ENVIRONMENT)));
    }
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-verdict",
      worst === null
        ? "対象の環境で動かなくなるところは見つかりませんでした。"
        : worst.note));
    (buckets || []).forEach(function (bucket) {
      tiles.appendChild(createGradeTile(bucket));
    });
    box.appendChild(tiles);
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-note",
      "指摘は原因ごとに1件です。該当箇所は合わせて " + occurrences + " か所。"));
    return box;
  }

  // The other kind of diagnosis: one grade for the workbook and the
  // reasoning in prose. It is a judgement, and the screen says so - the
  // macro-repair result does not, because that one is a fact.
  function createGradeResult(state) {
    var box = element("div", "diagnosis-conclusion diagnosis-conclusion--grade");
    var grade = String(state.diagnosis.grade || "");
    var head = element("div", "value-head");

    head.appendChild(element(
      "span",
      "grade-badge grade-badge--" + grade.toLowerCase(),
      grade));
    // What the run was graded on is the diagnosis template's own name,
    // which is authored in its own file. The app supplies only what the
    // letter means.
    head.appendChild(element(
      "h2",
      "value-title",
      diagnosisName(state) + "の判定は " + (VALUE_LABELS[grade] || "")));
    box.appendChild(head);
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-text",
      firstSentence(state.diagnosis.sections.PURPOSE)));
    box.appendChild(element(
      "p",
      "value-judgement",
      "これは AI の見立てです。同じコードでも AI によって変わります。"));
    return box;
  }

  function missingDiagnosis(root) {
    // Nothing reaches these screens without a diagnosis, but a renderer
    // that throws takes the whole window with it and hides whatever
    // actually went wrong. Say what is missing instead.
    root.appendChild(intro(
      "診断結果がありません。前の画面へ戻って、AIの返答を取り込んでください。"));
    return root;
  }

  // The result of the diagnosis, arranged by what it asks of the reader.
  // The conclusion is first, then one block per grade, then what the
  // diagnosis could not see, and only then the macro's own description -
  // which is background, not a decision.
  //
  // Which sections exist is the template's answer, not this file's, so
  // the summary rows are drawn from what came back.
  function createFindingsScreen(state) {
    var root = task(true);
    var summaryList = element("div", "summary-list");
    var sectionNames;
    var categories;
    var buckets;
    var empty;

    if (!state.diagnosis) {
      return missingDiagnosis(root);
    }
    sectionNames = Array.isArray(state.diagnosis.sectionNames)
      ? state.diagnosis.sectionNames
      : ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"];

    if (state.diagnosis.shape === "grade") {
      root.appendChild(createGradeResult(state));
      root.appendChild(element("h2", "task-step", "そう判断した理由"));
      root.appendChild(sourceBlock(state.diagnosis.sections.REASON || ""));
    } else {
      categories = groupFindings(state, sortedFindings(state.diagnosis));
      buckets = gradesOf(categories);
      root.appendChild(createDiagnosisHeadline(
        state,
        sortedFindings(state.diagnosis).length,
        buckets));
      if (allGroups(categories).length === 0) {
        empty = createEmptyFindings(state);
        if (empty) {
          root.appendChild(empty);
        }
      }
      buckets.forEach(function (bucket) {
        if (bucket.groups.length === 0) {
          return;
        }
        root.appendChild(createGradeSection(state, bucket, "diagnosis"));
      });
    }
    appendOutsideCodeWork(root, state);

    root.appendChild(element("h2", "task-step", "このマクロの詳細"));
    sectionNames.filter(function (name) {
      // The reasoning is already the body of the page above it.
      return name !== "REASON";
    }).forEach(function (name) {
      summaryList.appendChild(createSummaryRow(state, name));
    });
    root.appendChild(summaryList);

    root.appendChild(element(
      "p",
      "environment-note",
      "想定環境: " + environmentChip(state)));
    return root;
  }

  // A diagnosis reads code. Some of what this workbook depends on is not
  // in the code, so no diagnosis could have found it, and it changes what
  // the reader decides here. It is put in front of them once, flat, at
  // the point where the deciding happens - not held back to the end.
  function appendOutsideCodeWork(root, state) {
    var tasks = global.MacroStudioHandover
      ? global.MacroStudioHandover.humanTasks(state)
      : [];
    var box;
    var rows;

    if (tasks.length === 0) {
      return root;
    }
    box = element("div", "outside-code");
    box.appendChild(element(
      "h2",
      "task-step",
      "コードの外にあり、この診断が見ていないこと"));
    box.appendChild(element(
      "p",
      "task-note",
      "ブックから読み取った事実です。AIはコードしか見ていないので、" +
        "ここは人が決めます。"));
    rows = element("ul", "outside-code-list");
    tasks.forEach(function (item) {
      rows.appendChild(element(
        "li",
        "outside-code-item",
        item.title + " … " + item.detail));
    });
    box.appendChild(rows);
    root.appendChild(box);
    return root;
  }

  // Choosing the work. Nothing else: the diagnosis is the page before.
  // Exactly what the intake refuses while the chosen scope forbids
  // structural change - and, in the same breath, what it cannot see.
  // Listing only the first half would read as a promise the checks do not
  // make: nothing here inspects what happens inside a procedure, so a
  // rewritten body passes, and the reader has to know that before
  // trusting the box.
  var STRUCTURE_GUARD_CHECKS = [
    "読み込んだブックに無いモジュールが返ってきたら断ります" +
      "（分割・クラス化はこれに当たります）",
    "元のモジュールにあった Sub / Function / Property が" +
      "返答から消えていたら断ります",
    "別のモジュールにあった手続きが移ってきていたら断ります",
    "1つのモジュールがほぼ全面的に書き換わっていたら断ります"
  ];
  var STRUCTURE_GUARD_LIMIT =
    "機械的に検査するのはこの4つだけです。" +
    "手続きの中身の作り替え、変数の整理、コメントの書き直しは検査できません。" +
    "検査していないものを「検査した」とは表示しません。";

  function createStructureGuardNote() {
    var box = element("div", "scope-guard");
    var list = element("ul", "scope-guard-list");

    box.appendChild(element(
      "p",
      "task-note",
      "この設定のあいだ、取り込みで次を検査します。"));
    STRUCTURE_GUARD_CHECKS.forEach(function (line) {
      list.appendChild(element("li", "scope-guard-item", line));
    });
    box.appendChild(list);
    box.appendChild(element("p", "task-note", STRUCTURE_GUARD_LIMIT));
    return box;
  }

  function createChangeScopeOption(state, entry) {
    var chosen = state.changeScope &&
      state.changeScope.file === entry.file;
    var card;
    var body;
    var box;

    if (!entry.valid) {
      return element(
        "p",
        "preset-invalid-item",
        entry.file + " — " + entry.message);
    }
    card = element("button", "choice-card scope-card");
    body = element("span", "choice-body");
    box = element("span", "option-checkbox choice-checkbox");
    card.type = "button";
    card.setAttribute("data-action", "select-change-scope");
    card.setAttribute("data-scope-file", entry.file);
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", chosen ? "true" : "false");
    card.disabled = state.busyAction !== null;
    if (chosen) {
      card.classList.add("is-selected");
      box.appendChild(icon("check", "flow-icon--small"));
    }
    card.appendChild(box);
    card.appendChild(icon("template", "choice-icon"));
    body.appendChild(element("span", "choice-title", entry.name));
    if (entry.description) {
      body.appendChild(element(
        "span",
        "choice-description",
        entry.description));
    }
    card.appendChild(body);
    return card;
  }

  // How far the code may change. The first choice is the default and is
  // shown outright; the rest sit behind one row that opens, because
  // allowing the shape of the project to change is the unusual answer and
  // should be a deliberate one. The labels are the files' own, and every
  // one of them is written as something it permits - no option here is
  // phrased as a negative to be turned off.
  function createChangeScopeSection(state) {
    var box = section("変更範囲", "change-scope");
    var scopes = scopePresets(state);
    var chosen = state.changeScope;
    var rest = scopes.slice(1);
    var others;

    if (scopes.length === 0) {
      box.appendChild(element(
        "p",
        "preset-invalid-item",
        "presets\\03_変更範囲 に有効な Markdown がありません。" +
          "どこまで変えてよいかが決まらないので、依頼を作れません。"));
      return box;
    }
    box.appendChild(element(
      "p",
      "task-note",
      "改修でコードをどこまで変えてよいかを決めます。"));
    box.appendChild(createChangeScopeOption(state, scopes[0]));
    if (rest.length > 0) {
      others = element("div", "choice-list");
      rest.forEach(function (entry) {
        others.appendChild(createChangeScopeOption(state, entry));
      });
      box.appendChild(createDisclosure(
        "change-scope-detail",
        "詳細オプション",
        others,
        Boolean(chosen) && chosen.file !== scopes[0].file,
        chosen && chosen.file !== scopes[0].file ? chosen.name : ""));
    }
    if (global.MacroStudioScreens.isStructureForbidden(state)) {
      box.appendChild(createStructureGuardNote());
    } else if (chosen) {
      box.appendChild(element(
        "p",
        "task-note",
        "この設定のあいだ、構造の検査は行いません。" +
          "返ってきた変更は差分で確かめてください。"));
    }
    return box;
  }

  function createNextStepScreen(state) {
    var root = task(true);

    if (!state.diagnosis) {
      return missingDiagnosis(root);
    }
    root.appendChild(intro(
      "診断から出てきた操作を選びます。複数選べます。"));
    root.appendChild(createPresetCards(state));
    root.appendChild(createChangeScopeSection(state));
    return root;
  }

  function createQuestionFields(state) {
    var box = section("質問", "repair-questions");
    state.questions.forEach(function (question, index) {
      var label = element("label", "form-field");
      var input = element("textarea", "form-textarea");
      label.appendChild(element(
        "span",
        "form-label",
        typeof question === "string" ? question : question.text));
      input.rows = 2;
      input.value = state.answers[String(index)] || "";
      input.disabled = state.busyAction !== null;
      input.setAttribute("data-workflow-input", "repair-answer");
      input.setAttribute("data-question-index", String(index));
      label.appendChild(input);
      box.appendChild(label);
    });
    return box;
  }

  // This screen asks one thing: which problems to send. The problem's
  // detail was read on the page before, so repeating it here adds a
  // second copy and no decision. The row is the tick, the problem and
  // how many places it has.
  //
  // A question the AI asked about a finding is the exception. It is not
  // a restatement, it is something only the reader can settle, so it
  // stays in the open.
  function createRepairFindingRow(state, group) {
    var row = element("div", "repair-finding-row");
    var header = element("label", "repair-finding-select");
    var checkbox = element("input", "option-checkbox");
    var ids = group.findings.map(function (finding) {
      return String(finding.number);
    });
    var chosen = ids.filter(function (id) {
      return state.selectedFindings.indexOf(id) >= 0;
    });

    checkbox.type = "checkbox";
    checkbox.checked = chosen.length === ids.length;
    checkbox.indeterminate = chosen.length > 0 &&
      chosen.length < ids.length;
    checkbox.disabled = state.busyAction !== null;
    checkbox.setAttribute("data-workflow-input", "finding-group-select");
    checkbox.setAttribute("data-finding-ids", ids.join(","));
    header.appendChild(checkbox);
    header.appendChild(element("span", "grade-chip grade-chip--" +
      group.grade.toLowerCase(), group.grade));
    header.appendChild(element("span", "finding-title", group.title));
    header.appendChild(element("span", "group-count",
      "該当 " + ids.length + " か所"));
    row.setAttribute("data-grade", group.grade);
    row.appendChild(header);
    return row;
  }

  function createRepairGradeRows(state, bucket) {
    var box = element("div", "category-block");

    bucket.groups.forEach(function (group) {
      box.appendChild(createRepairFindingRow(state, group));
    });
    return box;
  }

  // Only B can be sent. C is a problem whose cause is outside the code
  // and D has nowhere to go, so putting either in a request would ask
  // for something that cannot be done; A is nothing to do. They are on
  // the page before and in the handover memo, not here.
  function appendRepairFindings(root, state) {
    var buckets = gradesOf(
      groupFindings(state, sortedFindings(state.diagnosis)));
    var box = section("改修する指摘", "repair-findings");
    var sendable = null;
    var blocked = 0;

    buckets.forEach(function (bucket) {
      if (bucket.grade === "B") {
        sendable = bucket;
        return;
      }
      if (bucket.grade === "C" || bucket.grade === "D") {
        blocked += bucket.groups.length;
      }
    });
    if (sendable && sendable.groups.length > 0) {
      box.appendChild(element(
        "p",
        "task-note",
        "診断で B（要改修）になった指摘です。" +
          "チェックしたものが、そのまま依頼文になります。"));
      box.appendChild(createRepairGradeRows(state, sendable));
    } else {
      box.appendChild(element(
        "p",
        "task-note",
        "このツールで直せる指摘はありませんでした。" +
          "下の欄に書けば、それだけを依頼できます。"));
    }
    if (blocked > 0) {
      box.appendChild(element(
        "p",
        "task-note",
        "C（不明）と D（改修不可）の " + blocked + " 件は、" +
          "このツールでは直せないので依頼に入りません。" +
          "完了画面の引渡しメモへ、人がやることとして残ります。"));
    }
    root.appendChild(box);
    return root;
  }

  // What comes back is written into the field like anything typed there,
  // so the reader still sees it, can still change it, and the same
  // validation applies. The dialog saves the typing, not the deciding.
  function pickReplacementLocation(groupKey) {
    var store = global.MacroStudioState;

    if (!groupKey || store.getState().busyAction) {
      return Promise.resolve(null);
    }
    store.setBusyAction("pickLocation");
    return global.hostBridge.request("pickLocation").then(
      function (result) {
        store.setBusyAction(null);
        if (!result || !result.path) {
          return null;
        }
        store.setPathMap(global.MacroStudioPathMap.updateRow(
          store.getState().pathMap,
          groupKey,
          {to: String(result.path)}));
        return result;
      },
      failHost);
  }

  function createPathMapRow(state, row, index) {
    var box = element(
      "article",
      "path-map-row" + (row.applied ? " is-applied" : "") +
        (!row.valid ? " has-error" : ""));
    var summary = element("div", "path-map-summary");
    var identity = element("div", "path-map-identity");
    var controls = element("div", "path-map-controls");
    var evidenceKey = "path-map-evidence-" + String(index);
    var input;
    var inputLabel;
    var includeRow;
    var include;
    var field;
    var pick;

    identity.appendChild(element("code", "path-map-value", row.from));
    // The name of the kind came from the template with the rule that
    // matched. The app repeats it and does not know what it means.
    identity.appendChild(element(
      "span",
      "path-map-class",
      row.label || row["class"]));
    identity.appendChild(element(
      "span",
      "path-map-count",
      row.occurrences.length + "か所"));
    summary.appendChild(identity);
    includeRow = optionRow(
      "path-map-include-" + String(index),
      "この候補を置き換える",
      row.included === true,
      state.busyAction !== null,
      "path-map-include",
      "path-map-include");
    include = includeRow.querySelector("input");
    include.setAttribute("data-group-key", row.groupKey);
    include.setAttribute("data-evidence-key", evidenceKey);
    summary.appendChild(includeRow);
    box.appendChild(summary);

    if (row.included) {
      inputLabel = element("label", "form-field path-map-target");
      inputLabel.appendChild(element("span", "form-label", "置き換え後の値"));
      field = element("div", "path-map-field");
      input = element("input", "form-input path-map-input");
      input.type = "text";
      input.value = row.to;
      input.disabled = state.busyAction !== null;
      input.setAttribute("data-workflow-input", "path-map-to");
      input.setAttribute("data-group-key", row.groupKey);
      field.appendChild(input);
      // Typing a location by hand is how a wrong one gets in. When the
      // template says this kind of candidate is a place, the reader can
      // pick it instead. Whether it is a place is the template's call.
      if (row.picksLocation) {
        pick = actionButton("選ぶ", "pick-replacement-location", false);
        pick.disabled = state.busyAction !== null;
        pick.setAttribute("data-group-key", row.groupKey);
        field.appendChild(pick);
      }
      inputLabel.appendChild(field);
      controls.appendChild(inputLabel);
      if (!row.valid && row.validationMessage) {
        controls.appendChild(element(
          "p",
          "path-map-error",
          row.validationMessage));
      }
    }
    // The reader is deciding about a string, and what settles it is the
    // code around it. A list of line numbers did not settle anything, so
    // the module itself opens here instead - built when the row is
    // opened, not on every render of every row.
    controls.appendChild(createDisclosure(
      evidenceKey,
      "このコードを見る（" + moduleNamesOf(row).join("、") + "）",
      function () {
        return createOccurrenceModules(state, row, evidenceKey);
      },
      disclosureState[evidenceKey] === true,
      row.occurrences.length + "か所"));
    box.appendChild(controls);
    return box;
  }

  function moduleNamesOf(row) {
    var names = [];

    row.occurrences.forEach(function (occurrence) {
      if (names.indexOf(occurrence.module) < 0) {
        names.push(occurrence.module);
      }
    });
    return names;
  }

  // Every module the candidate appears in, with the candidate marked,
  // shown through the same block the diagnosis result uses: only the
  // places by default, with a way to step between them and to open the
  // code around any of them.
  function createOccurrenceModules(state, row, key) {
    var modules = state.modules || [];

    return global.MacroStudioCodeView.create({
      key: key || ("path-map-" + row.groupKey),
      note: "この文字列がある行",
      matchesOnly: true,
      modules: moduleNamesOf(row).map(function (name) {
        var found = null;

        modules.some(function (module) {
          if (module.name === name) {
            found = module;
            return true;
          }
          return false;
        });
        return {
          name: name,
          code: found ? String(found.code || "") : null,
          hits: row.occurrences.filter(function (occurrence) {
            return occurrence.module === name;
          }).map(function (occurrence) {
            return {
              line: Number(occurrence.line),
              column: Number(occurrence.column),
              endColumn: Number(occurrence.endColumn)
            };
          })
        };
      })
    });
  }

  // The table itself. It is a stage of a run, not a screen: on a run that
  // sends nothing it is the whole of screen 4, and on a run that asks a
  // chat first it follows the reply on screen 5. One body either way.
  function createPathMapBody(state) {
    var root = element("div", "path-map-stage");
    var mapping = state.pathMap;
    var rows = mapping && Array.isArray(mapping.rows) ? mapping.rows : [];
    var intro = section("置換の候補", "path-map-intro");
    var list = element("div", "path-map-list");

    intro.appendChild(element(
      "p",
      "path-map-guidance",
      "コードの文字列として見つかった候補です。" +
        "置き換えるものだけチェックして、置き換え後の値を入力してください。"));
    intro.appendChild(element(
      "p",
      "path-map-fact",
      rows.length + "種類・" +
        global.MacroStudioPathMap.countOccurrences(mapping) + "か所"));
    root.appendChild(intro);
    if (rows.length === 0) {
      root.appendChild(element(
        "p",
        "path-map-empty",
        "置き換え候補になる文字列は見つかりませんでした。"));
      return root;
    }
    rows.forEach(function (mappingRow, index) {
      list.appendChild(createPathMapRow(state, mappingRow, index));
    });
    root.appendChild(list);
    return root;
  }

  function createPathMapScreen(state) {
    var root = task(true);

    root.appendChild(createPathMapBody(state));
    return root;
  }

  // The label a chosen template gave its own write-in field, if any gave
  // one. The app does not decide which template writes its work by hand.
  function writeInFieldLabel(state) {
    var label = "";

    (state.presets || []).some(function (entry) {
      var writeIn = entry && entry.parsed ? entry.parsed.writeIn : null;

      if (writeIn) {
        label = String(writeIn);
        return true;
      }
      return false;
    });
    return label;
  }

  function createRepairInputScreen(state) {
    // The table comes first. On the route that has both, the reader
    // fills it in and carries it out, and only then says what the chat
    // should repair - on the code the table produced.
    if (state.presetEngine === "対応表による置換" ||
        global.MacroStudioScreens.isReplacementPending(state)) {
      return createPathMapScreen(state);
    }
    var root = task(true);
    if (state.questions.length) {
      root.appendChild(createQuestionFields(state));
    }
    if (state.diagnosis) {
      appendRepairFindings(root, state);
    } else {
      root.appendChild(intro(
        "診断を行っていないので、直したいことを下の欄に書いてください。"));
    }

    var extraContent = element("div", "extra-request-content");
    var extra = element("textarea", "form-textarea");
    var writeInLabel = writeInFieldLabel(state);
    extra.rows = 4;
    extra.value = state.extraRequest;
    extra.disabled = state.busyAction !== null;
    extra.setAttribute("data-workflow-input", "extra-request");
    extra.id = "repair-write-in";
    extraContent.appendChild(extra);
    // A template that exists so the reader can write the work themselves
    // says what to call the field. Then it is on the screen, open, under
    // its own name - not folded away behind the word "任意".
    if (writeInLabel) {
      var writeIn = section(writeInLabel, "repair-write-in");
      writeIn.appendChild(element(
        "p",
        "task-note",
        "ここに書いた内容が、そのままAIへの改修指示になります。"));
      writeIn.appendChild(extraContent);
      root.appendChild(writeIn);
    } else {
      root.appendChild(createDisclosure(
        "extra-request",
        "追加の要望を書く（任意）",
        extraContent,
        false,
        String(state.extraRequest || "").trim() ? "記入あり" : "未記入",
        true));
    }

    if (state.splitOutputRules) {
      root.appendChild(optionRow(
        "repair-split-output",
        "コードが長い場合は、モジュール単位で返答を受け取る",
        state.splitOutput === true,
        state.busyAction !== null,
        "repair-split-output",
        "repair-split-option"));
    }

    return root;
  }

  function createRepairScreen(state) {
    var root = task(true);

    root.appendChild(element("h2", "task-step", "1. 依頼をAIへ渡す"));
    root.appendChild(element(
      "p",
      "task-note",
      "依頼文をコピーして貼り付け、開いたフォルダの " + AI_CODE_FILE + " を" +
        "添付します。"));
    root.appendChild(attachmentHint());
    root.appendChild(createHandoffActions(state, "repair"));

    root.appendChild(element("h2", "task-step", "2. 返答を取り込む"));
    root.appendChild(element(
      "p",
      "task-note",
      "AIの返答にあるコードブロック全体をコピーして、下のボタンを押します。"));
    appendIntakeError(root, state, "repair");
    if (state.noChangeResult) {
      var noChange = section(
        NO_CHANGE_TITLES[state.noChangeResult.verdict] ||
          "改修できないという回答です",
        "no-change-result");
      noChange.appendChild(element(
        "p",
        "no-change-summary",
        state.noChangeResult.summary));
      root.appendChild(noChange);
    }
    if (state.splitOutput && state.repairIntakeParts) {
      root.appendChild(element(
        "p",
        "split-progress",
        state.repairIntakeParts.parts.length + " / " +
          state.repairIntakeParts.total + " 個を受け取り済み"));
    }
    // One filled button at a time, as on the diagnosis screen: this is
    // the action only once the request has actually gone out.
    var button = actionButton(
      "クリップボードから改修結果を取り込む",
      "import-repair",
      Boolean(state.repairPromptCopied));
    var restart = null;
    button.disabled = state.busyAction !== null;
    if ((state.repairIntakeParts && state.repairIntakeParts.parts.length) ||
        state.intakeResult) {
      restart = actionButton(
        "最初から取り込み直す",
        "restart-repair-intake",
        false);
      restart.disabled = state.busyAction !== null;
    }
    root.appendChild(actionRow(button, restart));
    if (state.intakeResult) {
      root.appendChild(statusLine("AIの回答を取り込みました。"));
    }
    return root;
  }

  function build(index, state) {
    var screens = global.MacroStudioScreens;
    if (index === screens.bookScreen) {
      return createBookScreen(state);
    }
    if (index === screens.diagnoseScreen) {
      return createDiagnoseScreen(state);
    }
    if (index === screens.findingsScreen) {
      return createFindingsScreen(state);
    }
    if (index === screens.nextStepScreen) {
      return createNextStepScreen(state);
    }
    if (index === screens.repairInputScreen) {
      return createRepairInputScreen(state);
    }
    if (index === screens.repairScreen) {
      return createRepairScreen(state);
    }
    return task(true);
  }

  // Build what a row was holding back, once, on the render that first
  // opens it. The built content stays in the page afterwards, so opening
  // and closing again costs nothing.
  function fillLazyContent(key) {
    var pending = lazyContent[key];
    var panel;
    var built;

    if (!pending) {
      return false;
    }
    delete lazyContent[key];
    panel = document.getElementById(pending.panelId);
    if (!panel) {
      return false;
    }
    built = pending.factory();
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }
    panel.appendChild(built);
    return true;
  }

  function toggleDisclosure(button, finding) {
    var controls = button.getAttribute("aria-controls");
    var panel = controls ? document.getElementById(controls) : null;
    var open = button.getAttribute("aria-expanded") !== "true";
    var key = finding
      ? button.getAttribute("data-finding-key")
      : button.getAttribute("data-disclosure-key");
    var box = button.parentNode;

    if (open) {
      fillLazyContent(key);
    }
    disclosureState[key] = open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // The .disclosure body animates from data-open; a finding row still
    // shows and hides its detail block outright.
    if (box && box.getAttribute &&
        box.getAttribute("data-disclosure-box") !== null) {
      box.setAttribute("data-open", open ? "true" : "false");
    } else if (panel) {
      panel.hidden = !open;
      // The chevron turns from is-open. Without this the row opened but
      // the mark went on pointing right, which reads as "still closed".
      if (box && box.classList) {
        box.classList.toggle("is-open", open);
      }
    }
    return true;
  }

  function handleAction(action, button) {
    var store = global.MacroStudioState;
    if (action === "toggle-workflow-disclosure") {
      return toggleDisclosure(button, false);
    }
    if (action === "toggle-finding") {
      return toggleDisclosure(button, true);
    }
    // The code block's own controls. They move and reclass rows that are
    // already in the page, so none of them redraws the screen.
    if (action === "code-view-previous") {
      return global.MacroStudioCodeView.jump(
        button.getAttribute("data-code-view"), -1);
    }
    if (action === "code-view-next") {
      return global.MacroStudioCodeView.jump(
        button.getAttribute("data-code-view"), 1);
    }
    if (action === "code-view-matches") {
      return global.MacroStudioCodeView.toggleMatchesOnly(
        button.getAttribute("data-code-view"));
    }
    if (action === "code-view-expand") {
      return global.MacroStudioCodeView.expand(button);
    }
    if (action === "copy-diagnosis-prompt") {
      copyStagePrompt("diagnose"); return true;
    }
    if (action === "open-diagnosis-folder") {
      openRunFolder("diagnose"); return true;
    }
    if (action === "rebuild-diagnosis-request") {
      prepareDiagnosisRequest(true); return true;
    }
    if (action === "import-diagnosis") {
      importDiagnosisFromClipboard(); return true;
    }
    if (action === "select-change-scope") {
      selectChangeScope(button.getAttribute("data-scope-file"));
      return true;
    }
    if (action === "select-repair-preset") {
      selectRepairPreset(button.getAttribute("data-preset-file")); return true;
    }
    if (action === "pick-replacement-location") {
      pickReplacementLocation(button.getAttribute("data-group-key"));
      return true;
    }
    if (action === "copy-repair-prompt") {
      copyStagePrompt("repair"); return true;
    }
    if (action === "open-repair-folder") {
      openRunFolder("repair"); return true;
    }
    if (action === "import-repair") {
      importRepairFromClipboard(); return true;
    }
    if (action === "restart-repair-intake") {
      restartRepairIntake(); return true;
    }
    return false;
  }

  function handleInput(target) {
    var kind = target && target.getAttribute
      ? target.getAttribute("data-workflow-input")
      : null;
    var store = global.MacroStudioState;
    if (!kind) {
      return false;
    }
    if (kind === "diagnosis-concern") {
      store.setDiagnosisConcern(target.value);
    } else if (kind === "repair-answer") {
      store.setAnswer(Number(target.getAttribute("data-question-index")), target.value);
    } else if (kind === "finding-group-select") {
      String(target.getAttribute("data-finding-ids") || "").split(",")
        .filter(Boolean).forEach(function (id) {
          store.setFindingSelected(id, target.checked === true);
        });
    } else if (kind === "extra-request") {
      store.setExtraRequest(target.value);
    } else if (kind === "repair-split-output") {
      store.setSplitOutput(target.checked === true);
    } else if (kind === "path-map-include") {
      if (target.checked === true) {
        disclosureState[target.getAttribute("data-evidence-key")] = true;
      }
      store.setPathMap(global.MacroStudioPathMap.updateRow(
        store.getState().pathMap,
        target.getAttribute("data-group-key"),
        {included: target.checked === true}));
    } else if (kind === "path-map-to") {
      store.setPathMap(global.MacroStudioPathMap.updateRow(
        store.getState().pathMap,
        target.getAttribute("data-group-key"),
        {to: target.value}));
    }
    return true;
  }

  function handlePaste(text, state) {
    if (state.screen === global.MacroStudioScreens.diagnoseScreen) {
      applyDiagnosisText(text);
      return true;
    }
    if (state.screen === global.MacroStudioScreens.repairScreen) {
      applyRepairText(text);
      return true;
    }
    return false;
  }

  // Always from the text the candidates were detected in (SPEC 7.7.1),
  // never from a previous replacement - otherwise correcting a value and
  // pressing the button again could not succeed.
  function applyPathMapping(stayOnInput) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var result = global.MacroStudioPathMap.apply(
      state.pathMap,
      store.getPathMapBaseModules());

    if (!result.ok) {
      global.MacroStudioApp.showToast(result.message, "error");
      writeLog("WARN", "path mapping refused: " + result.code);
      return false;
    }
    if (store.setDeterministicResult(result) === 0 &&
        result.modules.length > 0) {
      global.MacroStudioApp.showToast(
        "置き換え結果を画面へ反映できませんでした。",
        "error");
      return false;
    }
    global.MacroStudioApp.showToast(
      result.mapping.rows.length + "種類の文字列を置き換えました。" +
        (stayOnInput ? "続けて、AIへ依頼する内容を決めます。" : ""),
      "success");
    if (!stayOnInput) {
      store.goNext();
    }
    return true;
  }

  function handleNext(state) {
    // Leaving the hand-over screen has nothing left to do. The
    // replacements happen before the chat is asked, not after it
    // answers, so there is no second pass over the reply here.
    if (state.screen !== global.MacroStudioScreens.repairInputScreen) {
      return false;
    }
    if (state.presetEngine === "AI" &&
        !global.MacroStudioScreens.isReplacementPending(state)) {
      prepareRepairRequest();
      return true;
    }
    // On the route that has both, carrying out the replacement does not
    // leave screen 4: the same screen then asks what the chat should do
    // with the code the table just produced.
    var stayOnInput = state.presetEngine === "AI";
    if (global.MacroStudioState.hasDeterministicManualEdits()) {
      global.MacroStudioApp.confirmDiscardManualChanges(function () {
        return applyPathMapping(stayOnInput);
      });
      return true;
    }
    applyPathMapping(stayOnInput);
    return true;
  }

  function enter(state) {
    // Called after every render, so "on arrival" has to be worked out
    // here. Without this, unticking the recommended template ticks it
    // straight back and the reader cannot choose another route.
    var arrived = state.screen !== lastEnteredScreen;

    if (entering || state.busyAction) {
      return;
    }
    lastEnteredScreen = state.screen;
    if (state.screen === global.MacroStudioScreens.diagnoseScreen &&
        !state.diagnosisRequestId && state.targetEnvironment &&
        global.MacroStudioApp.getDiagnosisPresetStatus().ok) {
      entering = true;
      prepareDiagnosisRequest(false).then(function () {
        entering = false;
      }, function () {
        entering = false;
      });
      return;
    }
    if (state.screen === global.MacroStudioScreens.findingsScreen) {
      syncSelectedPreset(state);
    }
    if (state.screen === global.MacroStudioScreens.nextStepScreen &&
        arrived) {
      selectRecommendedPresets(state);
    }
  }

  // The diagnosis already said which templates it points at, so arriving
  // with those ticked is the diagnosis's answer carried forward rather
  // than a choice made for the reader - who can untick any of them.
  // Only on arrival with nothing chosen; a cleared selection stays clear.
  function selectRecommendedPresets(state) {
    var recommended;

    if ((state.presetFiles || []).length > 0 || !state.diagnosis) {
      return false;
    }
    recommended = repairPresets(state).filter(function (entry) {
      return entry.valid && recommendedBy(state, entry).length > 0;
    });
    if (recommended.length === 0) {
      return false;
    }
    // Whatever the diagnosis pointed at arrives ticked, all of it.
    recommended.forEach(function (entry) {
      selectRepairPreset(entry.file);
    });
    return true;
  }

  function handleKeyDown(event) {
    var target = event.target;
    if (!target || !target.getAttribute ||
        target.getAttribute("data-finding-toggle") !== "true" ||
        (event.key !== "ArrowDown" && event.key !== "ArrowUp")) {
      return false;
    }
    var buttons = Array.prototype.slice.call(document.querySelectorAll(
      '[data-finding-toggle="true"]'));
    var index = buttons.indexOf(target);
    var next = event.key === "ArrowDown" ? index + 1 : index - 1;
    if (next >= 0 && next < buttons.length) {
      event.preventDefault();
      buttons[next].focus();
    }
    return true;
  }

  global.MacroStudioWorkflow = {
    build: build,
    enter: enter,
    handleAction: handleAction,
    handleInput: handleInput,
    handlePaste: handlePaste,
    handleNext: handleNext,
    handleKeyDown: handleKeyDown,
    prepareDiagnosisRequest: prepareDiagnosisRequest,
    applyDiagnosisText: applyDiagnosisText,
    prepareRepairRequest: prepareRepairRequest,
    selectRepairPreset: selectRepairPreset,
    applyRepairText: applyRepairText,
    restartRepairIntake: restartRepairIntake,
    retryCopyPrompt: retryCopyPrompt,
    formatDiagnosisForPrompt: formatDiagnosisForPrompt,
    formatSelectedFindings: formatSelectedFindings,
    composeDiagnosisRequestText: composeDiagnosisRequestText,
    composeOutsideCode: composeOutsideCode,
    composeRepairRequestText: composeRepairRequestText,
    createBookScreen: createBookScreen,
    createDiagnoseScreen: createDiagnoseScreen,
    createFindingsScreen: createFindingsScreen,
    createNextStepScreen: createNextStepScreen,
    createRepairInputScreen: createRepairInputScreen,
    createRepairScreen: createRepairScreen,
    // Handing over and taking back share one screen now. The old names
    // still resolve so existing callers keep drawing the same thing.
    createDiagnoseRequestScreen: createDiagnoseScreen,
    createDiagnoseIntakeScreen: createDiagnoseScreen,
    createRepairRequestScreen: createRepairScreen,
    createRepairIntakeScreen: createRepairScreen,
    sourceBlock: sourceBlock,
    markdownSection: markdownSection
  };
}(window));
