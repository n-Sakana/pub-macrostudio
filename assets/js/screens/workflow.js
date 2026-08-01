(function (global) {
  "use strict";

  var CRLF = "\r\n";
  var DIVIDER = new Array(81).join("-");
  var disclosureState = {};
  var entering = false;
  var CLASS_ORDER = ["BLOCKER", "DEFECT", "CONDITIONAL", "EXTERNAL", "INFO"];
  var CLASS_LABELS = {
    BLOCKER: "阻害",
    DEFECT: "不具合",
    CONDITIONAL: "条件付き",
    EXTERNAL: "前提",
    INFO: "補助"
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

  function padFinding(value) {
    var text = String(value || "");
    return text.length >= 2 ? text : "0" + text;
  }

  function sortedFindings(diagnosis) {
    var findings = diagnosis && Array.isArray(diagnosis.findings)
      ? diagnosis.findings.slice()
      : [];
    findings.sort(function (left, right) {
      var classDifference = CLASS_ORDER.indexOf(left.class) -
        CLASS_ORDER.indexOf(right.class);
      return classDifference || Number(left.number) - Number(right.number);
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

  function worstClass(findings) {
    var best = CLASS_ORDER.length - 1;

    findings.forEach(function (finding) {
      var index = CLASS_ORDER.indexOf(finding["class"]);
      if (index >= 0 && index < best) {
        best = index;
      }
    });
    return CLASS_ORDER[best];
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
        "class": worstClass(byKey[key]),
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
        return CLASS_ORDER.indexOf(left["class"]) -
          CLASS_ORDER.indexOf(right["class"]);
      });
      return {
        axis: axis,
        label: AXIS_LABELS[axis] || AXIS_LABELS[""],
        groups: byAxis[axis]
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

  function countGroupClasses(categories) {
    var counts = {};

    CLASS_ORDER.forEach(function (name) { counts[name] = 0; });
    allGroups(categories).forEach(function (group) {
      counts[group["class"]] += 1;
    });
    return counts;
  }

  function environmentTitle(state, key) {
    var constraints = state.targetEnvironment &&
      Array.isArray(state.targetEnvironment.constraints)
      ? state.targetEnvironment.constraints
      : [];
    var title = "";
    constraints.some(function (constraint) {
      if (constraint.key === key) {
        title = constraint.title;
        return true;
      }
      return false;
    });
    return title;
  }

  function formatLocation(finding) {
    return "module: " + finding.module + " / proc: " +
      finding.procedure + " / lines: " + finding.lines;
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
        "#" + padFinding(finding.number) + " [" + finding.class + "/" +
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
        "#" + padFinding(finding.number) + " [" + finding.class + "] " +
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

  function composeRepairRequestText(parsed, state, requestId) {
    var text = fillRequestId(parsed.instruction.body, requestId);
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
    return text;
  }

  function createIdentity() {
    var identity = global.MacroStudioResponse.createRequestIdentity();
    if (!identity.secure && global.hostBridge) {
      global.hostBridge.request("writeLog", {
        level: "WARN",
        message: "request identity used Math.random because secure random was unavailable"
      }).then(function () { return null; }, function () { return null; });
    }
    return identity.id;
  }

  function diagnosisPreset(state) {
    var status = global.MacroStudioApp.getDiagnosisPresetStatus();
    var raw = null;
    if (!status || !status.ok || !status.entry ||
        !state.appInfo || !state.appInfo.presets ||
        !Array.isArray(state.appInfo.presets.diagnose)) {
      return null;
    }
    (state.appInfo.presets.diagnose || []).some(function (entry) {
      if (entry.file === status.entry.file) {
        raw = entry;
        return true;
      }
      return false;
    });
    return raw ? {entry: status.entry, raw: raw} : null;
  }

  function failHost(error, toastAction) {
    global.MacroStudioApp.handleHostError(
      error || {code: "E-SYS-02"},
      "",
      toastAction || null);
    global.MacroStudioState.setBusyAction(null);
    return null;
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
          codeFileName: "source-code.md",
          targetEnvironment: state.targetEnvironmentSnapshot
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
        code: code
      }).then(function (result) {
        store.commitDiagnosisRequest({
          requestId: requestId,
          requestText: requestText,
          prompt: prompt,
          requestPath: result.requestPath,
          runFolder: result.folderPath,
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

    store.setBusyAction("writeDiagnosisFile");
    return global.hostBridge.request("writeDiagnosisFile", {
      outputTimestamp: state.outputTimestamp,
      markdown: markdown
    }).then(function (result) {
      store.commitDiagnosis(diagnosis, result.path);
      store.setBusyAction(null);
      global.MacroStudioApp.showToast("診断結果を取り込みました。", "success");
      return diagnosis;
    }, failHost);
  }

  function applyDiagnosisText(text) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var options = {
      requestId: state.diagnosisRequestId,
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
      global.MacroStudioApp.showToast(
        "診断結果を取り込めませんでした。コードブロック全体をコピーし直してください。",
        "error");
      return Promise.resolve(null);
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
      global.MacroStudioApp.showToast(
        "診断結果の分割を取り込めませんでした。届いた番号を確認してください。",
        "error");
      return Promise.resolve(null);
    }
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
        if (parsed.engine === "固定パス置換" &&
            (changed || !global.MacroStudioPathMap.isProductResult(
              store.getState().pathMap))) {
          store.setPathMap(global.MacroStudioPathMap.detect(
            store.getBookModules()));
        }
        store.setBusyAction(null);
        global.MacroStudioApp.showToast(parsed.name + " を選びました。", "success");
        return result;
      },
      failHost);
  }

  function syncSelectedPreset(state) {
    var raw = null;
    var parsed;
    if (!state.presetFile || !state.appInfo || !state.appInfo.presets) {
      return false;
    }
    (state.appInfo.presets.repair || []).some(function (entry) {
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
    if (parsed.engine === "固定パス置換" &&
        (changed || !global.MacroStudioPathMap.isProductResult(
          global.MacroStudioState.getState().pathMap))) {
      global.MacroStudioState.setPathMap(global.MacroStudioPathMap.detect(
        global.MacroStudioState.getBookModules()));
    }
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

    if (state.busyAction || state.presetEngine !== "AI" ||
        !global.MacroStudioScreens.isRepairInputReady(state)) {
      return Promise.resolve(null);
    }
    parsed = global.MacroStudioPreset.parse(state.presetContent, "repair");
    if (!parsed.valid) {
      return Promise.resolve(null);
    }
    requestId = createIdentity();
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
          codeFileName: "source-code.md",
          targetEnvironment: state.targetEnvironmentSnapshot,
          diagnosis: diagnosisText,
          selectedFindings: selectedText
        }), requestId);
      } catch (error) {
        return failHost({code: "E-GEN-02", message: error.message});
      }
      return global.hostBridge.request("writeRequestFiles", {
        stage: "repair",
        outputTimestamp: state.outputTimestamp,
        request: prompt
      }).then(function (result) {
        store.commitRepairRequest({
          requestId: requestId,
          requestText: requestText,
          prompt: prompt,
          requestPath: result.requestPath
        });
        store.setBusyAction(null);
        store.goNext();
        return result;
      }, failHost);
    }, failHost);
  }

  function applyWholeRepairPackage(parsed) {
    var store = global.MacroStudioState;
    var state = store.getState();
    var described = global.MacroStudioResponse.describe(
      parsed,
      state.modules,
      state.diagnosis);

    if (!described.ok) {
      return showRepairIntakeError(described.message);
    }
    store.setLastError(null);
    if (described.noChange === "NEEDDECISION") {
      store.setNeedDecision(described);
      global.MacroStudioApp.showToast(
        "決める必要があることが返ってきました。",
        "info");
      return true;
    }
    if (described.noChange) {
      store.setNoChangeResult(described);
      global.MacroStudioApp.showToast(
        "AIは変更なしと判断しました。理由を確認してください。",
        "info");
      return true;
    }
    store.importPackage(described);
    global.MacroStudioApp.showToast(
      described.total + "個のモジュールを取り込みました。",
      "success");
    return true;
  }

  function showRepairIntakeError(message) {
    global.MacroStudioState.setLastError({
      code: "E-INTAKE-01",
      message: String(message || "改修結果を取り込めませんでした。")
    });
    global.MacroStudioApp.showToast(
      String(message || "改修結果を取り込めませんでした。"),
      "error");
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
      return showRepairIntakeError(parsed.message);
    }
    if (!state.splitOutput) {
      if (parsed.part) {
        return showRepairIntakeError(
          global.MacroStudioResponse.messages.partUnexpected);
      }
      return applyWholeRepairPackage(parsed);
    }
    // NOCHANGE, including NEEDDECISION, is deliberately one complete answer
    // even when module-by-module output was requested. It never has PART.
    if (parsed.noChange) {
      return applyWholeRepairPackage(parsed);
    }
    added = global.MacroStudioResponse.addPart(
      state.repairIntakeParts ||
        global.MacroStudioResponse.createPartCollection(),
      parsed);
    if (!added.ok) {
      return showRepairIntakeError(added.message);
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

  function openRunFolder(stage) {
    var store = global.MacroStudioState;
    var state = store.getState();
    if (!state.runFolder || state.busyAction) {
      return Promise.resolve(null);
    }
    store.setBusyAction("openRunFolder");
    return global.hostBridge.request("revealPath", {path: state.runFolder})
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
        state.lastError));
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
    moduleList = element("ul", "read-module-list");
    state.modules.forEach(function (module) {
      moduleList.appendChild(element(
        "li",
        "read-module-item",
        module.name + " — " + module.lineCount + " 行"));
    });
    read.appendChild(moduleList);
    root.appendChild(createDisclosure(
      "book-read-result",
      "読み取った内容を見る",
      read,
      false,
      state.modules.length + " モジュール"));
    appendOutsideCode(root, state);
    return root;
  }

  // The workbook carries more than its code, and this tool changes none
  // of it. What was found is named here so the reader knows before the
  // diagnosis that some of the work will be theirs. Counts on the line,
  // the list inside.
  function appendOutsideCode(root, state) {
    var tasks = global.MacroStudioHandover.humanTasks(state);
    var found = tasks.filter(function (task) {
      return task.found;
    });
    var body = element("div", "outside-code");
    var list = element("ul", "outside-code-list");
    var inventory = state.bookInventory;

    if (!inventory) {
      return root;
    }
    body.appendChild(element(
      "p",
      "task-note",
      "このツールが読み書きするのは VBA のコードだけです。" +
        "次はコードの外にあるので、見つけて名前を出すだけにします。"));
    tasks.forEach(function (task) {
      list.appendChild(element(
        "li",
        task.found ? "outside-code-found" : "",
        task.title + " … " + task.detail));
    });
    body.appendChild(list);
    if (inventory.sha256) {
      body.appendChild(element(
        "p",
        "outside-code-hash",
        "SHA-256: " + inventory.sha256));
    }
    root.appendChild(createDisclosure(
      "book-outside-code",
      "コードの外にあるもの",
      body,
      false,
      found.length > 0 ? found.length + " 件あり" : "該当なし"));
    return root;
  }

  function environmentChip(state) {
    var profile = state.targetEnvironment;
    return profile
      ? profile.displayName + "（" + profile.revision + " 版）"
      : "想定動作環境を読み込み中";
  }

  function appendRuntimeFacts(root, state) {
    // This renderer runs inside notify(). A throw here would abandon the
    // whole update, so an absent module reads as "nothing was read"
    // rather than taking the screen down with it.
    var runtime = global.MacroStudioHandover
      ? global.MacroStudioHandover.runtimeComparison(state)
      : {available: false, rows: [], notes: []};
    var list = element("ul", "runtime-list");

    root.appendChild(element(
      "h3",
      "runtime-title",
      "この端末で確認できた実行環境"));
    root.appendChild(element(
      "p",
      "runtime-note",
      "ブックの属性ではありません。配布先の端末では別の値になります。"));
    if (!runtime.available) {
      root.appendChild(element(
        "p",
        "runtime-note",
        "読み取れていません。人が確認してください。"));
      return root;
    }
    runtime.rows.forEach(function (row) {
      list.appendChild(element(
        "li",
        row.verdict === "不一致" ? "runtime-mismatch" : "",
        row.label + ": " + row.measured +
          (row.expected ? "（期待 " + row.expected + " / " +
            row.verdict + "）" : "")));
    });
    root.appendChild(list);
    runtime.notes.forEach(function (note) {
      root.appendChild(element("p", "runtime-note", note));
    });
    return root;
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

    root.appendChild(intro(
      "診断の依頼文はできています。AIへ渡して、返ってきた答えをこの画面へ" +
        "戻してください。"));

    // Someone who already knows what to change does not need the
    // diagnosis. Skipping is offered here, in front, rather than hidden
    // as a way of getting unstuck later.
    root.appendChild(optionRow(
      "diagnosis-skip",
      "診断を飛ばして、直したいことを自分で書く",
      state.diagnosisSkipped === true,
      state.busyAction !== null,
      "diagnosis-skip"));
    if (state.diagnosisSkipped) {
      root.appendChild(element(
        "p",
        "task-note",
        "診断は行いません。右下の「次へ」で、次にすることを選びます。"));
      return root;
    }

    root.appendChild(element("h2", "task-step", "1. 依頼をAIへ渡す"));
    if (state.diagnosisRequestId) {
      root.appendChild(element(
        "p",
        "task-note",
        "依頼文をコピーして貼り付け、開いたフォルダの source-code.md を" +
          "添付します。"));
      root.appendChild(createHandoffActions(state, "diagnose"));
    } else if (state.busyAction) {
      root.appendChild(element("p", "inline-status", "診断依頼を作成しています…"));
    }

    appendDiagnoseIntake(root, state);

    // ---- everything below is optional reading ----
    if (state.targetEnvironment) {
      environment.appendChild(element(
        "p",
        "environment-description",
        state.targetEnvironment.summary));
    }
    // The environment the diagnosis assumes, and underneath it what this
    // terminal actually reports. They are labelled apart on purpose: one
    // is the target, the other is the machine in front of the reader.
    appendRuntimeFacts(environment, state);
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

  // The second half of the same screen: what comes back from the chat.
  function appendDiagnoseIntake(root, state) {
    var button;

    root.appendChild(element("h2", "task-step", "2. 返答を取り込む"));
    root.appendChild(element(
      "p",
      "task-note",
      "AIの返答にあるコードブロック全体をコピーして、下のボタンを押します。"));
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
        ? "診断結果を取り込みました"
        : "クリップボードから診断結果を取り込む",
      "import-diagnosis",
      Boolean(state.diagnosisPromptCopied) && !state.diagnosis);
    button.disabled = state.busyAction !== null;
    root.appendChild(actionRow(button));
    return root;
  }

  function createFindingDetails(state, finding) {
    var detail = element("div", "finding-detail");
    var location = element("div", "finding-detail-block");
    var evidence = element("div", "finding-detail-block");
    detail.appendChild(element("p", "finding-condition",
      "成立条件: " + finding.texts.condition));
    detail.appendChild(element("p", "finding-impact",
      "影響: " + finding.texts.impact));
    location.appendChild(element("strong", "", "該当箇所"));
    location.appendChild(element("code", "", formatLocation(finding)));
    evidence.appendChild(element("strong", "", "根拠"));
    evidence.appendChild(element("p", "", finding.texts.evidence));
    detail.appendChild(location);
    detail.appendChild(evidence);
    if (finding.environmentKey !== "-") {
      detail.appendChild(element(
        "p",
        "finding-environment",
        "参照した環境制約: " + finding.environmentKey + " — " +
          environmentTitle(state, finding.environmentKey)));
    }
    return detail;
  }

  // One occurrence of a grouped problem: where it is and why it counts.
  function createOccurrenceRow(state, finding) {
    var row = element("div", "occurrence-row");
    var button = element("button", "occurrence-toggle");
    var id = "occurrence-detail-" + finding.number;
    var key = "finding-" + finding.number;
    var open = disclosureState[key] === true;
    var details = createFindingDetails(state, finding);

    button.type = "button";
    button.setAttribute("data-action", "toggle-finding");
    button.setAttribute("data-finding-key", key);
    button.setAttribute("data-finding-toggle", "true");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-controls", id);
    button.appendChild(icon("chevron", "flow-icon--small disclosure-chevron"));
    button.appendChild(element("code", "occurrence-location",
      formatLocation(finding)));
    button.appendChild(element("span", "confidence-chip",
      CONFIDENCE_LABELS[finding.confidence]));
    details.id = id;
    details.hidden = !open;
    if (open) {
      row.classList.add("is-open");
    }
    row.appendChild(button);
    row.appendChild(details);
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
    button.appendChild(element("span", "class-chip class-chip--" +
      group["class"].toLowerCase(), CLASS_LABELS[group["class"]]));
    button.appendChild(element("span", "group-title", group.title));
    button.appendChild(element("span", "group-count",
      "該当 " + group.findings.length + " か所"));
    panel.id = id;
    panel.hidden = !open;
    group.findings.forEach(function (finding) {
      panel.appendChild(createOccurrenceRow(state, finding));
    });
    row.appendChild(button);
    row.appendChild(panel);
    return row;
  }

  function createCategorySection(state, category, prefix) {
    var box = element("div", "category-block");

    box.appendChild(element("h3", "category-label", category.label));
    category.groups.forEach(function (group) {
      box.appendChild(createGroupRow(state, group, prefix));
    });
    return box;
  }

  function createFindingsList(state) {
    var list = element("div", "findings-list");
    var findings = sortedFindings(state.diagnosis);

    if (!findings.length) {
      list.appendChild(element(
        "p",
        "findings-empty",
        "この監査範囲では動作阻害要因を確認できませんでした。"));
      return list;
    }
    groupFindings(state, findings).forEach(function (category) {
      list.appendChild(createCategorySection(state, category, "diagnosis"));
    });
    return list;
  }

  function countClasses(diagnosis) {
    var counts = {};
    CLASS_ORDER.forEach(function (name) { counts[name] = 0; });
    sortedFindings(diagnosis).forEach(function (finding) {
      counts[finding.class] += 1;
    });
    return counts;
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

  function createPresetCards(state) {
    var cards = element("div", "choice-list");
    var entries = global.MacroStudioPreset.describeAll(
      state.appInfo && state.appInfo.presets
          ? state.appInfo.presets.repair
          : [],
      "repair");
    var pathCandidateCount = null;

    if (global.MacroStudioPathMap && entries.some(function (entry) {
      return entry.valid && entry.engine === "固定パス置換";
    })) {
      pathCandidateCount = global.MacroStudioPathMap.countOccurrences(
        state.pathMap && global.MacroStudioPathMap.isProductResult(state.pathMap)
          ? state.pathMap
          : global.MacroStudioPathMap.detect(state.modules));
    }
    entries.forEach(function (entry) {
      var card;
      if (!entry.valid) {
        cards.appendChild(element(
          "p",
          "preset-invalid-item",
          entry.file + " — " + entry.message));
        return;
      }
      // β1's choice card is three columns: icon, body, check mark. The
      // title and the description belong inside the body, never in the
      // icon and check columns - that is what stood the titles on end.
      var selected = state.presetFile === entry.file;
      var body = element("span", "choice-body");
      var mark = element("span", "choice-state");

      card = element("button", "choice-card");
      card.type = "button";
      card.setAttribute("data-action", "select-repair-preset");
      card.setAttribute("data-preset-file", entry.file);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
      if (selected) {
        card.classList.add("is-selected");
      }
      var basis = recommendedBy(state, entry);

      card.disabled = state.busyAction !== null;
      if (basis.length > 0) {
        card.classList.add("is-recommended");
      }
      card.appendChild(icon("template", "choice-icon"));
      body.appendChild(element("span", "choice-title", entry.name));
      if (entry.description) {
        body.appendChild(element("span", "choice-description", entry.description));
      }
      if (entry.engine === "固定パス置換") {
        body.appendChild(element(
          "span",
          "choice-meta",
          "固定パスの候補 " + pathCandidateCount + "件"));
      }
      card.appendChild(body);
      // The mark sits at the far edge, on its own, and says only that
      // the diagnosis points here. The reasons are the page before.
      if (basis.length > 0) {
        mark.appendChild(element("span", "choice-recommended", "★ 推奨"));
      }
      if (selected) {
        mark.appendChild(icon("check", "flow-icon--small"));
      }
      card.appendChild(mark);
      cards.appendChild(card);
    });
    return cards;
  }

  var SUMMARY_LABELS = {
    PURPOSE: "このマクロは何をするものか",
    FLOW: "どう動いているか",
    DEPENDENCY: "何に頼っているか",
    ENVIRONMENT: "対象の環境で何が起きるか"
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
    button.appendChild(element("span", "summary-label", SUMMARY_LABELS[name]));
    panel.id = id;
    panel.hidden = !open;
    panel.appendChild(element("p", "summary-full",
      state.diagnosis.sections[name]));
    row.appendChild(button);
    row.appendChild(panel);
    return row;
  }

  // Two or three lines that give the whole diagnosis: what the macro is
  // for, what the target environment does to it, and how much has to be
  // dealt with. The count is of problems, not of places: a macro that
  // calls Sleep in thirteen procedures is one thing to decide about.
  function createDiagnosisHeadline(state, counts, occurrences) {
    var box = element("div", "diagnosis-conclusion");
    var chips = element("div", "diagnosis-counts");
    var acted = counts.BLOCKER + counts.DEFECT + counts.CONDITIONAL;

    box.setAttribute("aria-live", "polite");
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-text",
      firstLine(state.diagnosis.sections.PURPOSE)));
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-text",
      firstLine(state.diagnosis.sections.ENVIRONMENT)));
    box.appendChild(element(
      "p",
      "diagnosis-conclusion-verdict",
      acted > 0
        ? "対象環境で対処が必要な問題が " + acted + " 件あります（該当 " +
          occurrences + " か所）。"
        : "この監査範囲では動作阻害要因を確認できませんでした。"));
    // Only the kinds that are actually here. "不具合 0" is a fact about
    // a category, not about this workbook, and every one of them the
    // reader has to skip past costs the ones that matter.
    CLASS_ORDER.forEach(function (name) {
      if (counts[name] === 0) {
        return;
      }
      chips.appendChild(element(
        "span",
        "class-chip class-chip--" + name.toLowerCase(),
        CLASS_LABELS[name] + " " + counts[name]));
    });
    box.appendChild(chips);
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

  // The diagnosis, and only the diagnosis. Two or three lines at the top
  // give the whole of it; the macro's own description and every finding's
  // evidence open underneath, in the same kind of row.
  function createFindingsScreen(state) {
    var root = task(true);
    var summaryList = element("div", "summary-list");

    if (!state.diagnosis) {
      return missingDiagnosis(root);
    }
    var categories = groupFindings(state, sortedFindings(state.diagnosis));

    root.appendChild(createDiagnosisHeadline(
      state,
      countGroupClasses(categories),
      sortedFindings(state.diagnosis).length));

    root.appendChild(element("h2", "task-step", "このマクロの詳細"));
    ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"].forEach(
      function (name) {
        summaryList.appendChild(createSummaryRow(state, name));
      });
    root.appendChild(summaryList);

    root.appendChild(element("h2", "task-step", "見つかった事実"));
    root.appendChild(createFindingsList(state));

    root.appendChild(element(
      "p",
      "environment-note",
      "想定環境: " + environmentChip(state)));
    return root;
  }

  // Choosing the work. Nothing else: the diagnosis is the page before.
  function createNextStepScreen(state) {
    var root = task(true);

    if (!state.diagnosis && !state.diagnosisSkipped) {
      return missingDiagnosis(root);
    }
    root.appendChild(createPresetCards(state));
    return root;
  }

  function decisionQuotes(state, findingId) {
    var decisions = state.needDecision && Array.isArray(state.needDecision.decisions)
      ? state.needDecision.decisions
      : [];
    return decisions.filter(function (decision) {
      return String(decision.finding) === String(findingId);
    });
  }

  function appendDecisionQuotes(parent, decisions) {
    if (!decisions.length) {
      return;
    }
    var quotes = element("div", "decision-quotes");
    decisions.forEach(function (decision) {
      var quote = element("blockquote", "decision-quote");
      quote.appendChild(element("strong", "", decision.question));
      quote.appendChild(element("p", "", decision.options));
      quotes.appendChild(quote);
    });
    parent.appendChild(quotes);
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

  // A finding already says what is wrong and what has to change. Asking
  // the reader to restate it per finding added a form to fill in and
  // nothing to the request, so the row is now only the choice of whether
  // to include it.
  // The reader decides per problem, not per place. Ticking the row takes
  // in every occurrence behind it; opening the row shows what those
  // occurrences are.
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
    var key = "repair-group-" + (group.key || "none");
    var open = disclosureState[key] === true;
    var panel = element("div", "group-panel");
    var reveal = element("button", "group-reveal");
    var panelId = "repair-panel-" + (group.key || "none");

    checkbox.type = "checkbox";
    checkbox.checked = chosen.length === ids.length;
    checkbox.indeterminate = chosen.length > 0 &&
      chosen.length < ids.length;
    checkbox.disabled = state.busyAction !== null;
    checkbox.setAttribute("data-workflow-input", "finding-group-select");
    checkbox.setAttribute("data-finding-ids", ids.join(","));
    header.appendChild(checkbox);
    header.appendChild(element("span", "class-chip class-chip--" +
      group["class"].toLowerCase(), CLASS_LABELS[group["class"]]));
    header.appendChild(element("span", "finding-title", group.title));
    header.appendChild(element("span", "group-count",
      "該当 " + ids.length + " か所"));
    row.appendChild(header);

    reveal.type = "button";
    reveal.setAttribute("data-action", "toggle-finding");
    reveal.setAttribute("data-finding-key", key);
    reveal.setAttribute("data-finding-toggle", "true");
    reveal.setAttribute("aria-expanded", open ? "true" : "false");
    reveal.setAttribute("aria-controls", panelId);
    reveal.appendChild(icon("chevron", "flow-icon--small disclosure-chevron"));
    reveal.appendChild(element("span", "", "該当箇所を見る"));
    panel.id = panelId;
    panel.hidden = !open;
    group.findings.forEach(function (finding) {
      panel.appendChild(createOccurrenceRow(state, finding));
      appendDecisionQuotes(panel, decisionQuotes(state, String(finding.number)));
    });
    if (open) {
      row.classList.add("is-open");
    }
    row.appendChild(reveal);
    row.appendChild(panel);
    return row;
  }

  function createRepairCategorySection(state, category) {
    var box = element("div", "category-block");

    box.appendChild(element("h3", "category-label", category.label));
    category.groups.forEach(function (group) {
      box.appendChild(createRepairFindingRow(state, group));
    });
    return box;
  }

  function isLockedPathClass(className) {
    return className === "knownFolder" || className === "fragment" ||
      className === "bareName" || className === "ambiguous";
  }

  function createPathEvidenceCode(occurrence) {
    var block = element("div", "path-evidence-code");

    (occurrence.logicalLines || []).forEach(function (part) {
      var line = element("div", "path-evidence-line");
      var code = element("code", "path-evidence-text");
      var before;
      var marked;
      var after;

      line.appendChild(element(
        "span",
        "path-evidence-number",
        String(part.line)));
      if (Number(part.line) === Number(occurrence.line)) {
        before = String(part.text || "").slice(0, occurrence.column);
        marked = String(part.text || "").slice(
          occurrence.column,
          occurrence.endColumn);
        after = String(part.text || "").slice(occurrence.endColumn);
        code.appendChild(element("span", "", before));
        code.appendChild(element("mark", "path-evidence-mark", marked));
        code.appendChild(element("span", "", after));
      } else {
        code.textContent = part.text || "";
      }
      line.appendChild(code);
      block.appendChild(line);
    });
    return block;
  }

  function createPathEvidence(row) {
    var list = element("div", "path-evidence-list");

    row.occurrences.forEach(function (occurrence) {
      var item = element("article", "path-evidence-item");
      var meta = element("div", "path-evidence-meta");

      meta.appendChild(element("strong", "", occurrence.module));
      meta.appendChild(element(
        "span",
        "",
        (occurrence.procedure || "-") + " / " +
          occurrence.line + "行目 / " + occurrence.ruleId));
      if (occurrence.inConditional) {
        meta.appendChild(element(
          "span",
          "path-evidence-warning",
          "条件付きコンパイルの内側"));
      }
      if (occurrence.conditionalUnbalanced) {
        meta.appendChild(element(
          "span",
          "path-evidence-warning",
          "条件付きコンパイルの対応を確認できません"));
      }
      item.appendChild(meta);
      item.appendChild(createPathEvidenceCode(occurrence));
      list.appendChild(item);
    });
    return list;
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
    var locked = isLockedPathClass(row["class"]);
    var input;
    var inputLabel;

    identity.appendChild(element("code", "path-map-value", row.from));
    identity.appendChild(element(
      "span",
      "path-map-class",
      global.MacroStudioPathMap.classLabels[row["class"]] || row["class"]));
    identity.appendChild(element(
      "span",
      "path-map-count",
      row.occurrences.length + "か所"));
    summary.appendChild(identity);
    if (locked) {
      var includeRow = optionRow(
        "path-map-include-" + String(index),
        "この候補も置き換える",
        row.included === true,
        state.busyAction !== null,
        "path-map-include",
        "path-map-include");
      var include = includeRow.querySelector("input");
      include.setAttribute("data-group-key", row.groupKey);
      include.setAttribute("data-evidence-key", evidenceKey);
      summary.appendChild(includeRow);
    }
    box.appendChild(summary);

    if (!locked || row.included) {
      inputLabel = element("label", "form-field path-map-target");
      inputLabel.appendChild(element("span", "form-label", "新しい場所"));
      input = element("input", "form-input path-map-input");
      input.type = "text";
      input.value = row.to;
      input.disabled = state.busyAction !== null;
      input.setAttribute("data-workflow-input", "path-map-to");
      input.setAttribute("data-group-key", row.groupKey);
      inputLabel.appendChild(input);
      controls.appendChild(inputLabel);
      if (row.locationClassChangeMessage) {
        controls.appendChild(element(
          "p",
          "path-map-info",
          row.locationClassChangeMessage));
      }
      if (row.needsLocationShapeConfirmation) {
        var confirmRow = optionRow(
          "path-map-confirm-" + String(index),
          "入力した値が場所の形になっていないことを確認した",
          row.locationShapeConfirmed === true,
          state.busyAction !== null,
          "path-map-location-shape-confirm",
          "path-map-confirm");
        confirmRow.querySelector("input")
          .setAttribute("data-group-key", row.groupKey);
        controls.appendChild(confirmRow);
      }
      if (!row.valid && row.validationMessage) {
        controls.appendChild(element(
          "p",
          "path-map-error",
          row.validationMessage));
      }
    }
    controls.appendChild(createDisclosure(
      evidenceKey,
      "根拠を見る（" + row.occurrences.length + "か所）",
      createPathEvidence(row),
      disclosureState[evidenceKey] === true));
    box.appendChild(controls);
    return box;
  }

  function createPathMapScreen(state) {
    var root = task(true);
    var mapping = state.pathMap;
    var rows = mapping && Array.isArray(mapping.rows) ? mapping.rows : [];
    var intro = section("固定パスの候補", "path-map-intro");
    var list = element("div", "path-map-list");

    intro.appendChild(element(
      "p",
      "path-map-guidance",
      "コードの文字列として見つかった候補です。" +
        "置き換えるものだけ、新しい場所を入力してください。"));
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

  function createRepairInputScreen(state) {
    if (state.presetEngine === "固定パス置換") {
      return createPathMapScreen(state);
    }
    var root = task(true);
    if (state.questions.length) {
      root.appendChild(createQuestionFields(state));
    }
    if (state.diagnosis) {
      var findings = section("改修する指摘", "repair-findings");
      groupFindings(state, sortedFindings(state.diagnosis)).forEach(
        function (category) {
          findings.appendChild(
            createRepairCategorySection(state, category));
        });
      root.appendChild(findings);
    } else {
      root.appendChild(intro(
        "診断を行っていないので、直したいことを下の欄に書いてください。"));
    }

    var extraContent = element("div", "extra-request-content");
    var extra = element("textarea", "form-textarea");
    appendDecisionQuotes(extraContent, decisionQuotes(state, "-"));
    extra.rows = 4;
    extra.value = state.extraRequest;
    extra.disabled = state.busyAction !== null;
    extra.setAttribute("data-workflow-input", "extra-request");
    extraContent.appendChild(extra);
    root.appendChild(createDisclosure(
      "extra-request",
      "追加の要望を書く（任意）",
      extraContent,
      decisionQuotes(state, "-").length > 0,
      String(state.extraRequest || "").trim() ? "記入あり" : "未記入",
      true));

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

  function createNeedDecision(state) {
    var box = section("決める必要があること", "need-decision");
    if (state.needDecision.summary) {
      box.appendChild(element("p", "need-decision-summary",
        state.needDecision.summary));
    }
    state.needDecision.decisions.forEach(function (decision) {
      var item = element("article", "need-decision-item");
      item.appendChild(element("h3", "", decision.question));
      item.appendChild(element("p", "", decision.options));
      box.appendChild(item);
    });
    box.appendChild(actionRow(actionButton(
      "改修の入力へ戻る",
      "return-repair-input",
      true)));
    return box;
  }

  function createRepairScreen(state) {
    var root = task(true);
    if (state.needDecision) {
      root.appendChild(createNeedDecision(state));
      return root;
    }
    root.appendChild(intro(
      "改修の依頼文はできています。AIへ渡して、返ってきたコードを" +
        "この画面へ戻してください。"));

    root.appendChild(element("h2", "task-step", "1. 依頼をAIへ渡す"));
    root.appendChild(element(
      "p",
      "task-note",
      "依頼文をコピーして貼り付け、開いたフォルダの source-code.md を" +
        "添付します。"));
    root.appendChild(createHandoffActions(state, "repair"));

    root.appendChild(element("h2", "task-step", "2. 返答を取り込む"));
    root.appendChild(element(
      "p",
      "task-note",
      "AIの返答にあるコードブロック全体をコピーして、下のボタンを押します。"));
    if (state.noChangeResult) {
      var noChange = section(
        state.noChangeResult.verdict === "UNNECESSARY"
          ? "改修は不要という判断です"
          : "この方法では改修できないという判断です",
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
      root.appendChild(statusLine(
        state.intakeResult.total + "個のモジュールを取り込みました。"));
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

  function toggleDisclosure(button, finding) {
    var controls = button.getAttribute("aria-controls");
    var panel = controls ? document.getElementById(controls) : null;
    var open = button.getAttribute("aria-expanded") !== "true";
    var key = finding
      ? button.getAttribute("data-finding-key")
      : button.getAttribute("data-disclosure-key");
    var box = button.parentNode;

    disclosureState[key] = open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // The .disclosure body animates from data-open; a finding row still
    // shows and hides its detail block outright.
    if (box && box.getAttribute &&
        box.getAttribute("data-disclosure-box") !== null) {
      box.setAttribute("data-open", open ? "true" : "false");
    } else if (panel) {
      panel.hidden = !open;
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
    if (action === "select-repair-preset") {
      selectRepairPreset(button.getAttribute("data-preset-file")); return true;
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
    if (action === "return-repair-input") {
      store.goTo(global.MacroStudioScreens.repairInputScreen, true);
      return true;
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
    } else if (kind === "diagnosis-skip") {
      store.setDiagnosisSkipped(target.checked === true);
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
    } else if (kind === "path-map-location-shape-confirm") {
      store.setPathMap(global.MacroStudioPathMap.updateRow(
        store.getState().pathMap,
        target.getAttribute("data-group-key"),
        {locationShapeConfirmed: target.checked === true}));
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

  function applyPathMapping() {
    var store = global.MacroStudioState;
    var state = store.getState();
    var result = global.MacroStudioPathMap.apply(
      state.pathMap,
      store.getBookModules());

    if (!result.ok) {
      global.MacroStudioApp.showToast(
        result.code === "E-MAP-02"
          ? "コードの位置を再確認できませんでした。" + result.message
          : result.message,
        "error");
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
      result.mapping.rows.length + "種類の固定パスを置き換えました。",
      "success");
    store.goNext();
    return true;
  }

  function handleNext(state) {
    if (state.screen !== global.MacroStudioScreens.repairInputScreen) {
      return false;
    }
    if (state.presetEngine === "AI") {
      prepareRepairRequest();
      return true;
    }
    if (global.MacroStudioState.hasDeterministicManualEdits()) {
      global.MacroStudioApp.confirmDiscardManualChanges(applyPathMapping);
      return true;
    }
    applyPathMapping();
    return true;
  }

  function enter(state) {
    if (entering || state.busyAction) {
      return;
    }
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
    createRepairIntakeScreen: createRepairScreen
  };
}(window));
