(function (global) {
  "use strict";

  var elements = null;
  var toastTimer = null;
  var lastRenderedScreen = null;
  var pendingAttachPath = null;
  var pendingRestart = false;
  var buildStarted = false;
  var disclosureOpen = {};
  var newModuleNameDraft = "";
  var pasteEditDraft = "";
  var pendingEditDiscardAction = null;
  var pendingEditDiscardMode = "draft";
  var dropActive = false;
  var dragDepth = 0;
  var targetEnvironment = null;
  var targetEnvironmentError = null;
  var targetEnvironmentLoading = false;
  var targetEnvironmentLoadId = 0;
  var diagnosisPresetStatus = {
    ok: false,
    code: "E-PRESET-02",
    entry: null,
    validCount: 0,
    entries: []
  };

  var attachErrorMessages = {
    "E-ATTACH-02":
      "ファイルを読み取れませんでした。移動や削除がないか、アクセス権を確認してください。",
    "E-ATTACH-03":
      "このブックにはマクロがありません。選んだファイルが正しいか確認してください。",
    "E-ATTACH-04":
      "このブックはファイル全体がパスワードで暗号化されているため、読み取れません。" +
      "Excel で開いてパスワードを外したコピーを保存し、そのコピーを読み込んでください。"
  };

  // Attach failures the run cannot continue past. They are shown on the
  // screen itself instead of a toast that fades: nothing else can happen
  // until a different file is chosen, so the reason has to stay visible.
  var blockingAttachErrors = ["E-ATTACH-03", "E-ATTACH-04"];
  var attachErrorTitles = {
    "E-ATTACH-03": "マクロが見つかりません",
    "E-ATTACH-04": "パスワードで保護されています"
  };

  var generalErrorMessages = {
    "E-GEN-01":
      "コードファイルを作成できませんでした。保存先の書き込み権限と空き容量を確認してください。",
    "E-GEN-02":
      "依頼テンプレートを読み込めませんでした。templates\\request-template.txt の存在、UTF-8 形式、差し込み変数を確認してください。",
    "E-GEN-03":
      "依頼文をクリップボードへコピーできませんでした。少し待って、もう一度お試しください。",
    "E-GEN-04":
      "クリップボードからAIの返答を読み取れませんでした。" +
      "ほかのアプリがクリップボードを使っている可能性があります。" +
      "少し待ってもう一度お試しください。Ctrl+Vでも貼り付けられます。",
    "E-PASTE-01":
      "貼り付けるコードがありません。チャット AI のコードブロックをコピーして、もう一度お試しください。",
    "E-PRESET-01":
      "ひな形を読み取れませんでした。presets フォルダの Markdown を確認してください。",
    "E-PRESET-02":
      "診断のひな形は 1 つだけ置いてください。presets\\01_診断 フォルダを確認してください。",
    "E-SYS-01":
      "WebView2 Runtime が見つかりません。起動時の案内に従って配布元へ連絡してください。",
    "E-SYS-02":
      "処理を完了できませんでした。作業状態を保ったまま、もう一度お試しください。"
  };

  var buildErrorMessages = {
    "E-BUILD-01":
      "ビルド処理を完了できませんでした。もう一度ビルドし、再発する場合は管理担当へ連絡してください。",
    "E-BUILD-02":
      "読み直し検証で一致しなかったため、出力ファイルを破棄しました。もう一度ビルドしてください。",
    "E-BUILD-03":
      "出力ファイルを書き込めませんでした。同名ファイルを開いていないか、保存先の権限を確認してください。",
    "E-BUILD-04":
      "元のブックのマクロが、読み込んだときから変わっています。出力は作成していません。ブックを読み込み直して、依頼を作り直してください。"
  };

  var diffReportErrorMessage =
    "差分 HTML ファイルを作成できませんでした。改修版ブックは正常に作成されています。";

  var resultNoteErrorMessage =
    "改修の概要メモ（result.md）を作成できませんでした。改修版ブックは正常に作成されています。";

  var buildSlowMessage =
    "ビルドに時間がかかっています。処理は続いているので、" +
    "終わるまでこのままお待ちください。";

  var buildResultLabels = {
    written: "書き戻し・検証 OK",
    verify_failed: "読み直し検証で不一致",
    io_error: "書き戻し失敗",
    skipped_no_change: "変更なし"
  };

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  // The older helper kept its call sites; it now produces the same
  // button as the rest of the flow.
  function createActionButton(label, className, action) {
    var classes = String(className || "");
    var kind = "";
    var extra = classes
      .split(/\s+/)
      .filter(function (name) {
        return name && name.indexOf("action-button") !== 0;
      })
      .join(" ");

    if (classes.indexOf("action-button--primary") >= 0) {
      kind = "primary";
    } else if (classes.indexOf("action-button--danger") >= 0) {
      kind = "danger";
    }
    return createFlowButton(label, action, {
      kind: kind,
      compact: classes.indexOf("action-button--compact") >= 0,
      className: extra
    });
  }

  function getFileName(path) {
    var parts = String(path || "").split(/[\\/]/);
    return parts[parts.length - 1] || "";
  }

  function getSelectedModule(state) {
    var selected = null;
    state.modules.some(function (module) {
      if (module.name === state.selectedModuleName) {
        selected = module;
        return true;
      }
      return false;
    });
    return selected;
  }

  function showToast(message, tone, action) {
    var toast;
    var label;
    var button;

    if (!elements || !elements.toastRegion) {
      return;
    }

    clearToast();
    elements.toastRegion.textContent = "";
    toast = createElement(
      "div",
      "toast toast--" + (tone || "info"));
    label = createElement(
      "strong",
      "toast-label",
      tone === "error"
        ? "確認してください"
        : tone === "warning"
          ? "注意"
          : tone === "info"
            ? "お知らせ"
            : "完了");
    toast.setAttribute(
      "role",
      tone === "error" ? "alert" : "status");
    toast.appendChild(label);
    toast.appendChild(createElement("span", "toast-message", message));
    if (action && action.name && action.label) {
      button = createElement(
        "button",
        "button button--compact toast-action",
        action.label);
      button.type = "button";
      button.setAttribute("data-toast-action", action.name);
      toast.appendChild(button);
    }
    elements.toastRegion.appendChild(toast);

    toastTimer = global.setTimeout(function () {
      toastTimer = null;
      dismissToast(toast);
    }, 5000);
  }

  // Leaving the screen is an animation too: the toast fades out rather
  // than disappearing between two frames.
  function dismissToast(toast) {
    if (!toast || !toast.parentNode) {
      return;
    }
    toast.classList.add("is-leaving");
    global.setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 220);
  }

  function clearToast() {
    if (!elements || !elements.toastRegion) {
      return;
    }
    if (toastTimer !== null) {
      global.clearTimeout(toastTimer);
      toastTimer = null;
    }
    Array.prototype.slice.call(
      elements.toastRegion.children
    ).forEach(dismissToast);
  }

  function copyText(value, label) {
    var clipboard = global.navigator &&
      global.navigator.clipboard;

    if (!clipboard ||
        typeof clipboard.writeText !== "function") {
      showToast(
        "クリップボードへコピーできませんでした。",
        "error");
      return Promise.resolve(false);
    }
    return clipboard.writeText(String(value || "")).then(
      function () {
        showToast(
          (label || "内容") + "をコピーしました。",
          "success");
        return true;
      },
      function () {
        showToast(
          "クリップボードへコピーできませんでした。",
          "error");
        return false;
      });
  }

  function announce(message) {
    if (!elements || !elements.statusAnnouncer) {
      return;
    }
    elements.statusAnnouncer.textContent = "";
    global.setTimeout(function () {
      elements.statusAnnouncer.textContent = message;
    }, 0);
  }

  // The sprite itself lives in icons.js so the screen renderers can draw
  // the same shapes without loading the shell.
  function createIcon(name, className) {
    var element = createElement(
      "span",
      "flow-icon " + (className || ""));

    element.setAttribute("aria-hidden", "true");
    element.innerHTML = global.MacroStudioIcons.markup(name);
    return element;
  }

  // Every button in the flow is built here so the two sizes stay the
  // only sizes: the normal action button and the compact one used in
  // toolbars and inside cards.
  function createFlowButton(label, action, options) {
    var settings = options || {};
    var button = createElement("button", "button");

    button.type = "button";
    button.setAttribute("data-action", action);
    if (settings.kind) {
      button.classList.add("button--" + settings.kind);
    }
    if (settings.compact) {
      button.classList.add("button--compact");
    }
    if (settings.className) {
      button.className += " " + settings.className;
    }
    if (settings.icon) {
      button.appendChild(createIcon(settings.icon, "flow-icon--small"));
    }
    button.appendChild(createElement("span", "button-label", label));
    if (settings.iconAfter) {
      button.appendChild(
        createIcon(settings.iconAfter, "flow-icon--small"));
    }
    if (settings.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
    return button;
  }

  function createTaskIntro(message) {
    return createElement("p", "task-intro", message);
  }

  function createTask(className) {
    return createElement(
      "section",
      "task " + (className || ""));
  }

  function createPanel(title, className) {
    var panel = createElement("section", "panel " + (className || ""));
    var header;

    if (title) {
      header = createElement("div", "panel-header");
      header.appendChild(createElement("span", "", title));
      panel.appendChild(header);
    }
    return panel;
  }

  // Progressive disclosure: the main work stays visible, the optional
  // detail opens in place under a label that says what it opens.
  function createDisclosure(key, label, content, options) {
    var settings = options || {};
    var open = disclosureOpen[key] === true;
    var box = createElement(
      "div",
      "disclosure " + (settings.className || ""));
    var trigger = createElement("button", "disclosure-trigger");
    var body = createElement("div", "disclosure-body");
    var inner = createElement("div", "disclosure-inner");

    trigger.type = "button";
    trigger.setAttribute("data-action", "toggle-disclosure");
    trigger.setAttribute("data-disclosure", key);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    trigger.appendChild(
      createIcon("chevron", "flow-icon--small disclosure-chevron"));
    trigger.appendChild(createElement("span", "", label));
    if (settings.note) {
      trigger.appendChild(
        createElement("span", "disclosure-note", settings.note));
    }
    box.setAttribute("data-open", open ? "true" : "false");
    box.setAttribute("data-disclosure-box", key);
    inner.appendChild(content);
    body.appendChild(inner);
    box.appendChild(trigger);
    box.appendChild(body);
    return box;
  }

  function createDropIcon() {
    var icon = createElement("span", "drop-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML =
      '<svg viewBox="0 0 24 24">' +
      '<path d="M6 2h8l4 4v16H6z"></path>' +
      '<path d="M14 2v5h5"></path>' +
      '<path d="M12 18v-6"></path>' +
      '<path d="m9 15 3-3 3 3"></path>' +
      "</svg>";
    return icon;
  }

  function isBlockingAttachError(error) {
    return Boolean(error) &&
      blockingAttachErrors.indexOf(error.code) >= 0;
  }

  function createAttachErrorCard(error) {
    var card = createElement("section", "inline-error-card");
    var code = error.code;

    card.setAttribute("role", "alert");
    card.appendChild(createElement("span", "inline-error-code", code));
    card.appendChild(createElement(
      "h2",
      "",
      getFileName(error.path) || attachErrorTitles[code]));
    card.appendChild(createElement(
      "p",
      "",
      attachErrorMessages[code]));
    return card;
  }

  function createTargetEnvironmentErrorCard(error) {
    var card = createElement("section", "inline-error-card");

    card.setAttribute("role", "alert");
    card.appendChild(createElement(
      "span",
      "inline-error-code",
      "E-ENV-01"));
    card.appendChild(createElement(
      "h2",
      "",
      "想定動作環境を読み込めません"));
    card.appendChild(createElement(
      "p",
      "",
      "environment\\target-environment.json を確認してください。"));
    if (error && error.message) {
      card.appendChild(createElement(
        "p",
        "inline-error-detail",
        String(error.message)));
    }
    return card;
  }

  function isTargetEnvironmentReady() {
    return targetEnvironment !== null &&
      targetEnvironmentError === null &&
      !targetEnvironmentLoading;
  }

  function isDiagnosisPresetReady() {
    return diagnosisPresetStatus.ok === true &&
      diagnosisPresetStatus.entry !== null;
  }

  function createDiagnosisPresetErrorCard() {
    var card = createElement("div", "inline-error-card");

    card.setAttribute("role", "alert");
    card.appendChild(createElement(
      "span",
      "inline-error-code",
      "E-PRESET-02"));
    card.appendChild(createElement(
      "h2",
      "",
      "診断のひな形を 1 つにしてください"));
    card.appendChild(createElement(
      "p",
      "",
      "presets\\01_診断 に有効な Markdown を 1 つだけ置いてください。"));
    return card;
  }

  function getPresetEntries(state) {
    var presets = state.appInfo && state.appInfo.presets &&
      Array.isArray(state.appInfo.presets.repair)
      ? state.appInfo.presets.repair
      : [];

    return global.MacroStudioPreset.describeAll(presets, "repair");
  }

  function resolveDiagnosisPreset(appInfo) {
    var presets = appInfo && appInfo.presets &&
      Array.isArray(appInfo.presets.diagnose)
      ? appInfo.presets.diagnose
      : [];
    var entries = global.MacroStudioPreset.describeAll(
      presets,
      "diagnose");
    var valid = entries.filter(function (entry) {
      return entry.valid;
    });

    if (valid.length !== 1) {
      return {
        ok: false,
        code: "E-PRESET-02",
        entry: null,
        validCount: valid.length,
        entries: entries
      };
    }
    return {
      ok: true,
      code: "",
      entry: valid[0],
      validCount: 1,
      entries: entries
    };
  }

  function normalizePastedText(value) {
    var text = String(
      value === undefined || value === null ? "" : value);
    var lines = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
    var withoutFences = [];
    var blockEnd = 0;
    var sawAttribute = false;

    lines.forEach(function (line) {
      if (line.indexOf("```") !== 0) {
        withoutFences.push(line);
      }
    });
    lines = withoutFences;

    // An answer usually differs from the workbook at the end of a line
    // without meaning anything by it: models drop or add trailing spaces
    // as they format. Left in, such a line counts as changed and the
    // diff marks the invisible difference with one dot per space, which
    // reads as damage to code nobody touched. Only the end of the line
    // is trimmed - the indent and any spacing inside the line are the
    // code's own and are left exactly as written.
    lines = lines.map(function (line) {
      return line.replace(/[ \t]+$/, "");
    });

    while (blockEnd < lines.length) {
      if (/^\s*Attribute VB_/i.test(lines[blockEnd])) {
        sawAttribute = true;
        blockEnd += 1;
      } else if (/^\s*$/.test(lines[blockEnd])) {
        blockEnd += 1;
      } else {
        break;
      }
    }
    if (sawAttribute) {
      lines = lines.slice(blockEnd);
    }

    while (lines.length > 0 && /^\s*$/.test(lines[0])) {
      lines.shift();
    }
    while (lines.length > 0 &&
        /^\s*$/.test(lines[lines.length - 1])) {
      lines.pop();
    }

    return lines.length > 0
      ? lines.join("\r\n") + "\r\n"
      : "";
  }

  function padDatePart(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function createOutputTimestamp(dateValue) {
    var value = dateValue || new Date();

    return String(value.getFullYear()) +
      padDatePart(value.getMonth() + 1) +
      padDatePart(value.getDate()) +
      "_" +
      padDatePart(value.getHours()) +
      padDatePart(value.getMinutes()) +
      padDatePart(value.getSeconds());
  }

  function createCodeFileTimestamp(dateValue) {
    var value = dateValue || new Date();

    return String(value.getFullYear()) + "-" +
      padDatePart(value.getMonth() + 1) + "-" +
      padDatePart(value.getDate()) + " " +
      padDatePart(value.getHours()) + ":" +
      padDatePart(value.getMinutes()) + ":" +
      padDatePart(value.getSeconds());
  }

  function createBuildOutputName(book, timestamp, buildFileLabel) {
    var name = book && book.name ? String(book.name) : "";
    var extension = book && book.ext ? String(book.ext) : "";
    var baseName = name;
    var label = buildFileLabel ? String(buildFileLabel) : "";

    if (extension &&
        name.slice(-extension.length).toLowerCase() ===
          extension.toLowerCase()) {
      baseName = name.slice(0, -extension.length);
    }
    if (!label) {
      throw new Error("Build file label is missing.");
    }
    return baseName + "_" + label + "_" + timestamp + extension;
  }

  function joinFinalCode(attributes, normalizedCode) {
    var header = attributes || "";
    var code = normalizedCode || "";

    if (!header) {
      return code;
    }
    if (header.slice(-2) === "\r\n") {
      return header + code;
    }
    return header + "\r\n" + code;
  }

  function formatRunTimestamp(timestamp) {
    var match = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
      .exec(String(timestamp || ""));

    if (!match) {
      return String(timestamp || "");
    }
    return match[1] + "-" + match[2] + "-" + match[3] + " " +
      match[4] + ":" + match[5] + ":" + match[6];
  }

  function countModuleLines(module) {
    var rows;
    var counts = { added: 0, removed: 0 };

    if (module.status !== "changed" ||
        typeof module.pastedCode !== "string") {
      return counts;
    }
    rows = global.MacroStudioDiff.compare(
      module.code || "",
      module.pastedCode);
    rows.forEach(function (row) {
      if (row.type === "added" || row.type === "changed") {
        counts.added += 1;
      }
      if (row.type === "removed" || row.type === "changed") {
        counts.removed += 1;
      }
    });
    return counts;
  }

  // A short note a person can read months later, without the app: what
  // was asked for, what the AI said it did, and what actually changed.
  function createResultMarkdown(state, timestamp) {
    var lines = [];
    var changed = state.modules.filter(function (module) {
      return module.status === "changed";
    });
    var untouched = state.modules.filter(function (module) {
      return module.status !== "changed";
    });
    var mappingRows = state.repairResultEngine === "対応表による置換" &&
      state.intakeResult && state.intakeResult.mapping &&
      Array.isArray(state.intakeResult.mapping.rows)
      ? state.intakeResult.mapping.rows
      : [];
    var summary = mappingRows.length > 0
      ? mappingRows.length + "種類の文字列を、確認した対応表どおりに置き換えました。"
      : (state.intakeResult && state.intakeResult.summary
        ? String(state.intakeResult.summary)
        : "");

    function tableText(value) {
      return String(value === undefined || value === null ? "" : value)
        .replace(/`/g, "\\`")
        .replace(/\|/g, "\\|");
    }

    lines.push("# " + state.book.name + " 改修メモ");
    lines.push("");
    lines.push("- 実行日時: " + formatRunTimestamp(timestamp));
    lines.push("- 依頼の目的: " + (state.presetName || "（指定なし）"));
    lines.push("- 依頼番号: " + (state.repairRequestId || "（なし）"));
    lines.push("- 作成した改修済みブック: " + state.outputName);
    lines.push("- 元のブック: " + state.book.name + "（変更していません）");
    lines.push("");
    lines.push("## 改修内容");
    lines.push("");
    if (summary) {
      summary.replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
        lines.push(line);
      });
    } else {
      lines.push("（返答に要約は入っていませんでした）");
    }
    lines.push("");
    if (mappingRows.length > 0) {
      lines.push("## 置換の対応表");
      lines.push("");
      lines.push("| 種類 | 置換前 | 置換後 | 件数 | 出現箇所 |");
      lines.push("|---|---|---|---:|---|");
      mappingRows.forEach(function (row) {
        var places = (row.occurrences || []).map(function (occurrence) {
          return occurrence.module + " / " +
            (occurrence.procedure || "-") + " / " +
            occurrence.line + "行目";
        }).join("、");
        lines.push(
          "| " + tableText(row["class"]) +
          " | `" + tableText(row.from) +
          "` | `" + tableText(row.to) +
          "` | " + String(row.count || 0) +
          " | " + tableText(places) + " |");
      });
      lines.push("");
    }
    lines.push("## 変更したモジュール");
    lines.push("");
    if (changed.length === 0) {
      lines.push("（ありません）");
    } else {
      lines.push("| モジュール | 種類 | 追加 | 削除 |");
      lines.push("|---|---|---|---|");
      changed.forEach(function (module) {
        var counts = countModuleLines(module);

        lines.push(
          "| " + module.name +
          (module.isNew === true ? "（新規）" : "") +
          " | " + (module.typeLabel || module.type) +
          " | +" + counts.added +
          " | \u2212" + counts.removed + " |");
      });
    }
    lines.push("");
    lines.push("## 変更しなかったモジュール");
    lines.push("");
    if (untouched.length === 0) {
      lines.push("（ありません）");
    } else {
      untouched.forEach(function (module) {
        lines.push(
          "- " + module.name +
          "（" + (module.typeLabel || module.type) + "）");
      });
    }
    lines.push("");
    lines.push(global.MacroStudioHandover.sections(state));
    lines.push("## このフォルダのファイル");
    lines.push("");
    lines.push("- diagnose-request.md … 診断のためAIへ渡した第1依頼");
    lines.push("- source-code.md … 改修前のコード全文");
    lines.push("- diagnosis.md … 受理した診断結果");
    if (state.repairRequestFilePath) {
      lines.push("- repair-request.md … 改修のためAIへ渡した第2依頼");
    }
    lines.push("- " + state.outputName + " … 改修済みブック");
    lines.push(
      "- " +
      global.MacroStudioState.getDiffReportName(
        state.book,
        state.outputDateStamp) +
      " … 変更内容（全モジュール）");
    lines.push("- result.md … このメモ");
    lines.push("");
    return lines.join("\r\n");
  }

  function createBuildModules(state) {
    var modules = [];

    state.modules.forEach(function (module) {
      var item;

      if (module.status !== "changed" || module.accepted !== true) {
        return;
      }
      if (typeof module.pastedCode !== "string") {
        throw new Error(
          "Accepted module has no code: " + module.name);
      }
      item = {
        name: module.name,
        code: module.isNew === true
          ? module.pastedCode
          : joinFinalCode(
            module.attributes,
            module.pastedCode)
      };
      if (module.isNew === true) {
        item.isNew = true;
      }
      modules.push(item);
    });
    return modules;
  }

  function createDiffWorkspace(state, module) {
    var workspace = createElement(
      "div",
      "step-three-workspace step-three-workspace--diff");
    var toolbar = createElement("div", "diff-toolbar");
    var resultGroup = createElement("div", "diff-result-group");
    var result = createElement(
      "span",
      "diff-result diff-result--" + module.status,
      module.status === "unchanged"
        ? "変更なし"
        : "変更 " + module.changedLineCount + " 行");
    var actions = createElement("div", "diff-actions");
    var rows = global.MacroStudioDiff.compare(
      module.code || "",
      module.pastedCode || "");
    var tableHost = createElement("div", "diff-table-host");
    var changeBlocks =
      global.MacroStudioDiffView.assignChangeBlocks(rows);
    var previous = createActionButton(
      "↑ 前の変更",
      "action-button--secondary action-button--compact",
      "previous-change");
    var next = createActionButton(
      "↓ 次の変更",
      "action-button--secondary action-button--compact",
      "next-change");
    var counter = createElement(
      "span",
      "diff-change-counter",
      changeBlocks > 0 ? "1/" + changeBlocks : "0/0");
    var contextToggle;
    var wrapToggle;
    var editButton;

    result.setAttribute("role", "status");
    result.title = "追加・削除・変更された行の合計です";
    resultGroup.appendChild(result);
    if (module.status === "unchanged") {
      resultGroup.appendChild(createElement(
        "span",
        "diff-result-note",
        "現在のコードと同一です"));
    } else if (
        global.MacroStudioDiffView.hasWhitespaceOnlyChange(rows)) {
      resultGroup.appendChild(createElement(
        "span",
        "diff-result-note",
        "空白のみの変更を含む"));
    }

    previous.disabled = changeBlocks === 0;
    next.disabled = changeBlocks === 0;
    actions.appendChild(previous);
    actions.appendChild(next);
    actions.appendChild(counter);
    contextToggle = createActionButton(
      "変更箇所のみ",
      "action-button--secondary action-button--compact diff-toggle",
      "toggle-diff-context");
    contextToggle.setAttribute(
      "aria-pressed",
      module.showChangesOnly ? "true" : "false");
    contextToggle.classList.toggle(
      "is-active",
      module.showChangesOnly === true);
    wrapToggle = createActionButton(
      "折り返し",
      "action-button--secondary action-button--compact diff-toggle",
      "toggle-diff-wrap");
    wrapToggle.setAttribute(
      "aria-pressed",
      module.wrapDiff !== false ? "true" : "false");
    wrapToggle.classList.toggle(
      "is-active",
      module.wrapDiff !== false);
    wrapToggle.title = "長い行を折り返して全文を表示します";
    actions.appendChild(contextToggle);
    actions.appendChild(wrapToggle);
    editButton = createActionButton(
      "手動修正",
      "action-button--secondary action-button--compact",
      "edit-paste");
    editButton.title = "貼り付けたコードを右の欄で直接修正します";
    editButton.disabled = state.busyAction !== null;
    actions.appendChild(editButton);

    toolbar.appendChild(resultGroup);
    toolbar.appendChild(actions);
    workspace.appendChild(toolbar);
    workspace.appendChild(tableHost);
    global.MacroStudioDiffView.renderDiff(
      tableHost,
      rows,
      module.showChangesOnly === true,
      module.wrapDiff !== false);
    if (module.isNew === true) {
      var placeholder = createElement(
        "div",
        "diff-new-placeholder");
      placeholder.appendChild(createElement(
        "span",
        "diff-new-placeholder-icon",
        "＋"));
      placeholder.appendChild(createElement(
        "p",
        "",
        "新規モジュール — 元のコードはありません。" +
          "全行が追加行になります。"));
      tableHost.insertBefore(placeholder, tableHost.firstChild);
    }
    return workspace;
  }

  function createEditWorkspace(state, module) {
    var workspace = createElement(
      "div",
      "step-three-workspace step-three-workspace--edit");
    var toolbar = createElement("div", "diff-toolbar");
    var resultGroup = createElement("div", "diff-result-group");
    var actions = createElement("div", "diff-actions");
    var apply = createActionButton(
      "修正を反映",
      "action-button--primary action-button--compact",
      "apply-paste-edit");
    var cancel = createActionButton(
      "編集をやめる",
      "action-button--secondary action-button--compact",
      "cancel-paste-edit");
    var panes = createElement(
      "div",
      "edit-workspace-panes edit-workspace-panes--single");
    var editPane = createElement("section", "code-pane edit-pane");
    var header = createElement("header", "code-pane-header");
    var textarea = createElement("textarea", "edit-textarea");

    resultGroup.appendChild(createElement(
      "span",
      "edit-mode-label",
      "手動修正"));
    resultGroup.appendChild(createElement(
      "span",
      "diff-result-note",
      "軽微な写し間違いを直して反映します"));
    apply.disabled = state.busyAction !== null;
    cancel.disabled = state.busyAction !== null;
    actions.appendChild(apply);
    actions.appendChild(cancel);
    toolbar.appendChild(resultGroup);
    toolbar.appendChild(actions);

    header.appendChild(createElement(
      "span",
      "",
      "貼り付けたコード（編集中）"));
    textarea.id = "paste-edit-textarea";
    textarea.value = pasteEditDraft;
    textarea.spellcheck = false;
    textarea.setAttribute("wrap", "off");
    textarea.setAttribute("autocomplete", "off");
    textarea.setAttribute(
      "aria-label",
      module.name + " の貼り付けたコードを編集");
    textarea.disabled = state.busyAction !== null;
    editPane.appendChild(header);
    editPane.appendChild(textarea);
    panes.appendChild(editPane);
    workspace.appendChild(toolbar);
    workspace.appendChild(panes);
    return workspace;
  }

  function getNewModuleNameError(state, name) {
    var identifierPattern =
      /^\p{L}[\p{L}\p{Nd}_]*$/u;
    var duplicate = false;

    if (typeof name !== "string" ||
        name.length === 0 ||
        name.length > 31 ||
        /[\uD800-\uDFFF]/.test(name) ||
        !identifierPattern.test(name)) {
      return "モジュール名は31文字以内のVBA識別子で入力してください。";
    }
    state.modules.some(function (module) {
      if (module.name.toLowerCase() ===
          name.toLowerCase()) {
        duplicate = true;
        return true;
      }
      return false;
    });
    if (duplicate) {
      return "同じ名前のモジュールが既にあります。";
    }
    return "";
  }

  // The tree counts lines the same way the diff report does: added and
  // removed, in the same colours, so the two views agree.
  function createModuleCounts(module) {
    var counts = createElement("span", "module-counts");
    var rows;
    var added = 0;
    var removed = 0;

    if (module.status === "changed" &&
        typeof module.pastedCode === "string") {
      rows = global.MacroStudioDiff.compare(
        module.code || "",
        module.pastedCode);
      rows.forEach(function (row) {
        if (row.type === "added" || row.type === "changed") {
          added += 1;
        }
        if (row.type === "removed" || row.type === "changed") {
          removed += 1;
        }
      });
    }
    counts.appendChild(createElement(
      "span",
      "module-count module-count--add",
      "+" + added));
    counts.appendChild(createElement(
      "span",
      "module-count module-count--del",
      "\u2212" + removed));
    return counts;
  }

  function getModuleFlowState(state, module) {
    if (module.status === "changed") {
      return { dot: "changed" };
    }
    if (module.status === "unchanged") {
      return { dot: "excluded" };
    }
    return { dot: "excluded" };
  }

  // Inside the review disclosure: pick a module to look at. Nothing
  // here changes what gets built.
  //
  // The tree is grouped the way the VBE project tree is, so a module is
  // found where the user expects it rather than in one flat list.
  var MODULE_GROUPS = ["standard", "class", "form", "document"];

  function createModuleItem(state, module) {
    var item = createElement("li", "");
    var button = createElement("button", "module-item");
    var flowState = getModuleFlowState(state, module);

    button.type = "button";
    button.setAttribute("data-action", "select-module");
    button.setAttribute("data-module-name", module.name);
    button.setAttribute("data-module-row-name", module.name);
    button.classList.toggle(
      "is-active",
      module.name === state.selectedModuleName);
    button.disabled = state.busyAction !== null;
    button.appendChild(
      createElement("span", "module-dot " + flowState.dot, ""));
    button.appendChild(createElement("span", "module-name", module.name));
    button.appendChild(createModuleCounts(module));
    item.appendChild(button);
    return item;
  }

  function createModulePane(state, title) {
    var pane = createElement("aside", "panel module-pane");
    var shown = state.modules.filter(function (module) {
      return global.MacroStudioScreens.isImported(module);
    });

    pane.appendChild(createElement("div", "module-pane-title", title));
    MODULE_GROUPS.forEach(function (group) {
      var members = shown.filter(function (module) {
        return module.type === group;
      });
      var list;

      if (members.length === 0) {
        return;
      }
      pane.appendChild(createElement(
        "div",
        "module-group-title",
        members[0].typeLabel || group));
      list = createElement("ul", "module-list");
      members.forEach(function (module) {
        list.appendChild(createModuleItem(state, module));
      });
      pane.appendChild(list);
    });
    return pane;
  }

  // ---- screen 4: the questions a preset asks ----

  // One question at a time. The beads across the top say how many
  // there are and which one this is; long forms keep the ends and the
  // neighbourhood of the current question, and fold the rest away.
  var BEAD_LIMIT = 9;

  function createChangeDetail(state) {
    var layout = createElement("div", "code-layout");
    var column = createElement("div", "diff-review-column");
    var selected = getSelectedModule(state);

    layout.appendChild(createModulePane(state, "取り込んだモジュール"));
    if (!selected ||
        !global.MacroStudioScreens.isImported(selected)) {
      column.appendChild(createElement(
        "p",
        "review-empty",
        "左の一覧からモジュールを選ぶと、変更内容が出ます。"));
    } else if (state.pasteEditing) {
      column.appendChild(createEditWorkspace(state, selected));
    } else {
      column.appendChild(createDiffWorkspace(state, selected));
    }
    layout.appendChild(column);
    return layout;
  }

  // The review screen shows what came in. Deciding to keep it is the
  // act of pressing next, so there is no separate accept button.
  // The short way shows what the AI said it changed, and nothing else:
  // no module list and no diff. The checks behind it are the same ones
  // the detailed screen relies on - they have already run by now.
  function createScreen6(state) {
    var api = global.MacroStudioScreens;
    var changed;
    var unchanged;
    var open;
    var task;
    var headline;
    var kindWarning;

    changed = api.countChanged(state);
    unchanged = api.countUnchangedImports(state);
    open = disclosureOpen["change-detail"] === true;
    task = createTask("task--wide" + (open ? " task--fill" : ""));
    headline = createElement("div", "headline-card");
    kindWarning = state.intakeResult && state.intakeResult.kindWarning
      ? state.intakeResult.kindWarning
      : "";

    task.appendChild(createTaskIntro(
      "取り込んだ内容です。右下の「次へ」でブックの作成へ進みます。"));

    headline.appendChild(createIcon("code", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      changed + "個のモジュールへ変更を取り込みました" +
        (unchanged > 0 ? "（" + unchanged + "個は変更なし）" : "")));
    headline.appendChild(createElement(
      "p",
      "headline-preview",
      kindWarning
        ? "確かめてほしい点があります。中身を見てください。"
        : "問題は見つかりません。中身を見るときは下を開いてください。"));
    // A warning never hides inside the disclosure.
    if (kindWarning) {
      headline.appendChild(createElement(
        "p",
        "headline-warning",
        kindWarning));
    }
    task.appendChild(headline);

    task.appendChild(createDisclosure(
      "change-detail",
      "変更内容を見る",
      createChangeDetail(state),
      {
        className: "disclosure--fill",
        note: changed + "モジュール"
      }));
    return task;
  }

  function getRunArtifactNames(state, withResults) {
    var names = ["diagnose-request.md", "source-code.md"];

    if (state.diagnosisFilePath) {
      names.push("diagnosis.md");
    }
    if (state.repairRequestFilePath) {
      names.push("repair-request.md");
    }
    if (withResults) {
      names = names.concat([
        state.outputName,
        global.MacroStudioState.getDiffReportName(
          state.book,
          state.outputDateStamp),
        "result.md"
      ]);
    }
    return names;
  }

  function createFolderContract(state, withResults) {
    var box = createElement("div", "folder-contract");
    var chips = createElement("div", "artifact-chips");

    box.appendChild(createElement(
      "div",
      "folder-path",
      state.runFolder || ""));
    getRunArtifactNames(state, withResults).forEach(function (name) {
      chips.appendChild(createElement("span", "artifact-chip", name));
    });
    box.appendChild(chips);
    return box;
  }

  function createFolderDisclosure(state, key, withResults) {
    return createDisclosure(
      key,
      "作成されるファイルの場所を見る",
      createFolderContract(state, withResults),
      { note: "この改修専用のフォルダ" });
  }

  function createBuildStatusIcon(tone) {
    var icon = createElement(
      "span",
      "build-status-icon build-status-icon--" + tone);

    icon.setAttribute("aria-hidden", "true");
    if (tone === "success") {
      icon.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="8.5"></circle>' +
        '<path d="m8.5 12 2.3 2.4 4.9-5"></path>' +
        "</svg>";
    } else {
      icon.innerHTML =
        '<svg viewBox="0 0 24 24">' +
        '<path d="M12 3.5 21 20H3Z"></path>' +
        '<path d="M12 9v5"></path>' +
        '<path d="M12 17.2v.1"></path>' +
        "</svg>";
    }
    return icon;
  }

  function createBuildResultTable(results) {
    var section = createElement("section", "build-panel");
    var heading = createElement(
      "h3",
      "build-panel-title",
      "モジュール別の結果");
    var tableWrap;
    var table;
    var thead;
    var headRow;
    var tbody;

    heading.id = "build-result-title";
    section.setAttribute("aria-labelledby", heading.id);
    section.appendChild(heading);
    if (!results || results.length === 0) {
      section.appendChild(createElement(
        "p",
        "build-empty-results",
        "モジュール別の結果はありません。"));
      return section;
    }

    tableWrap = createElement("div", "build-table-wrap");
    table = createElement("table", "build-table build-result-table");
    thead = createElement("thead");
    headRow = createElement("tr");
    tbody = createElement("tbody");
    ["モジュール", "結果"].forEach(function (label) {
      var cell = createElement("th", "", label);
      cell.scope = "col";
      headRow.appendChild(cell);
    });
    results.forEach(function (result) {
      var row = createElement("tr");
      var name = createElement(
        "th",
        "build-module-name",
        result.name || "ビルド全体");
      var value = createElement(
        "td",
        "build-result-value build-result-value--" +
          (result.result || "unknown"),
        buildResultLabels[result.result] || result.result || "失敗");

      name.scope = "row";
      row.appendChild(name);
      row.appendChild(value);
      tbody.appendChild(row);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    return section;
  }

  function createSummaryGrid(items) {
    var grid = createElement("div", "summary-grid");

    items.forEach(function (item) {
      var card = createElement("div", "summary-card");

      card.appendChild(createElement("div", "stat-label", item[0]));
      card.appendChild(createElement("div", "stat-value", item[1]));
      grid.appendChild(card);
    });
    return grid;
  }

  function createScreen7(state) {
    var task = createTask("task--wide");
    var api = global.MacroStudioScreens;
    var panel = createElement("div", "panel output-panel");
    var label = createElement("label", "field-label", "出力ファイル名");
    var input = createElement("input", "text-input");
    var newCount = 0;

    state.modules.forEach(function (module) {
      if (module.isNew === true && module.accepted === true) {
        newCount += 1;
      }
    });

    task.appendChild(createTaskIntro(
      "作成するファイル名を確認します。右下の「次へ」で作成を始めます。"));
    task.appendChild(createSummaryGrid([
      ["書き戻し", String(api.countAccepted(state))],
      ["変更なし", String(api.countUnchangedImports(state))],
      ["新規追加", String(newCount)],
      ["元ブック", "保持"]
    ]));

    label.htmlFor = "output-name";
    input.id = "output-name";
    input.type = "text";
    input.value = state.outputName;
    input.spellcheck = false;
    input.disabled = state.busyAction !== null;
    if (!api.isOutputNameValid(state)) {
      input.setAttribute("aria-invalid", "true");
    }
    panel.appendChild(label);
    panel.appendChild(input);
    panel.appendChild(createElement(
      "p",
      "field-help",
      "拡張子は " + (state.book ? state.book.ext : "") + " のままにします。"));
    task.appendChild(panel);
    task.appendChild(createFolderDisclosure(state, "output-folder", true));
    return task;
  }

  // ---- screen 10: building ----

  function createScreenBuilding() {
    var task = createTask("");
    var progress = createElement("section", "build-progress");
    var spinner = createElement("span", "spinner");
    var bar = createElement("div", "build-bar");

    spinner.setAttribute("aria-hidden", "true");
    bar.setAttribute("aria-hidden", "true");
    bar.appendChild(createElement("span", ""));
    progress.appendChild(spinner);
    progress.appendChild(createElement(
      "h2",
      "",
      "改修済みブックをビルドしています"));
    progress.appendChild(createElement(
      "p",
      "",
      "書き戻し後にブックを読み直して、モジュール名とコードを検証しています。"));
    progress.appendChild(bar);
    task.appendChild(progress);
    return task;
  }

  // ---- screen 11: done ----

  function createResultRow(label, fileName) {
    var row = createElement("div", "result-row");

    row.appendChild(createIcon("check", "flow-icon--small"));
    row.appendChild(createElement("span", "", label));
    row.appendChild(createElement("code", "", fileName));
    return row;
  }

  function createScreenDone(state) {
    var task = createTask("task--wide");
    var result = state.buildResult;
    var panel = createElement("div", "panel success-panel");
    var actions = createElement("div", "completion-actions");
    var list = createElement("div", "result-list");
    var rows = [
      ["診断のためAIへ渡した第1依頼", "diagnose-request.md"],
      ["元マクロのコード全文", "source-code.md"],
      ["受理した診断結果", "diagnosis.md"]
    ];

    if (state.repairRequestFilePath) {
      rows.push(["改修のためAIへ渡した第2依頼", "repair-request.md"]);
    }

    // A build that failed is the one ending that looks different: it
    // has no folder to show and something to try again.
    if (result && result.status === "error") {
      task.appendChild(createTaskIntro(
        "出力は作成していません。元のブックは変更されていません。"));
      panel = createElement("div", "panel failure-panel");
      panel.appendChild(createElement(
        "p",
        "failure-message",
        result.message));
      panel.appendChild(createBuildResultTable(result.results));
      task.appendChild(panel);
      actions = createElement("div", "task-actions");
      actions.appendChild(createFlowButton(
        "もう一度ビルドする",
        "retry-build",
        { kind: "primary" }));
      task.appendChild(actions);
      return task;
    }

    rows.push([
      "改修済みブック",
      result && result.outputPath
        ? getFileName(result.outputPath)
        : state.outputName
    ]);
    if (result && result.diffPath) {
      rows.push([
        "変更内容の確認レポート",
        getFileName(result.diffPath)
      ]);
    }
    if (result && result.resultPath) {
      rows.push(["改修の概要メモ", getFileName(result.resultPath)]);
    }

    panel.appendChild(createIcon("check", "success-icon"));
    panel.appendChild(createElement(
      "h2",
      "",
      "改修済みブックを作成しました"));
    panel.appendChild(createElement(
      "p",
      "",
      "作成したファイルは、すべてこのフォルダにまとまっています。"));
    panel.appendChild(createElement(
      "div",
      "folder-path",
      state.runFolder || ""));
    actions.appendChild(createFlowButton(
      "出力フォルダをエクスプローラーで開く",
      "open-run-folder",
      {
        kind: "primary",
        icon: "folder",
        disabled: state.busyAction !== null
      }));
    panel.appendChild(actions);

    rows.forEach(function (row) {
      list.appendChild(createResultRow(row[0], row[1]));
    });
    panel.appendChild(list);
    if (result && result.diffError) {
      panel.appendChild(createElement(
        "p",
        "result-note",
        diffReportErrorMessage));
    }
    // The summary note is reported the same way the diff report is: a
    // file this run could not write must not be read as this run's.
    if (result && result.resultError) {
      panel.appendChild(createElement(
        "p",
        "result-note",
        resultNoteErrorMessage));
    }
    // The result comes first: the workbook is built and the folder is one
    // press away. What is left to do is real, but it is not the headline,
    // so it opens from a line that says how much of it there is.
    panel.appendChild(createRemainingWork(state));
    task.appendChild(panel);
    return task;
  }

  // What this run could not do, in the order a person would do it. Every
  // line is a task, not a description: the tool has already said what it
  // verified, and this is the rest.
  function createRemainingWork(state) {
    var body = createElement("div", "remaining-work");
    var handover = global.MacroStudioHandover;
    var human = handover.humanTasks(state);
    var viewpoints = handover.testViewpoints(state);
    var total = human.length;

    viewpoints.forEach(function (group) {
      total += group.items.length;
    });
    body.appendChild(createElement(
      "p",
      "remaining-note",
      "このツールはマクロを実行しません。次の確認は行っていません。" +
        "同じ一覧が result.md にも入っています。"));
    // Only work that is actually here. A group with nothing in it is not
    // a heading with an empty list under it; it is left out.
    [{
      title: "コードの外にあるので、このツールでは直せないこと",
      items: human.map(function (task) {
        return task.title + " … " + task.detail;
      })
    }].concat(viewpoints).forEach(function (group) {
      var list = createElement("ul", "remaining-list");

      if (group.items.length === 0) {
        return;
      }
      body.appendChild(createElement("h3", "remaining-title", group.title));
      group.items.forEach(function (item) {
        list.appendChild(createElement("li", "", item));
      });
      body.appendChild(list);
    });
    return createDisclosure(
      "remaining-work",
      "このあと人が確かめること",
      body,
      { note: total + " 件" });
  }

  // ---- shell rendering ----

  function createWorkflowScreen(index) {
    return function (state) {
      return global.MacroStudioWorkflow.build(index, state);
    };
  }

  // β2 screens 0-5 live in screens/workflow.js. The established review,
  // output, build and done builders remain the β1.10 implementations.
  var screenBuilders = [
    createWorkflowScreen(0),
    createWorkflowScreen(1),
    createWorkflowScreen(2),
    createWorkflowScreen(3),
    createWorkflowScreen(4),
    createWorkflowScreen(5),
    createScreen6,
    createScreen7,
    createScreenBuilding,
    createScreenDone
  ];

  function renderProgress(state) {
    var described = global.MacroStudioScreens.describe(
      state,
      state.screen);
    var current = described.major;
    var majors = global.MacroStudioScreens.getMajors(state);

    // The bar always reserves the same number of columns, so it never
    // changes shape: what the run turns out to be only fills them in.
    var slots = global.MacroStudioScreens.majors.length;
    var grew = majors.length >
      elements.progressList.querySelectorAll(".progress-step").length;
    var index;

    elements.progressList.textContent = "";
    elements.progressList.style.gridTemplateColumns =
      "repeat(" + slots + ", minmax(0, 1fr))";
    majors.forEach(function (label, index) {
      var number = index + 1;
      var item = createElement("li", "");
      var step = createElement("div", "progress-step");
      var mark = createElement("span", "progress-number", "");

      step.classList.toggle("is-done", number < current);
      step.classList.toggle("is-active", number === current);
      // Steps that were not there a moment ago slide in, so the bar
      // reads as filling out rather than as jumping.
      if (grew && index > 0) {
        step.classList.add("is-new");
        step.style.animationDelay = ((index - 1) * 60) + "ms";
      }
      if (number < current) {
        mark.appendChild(createIcon("check", "flow-icon--small"));
      } else {
        mark.textContent = String(number);
      }
      step.appendChild(mark);
      step.appendChild(createElement("span", "progress-label", label));
      item.appendChild(step);
      elements.progressList.appendChild(item);
    });
    for (index = majors.length; index < slots; index += 1) {
      elements.progressList.appendChild(
        createElement("li", "progress-slot"));
    }
    elements.progressFill.style.width =
      (described.major / global.MacroStudioScreens.majors.length * 100) + "%";
  }

  // The footer is not rebuilt on every render. Rebuilding swapped the
  // buttons out from under the cursor, which killed their transitions
  // and read as a flicker on every click.
  function updateFlowButton(button, label, disabled) {
    var text = button.querySelector(".button-label");

    if (text && text.textContent !== label) {
      text.textContent = label;
    }
    if (button.disabled !== disabled) {
      button.disabled = disabled;
    }
  }

  function renderFooter(state) {
    var api = global.MacroStudioScreens;
    var done = api.isTerminal(state, state.screen);
    var forwardAction = done ? "finish" : "go-next";
    var forwardLabel = done
      ? "完了"
      : (state.screen === api.repairInputScreen &&
          api.getEngine(state) === "対応表による置換"
        ? "この内容で置き換える"
        : "次へ");
    var forwardReady = done
      ? api.canFinish(state, state.screen)
      : global.MacroStudioState.canGoNext();
    var back = elements.footerActions.querySelector(
      '[data-action="go-back"]');
    var forward = elements.footerActions.querySelector(
      '[data-action="go-next"],[data-action="finish"]');

    if (state.screen === api.diagnoseScreen &&
        (!isTargetEnvironmentReady() || !isDiagnosisPresetReady())) {
      forwardReady = false;
    }

    if (!back) {
      back = createFlowButton("戻る", "go-back", { icon: "arrowLeft" });
      elements.footerActions.appendChild(back);
    }
    // Only the shape of the forward button changes between screens, so
    // it is replaced only when it actually becomes a different button.
    if (!forward ||
        forward.getAttribute("data-action") !== forwardAction) {
      if (forward) {
        elements.footerActions.removeChild(forward);
      }
      forward = done
        ? createFlowButton("完了", "finish", {
          kind: "primary",
          icon: "check"
        })
        : createFlowButton("次へ", "go-next", {
          kind: "primary",
          iconAfter: "arrowRight"
        });
      elements.footerActions.appendChild(forward);
    }
    updateFlowButton(back, "戻る", !global.MacroStudioState.canGoBack());
    updateFlowButton(forward, forwardLabel, !forwardReady);
    elements.footerActions.setAttribute(
      "data-screen",
      String(state.screen));
  }

  // True when the only thing that moved is which card is selected, so
  // the screen can be painted rather than rebuilt.
  // The box the person is writing in, if there is one.
  //
  // Typing goes through the state, and the state repaints the screen.
  // That is fine for everything except the box the characters are
  // coming from: replacing that element takes the caret, the selection
  // and any half-finished IME word with it, so one keystroke throws
  // away the next. Whenever such a box has the focus, the screen is
  // patched in place instead of rebuilt.
  function focusedEditor() {
    var node = document.activeElement;

    if (!node || !elements.main.contains(node)) {
      return null;
    }
    if (node.isContentEditable === true) {
      return node;
    }
    return node.tagName === "INPUT" ||
      node.tagName === "TEXTAREA" ||
      node.tagName === "SELECT"
      ? node
      : null;
  }

  function sameKind(current, next) {
    if (current.nodeType !== next.nodeType) {
      return false;
    }
    return current.nodeType !== 1 || current.tagName === next.tagName;
  }

  function patchAttributes(current, next) {
    var attributes = current.attributes;
    var index;
    var name;

    for (index = attributes.length - 1; index >= 0; index -= 1) {
      name = attributes[index].name;
      if (!next.hasAttribute(name)) {
        current.removeAttribute(name);
      }
    }
    attributes = next.attributes;
    for (index = 0; index < attributes.length; index += 1) {
      name = attributes[index].name;
      if (current.getAttribute(name) !== attributes[index].value) {
        current.setAttribute(name, attributes[index].value);
      }
    }
  }

  // What a field holds is not an attribute, so it has to be carried
  // across by hand - except for the field being written in, whose
  // contents are the one thing on screen the state was just told about.
  function patchFieldValue(current, next, keep) {
    if (current === keep ||
        (current.tagName !== "INPUT" && current.tagName !== "TEXTAREA")) {
      return;
    }
    if (current.value !== next.value) {
      current.value = next.value;
    }
    if (current.checked !== next.checked) {
      current.checked = next.checked;
    }
  }

  function holdsEditor(node, keep) {
    return node === keep ||
      (typeof node.contains === "function" && node.contains(keep));
  }

  function patchChildren(current, next, keep) {
    var incoming = Array.prototype.slice.call(next.childNodes);
    var index;
    var existing;
    var last;

    for (index = 0; index < incoming.length; index += 1) {
      existing = current.childNodes[index];
      if (!existing) {
        current.appendChild(incoming[index]);
      } else if (sameKind(existing, incoming[index])) {
        patchNode(existing, incoming[index], keep);
      } else if (holdsEditor(existing, keep)) {
        // The screen changed shape around the box being written in.
        // Rather than lose it, the new node goes beside it.
        current.insertBefore(incoming[index], existing);
      } else {
        current.replaceChild(incoming[index], existing);
      }
    }
    while (current.childNodes.length > incoming.length) {
      last = current.lastChild;
      if (holdsEditor(last, keep)) {
        break;
      }
      current.removeChild(last);
    }
  }

  // Bring the screen on display in line with the one just built, node
  // by node, so that everything derived from the state stays current
  // without anything being thrown away that did not have to be.
  function patchNode(current, next, keep) {
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) {
        current.nodeValue = next.nodeValue;
      }
      return;
    }
    patchAttributes(current, next);
    patchFieldValue(current, next, keep);
    patchChildren(current, next, keep);
  }

  function renderMain(state, direction) {
    var described = global.MacroStudioScreens.describe(state, state.screen);
    var screen = createElement("section", "screen");
    var header = createElement("header", "screen-header");
    var workspace = createElement("div", "workspace screen-body");
    var live;
    var keep;

    screen.setAttribute("data-screen", String(state.screen));
    if (direction) {
      screen.classList.add("screen-enter-" + direction);
    }
    header.appendChild(createElement(
      "span",
      "step-tag",
      "手順 " + described.major + " · " + described.sub));
    header.appendChild(
      createElement("h1", "screen-title", described.title));
    header.appendChild(
      createElement("span", "screen-meta", described.meta));
    screen.appendChild(header);

    // Only the review screen is a code layout. Asking and importing now
    // share one ordinary screen, so it is centred like the rest.
    if (state.screen === global.MacroStudioScreens.reviewScreen) {
      workspace.classList.add("workspace--code");
    } else {
      workspace.classList.add("workspace--centered");
    }
    if (state.screen === global.MacroStudioScreens.diagnoseScreen &&
        targetEnvironmentError) {
      workspace.appendChild(
        createTargetEnvironmentErrorCard(targetEnvironmentError));
    }
    if (state.screen === global.MacroStudioScreens.diagnoseScreen &&
        !isDiagnosisPresetReady()) {
      workspace.appendChild(createDiagnosisPresetErrorCard());
    }
    workspace.appendChild(screenBuilders[state.screen](state));
    screen.appendChild(workspace);

    live = elements.main.querySelector(".screen");
    keep = focusedEditor();
    // Only a screen that is still the same screen can be patched, and
    // only while someone is writing in it. Every other repaint is the
    // wholesale one it always was.
    if (keep &&
        live &&
        live.getAttribute("data-screen") === String(state.screen)) {
      patchNode(live, screen, keep);
    } else {
      elements.main.textContent = "";
      elements.main.appendChild(screen);
    }
    elements.actionContext.textContent = described.context;
  }

  function render(state) {
    var direction = null;

    if (lastRenderedScreen !== null &&
        lastRenderedScreen !== state.screen) {
      direction = state.screen > lastRenderedScreen ? "forward" : "back";
    }
    // The repair preset folder is re-read every time findings are shown.
    if (state.screen === global.MacroStudioScreens.findingsScreen &&
        lastRenderedScreen !== global.MacroStudioScreens.findingsScreen &&
        global.hostBridge) {
      lastRenderedScreen = global.MacroStudioScreens.findingsScreen;
      loadAppInfo();
    }
    // The environment file is deliberately re-read whenever the first
    // diagnosis-stage screen is entered. Editing the file does not require an
    // application restart.
    if (state.screen === global.MacroStudioScreens.diagnoseScreen &&
        lastRenderedScreen !== global.MacroStudioScreens.diagnoseScreen &&
        global.hostBridge) {
      lastRenderedScreen = global.MacroStudioScreens.diagnoseScreen;
      loadTargetEnvironment();
    }
    lastRenderedScreen = state.screen;
    renderProgress(state);
    renderMain(state, direction);
    renderFooter(state);
    if (state.screen !== global.MacroStudioScreens.buildScreen) {
      buildStarted = false;
    } else if (!buildStarted) {
      buildStarted = true;
      buildBook();
    }
    if (global.MacroStudioWorkflow) {
      global.MacroStudioWorkflow.enter(state);
    }
  }

  // What the read warning was about, in the words the user needs.
  //
  // The host reports which of its findings fired, because "incomplete"
  // covers two very different things. When the VBA source itself could
  // be short, the only honest thing is to say so plainly and name the
  // modules to compare. When only the workbook's internal bookkeeping
  // was off, the code was read in full and there is nothing to act on,
  // so the same sentence must not be used for both.
  function describeReadResult(data) {
    var read = data && data.read ? data.read : null;
    var partial = read && read.partialModules
      ? read.partialModules
      : [];
    var unreadable = read && read.unreadableModules
      ? read.unreadableModules
      : [];
    var recovered = read && read.recoveredOffsetModules
      ? read.recoveredOffsetModules
      : [];
    var level = read && read.level ? read.level : null;
    var names;
    var reason;

    if (!data || data.warning !== true) {
      return null;
    }
    // Without the host's breakdown nothing can be separated, so the
    // wording stays the careful one.
    if (level === "sourceDoubt" || level === null) {
      names = partial.concat(unreadable);
      return {
        level: "sourceDoubt",
        tone: "warning",
        headline: "一部をバイナリレベルで読み取れませんでした。",
        detail: names.length > 0
          ? names.join("、") +
            " のコードが途中までの可能性があります。" +
            "改修前後のコードを確認してください。"
          : "改修前後のコードを確認してください。"
      };
    }

    if (read.containerFallback === true) {
      reason = "ブックの中のマクロ部分が通常の場所になかったため、" +
        "別の経路から取り出しました。";
    } else if (recovered.length > 0) {
      reason = recovered.join("、") +
        " の位置情報がブックの記録と合わなかったため、" +
        "コード本体を探して読み取りました。";
    } else {
      reason = "ブック内部の管理情報に、規格どおりでない箇所がありました。";
    }
    return {
      level: "structureOnly",
      tone: "info",
      headline: "マクロのコードは全モジュール読み取れています。",
      detail: reason + "コードの読み取りには影響していません。"
    };
  }

  function getAttachWarningMessage(data) {
    var described = describeReadResult(data);

    if (!described) {
      return "";
    }
    return described.headline + described.detail;
  }

  function getHostErrorMessage(error) {
    if (error &&
        error.data &&
        typeof error.data.userMessage === "string" &&
        error.data.userMessage) {
      return error.data.userMessage;
    }
    if (attachErrorMessages[error.code]) {
      return attachErrorMessages[error.code];
    }
    if (buildErrorMessages[error.code]) {
      return buildErrorMessages[error.code];
    }
    if (generalErrorMessages[error.code]) {
      return generalErrorMessages[error.code];
    }
    return generalErrorMessages["E-SYS-02"];
  }

  function recordClientError(error, path) {
    var code = error && error.code
      ? error.code
      : "E-SYS-02";
    var detail = error && (error.stack || error.message)
      ? error.stack || error.message
      : "No client error detail.";
    var location = path ? " path=" + path : "";

    global.hostBridge.request("writeLog", {
      level: "ERROR",
      message:
        "client error: " + code + location + " " + detail
    }).then(function () {
      return null;
    }, function () {
      return null;
    });
  }

  function handleHostError(error, path, toastAction) {
    var code = error.code || "E-SYS-02";
    var viewError = {
      code: code,
      message: getHostErrorMessage(error),
      path: path || ""
    };

    global.MacroStudioState.setLastError(viewError);
    if (isBlockingAttachError(viewError)) {
      clearToast();
    } else {
      showToast(viewError.message, "error", toastAction);
    }
    recordClientError(error, path);
    return null;
  }

  function recordLog(level, message) {
    var request;

    try {
      request = global.hostBridge.request("writeLog", {
        level: level,
        message: message
      });
      if (request && typeof request.then === "function") {
        request.then(function () {
          return null;
        }, function () {
          return null;
        });
      }
    } catch (ignore) {
    }
  }

  function recordInfo(message) {
    recordLog("INFO", message);
  }

  function recordWarning(message) {
    recordLog("WARN", message);
  }

  function failBuild(error) {
    var code = error && error.code
      ? error.code
      : "E-BUILD-01";
    var data = error && error.data
      ? error.data
      : {};
    var message = buildErrorMessages[code] ||
      "ビルド処理を完了できませんでした。もう一度お試しください。";
    var result = {
      status: "error",
      success: false,
      code: code,
      message: message,
      outputPath: data.outputPath || "",
      results: data.results || []
    };

    global.MacroStudioState.setBuildResult(result);
    global.MacroStudioState.setLastError({
      code: code,
      message: message,
      path: ""
    });
    global.MacroStudioState.setBuildSlow(false);
    global.MacroStudioState.setBusyAction(null);
    clearToast();
    announce("ビルドに失敗しました。" + message);
    recordInfo("build failed: " + code);
    global.MacroStudioState.goTo(
      global.MacroStudioScreens.doneScreen,
      false);
    return null;
  }

  // The written report renders with the app's own diff code, so it has
  // to carry that code inside itself. The files are read from the same
  // place the page loaded them from - no network is involved - and kept
  // for the rest of the session.
  var REPORT_STYLE_FILES = [
    "css/variables.css",
    "css/flow.css",
    "css/module-list.css",
    "css/diff.css"
  ];
  var REPORT_SCRIPT_FILES = [
    "js/diff.js",
    "js/vba-highlight.js",
    "js/diff-view.js"
  ];
  var reportAssets = null;

  function readAssetText(path) {
    return new Promise(function (resolve, reject) {
      var request = new global.XMLHttpRequest();

      request.open("GET", path, true);
      request.onload = function () {
        if (request.status === 0 || request.status === 200) {
          resolve(request.responseText);
          return;
        }
        reject(new Error(
          "The report asset could not be read: " + path));
      };
      request.onerror = function () {
        reject(new Error(
          "The report asset could not be read: " + path));
      };
      request.send(null);
    });
  }

  function loadReportAssets() {
    if (reportAssets) {
      return Promise.resolve(reportAssets);
    }
    return Promise.all(
      REPORT_STYLE_FILES.concat(REPORT_SCRIPT_FILES).map(readAssetText)
    ).then(function (texts) {
      reportAssets = {
        css: texts.slice(0, REPORT_STYLE_FILES.length),
        js: texts.slice(REPORT_STYLE_FILES.length)
      };
      return reportAssets;
    });
  }

  function buildBook() {
    var state = global.MacroStudioState.getState();
    var modules;
    var timestamp = state.buildTimestamp ||
      createOutputTimestamp(new Date());

    if (state.screen !== global.MacroStudioScreens.buildScreen ||
        state.busyAction) {
      return Promise.resolve(null);
    }
    try {
      modules = createBuildModules(state);
      if (modules.length === 0) {
        throw new Error("No accepted modules are ready to build.");
      }
    } catch (error) {
      return Promise.resolve(failBuild({
        code: "E-BUILD-01",
        message: error.message
      }));
    }

    // Failing to build the report never cancels a workbook that can be
    // built, so the assets are read before the build starts and a
    // failure here becomes the same "no report" outcome as before.
    return loadReportAssets().then(function (assets) {
      return assets;
    }, function (error) {
      recordClientError(error, "");
      return null;
    }).then(function (assets) {
      return sendBuild(state, modules, timestamp, assets);
    });
  }

  function sendBuild(state, modules, timestamp, assets) {
    var diffHtml = null;
    var diffGenerationError = null;

    try {
      diffHtml = global.MacroStudioDiffReport.buildReport({
        bookName: state.book.name,
        buildTimestamp: timestamp,
        modules: state.modules,
        assets: assets
      });
    } catch (error) {
      diffGenerationError = error;
    }

    global.MacroStudioState.setBusyAction("buildBook");
    global.MacroStudioState.setBuildConfirmation(timestamp);
    global.MacroStudioState.setLastError(null);
    clearToast();
    announce("ビルドを開始しました。");
    recordInfo(
      "build start: " + state.outputName +
      " (" + modules.length + " modules)");
    if (diffGenerationError) {
      recordClientError(diffGenerationError, "");
    }

    // The host finishing is what ends a build. A long build is reported
    // as long, never as failed: the client clock decides nothing here,
    // and the late answer still arrives against this request id.
    return global.hostBridge.request("buildBook", {
      outputTimestamp: timestamp,
      outputName: state.outputName,
      diffName: global.MacroStudioState.getDiffReportName(
        state.book,
        state.outputDateStamp),
      modules: modules,
      diffHtml: diffHtml,
      resultMarkdown: createResultMarkdown(state, timestamp)
    }, {
      timeoutMilliseconds: 0,
      onSlow: function () {
        global.MacroStudioState.setBuildSlow(true);
        showToast(buildSlowMessage, "warning");
        announce(buildSlowMessage);
        recordInfo("build still running after the client wait");
      }
    }).then(function (result) {
      var viewResult = {
        status: "success",
        success: true,
        outputPath: result.outputPath,
        results: result.results || [],
        diffPath: result.diffPath || "",
        diffError: result.diffError || "",
        resultPath: result.resultPath || "",
        resultError: result.resultError || ""
      };

      global.MacroStudioState.setLastError(null);
      global.MacroStudioState.setBuildSlow(false);
      global.MacroStudioState.setBuildResult(viewResult);
      global.MacroStudioState.markModulesWritten(viewResult.results);
      global.MacroStudioState.setBusyAction(null);
      clearToast();
      if (viewResult.diffError) {
        showToast(diffReportErrorMessage, "error");
        announce(
          "改修版ブックを作成しました。" +
          "差分 HTML ファイルは作成できませんでした。");
      } else if (viewResult.resultError) {
        showToast(resultNoteErrorMessage, "error");
        announce(
          "改修版ブックを作成しました。" +
          "改修の概要メモは作成できませんでした。");
      } else {
        announce("改修版ブックと差分 HTML ファイルを作成しました。");
      }
      recordInfo(
        "build success: " + result.outputPath +
        " (" + viewResult.results.length + " results)");
      global.MacroStudioState.goTo(
        global.MacroStudioScreens.doneScreen,
        false);
      return result;
    }, function (error) {
      return failBuild(error);
    });
  }

  // Everything this run produced lives in one folder, so one action
  // opens it from both the hand-off screen and the final screen.
  function openRunFolder() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction || !state.runFolder) {
      return Promise.resolve(null);
    }
    global.MacroStudioState.setBusyAction("revealPath");
    return global.hostBridge.request("revealPath", {
      path: state.runFolder
    }).then(function () {
      global.MacroStudioState.setLastError(null);
      global.MacroStudioState.setBusyAction(null);
      announce("出力フォルダをエクスプローラーで開きました。");
      return state.runFolder;
    }, function (error) {
      handleHostError(error, state.runFolder);
      global.MacroStudioState.setBusyAction(null);
      return null;
    });
  }

  function retryBuild() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return false;
    }
    global.MacroStudioState.setLastError(null);
    global.MacroStudioState.setBuildResult(null);
    clearToast();
    global.MacroStudioState.goTo(
      global.MacroStudioScreens.buildScreen,
      false);
    return true;
  }

  function showDiscardModal(path) {
    pendingAttachPath = path;
    elements.discardModal.showModal();
  }

  function performAttachPath(path) {
    var state = global.MacroStudioState.getState();

    if (!path || state.busyAction) {
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("attachBook");
    return global.hostBridge.request(
      "attachBook",
      { path: path }
    ).then(function (data) {
      var warningMessage;

      newModuleNameDraft = "";
      data.book.warning = data.warning === true;
      data.book.read = describeReadResult(data);
      global.MacroStudioState.setBook(data.book, data.modules);
      global.MacroStudioState.setBookInventory(data.inventory || null);
      global.MacroStudioState.setBusyAction(null);
      clearToast();
      warningMessage = data.book.read;
      if (warningMessage) {
        showToast(
          warningMessage.headline + warningMessage.detail,
          warningMessage.tone);
      }
      announce(
        data.book.name + "、" +
        data.modules.length + " モジュールを読み込みました。");
      recordInfo(
        "attach: " + data.book.path +
        " (" + data.modules.length + " modules)");
      return data;
    }, function (error) {
      handleHostError(error, path);
      global.MacroStudioState.setBusyAction(null);
      return null;
    });
  }

  function attachPath(path) {
    var state = global.MacroStudioState.getState();

    if (!path || state.busyAction) {
      return Promise.resolve(null);
    }
    if (isEditDraftDirty()) {
      guardEditDraft(function () {
        attachPath(path);
      });
      return Promise.resolve(null);
    }
    if (global.MacroStudioState.hasImportedModules()) {
      showDiscardModal(path);
      return Promise.resolve(null);
    }
    return performAttachPath(path);
  }

  function pickBook() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("pickBook");
    return global.hostBridge.request("pickBook").then(
      function (result) {
        global.MacroStudioState.setBusyAction(null);
        if (!result) {
          return null;
        }
        return attachPath(result.path);
      },
      function (error) {
        handleHostError(error, "");
        global.MacroStudioState.setBusyAction(null);
        return null;
      });
  }

  function showPasteError(focusAction) {
    var error = {
      code: "E-PASTE-01",
      message: generalErrorMessages["E-PASTE-01"]
    };
    var button;

    global.MacroStudioState.setLastError(error);
    showToast(error.message, "error");
    button = document.querySelector(
      '[data-action="' +
      (focusAction || "paste-response") +
      '"]');
    if (button) {
      button.focus();
    }
    error.stack = (new Error("Normalized paste text is empty.")).stack;
    recordClientError(error, "");
  }

  function recordPaste(module, normalizedText) {
    var lineCount = global.MacroStudioDiff.toLines(normalizedText).length;

    global.hostBridge.request("writeLog", {
      level: "INFO",
      message:
        "paste: " + module.name + " (" + lineCount + " lines)"
    }).then(function () {
      return null;
    }, function (error) {
      handleHostError(error, "");
      return null;
    });
  }

  function acceptPastedText(value, moduleName, focusAction) {
    var state = global.MacroStudioState.getState();
    var name = moduleName || state.selectedModuleName;
    var module = global.MacroStudioState.findModule(name);
    var normalizedText;
    var rows;
    var changedLineCount;
    var accepted;

    if (!module || module.status === "excluded") {
      return false;
    }

    normalizedText = normalizePastedText(value);
    if (normalizedText.length === 0) {
      showPasteError(focusAction);
      return false;
    }

    rows = global.MacroStudioDiff.compare(
      module.code || "",
      normalizedText);
    changedLineCount =
      global.MacroStudioDiff.countChangedLines(rows);
    global.MacroStudioState.setLastError(null);
    accepted = global.MacroStudioState.acceptModuleCode(
      name,
      normalizedText,
      changedLineCount);
    clearToast();
    announce(
      module.name +
      (accepted.status === "unchanged"
        ? " は変更なしとして取り込みました。"
        : " を変更 " + changedLineCount + " 行で取り込みました。"));
    recordPaste(module, normalizedText);
    return true;
  }

  function normalizeToLf(value) {
    return String(
      value === undefined || value === null ? "" : value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  }

  function isEditDraftDirty() {
    var state = global.MacroStudioState.getState();
    var module;

    if (!state.pasteEditing) {
      return false;
    }
    module = global.MacroStudioState.findModule(
      state.selectedModuleName);
    if (!module) {
      return false;
    }
    return normalizeToLf(pasteEditDraft) !==
      normalizeToLf(module.pastedCode || "");
  }

  function guardEditDraft(action) {
    if (!isEditDraftDirty()) {
      action();
      return true;
    }
    pendingEditDiscardAction = action;
    pendingEditDiscardMode = "draft";
    setEditDiscardCopy("draft");
    elements.editDiscardModal.showModal();
    return false;
  }

  function setEditDiscardCopy(mode) {
    var title = document.getElementById("edit-discard-modal-title");
    var body = elements && elements.editDiscardModal
      ? elements.editDiscardModal.querySelector("p")
      : null;
    var confirm = document.getElementById("edit-discard-confirm");
    var manual = mode === "deterministic";

    if (title) {
      title.textContent = manual
        ? "手動修正を破棄して置き換えますか？"
        : "未反映の修正を破棄しますか？";
    }
    if (body) {
      body.textContent = manual
        ? "確認画面で加えた手動修正は失われます。" +
          "元のブックから、現在の対応表で作り直します。"
        : "手動修正でまだ反映していない変更があります。" +
          "このまま進むと破棄されます。";
    }
    if (confirm) {
      confirm.textContent = manual ? "破棄して置き換える" : "破棄して続行";
    }
  }

  function confirmDiscardManualChanges(action) {
    if (typeof action !== "function" || !elements ||
        !elements.editDiscardModal) {
      return false;
    }
    pendingEditDiscardAction = action;
    pendingEditDiscardMode = "deterministic";
    setEditDiscardCopy("deterministic");
    elements.editDiscardModal.showModal();
    return true;
  }

  function beginEditPaste() {
    var state = global.MacroStudioState.getState();
    var module = global.MacroStudioState.findModule(
      state.selectedModuleName);

    if (state.busyAction ||
        !module ||
        (module.status !== "changed" &&
         module.status !== "unchanged")) {
      return false;
    }

    pasteEditDraft = module.pastedCode || "";
    if (!global.MacroStudioState.beginPasteEdit()) {
      return false;
    }
    clearToast();
    announce(module.name + " の手動修正を開始しました。");
    global.setTimeout(function () {
      var textarea = document.getElementById(
        "paste-edit-textarea");
      if (textarea) {
        textarea.focus();
      }
    }, 0);
    return true;
  }

  function applyPasteEdit() {
    var state = global.MacroStudioState.getState();

    if (!state.pasteEditing || state.busyAction) {
      return false;
    }
    if (!acceptPastedText(
        pasteEditDraft,
        state.selectedModuleName,
        "apply-paste-edit")) {
      return false;
    }
    pasteEditDraft = "";
    global.setTimeout(function () {
      var button = document.querySelector(
        '[data-action="edit-paste"]');
      if (button) {
        button.focus();
      }
    }, 0);
    return true;
  }

  function requestCancelPasteEdit() {
    var state = global.MacroStudioState.getState();

    if (!state.pasteEditing) {
      return false;
    }
    return guardEditDraft(function () {
      pasteEditDraft = "";
      global.MacroStudioState.cancelPasteEdit();
      announce("手動修正をやめました。");
      global.setTimeout(function () {
        var button = document.querySelector(
          '[data-action="edit-paste"]');
        if (button) {
          button.focus();
        }
      }, 0);
    });
  }

  function toggleSelectedDiffContext() {
    var state = global.MacroStudioState.getState();
    var module = global.MacroStudioState.findModule(
      state.selectedModuleName);

    if (!module) {
      return false;
    }
    return global.MacroStudioState.setModuleShowChangesOnly(
      module.name,
      !module.showChangesOnly);
  }

  function toggleSelectedDiffWrap() {
    var state = global.MacroStudioState.getState();
    var module = global.MacroStudioState.findModule(
      state.selectedModuleName);

    if (!module) {
      return false;
    }
    return global.MacroStudioState.setModuleWrapDiff(
      module.name,
      module.wrapDiff === false);
  }

  function jumpSelectedDiff(direction) {
    var host = elements.main.querySelector(".diff-table-host");
    var counter = elements.main.querySelector(
      ".diff-change-counter");

    if (!host) {
      return false;
    }
    return global.MacroStudioDiffView.jumpToChange(
      host,
      direction,
      counter);
  }

  function loadAppInfo() {
    return global.hostBridge.request("getAppInfo").then(
      function (appInfo) {
        // A rediscovery that comes back without a preset list is not
        // an empty presets folder: keep what the app already has.
        if (appInfo && appInfo.presets &&
            Array.isArray(appInfo.presets.diagnose) &&
            Array.isArray(appInfo.presets.repair)) {
          diagnosisPresetStatus = resolveDiagnosisPreset(appInfo);
          global.MacroStudioState.setAppInfo(appInfo);
        }
        return appInfo;
      },
      function (error) {
        handleHostError(error, "");
        return null;
      });
  }

  function finishTargetEnvironmentLoad(loadId, profile, error) {
    var canonical = "";

    if (loadId !== targetEnvironmentLoadId) {
      return profile;
    }
    targetEnvironmentLoading = false;
    targetEnvironment = profile;
    targetEnvironmentError = error;
    if (profile && global.MacroStudioTargetEnvironment) {
      canonical = global.MacroStudioTargetEnvironment.renderForPrompt(profile);
    }
    if (global.MacroStudioState) {
      global.MacroStudioState.setTargetEnvironment(profile, canonical);
    }
    return profile;
  }

  function loadTargetEnvironment() {
    var loadId = targetEnvironmentLoadId + 1;

    targetEnvironmentLoadId = loadId;
    targetEnvironmentLoading = true;
    return global.hostBridge.request("getTargetEnvironment").then(
      function (result) {
        try {
          if (!global.MacroStudioTargetEnvironment) {
            throw {
              code: "E-ENV-01",
              message: "環境定義の検証機能を読み込めませんでした。"
            };
          }
          return finishTargetEnvironmentLoad(
            loadId,
            global.MacroStudioTargetEnvironment.parse(
              result && result.content),
            null);
        } catch (error) {
          return finishTargetEnvironmentLoad(loadId, null, {
            code: "E-ENV-01",
            validationId: error && error.validationId
              ? String(error.validationId)
              : "ENV-FIELD",
            message: error && error.message
              ? String(error.message)
              : "環境定義の内容が正しくありません。"
          });
        }
      },
      function (error) {
        return finishTargetEnvironmentLoad(loadId, null, {
          code: "E-ENV-01",
          validationId: error && error.data &&
            error.data.validationId
            ? String(error.data.validationId)
            : "ENV-READ",
          message: error && error.message
            ? String(error.message)
            : "環境定義ファイルを読み取れませんでした。"
        });
      });
  }

  function goToScreen(index) {
    if (global.MacroStudioState.goTo(index, false)) {
      elements.main.focus();
      return true;
    }
    return false;
  }

  // [次へ] is the only forward control. Screens that have to do work
  // before the next one appears do it here.
  function goNext() {
    var state = global.MacroStudioState.getState();

    if (state.screen === global.MacroStudioScreens.diagnoseScreen &&
        (!isTargetEnvironmentReady() || !isDiagnosisPresetReady())) {
      return false;
    }
    if (!global.MacroStudioState.canGoNext()) {
      return false;
    }
    if (global.MacroStudioWorkflow &&
        global.MacroStudioWorkflow.handleNext(state)) {
      return true;
    }
    if (global.MacroStudioState.goNext()) {
      elements.main.focus();
      return true;
    }
    return false;
  }

  function goBack() {
    guardEditDraft(function () {
      if (global.MacroStudioState.goBack()) {
        elements.main.focus();
      }
    });
    return true;
  }

  function selectModuleFromPane(moduleName) {
    guardEditDraft(function () {
      global.MacroStudioState.setLastError(null);
      clearToast();
      global.MacroStudioState.selectModule(moduleName);
    });
    return true;
  }

  function restartFlow() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return false;
    }
    if (global.MacroStudioState.hasImportedModules()) {
      pendingRestart = true;
      elements.discardModal.showModal();
      return false;
    }
    global.MacroStudioState.reset();
    clearToast();
    announce("最初の画面へ戻りました。");
    loadAppInfo();
    return true;
  }

  // The work is done: the files are on disk, so the app goes back to
  // the first screen ready for the next workbook.
  function finishFlow() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return false;
    }
    global.MacroStudioState.reset();
    clearToast();
    announce("完了しました。最初の画面へ戻りました。");
    loadAppInfo();
    return true;
  }

  function onTopbarClick(event) {
    var button = event.target.closest("[data-action]");

    if (!button || button.disabled) {
      return;
    }
    if (button.getAttribute("data-action") === "restart") {
      restartFlow();
    }
  }

  function onFooterClick(event) {
    var button = event.target.closest("[data-action]");
    var action;

    if (!button || button.disabled) {
      return;
    }
    action = button.getAttribute("data-action");
    if (action === "go-next") {
      goNext();
    } else if (action === "go-back") {
      goBack();
    } else if (action === "finish") {
      finishFlow();
    }
  }

  function toggleDisclosure(key) {
    var box = document.querySelector(
      '[data-disclosure-box="' + key + '"]');
    var trigger;
    var open;

    if (!box) {
      return false;
    }
    open = box.getAttribute("data-open") !== "true";
    disclosureOpen[key] = open;
    box.setAttribute("data-open", open ? "true" : "false");
    trigger = box.querySelector(".disclosure-trigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }
    // The review detail needs the whole height, so its screen is
    // rebuilt with the taller layout.
    if (key === "change-detail") {
      render(global.MacroStudioState.getState());
    }
    return open;
  }

  function onMainClick(event) {
    var button = event.target.closest("[data-action]");
    var action;

    if (!button || button.disabled) {
      return;
    }

    action = button.getAttribute("data-action");
    if (global.MacroStudioWorkflow &&
        global.MacroStudioWorkflow.handleAction(action, button, event)) {
      return;
    }
    if (action === "pick-book") {
      pickBook();
    } else if (action === "replace-book") {
      guardEditDraft(function () {
        goToScreen(global.MacroStudioScreens.bookScreen);
      });
    } else if (action === "toggle-disclosure") {
      toggleDisclosure(button.getAttribute("data-disclosure"));
    } else if (action === "select-module") {
      selectModuleFromPane(button.getAttribute("data-module-name"));
    } else if (action === "edit-paste") {
      beginEditPaste();
    } else if (action === "apply-paste-edit") {
      applyPasteEdit();
    } else if (action === "cancel-paste-edit") {
      requestCancelPasteEdit();
    } else if (action === "toggle-diff-context") {
      toggleSelectedDiffContext();
    } else if (action === "toggle-diff-wrap") {
      toggleSelectedDiffWrap();
    } else if (action === "previous-change") {
      jumpSelectedDiff(-1);
    } else if (action === "next-change") {
      jumpSelectedDiff(1);
    } else if (action === "retry-build") {
      retryBuild();
    } else if (action === "open-run-folder") {
      openRunFolder();
    }
  }

  function onToastClick(event) {
    var button = event.target.closest("[data-toast-action]");

    if (!button || button.disabled) {
      return;
    }
    if (button.getAttribute("data-toast-action") ===
        "retry-copy-request" && global.MacroStudioWorkflow) {
      global.MacroStudioWorkflow.retryCopyPrompt();
    }
  }

  function onMainInput(event) {
    if (global.MacroStudioWorkflow &&
        global.MacroStudioWorkflow.handleInput(event.target)) {
      return;
    }
    if (event.target.id === "paste-edit-textarea") {
      pasteEditDraft = event.target.value;
      return;
    }
    if (event.target.id === "output-name") {
      global.MacroStudioState.setOutputName(event.target.value);
    }
  }

  // Ctrl+V on the intake screen does the same as the button.
  function onDocumentPaste(event) {
    var state = global.MacroStudioState.getState();
    var text = "";

    if (!global.MacroStudioWorkflow || state.busyAction ||
        (state.screen !== global.MacroStudioScreens.diagnoseScreen &&
         state.screen !== global.MacroStudioScreens.repairScreen)) {
      return;
    }
    if (state.pasteEditing ||
        (event.target &&
         typeof event.target.closest === "function" &&
         event.target.closest("textarea, input"))) {
      return;
    }
    if (event.clipboardData &&
        typeof event.clipboardData.getData === "function") {
      text = event.clipboardData.getData("text") || "";
    }
    event.preventDefault();
    global.MacroStudioWorkflow.handlePaste(text, state);
  }

  function onDocumentKeyDown(event) {
    var state = global.MacroStudioState.getState();

    if (global.MacroStudioWorkflow &&
        global.MacroStudioWorkflow.handleKeyDown(event)) {
      return;
    }
    if (state.screen !== global.MacroStudioScreens.reviewScreen ||
        state.pasteEditing ||
        state.busyAction ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      jumpSelectedDiff(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      jumpSelectedDiff(-1);
    }
  }

  function hasFileDrag(event) {
    var transfer = event.dataTransfer;
    var types = transfer && transfer.types ? transfer.types : null;
    var index;

    if (!types) {
      return false;
    }
    for (index = 0; index < types.length; index += 1) {
      if (types[index] === "Files") {
        return true;
      }
    }
    return false;
  }

  function setDropActive(active) {
    if (dropActive === active) {
      return;
    }
    dropActive = active;
    document.body.classList.toggle("is-file-drag", active);
  }

  function onWindowDragOver(event) {
    if (!hasFileDrag(event)) {
      return;
    }

    // The page must accept the drag for the drop event to fire at all.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    dragDepth = 1;
    setDropActive(true);
  }

  function onWindowDragLeave(event) {
    if (event.relatedTarget) {
      return;
    }
    dragDepth = 0;
    setDropActive(false);
  }

  function onWindowDrop(event) {
    var files = event.dataTransfer ? event.dataTransfer.files : null;

    if (!hasFileDrag(event)) {
      return;
    }
    event.preventDefault();
    dragDepth = 0;
    setDropActive(false);
    if (!files || files.length === 0) {
      return;
    }

    global.hostBridge.resolveDroppedFiles(files).then(
      function (paths) {
        if (!paths || paths.length === 0) {
          return null;
        }
        return attachPath(paths[0]);
      },
      function (error) {
        handleHostError(error, "");
        return null;
      });
  }

  function hasDemoQuery() {
    var query = global.location.search || "";

    return /(?:^\?|&)demo=1(?:&|$)/.test(query);
  }

  function initialize() {
    elements = {
      progressList: document.getElementById("progress-list"),
      progressFill: document.getElementById("progress-fill"),
      topbar: document.querySelector(".topbar"),
      main: document.getElementById("main-content"),
      actionContext: document.getElementById("action-context"),
      footerActions: document.getElementById("footer-actions"),
      statusAnnouncer: document.getElementById("status-announcer"),
      toastRegion: document.getElementById("toast-region"),
      discardModal: document.getElementById("discard-modal"),
      discardModalCancel: document.getElementById(
        "discard-modal-cancel"),
      discardModalConfirm: document.getElementById(
        "discard-modal-confirm"),
      editDiscardModal: document.getElementById(
        "edit-discard-modal"),
      editDiscardCancel: document.getElementById(
        "edit-discard-cancel"),
      editDiscardConfirm: document.getElementById(
        "edit-discard-confirm")
    };

    elements.topbar.addEventListener("click", onTopbarClick);
    elements.main.addEventListener("click", onMainClick);
    elements.main.addEventListener("input", onMainInput);
    elements.footerActions.addEventListener("click", onFooterClick);
    elements.toastRegion.addEventListener("click", onToastClick);
    document.addEventListener("paste", onDocumentPaste);
    document.addEventListener("dragenter", onWindowDragOver);
    document.addEventListener("dragover", onWindowDragOver);
    document.addEventListener("dragleave", onWindowDragLeave);
    document.addEventListener("dragend", onWindowDragLeave);
    document.addEventListener("drop", onWindowDrop);
    document.addEventListener("keydown", onDocumentKeyDown);
    elements.discardModalCancel.addEventListener("click", function () {
      pendingAttachPath = null;
      pendingRestart = false;
      elements.discardModal.close();
      announce("取り込み済みの内容はそのままです。");
    });
    elements.discardModalConfirm.addEventListener("click", function () {
      var path = pendingAttachPath;
      var restart = pendingRestart;

      pendingAttachPath = null;
      pendingRestart = false;
      elements.discardModal.close();
      if (restart) {
        global.MacroStudioState.reset();
        clearToast();
        announce("最初の画面へ戻りました。");
        loadAppInfo();
        return;
      }
      performAttachPath(path);
    });
    elements.discardModal.addEventListener("cancel", function () {
      pendingAttachPath = null;
      pendingRestart = false;
      announce("取り込み済みの内容はそのままです。");
    });
    elements.editDiscardCancel.addEventListener("click", function () {
      pendingEditDiscardAction = null;
      pendingEditDiscardMode = "draft";
      elements.editDiscardModal.close();
      announce("手動修正に戻りました。");
      global.setTimeout(function () {
        var textarea = document.getElementById(
          "paste-edit-textarea");
        if (textarea) {
          textarea.focus();
        }
      }, 0);
    });
    elements.editDiscardConfirm.addEventListener("click", function () {
      var action = pendingEditDiscardAction;
      var mode = pendingEditDiscardMode;
      var completed = true;

      pendingEditDiscardAction = null;
      pendingEditDiscardMode = "draft";
      elements.editDiscardModal.close();
      pasteEditDraft = "";
      global.MacroStudioState.cancelPasteEdit();
      if (action) {
        completed = action() !== false;
      }
      announce(mode === "deterministic"
        ? (completed
          ? "手動修正を破棄し、対応表から置き換え直しました。"
          : "置き換えられなかったため、手動修正を保持しています。")
        : "未反映の修正を破棄しました。");
    });
    elements.editDiscardModal.addEventListener("cancel", function () {
      pendingEditDiscardAction = null;
      pendingEditDiscardMode = "draft";
      announce("手動修正に戻りました。");
    });
    global.MacroStudioState.subscribe(render);
    if (hasDemoQuery()) {
      global.MacroStudioState.loadDemoState();
    } else {
      render(global.MacroStudioState.getState());
    }

    global.hostBridge.on("bookDropped", function (data) {
      setDropActive(false);
      attachPath(data.path);
    });
    loadAppInfo();
  }

  global.MacroStudioApp = {
    initialize: initialize,
    render: render,
    showToast: showToast,
    handleHostError: handleHostError,
    attachPath: attachPath,
    pickBook: pickBook,
    toggleDisclosure: toggleDisclosure,
    createIcon: createIcon,
    goNext: goNext,
    goBack: goBack,
    goToScreen: goToScreen,
    createCodeFileTimestamp: createCodeFileTimestamp,
    normalizePastedText: normalizePastedText,
    onWindowDragOver: onWindowDragOver,
    onWindowDragLeave: onWindowDragLeave,
    onWindowDrop: onWindowDrop,
    getAttachWarningMessage: getAttachWarningMessage,
    describeReadResult: describeReadResult,
    createOutputTimestamp: createOutputTimestamp,
    createBuildOutputName: createBuildOutputName,
    loadReportAssets: loadReportAssets,
    getHostErrorMessage: getHostErrorMessage,
    getNewModuleNameError: getNewModuleNameError,
    joinFinalCode: joinFinalCode,
    createBuildModules: createBuildModules,
    createResultMarkdown: createResultMarkdown,
    createDoneScreen: createScreenDone,
    createReviewScreen: createScreen6,
    buildBook: buildBook,
    retryBuild: retryBuild,
    finishFlow: finishFlow,
    acceptPastedText: acceptPastedText,
    beginEditPaste: beginEditPaste,
    applyPasteEdit: applyPasteEdit,
    requestCancelPasteEdit: requestCancelPasteEdit,
    isEditDraftDirty: isEditDraftDirty,
    confirmDiscardManualChanges: confirmDiscardManualChanges,
    loadAppInfo: loadAppInfo,
    resolveDiagnosisPreset: resolveDiagnosisPreset,
    getDiagnosisPresetStatus: function () {
      return diagnosisPresetStatus;
    },
    loadTargetEnvironment: loadTargetEnvironment,
    getTargetEnvironment: function () {
      return targetEnvironment;
    },
    getTargetEnvironmentError: function () {
      return targetEnvironmentError;
    },
    isBlockingAttachError: isBlockingAttachError,
    createAttachErrorCard: createAttachErrorCard,
    announce: announce,
    loadDemoState: global.MacroStudioState.loadDemoState
  };

  document.addEventListener("DOMContentLoaded", initialize);
}(window));
