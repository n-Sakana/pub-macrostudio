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
  var dropActive = false;
  var dragDepth = 0;

  var typeNames = {
    document: "ドキュメントモジュール",
    form: "フォームモジュール",
    standard: "標準モジュール",
    "class": "クラスモジュール"
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
      "依頼文をクリップボードへコピーできませんでした。［依頼文をもう一度コピー］でやり直してください。",
    "E-PASTE-01":
      "貼り付けるコードがありません。チャット AI のコードブロックをコピーして、もう一度お試しください。",
    "E-PRESET-01":
      "ひな形を読み取れませんでした。presets フォルダの Markdown を確認してください。",
    "E-SYS-01":
      "WebView2 Runtime が見つかりません。起動時の案内に従って配布元へ連絡してください。",
    "E-SYS-02":
      "処理を完了できませんでした。作業状態を保ったまま、もう一度お試しください。"
  };

  var buildErrorMessages = {
    "E-BUILD-05":
      "コードの欠落・部分復旧があるため、安全に書き戻せません。" +
      "相談用の資料としては使えます。改修するにはExcelで修復したコピーを読み込み直してください。",
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

  function showToast(message, tone) {
    var toast;
    var label;

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

  var iconPaths = {
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 8V5h7l2 3"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/>' +
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    template: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    code: '<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>',
    arrowLeft: '<path d="m15 18-6-6 6-6"/>',
    arrowRight: '<path d="m9 18 6-6-6-6"/>',
    arrowUp: '<path d="m6 15 6-6 6 6"/>',
    arrowDown: '<path d="m6 9 6 6 6-6"/>',
    restart: '<path d="M4 4v6h6"/><path d="M5.5 15a8 8 0 1 0 .8-7.7L4 10"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>' +
      '<path d="M12 8h.01"/>'
  };

  function createIcon(name, className) {
    var element = createElement(
      "span",
      "flow-icon " + (className || ""));

    element.setAttribute("aria-hidden", "true");
    element.innerHTML =
      '<svg viewBox="0 0 24 24">' +
      (iconPaths[name] || iconPaths.file) +
      "</svg>";
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

  function getPresetEntries(state) {
    var presets = state.appInfo && state.appInfo.presets
      ? state.appInfo.presets
      : [];

    return global.MacroStudioPreset.describeAll(presets);
  }

  // ---- screen 0: choose the workbook ----

  function createScreen0(state) {
    var task = createTask("");
    var zone;
    var loaded;
    var details;

    task.appendChild(createTaskIntro(state.book
      ? "このブックでよければ、右下の「次へ」へ進みます。"
      : "対象のブックを、ここへドラッグするか選んでください。"));

    if (isBlockingAttachError(state.lastError)) {
      task.appendChild(createAttachErrorCard(state.lastError));
    }

    if (state.book) {
      loaded = createElement("div", "loaded-zone");
      details = createElement("div", "loaded-zone-details");
      details.appendChild(createElement("h2", "", state.book.name));
      details.appendChild(createElement(
        "p",
        "loaded-zone-path",
        state.book.path));
      loaded.appendChild(createDropIcon());
      loaded.appendChild(details);
      loaded.appendChild(createFlowButton("選び直す", "pick-book", {
        icon: "folder",
        compact: true,
        disabled: state.busyAction !== null
      }));
      task.appendChild(loaded);
      return task;
    }

    zone = createElement("button", "drop-zone");
    zone.type = "button";
    zone.setAttribute("data-action", "pick-book");
    zone.disabled = state.busyAction !== null;
    zone.appendChild(createDropIcon());
    zone.appendChild(createElement(
      "h2",
      "",
      state.busyAction === "attachBook"
        ? "読み込んでいます"
        : "Excelブックをここにドロップ"));
    zone.appendChild(createElement(
      "p",
      "",
      "またはクリックしてファイルを選ぶ"));
    task.appendChild(zone);
    return task;
  }

  // ---- screen 1: what was read ----

  function createStatCard(label, value) {
    var card = createElement("div", "stat-card");

    card.appendChild(createElement("div", "stat-label", label));
    card.appendChild(createElement("div", "stat-value", value));
    return card;
  }

  function createReadDetail(state) {
    var wrap = createElement("div", "read-detail");
    var main = createElement("div", "book-main");
    var fileCard = createElement("div", "file-card");
    var fileName = createElement("div", "file-name");
    var strip = createElement("div", "module-strip");

    fileName.appendChild(createElement("span", "file-kind", "XLS"));
    fileName.appendChild(createElement("span", "", state.book.name));
    fileCard.appendChild(fileName);
    fileCard.appendChild(createElement(
      "div",
      "file-path",
      state.book.path));
    main.appendChild(fileCard);
    main.appendChild(createStatCard(
      "モジュール",
      String(state.modules.length)));
    main.appendChild(createStatCard(
      "合計行数",
      String(state.book.totalLines)));
    main.appendChild(createStatCard(
      "コードの読み取り",
      state.book.read && state.book.read.level === "sourceDoubt"
        ? "一部不明"
        : "全モジュール"));
    wrap.appendChild(main);
    if (state.book.read) {
      wrap.appendChild(createElement(
        "p",
        "read-note",
        state.book.read.detail));
    }

    state.modules.forEach(function (module) {
      var chip = createElement("span", "module-chip", module.name);

      chip.title = module.name + "（" + module.lineCount + " 行）";
      strip.appendChild(chip);
    });
    wrap.appendChild(strip);
    return wrap;
  }

  function createScreen1(state) {
    var task = createTask("task--wide");
    var headline = createElement("div", "headline-card");

    headline.appendChild(createIcon("check", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      state.book.name + " から " + state.modules.length +
        "モジュール・" + state.book.totalLines + "行を読み込みました"));
    // The read result stays on this screen after the toast is gone, and
    // it only looks like a warning when there is something to act on.
    if (state.book.read) {
      headline.appendChild(createElement(
        "p",
        state.book.read.level === "sourceDoubt"
          ? "headline-warning"
          : "headline-note",
        state.book.read.headline + state.book.read.detail));
    }
    task.appendChild(headline);
    task.appendChild(createDisclosure(
      "read-detail",
      "読み取った内容を見る",
      createReadDetail(state),
      { note: "モジュール名と行数" }));
    return task;
  }

  // ---- screen 2: what this run is for ----

  var MODE_CHOICES = [
    {
      mode: "refactor",
      icon: "template",
      title: "AIで改修する",
      description:
        "AIの返答を取り込んで、改修済みのブックをこのアプリで作ります。"
    },
    {
      mode: "diagnose",
      icon: "code",
      title: "AIで相談する",
      description:
        "AIチャットへ渡す依頼文とコードを作ります。ブックは変更しません。"
    }
  ];

  function createModeCard(state, choice) {
    var selected = state.mode === choice.mode;
    var card = createElement("button", "choice-card");
    var body = createElement("span", "choice-body");
    var mark = createElement("span", "choice-state");

    card.type = "button";
    card.setAttribute("data-action", "select-mode");
    card.setAttribute("data-mode", choice.mode);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    card.disabled = state.busyAction !== null;
    card.appendChild(createIcon(choice.icon, "choice-icon"));
    body.appendChild(createElement("span", "choice-title", choice.title));
    body.appendChild(
      createElement("span", "choice-description", choice.description));
    card.appendChild(body);
    if (selected) {
      mark.appendChild(createIcon("check", "flow-icon--small"));
    }
    card.appendChild(mark);
    return card;
  }

  function createScreenMode(state) {
    var task = createTask("");
    var list = createElement("div", "choice-list");

    // No workbook has been read yet on this screen, so nothing here may
    // point at "this macro": there is none, and the only macro in sight
    // would be the app itself.
    task.appendChild(createTaskIntro(
      "これからすることを、ひとつ選んでください。"));
    MODE_CHOICES.forEach(function (choice) {
      list.appendChild(createModeCard(state, choice));
    });
    task.appendChild(list);
    task.appendChild(createSimpleStart(state));
    return task;
  }

  // The short way in, offered quietly beside the two main choices so it
  // never reads as a third one.
  function createSimpleStart(state) {
    var row = createElement("div", "simple-start");
    var button = createFlowButton(
      "簡易モードで始める",
      "start-simple",
      { compact: true, disabled: state.busyAction !== null });

    button.title =
      "ブックを選び、直したいことを書くだけで進みます";
    row.appendChild(button);
    return row;
  }

  // ---- screen 3: what kind of request ----

  function createPurposeCard(state, entry) {
    var selected = state.presetFile === entry.file;
    var card = createElement("button", "choice-card");
    var body = createElement("span", "choice-body");
    var mark = createElement("span", "choice-state");

    card.type = "button";
    card.setAttribute("data-action", "select-purpose");
    card.setAttribute("data-preset-file", entry.file);
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", selected ? "true" : "false");
    card.disabled = state.busyAction !== null;
    card.appendChild(createIcon("template", "choice-icon"));
    body.appendChild(createElement("span", "choice-title", entry.name));
    // The line under the name is the preset's own "## 説明" and nothing
    // else. The request and the output rules are addressed to the chat AI,
    // so borrowing a sentence from them would put text written for another
    // reader on this screen. A preset without that section shows its name
    // alone.
    if (entry.description) {
      body.appendChild(createElement(
        "span",
        "choice-description",
        entry.description));
    }
    card.appendChild(body);
    if (selected) {
      mark.appendChild(createIcon("check", "flow-icon--small"));
    }
    card.appendChild(mark);
    return card;
  }

  function createScreen2(state) {
    var task = createTask("");
    var entries = getPresetEntries(state).filter(function (entry) {
      return !entry.valid || entry.mode === state.mode;
    });
    var list = createElement("div", "choice-list");
    var invalid = entries.filter(function (entry) {
      return !entry.valid;
    });
    var usable = entries.filter(function (entry) {
      return entry.valid;
    });
    var errorBox;
    var errorList;

    task.appendChild(createTaskIntro(
      global.MacroStudioScreens.isDiagnose(state)
        ? "聞きたいことに近いものを、ひとつ選んでください。"
        : "したい改修に近いものを、ひとつ選んでください。"));

    usable.forEach(function (entry) {
      list.appendChild(createPurposeCard(state, entry));
    });
    if (usable.length === 0) {
      list.appendChild(createElement(
        "p",
        "preset-empty",
        "選べる依頼がありません。presets フォルダの Markdown を" +
          "確認してください。"));
    }
    task.appendChild(list);

    if (invalid.length > 0) {
      errorBox = createElement("div", "preset-invalid");
      errorBox.appendChild(createElement(
        "p",
        "preset-invalid-label",
        "読み込めないひな形が " + invalid.length + " 件あります"));
      errorList = createElement("ul", "preset-invalid-list");
      invalid.forEach(function (entry) {
        var item = createElement("li", "preset-invalid-item");

        item.setAttribute("data-preset-invalid-file", entry.file);
        item.appendChild(
          createElement("code", "preset-invalid-file", entry.file));
        item.appendChild(
          createElement("span", "preset-invalid-message", entry.message));
        errorList.appendChild(item);
      });
      errorBox.appendChild(errorList);
      task.appendChild(errorBox);
    }
    return task;
  }

  // ---- screen 3: the request itself ----

  function createRequestEditor(state) {
    var wrap = createElement("div", "request-editor-wrap");
    var textarea = createElement("textarea", "request-editor");

    textarea.id = "request-text";
    textarea.value = state.requestText;
    textarea.spellcheck = false;
    textarea.placeholder =
      "例: 新しい端末でも同じ保存先を使えるようにしてください。";
    textarea.disabled = state.busyAction !== null;
    wrap.appendChild(textarea);
    wrap.appendChild(createElement(
      "p",
      "editor-note",
      "この文章と、返答のしかたの指示、コード全文ファイルをAIへ渡します。" +
        "返答のしかたは " + (state.presetName || "選んだ改修") +
        " のひな形が持っています。"));
    return wrap;
  }

  // An optional way of answering, offered only when the chosen preset
  // writes the rules for it. Long macros do not always come back in one
  // reply, so the same request can ask for one module at a time.
  function createSplitOutputOption(state) {
    var row = createElement("div", "option-row");
    var label = createElement("label", "option-label");
    var input = createElement("input", "option-checkbox");

    input.type = "checkbox";
    input.id = "split-output";
    input.checked = state.splitOutput === true;
    input.disabled = state.busyAction !== null;
    label.setAttribute("for", "split-output");
    label.appendChild(input);
    label.appendChild(createElement(
      "span",
      "option-text",
      "モジュール単位出力（コードが長い時用）"));
    row.appendChild(label);
    row.appendChild(createElement(
      "p",
      "option-help",
      state.splitOutput
        ? "AIは変更するモジュールを1回の返答に1つだけ出し、" +
          "次を出してよいか聞いてきます。届いた順に取り込むと、" +
          "MacroStudioが1つの変更へまとめます。"
        : "コードが長くて返答が途中で切れるときに使います。" +
          "ふだんは付けなくてかまいません。"));
    return row;
  }

  // The short way: one box to write in, and one option for a long
  // macro. Nothing about presets, ids or output rules appears - those
  // are settled behind this screen.
  function createSimpleRequestScreen(state) {
    var task = createTask("task--wide");
    var textarea = createElement("textarea", "form-textarea");

    task.appendChild(createTaskIntro(
      "直したいことを書いてください。"));
    textarea.id = "simple-request-input";
    textarea.value = state.requestText;
    textarea.spellcheck = false;
    textarea.rows = 8;
    textarea.disabled = state.busyAction !== null;
    textarea.setAttribute("data-simple-request", "true");
    textarea.setAttribute(
      "placeholder",
      "例: 実行に時間がかかるので、速くしてください。" +
        "動きは今までと同じにしてください。");
    textarea.setAttribute("aria-label", "どのように直しますか");
    task.appendChild(textarea);
    if (state.splitOutputRules) {
      task.appendChild(createSimpleSplitOption(state));
    }
    return task;
  }

  // The same switch as the detailed screen, on the same state and the
  // same rules, worded for someone who only knows their macro is long.
  function createSimpleSplitOption(state) {
    var row = createElement("div", "option-row");
    var label = createElement("label", "option-label");
    var input = createElement("input", "option-checkbox");

    input.type = "checkbox";
    input.id = "split-output";
    input.checked = state.splitOutput === true;
    input.disabled = state.busyAction !== null;
    label.setAttribute("for", "split-output");
    label.appendChild(input);
    label.appendChild(createElement(
      "span",
      "option-text",
      "コードが長い場合は、モジュールごとに受け取る"));
    row.appendChild(label);
    row.appendChild(createElement(
      "p",
      "option-help",
      state.splitOutput
        ? "AIは1回の返答に1つずつ出します。届いた順に貼り付けてください。"
        : "AIの返答が途中で切れるときに使います。"));
    return row;
  }

  function createScreen3(state) {
    var task;
    var headline;
    var preview;

    if (global.MacroStudioScreens.isSimple(state)) {
      return createSimpleRequestScreen(state);
    }
    task = createTask("task--wide");
    headline = createElement("div", "headline-card");
    preview = state.requestText
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter(function (line) {
        return line.trim().length > 0;
      })
      .slice(0, 2)
      .join(" ");

    task.appendChild(createTaskIntro(
      "この内容でAIへ依頼します。書き換えたいときだけ開いてください。"));
    headline.appendChild(createIcon("template", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      state.presetName || "改修依頼"));
    headline.appendChild(createElement(
      "p",
      "headline-preview",
      preview.length > 92 ? preview.slice(0, 92) + "…" : preview));
    task.appendChild(headline);
    if (state.splitOutputRules) {
      task.appendChild(createSplitOutputOption(state));
    }
    task.appendChild(createDisclosure(
      "request-editor",
      "依頼文を確認・編集",
      createRequestEditor(state),
      { note: state.requestText.length + "文字" }));
    return task;
  }

  // ---- screen 4: hand the request to the chat ----

  function createFolderContract(state, withResults) {
    var box = createElement("div", "folder-contract");
    var chips = createElement("div", "artifact-chips");
    var names = ["request.md", "source-code.md"];

    if (withResults) {
      names = names.concat([
        state.outputName,
        global.MacroStudioState.getDiffReportName(
          state.book,
          state.outputDateStamp),
        "result.md"
      ]);
    }
    box.appendChild(createElement(
      "div",
      "folder-path",
      state.runFolder || ""));
    names.forEach(function (name) {
      chips.appendChild(createElement("span", "artifact-chip", name));
    });
    box.appendChild(chips);
    return box;
  }

  // Where the files go is reference material: shown on request, never
  // in the way of the thing the user came to this screen to do.
  function createFolderDisclosure(state, key, withResults) {
    return createDisclosure(
      key,
      "作成されるファイルの場所を見る",
      createFolderContract(state, withResults),
      { note: "この改修専用のフォルダ" });
  }

  function createHandoffCard(state, options) {
    var card = createElement("div", "handoff-card");
    var number = createElement("div", "handoff-number");
    var actions = createElement("div", "inline-actions");

    card.classList.toggle("is-done", options.done);
    if (options.done) {
      number.appendChild(createIcon("check", "flow-icon--small"));
    } else {
      number.textContent = options.step;
    }
    card.appendChild(number);
    card.appendChild(createElement("h2", "", options.title));
    card.appendChild(createElement("p", "", options.description));
    if (options.fileName) {
      card.appendChild(
        createElement("div", "file-pill", options.fileName));
    }
    actions.appendChild(createFlowButton(
      options.label,
      options.action,
      {
        kind: options.done ? "" : "primary",
        icon: options.done ? "check" : options.icon,
        className: options.done ? "is-done" : "",
        disabled: state.busyAction !== null
      }));
    card.appendChild(actions);
    return card;
  }

  function createScreen4(state) {
    var task = createTask("task--wide");
    var handoff = createElement("div", "handoff");

    task.appendChild(createTaskIntro(
      state.promptCopied && state.codeFolderOpened
        ? "依頼文を貼り付け、source-code.md を添付して、AIからの返答を待ちます。"
        : "依頼文をコピーして、コード全文ファイルと一緒にAIチャットへ渡します。"));
    handoff.appendChild(createHandoffCard(state, {
      step: "1",
      done: state.promptCopied === true,
      title: "依頼文をチャットへ貼り付ける",
      description:
        "ボタンを押すと、AIへの依頼文がクリップボードへコピーされます。",
      label: state.promptCopied ? "コピーしました" : "依頼文をコピー",
      action: "copy-request-prompt",
      icon: "copy"
    }));
    handoff.appendChild(createHandoffCard(state, {
      step: "2",
      done: state.codeFolderOpened === true,
      title: "コード全文ファイルを添付する",
      description:
        "マクロのコード全文を保存したファイルです。AIチャットに添付してください。",
      fileName: "source-code.md",
      label: state.codeFolderOpened
        ? "フォルダを開きました"
        : "ファイルの場所を開く",
      action: "open-run-folder",
      icon: "folder"
    }));
    task.appendChild(handoff);
    // The code alone often is not enough: the AI answers better when it
    // can see the sheets the macro reads and writes.
    task.appendChild(createElement(
      "p",
      "handoff-note",
      "マクロが読み書きするExcelシートやファイルがあれば、" +
        "それも一緒にAIチャットへ添付すると、より正確な回答が得られます。"));
    task.appendChild(createFolderDisclosure(state, "handoff-folder", false));
    return task;
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
    var summary = state.intakeResult && state.intakeResult.summary
      ? String(state.intakeResult.summary)
      : "";

    lines.push("# " + state.book.name + " 改修メモ");
    lines.push("");
    lines.push("- 実行日時: " + formatRunTimestamp(timestamp));
    lines.push("- 依頼の目的: " + (state.presetName || "（指定なし）"));
    lines.push("- 依頼番号: " + (state.requestId || "（なし）"));
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
    lines.push("## このフォルダのファイル");
    lines.push("");
    lines.push("- request.md … AIへ渡した依頼文");
    lines.push("- source-code.md … 改修前のコード全文");
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
  var MODULE_GROUPS = [
    { type: "standard", title: "標準モジュール" },
    { type: "class", title: "クラスモジュール" },
    { type: "form", title: "フォームモジュール" },
    { type: "document", title: "シートモジュール" }
  ];

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
        return module.type === group.type;
      });
      var list;

      if (members.length === 0) {
        return;
      }
      pane.appendChild(createElement(
        "div",
        "module-group-title",
        group.title));
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

  function getBeadPositions(total, current) {
    var positions = [];
    var index;

    if (total <= BEAD_LIMIT) {
      for (index = 0; index < total; index += 1) {
        positions.push(index);
      }
      return positions;
    }
    [0, 1].forEach(function (index) {
      positions.push(index);
    });
    for (index = current - 1; index <= current + 1; index += 1) {
      if (index > 1 && index < total - 2) {
        positions.push(index);
      }
    }
    [total - 2, total - 1].forEach(function (index) {
      positions.push(index);
    });
    return positions.filter(function (value, at, all) {
      return all.indexOf(value) === at;
    }).sort(function (a, b) {
      return a - b;
    });
  }

  function isAnswered(state, index) {
    return String(state.answers[String(index)] || "").trim().length > 0;
  }

  function createBeadTrack(state) {
    var wrap = createElement("div", "bead-rail");
    var track = createElement("div", "bead-track");
    var total = state.questions.length;
    var positions = getBeadPositions(total, state.questionIndex);
    var previous = null;

    positions.forEach(function (index) {
      var bead;

      if (previous !== null && index - previous > 1) {
        track.appendChild(createElement("span", "bead-gap", ""));
      }
      bead = createElement("button", "bead", String(index + 1));
      bead.type = "button";
      bead.setAttribute("data-action", "go-question");
      bead.setAttribute("data-index", String(index));
      bead.setAttribute(
        "aria-label",
        (index + 1) + "問目" +
          (isAnswered(state, index) ? "（回答済み）" : ""));
      bead.setAttribute(
        "aria-current",
        index === state.questionIndex ? "step" : "false");
      bead.classList.toggle("is-current", index === state.questionIndex);
      bead.classList.toggle("is-answered", isAnswered(state, index));
      bead.disabled = state.busyAction !== null;
      track.appendChild(bead);
      previous = index;
    });
    wrap.appendChild(track);
    return wrap;
  }

  function createChoiceField(state, question, index) {
    var wrap = createElement("div", "form-choices");

    question.choices.forEach(function (choice) {
      var button = createElement("button", "form-chip", choice);
      var selected = state.answers[String(index)] === choice;

      button.type = "button";
      button.setAttribute("data-action", "answer-choice");
      button.setAttribute("data-question", String(index));
      button.setAttribute("data-value", choice);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.classList.toggle("is-selected", selected);
      button.disabled = state.busyAction !== null;
      wrap.appendChild(button);
    });
    return wrap;
  }

  // With one question per screen there is room to write properly.
  function createTextField(state, index) {
    var input = createElement("textarea", "form-textarea");

    input.id = "answer-" + index;
    input.value = state.answers[String(index)] || "";
    input.spellcheck = false;
    input.rows = 5;
    input.setAttribute("data-question", String(index));
    input.setAttribute("placeholder", "分かる範囲で書いてください");
    input.disabled = state.busyAction !== null;
    return input;
  }

  function createQuestionArrow(state, direction) {
    var forward = direction > 0;
    var button = createElement(
      "button",
      "question-arrow question-arrow--" + (forward ? "next" : "previous"));
    var target = state.questionIndex + direction;

    button.type = "button";
    button.setAttribute("data-action", "go-question");
    button.setAttribute("data-index", String(target));
    button.setAttribute(
      "aria-label",
      forward ? "次の質問へ" : "前の質問へ");
    button.appendChild(createIcon(
      forward ? "arrowRight" : "arrowLeft",
      "flow-icon--small"));
    button.disabled = state.busyAction !== null ||
      target < 0 ||
      target >= state.questions.length;
    return button;
  }

  function createScreenQuestions(state) {
    var task = createTask("task--wide");
    var question = state.questions[state.questionIndex];
    var card = createElement("div", "question-card");
    var body = createElement("div", "question-body");

    if (!question) {
      task.appendChild(createTaskIntro("質問がありません。"));
      return task;
    }

    task.appendChild(createBeadTrack(state));
    body.appendChild(createElement(
      "p",
      "question-count",
      (state.questionIndex + 1) + " / " + state.questions.length));
    body.appendChild(createElement("h2", "question-text", question.text));
    body.appendChild(question.choices.length > 0
      ? createChoiceField(state, question, state.questionIndex)
      : createTextField(state, state.questionIndex));
    card.appendChild(createQuestionArrow(state, -1));
    card.appendChild(body);
    card.appendChild(createQuestionArrow(state, 1));
    task.appendChild(card);
    task.appendChild(createElement(
      "p",
      "question-note",
      "分かるところだけで大丈夫です。答えた内容が依頼文に入ります。"));
    return task;
  }

  // The answers become a block the user can read and edit on the next
  // screen, so nothing reaches the chat unseen.
  function composeRequestWithAnswers(state) {
    var lines = [];

    state.questions.forEach(function (question, index) {
      var answer = String(state.answers[String(index)] || "").trim();

      if (answer.length === 0) {
        return;
      }
      lines.push("- " + question.text);
      answer.replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
        lines.push("  " + line);
      });
    });
    if (lines.length === 0) {
      return state.requestBase;
    }
    return state.requestBase + "\r\n\r\n" +
      "【質問への回答】\r\n" + lines.join("\r\n");
  }

  function answerQuestion(index, value) {
    var state = global.MacroStudioState.getState();
    var key = String(index);
    var next = state.answers[key] === value ? "" : value;

    if (state.busyAction) {
      return false;
    }
    return global.MacroStudioState.setAnswer(Number(index), next);
  }

  // Moving between questions is its own control, kept away from the
  // fixed back / next pair that moves between screens.
  function goToQuestion(index) {
    if (global.MacroStudioState.getState().busyAction) {
      return false;
    }
    return global.MacroStudioState.setQuestionIndex(Number(index));
  }

  // ---- screen 5: take the whole answer in at once ----

  function createSummaryText(summary) {
    var box = createElement("div", "intake-summary");

    String(summary)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .forEach(function (line) {
        box.appendChild(createElement("p", "intake-summary-line", line));
      });
    return box;
  }

  // What came in, said once. The AI's own account of the change sits
  // behind a disclosure so it never pushes the button off the screen.
  function createIntakeResult(state) {
    var result = state.intakeResult || {};
    var imported = global.MacroStudioScreens.countImported(state);
    var headline = createElement("div", "headline-card");
    var wrap = createElement("div", "intake-result");

    headline.appendChild(createIcon("check", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      imported + "個のモジュールを取り込みました"));
    headline.appendChild(createElement(
      "p",
      "headline-preview",
      (result.added > 0
        ? "既存 " + result.existing + "個・新規 " + result.added + "個"
        : "既存 " + result.existing + "個") +
        "。内容は次の画面で確認できます。"));
    if (result.kindWarning) {
      headline.appendChild(createElement(
        "p",
        "headline-warning",
        result.kindWarning));
    }
    wrap.appendChild(headline);
    if (result.summary) {
      wrap.appendChild(createDisclosure(
        "intake-summary",
        "AIが書いた改修内容を見る",
        createSummaryText(result.summary),
        { note: "AIの説明" }));
    }
    return wrap;
  }


  // What has arrived so far when the answer comes one module at a time,
  // and what is still outstanding.
  function createPartProgress(state) {
    var api = global.MacroStudioResponse;
    var parts = state.intakeParts;
    var total = parts && parts.total ? parts.total : 0;
    var box = createElement("div", "intake-parts");
    var list = createElement("div", "intake-part-list");
    var missing = api.describeMissingParts(parts);

    box.appendChild(createElement(
      "div",
      "intake-part-count",
      total > 0
        ? parts.parts.length + " / " + total + "個を受け取りました"
        : "まだ受け取っていません"));
    (parts && parts.parts ? parts.parts : []).forEach(function (entry) {
      var row = createElement("div", "intake-part-row");

      row.appendChild(createIcon("check", "flow-icon--small"));
      row.appendChild(createElement(
        "span",
        "intake-part-number",
        api.formatPartNumber(entry.index)));
      row.appendChild(createElement("span", "", entry.name));
      list.appendChild(row);
    });
    box.appendChild(list);
    if (missing) {
      box.appendChild(createElement("p", "intake-part-missing", missing));
    }
    return box;
  }

  // What came back when the answer was "there is nothing to change":
  // which of the two verdicts it was, and the reason it gave. The
  // reason is the AI's own words, shown as it wrote them.
  function createNoChangeResult(state) {
    var result = global.MacroStudioScreens.getNoChangeResult(state);
    var described = describeNoChange(result.verdict);
    var headline = createElement("div", "headline-card");
    var wrap = createElement("div", "intake-result");

    headline.appendChild(createIcon("info", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      described.label));
    headline.appendChild(createElement(
      "p",
      "headline-preview",
      described.note));
    wrap.appendChild(headline);
    // The reason is the whole of this result, so it is on the screen,
    // not behind something to open.
    wrap.appendChild(createSummaryText(result.summary));
    return wrap;
  }

  function createScreen5(state) {
    var api = global.MacroStudioScreens;
    var task = createTask("task--wide");
    var imported = api.countImported(state);
    var split = api.isSplitOutput(state);
    var started = split && api.getIntakePartTotal(state) > 0;
    var noChange = api.isNoChange(state);
    var target = createElement("div", "paste-target");
    var guide = createElement("div", "intake-guide");
    var actions = createElement("div", "inline-actions");
    var steps = split
      ? [
        ["1", "AIの返答の", "コードブロック", "をコピーする"],
        ["2", "下のボタンで", "そのモジュールを取り込む", ""],
        ["3", "AIへ", "次のモジュールを出すよう返事", "する"]
      ]
      : [
        ["1", "AIの返答の", "コードブロック", "をコピーする"],
        ["2", "下のボタンで", "まとめて取り込む", ""],
        ["3", "次の画面で", "内容を確認", "する"]
      ];

    task.appendChild(createTaskIntro(
      noChange
        ? "AIは、変更するモジュールは無いと返してきました。"
        : imported > 0
          ? "取り込みました。右下の「次へ」で内容を確認します。"
          : split
            ? "モジュールごとに返ってくるコードブロックを、" +
              "届いた順に取り込んでください。"
            : "AIの返答にあるコードブロックをコピーして、" +
              "ボタンを押してください。"));

    // Even after a package has come in, the way to take a corrected
    // answer instead stays on this screen.
    if (noChange) {
      task.appendChild(createNoChangeResult(state));
    } else if (imported > 0) {
      task.appendChild(createIntakeResult(state));
    } else {
      steps.forEach(function (item) {
        var step = createElement("div", "intake-step");
        var text = createElement("span", "intake-step-text");

        step.appendChild(
          createElement("span", "intake-step-number", item[0]));
        text.appendChild(createElement("span", "", item[1]));
        text.appendChild(createElement("strong", "", item[2]));
        if (item[3]) {
          text.appendChild(createElement("span", "", item[3]));
        }
        step.appendChild(text);
        guide.appendChild(step);
      });
      task.appendChild(guide);
      if (started) {
        task.appendChild(createPartProgress(state));
      }
    }

    target.appendChild(createIcon(
      imported > 0 || noChange ? "check" : "code",
      "drop-icon"));
    target.appendChild(createElement(
      "h2",
      "",
      noChange
        ? "変更するモジュールはありませんでした"
        : imported > 0
          ? imported + "個のモジュールを取り込みました"
          : split
            ? "モジュールを1つずつ取り込みます"
            : "AIの返答をここへ取り込みます"));
    target.appendChild(createElement(
      "p",
      "",
      noChange
        ? "改修済みブックは作りません。" +
          "別の返答を受け取ったときは、取り込み直せます。"
        : imported > 0
          ? "取り込み直すときは、もう一度コピーしてからボタンを押します。"
          : "コードブロック全体をコピーしてから、ボタンを押してください。"));
    // Taking a different answer instead always stays available. With
    // one paste that means pasting again; with one module per answer the
    // collection is emptied first, then filled from module 00 again.
    if (imported > 0 && split) {
      actions.appendChild(createFlowButton(
        "最初から取り込み直す",
        "restart-intake",
        { icon: "copy", disabled: state.busyAction !== null }));
    } else {
      actions.appendChild(createFlowButton(
        state.busyAction === "readClipboard"
          ? "読み取っています"
          : imported > 0 || noChange
            ? "取り込み直す"
            : started
              ? "次のモジュールを取り込む"
              : "クリップボードからAIの返答を取り込む",
        "import-response",
        {
          kind: imported > 0 || noChange ? "" : "primary",
          icon: "copy",
          disabled: state.busyAction !== null
        }));
      if (started) {
        actions.appendChild(createFlowButton(
          "最初から取り込み直す",
          "restart-intake",
          { disabled: state.busyAction !== null }));
      }
    }
    target.appendChild(actions);
    task.appendChild(target);
    return task;
  }

  // ---- screen 6: confirm what came in ----

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
  function createSimpleReviewScreen(state) {
    var task = createTask("task--wide");
    var headline = createElement("div", "headline-card");
    var summary = state.intakeResult && state.intakeResult.summary
      ? String(state.intakeResult.summary)
      : "";

    task.appendChild(createTaskIntro(
      "AIが直した内容です。"));
    headline.appendChild(createIcon("code", "headline-icon"));
    headline.appendChild(createElement(
      "div",
      "headline-text",
      "改修内容"));
    task.appendChild(headline);
    if (summary) {
      task.appendChild(createSummaryText(summary));
    } else {
      task.appendChild(createElement(
        "p",
        "headline-preview",
        "AIからの説明はありませんでした。" +
          "そのまま改修へ進めます。"));
    }
    return task;
  }

  function createScreen6(state) {
    var api = global.MacroStudioScreens;
    var changed;
    var unchanged;
    var open;
    var task;
    var headline;
    var kindWarning;

    if (api.isSimple(state)) {
      return createSimpleReviewScreen(state);
    }
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
      input.setAttribute("aria-describedby", "output-name-error");
      var nameHelp = createElement("p", "field-help",
        "120文字以内で、Windowsで使用できるファイル名にしてください。" +
        "NUL・CONなどの予約名や、パス区切り文字は使えません。");
      nameHelp.id = "output-name-error";
      panel.appendChild(nameHelp);
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
      ["AIへ渡した依頼文", "request.md"],
      ["元マクロのコード全文", "source-code.md"]
    ];

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
    // The source workbook was signed. The signature signed the VBA
    // project, this run rewrote the VBA project, so it was taken out
    // rather than carried into a file it no longer matches. Whoever
    // distributes this workbook has to sign it again, and nothing else
    // in the run would tell them that.
    if (result && result.signatureRemoved) {
      panel.appendChild(createElement(
        "p",
        "result-note result-note--signature",
        "元のブックにあったコード署名は、この改修済みブックには" +
          "付いていません。コードを書き換えたため、元の署名は" +
          "内容と一致しなくなります。配布する前に署名し直してください。"));
    }
    task.appendChild(panel);
    return task;
  }

  // ---- shell rendering ----

  // Same order as the screen table: the work is chosen first, then the
  // workbook is read.
  var screenBuilders = [
    createScreenMode,
    createScreen0,
    createScreen1,
    createScreen2,
    createScreenQuestions,
    createScreen3,
    createScreen4,
    createScreen5,
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
      ((state.screen + 1) / global.MacroStudioScreens.count * 100) + "%";
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
    // The short way builds straight from the review screen, so the one
    // button there says what pressing it does.
    var forwardLabel = done
      ? "完了"
      : (api.isSimple(state) &&
          state.screen === api.reviewScreen
        ? "マクロを改修"
        : "次へ");
    var forwardReady = done
      ? api.canFinish(state, state.screen)
      : global.MacroStudioState.canGoNext();
    var back = elements.footerActions.querySelector(
      '[data-action="go-back"]');
    var forward = elements.footerActions.querySelector(
      '[data-action="go-next"],[data-action="finish"]');

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
  function paintSelection(state) {
    var screen = elements.main.querySelector(".screen");
    var cards;

    if (!screen ||
        screen.getAttribute("data-screen") !== String(state.screen)) {
      return false;
    }
    cards = screen.querySelectorAll(
      '[data-action="select-mode"],[data-action="select-purpose"]');
    if (cards.length === 0) {
      return false;
    }
    Array.prototype.forEach.call(cards, function (card) {
      // Compare against whichever key this card carries: a null on
      // both sides would otherwise mark every card selected.
      var mode = card.getAttribute("data-mode");
      var file = card.getAttribute("data-preset-file");
      var selected = mode !== null
        ? mode === state.mode
        : file !== null && file === state.presetFile;
      var mark = card.querySelector(".choice-state");

      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
      card.disabled = state.busyAction !== null;
      if (!mark) {
        return;
      }
      if (selected && mark.children.length === 0) {
        mark.appendChild(createIcon("check", "flow-icon--small"));
      } else if (!selected && mark.children.length > 0) {
        mark.textContent = "";
      }
    });
    return true;
  }

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
    var workspace = createElement("div", "workspace");
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

    if (state.screen === global.MacroStudioScreens.intakeScreen ||
        state.screen === global.MacroStudioScreens.reviewScreen) {
      workspace.classList.add("workspace--code");
    } else {
      workspace.classList.add("workspace--centered");
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
    // The preset folder is re-read every time the list is shown.
    if (state.screen === global.MacroStudioScreens.purposeScreen &&
        lastRenderedScreen !== global.MacroStudioScreens.purposeScreen &&
        global.hostBridge) {
      lastRenderedScreen = global.MacroStudioScreens.purposeScreen;
      loadAppInfo();
    }
    lastRenderedScreen = state.screen;
    renderProgress(state);
    if (!paintSelection(state)) {
      renderMain(state, direction);
    }
    renderFooter(state);
    if (state.screen !== global.MacroStudioScreens.buildScreen) {
      buildStarted = false;
    } else if (!buildStarted) {
      buildStarted = true;
      buildBook();
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

    if (!data || (data.warning !== true && level !== "sourceDoubt")) {
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
            "このブックは相談用の読み取りのみ対応します。" +
            "改修版の作成には、正常なブックを読み直してください。"
          : "このブックは相談用の読み取りのみ対応します。" +
            "改修版の作成には、正常なブックを読み直してください。"
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

  function handleHostError(error, path) {
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
      showToast(viewError.message, "error");
    }
    recordClientError(error, path);
    return null;
  }

  function recordInfo(message) {
    global.hostBridge.request("writeLog", {
      level: "INFO",
      message: message
    }).then(function () {
      return null;
    }, function () {
      return null;
    });
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

    // Lock before the first asynchronous step, not after assets load.
    global.MacroStudioState.setBusyAction("buildBook");

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
        resultError: result.resultError || "",
        signatureRemoved: result.signatureRemoved === true
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
      global.MacroStudioState.setHandoffProgress(null, true);
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
      { path: path },
      {
        timeoutMilliseconds: 0,
        onSlow: function () {
          showToast("ブックを読み込み中です。処理は続いています。", "warning");
        }
      }
    ).then(function (data) {
      var warningMessage;

      newModuleNameDraft = "";
      data.book.warning = data.warning === true;
      data.book.read = describeReadResult(data);
      global.MacroStudioState.setBook(data.book, data.modules);
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
    return global.hostBridge.request("pickBook", {}, {
      timeoutMilliseconds: 0
    }).then(
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

  function fillRequestId(text, requestId) {
    return String(text === undefined || text === null ? "" : text)
      .split("{{REQUEST_ID}}")
      .join(requestId || "");
  }

  // Choosing the purpose loads one preset file and mints the request
  // id that ties this request to the answer it will get back.
  function selectMode(mode) {
    if (global.MacroStudioState.getState().busyAction) {
      return false;
    }
    global.MacroStudioState.setMode(mode);
    global.MacroStudioState.setLastError(null);
    clearToast();
    return true;
  }

  function startSimple() {
    if (global.MacroStudioState.getState().busyAction) {
      return false;
    }
    global.MacroStudioState.startSimple();
    clearToast();
    announce("簡易モードで始めます。ブックを選んでください。");
    return true;
  }

  // The short way asks the user what to change instead of offering
  // purposes, but the answer still has to come back in the shape the
  // importer accepts. Those rules live in the presets and nowhere else,
  // so one is read here for its output rules alone - its own request
  // text is replaced by what the user wrote. A preset that cannot answer
  // both ways is not usable, because the long-code option must stay
  // available.
  function findSimplePreset(state) {
    var chosen = null;

    getPresetEntries(state).forEach(function (entry) {
      if (chosen ||
          !entry.valid ||
          entry.mode !== "refactor" ||
          !entry.splitOutput) {
        return;
      }
      chosen = entry;
    });
    return chosen;
  }

  // Called when the short way reaches the request screen. The request id
  // is minted here, exactly as choosing a purpose would.
  function prepareSimpleRequest() {
    var state = global.MacroStudioState.getState();
    var entry;

    // Always a promise: the caller waits on it before moving the flow
    // on, so a refusal has to arrive the same way an answer does.
    if (!state.simple || state.busyAction || state.requestId) {
      return Promise.resolve(null);
    }
    entry = findSimplePreset(state);
    if (!entry) {
      handleHostError({
        code: "E-PRESET-01",
        data: {
          userMessage: "依頼の形式を読み取れませんでした。" +
            "presets フォルダを確認してください。"
        }
      }, "");
      return Promise.resolve(null);
    }
    return selectPurpose(entry.file).then(function (result) {
      if (!result) {
        return null;
      }
      // What the user writes replaces the preset's own request text.
      global.MacroStudioState.setRequestBase("");
      global.MacroStudioState.setRequestText("");
      return result;
    });
  }

  // Turning the option on changes which rules the request carries, so
  // anything already taken in under the other shape is dropped.
  function setSplitOutput(enabled) {
    var state = global.MacroStudioState.getState();

    if (state.busyAction || !state.splitOutputRules) {
      return false;
    }
    if (!global.MacroStudioState.setSplitOutput(enabled)) {
      return false;
    }
    clearToast();
    announce(enabled
      ? "モジュール単位出力を使います。AIは1回の返答に1つのモジュールだけ出します。"
      : "モジュール単位出力をやめました。AIは1回の返答にまとめて出します。");
    return true;
  }

  function selectPurpose(file) {
    var state = global.MacroStudioState.getState();

    if (!file || state.busyAction) {
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("readPreset");
    return global.hostBridge.request(
      "readPreset",
      { file: file }
    ).then(function (result) {
      var parsed = global.MacroStudioPreset.parse(result.content);
      var requestId;

      // The file is read again on every press, so a file that broke
      // since the list was built must not be applied.
      if (!parsed.valid) {
        global.MacroStudioState.setBusyAction(null);
        handleHostError({
          code: "E-PRESET-01",
          message: file + ": " + parsed.message,
          data: {
            userMessage: file + " を読み取れませんでした。" +
              parsed.message
          }
        }, file);
        loadAppInfo();
        return null;
      }

      requestId = global.MacroStudioResponse.createRequestId();
      global.MacroStudioState.setLastError(null);
      global.MacroStudioState.setPurpose(
        file,
        parsed.name,
        requestId,
        parsed.questions);
      global.MacroStudioState.setRequestBase(
        fillRequestId(parsed.instruction.body, requestId));
      global.MacroStudioState.setRequestText(
        fillRequestId(parsed.instruction.body, requestId));
      global.MacroStudioState.setOutputRules({
        presetFile: file,
        presetName: parsed.name,
        title: parsed.output.title,
        body: fillRequestId(parsed.output.body, requestId)
      });
      // Only a preset that writes the one-module-per-reply rules can
      // offer that option; nothing here supplies a substitute wording.
      global.MacroStudioState.setSplitOutputRules(parsed.splitOutput
        ? {
          presetFile: file,
          presetName: parsed.name,
          title: parsed.splitOutput.title,
          body: fillRequestId(parsed.splitOutput.body, requestId)
        }
        : null);
      global.MacroStudioState.setBusyAction(null);
      clearToast();
      announce(parsed.name + " を選びました。");
      return result;
    }, function (error) {
      handleHostError(error, "");
      global.MacroStudioState.setBusyAction(null);
      return null;
    });
  }

  // Leaving the request screen creates this run's folder and writes
  // both files into it, so every later output lands in the same place.
  function prepareRequest() {
    var state = global.MacroStudioState.getState();
    var timestamp = createOutputTimestamp(new Date());

    if (state.busyAction || state.requestText.trim().length === 0) {
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("prepareRequest");
    return global.hostBridge.request(
      "readRequestTemplate"
    ).then(function (templateResult) {
      var codeContent;
      var prompt;
      // Whichever way of answering the user chose, the wording comes
      // from the same preset file.
      var outputRules = state.splitOutput && state.splitOutputRules
        ? state.splitOutputRules
        : state.outputRules;

      try {
        prompt = fillRequestId(
          global.MacroStudioPrompt.buildRequestPrompt({
            template: templateResult.content,
            requestText: state.requestText,
            outputRules: outputRules,
            requestId: state.requestId,
            book: state.book,
            modules: global.MacroStudioState.getBookModules(),
            codeFileName: "source-code.md"
          }),
          state.requestId);
        codeContent = global.MacroStudioPrompt.buildCodeFile({
          book: state.book,
          modules: global.MacroStudioState.getBookModules(),
          generatedAt: createCodeFileTimestamp(new Date())
        });
      } catch (error) {
        handleHostError({
          code: "E-GEN-02",
          message: error.message
        }, "");
        global.MacroStudioState.setBusyAction(null);
        return null;
      }

      return global.hostBridge.request("writeRequestFiles", {
        outputTimestamp: timestamp,
        request: prompt,
        code: codeContent
      }).then(function (result) {
        global.MacroStudioState.setRunFolder(result.folderPath);
        global.MacroStudioState.setRequestFilePath(result.codePath);
        global.MacroStudioState.setRequestPrompt(prompt);
        global.MacroStudioState.setHandoffProgress(false, false);
        global.MacroStudioState.setLastError(null);
        global.MacroStudioState.setBusyAction(null);
        clearToast();
        recordInfo("request folder created: " + result.folderPath);
        announce("依頼文とコード全文ファイルを作成しました。");
        return result;
      }, function (error) {
        handleHostError(error, "");
        global.MacroStudioState.setBusyAction(null);
        return null;
      });
    }, function (error) {
      handleHostError(error, "");
      global.MacroStudioState.setBusyAction(null);
      return null;
    });
  }

  function copyRequestPrompt() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction || !state.requestPrompt) {
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("writeClipboard");
    return global.hostBridge.request(
      "writeClipboard",
      { text: state.requestPrompt }
    ).then(function () {
      global.MacroStudioState.setLastError(null);
      global.MacroStudioState.setHandoffProgress(true, null);
      global.MacroStudioState.setBusyAction(null);
      showToast("依頼文をクリップボードへコピーしました。", "success");
      announce("依頼文をクリップボードへコピーしました。");
      return true;
    }, function (error) {
      handleHostError(error, "");
      global.MacroStudioState.setBusyAction(null);
      return null;
    });
  }

  // Accepting and discarding both ask first: this is where a change
  // enters the build, or leaves it.
  function showIntakeError(message) {
    var error = {
      code: "E-INTAKE-01",
      message: message
    };
    var button;

    global.MacroStudioState.setLastError(error);
    showToast(message, "error");
    button = document.querySelector('[data-action="import-response"]');
    if (button) {
      button.focus();
    }
    error.stack = (new Error("Response package refused.")).stack;
    recordClientError(error, "");
    return false;
  }

  // A whole package - one paste, or the parts merged back together - is
  // applied against the workbook's own modules. A module an earlier
  // answer added is not one of them, so a replacement package is never
  // measured against the answer it replaces.
  function applyWholePackage(state, parsed) {
    var bookModules = global.MacroStudioState.getBookModules();
    var described = global.MacroStudioResponse.describe(
      parsed,
      bookModules);
    var items = [];
    var nameError = "";
    var kindWarning;

    described.modules.forEach(function (item) {
      var normalized = normalizePastedText(item.code);
      var existing = null;
      var rows;

      bookModules.some(function (module) {
        if (module.name.toLowerCase() === item.name.toLowerCase()) {
          existing = module;
          return true;
        }
        return false;
      });
      if (normalized.length === 0) {
        nameError = global.MacroStudioResponse.messages.emptyModule;
        return;
      }
      if (!existing) {
        // Adding a module is limited to standard modules: that is the
        // only kind this app can write into a workbook.
        if (item.kind !== "standard") {
          nameError =
            "新しく増やせるのは標準モジュールだけです。" +
            "AIへ、追加する補助モジュールは標準モジュールにするよう" +
            "伝えて、もう一度お試しください。";
          return;
        }
        nameError = nameError ||
          getNewModuleNameError({ modules: bookModules }, item.name);
        if (nameError) {
          return;
        }
      }
      // Formatting-only normalisation is not a macro modification.
      if (existing && normalizePastedText(existing.code) === normalized) {
        normalized = existing.code;
      }
      rows = global.MacroStudioDiff.compare(
        existing ? existing.code || "" : "",
        normalized);
      items.push({
        name: existing ? existing.name : item.name,
        code: normalized,
        changedLineCount:
          global.MacroStudioDiff.countChangedLines(rows),
        lineCount: global.MacroStudioDiff.toLines(normalized).length
      });
    });

    if (nameError) {
      return showIntakeError(nameError);
    }
    if (items.length === 0) {
      return showIntakeError(
        global.MacroStudioResponse.messages.noSentinel);
    }

    kindWarning = global.MacroStudioResponse.describeKindWarning(
      described.kindWarnings);
    global.MacroStudioState.importPackage(items);
    global.MacroStudioState.setIntakeResult({
      total: items.length,
      existing: described.existing,
      added: described.added,
      summary: described.summary || "",
      kindWarning: kindWarning
    });
    global.MacroStudioState.setLastError(null);
    clearToast();
    if (kindWarning) {
      showToast(kindWarning, "warning");
      announce(kindWarning);
      recordInfo("kind corrected: " + described.kindWarnings.map(
        function (warning) {
          return warning.name + " " + warning.answered +
            "->" + warning.actual;
        }).join(", "));
      return true;
    }
    showToast(
      items.length + "個のモジュールを取り込みました。",
      "success");
    announce(items.length + "個のモジュールを取り込みました。");
    recordInfo("package imported: " + items.length + " modules");
    return true;
  }

  // One module per answer. Each part is collected and checked against
  // the ones already in; only when every declared module has arrived is
  // the whole thing applied, as one package.
  function applySplitPart(state, parsed) {
    var api = global.MacroStudioResponse;
    var added = api.addPart(state.intakeParts, parsed);
    var message;
    var received;

    if (!added.ok) {
      return showIntakeError(added.message);
    }
    // Starting another split answer invalidates the old complete one.
    // Otherwise Next could build yesterday's answer while a new part
    // collection is still incomplete.
    if (state.intakeRequestId || state.noChangeResult) {
      global.MacroStudioState.discardImportedModules();
    }
    global.MacroStudioState.setIntakeParts(added.collection);
    global.MacroStudioState.setLastError(null);
    clearToast();
    if (!added.complete) {
      received = parsed.modules[0];
      message = (added.added
        ? "モジュール" + api.formatPartNumber(parsed.part.index) +
          "（" + received.name + "）を受け取りました。"
        : "そのモジュールはすでに受け取っています。") +
        api.describeMissingParts(added.collection);
      showToast(message, "success");
      announce(message);
      recordInfo(
        "split part received: " +
        api.formatPartNumber(parsed.part.index) + "/" +
        api.formatPartNumber(parsed.part.total) +
        " (" + added.collection.parts.length + " collected)");
      return true;
    }
    recordInfo(
      "split parts complete: " +
      added.collection.parts.length + " modules");
    return applyWholePackage(
      global.MacroStudioState.getState(),
      api.mergeParts(added.collection));
  }

  // One answer, one press: the package is parsed, checked against the
  // request id, and every module in it is applied together. With the
  // module-by-module option the same press takes in one part.
  // What the two verdicts mean for the person reading them. How an
  // answer is asked to declare them belongs to the preset templates;
  // this is only how the declared result is reported back. Each verdict
  // is named here rather than being reached by falling through, so a
  // third one could never quietly be shown as one of these two.
  var noChangeWords = {
    UNNECESSARY: {
      label: "改修は不要と判断されました",
      note: "いまのマクロのままで依頼の内容を満たしている、という" +
        "返答です。下の理由を読んで、納得できないときは依頼文を" +
        "書き直して、AIへもう一度渡してください。"
    },
    IMPOSSIBLE: {
      label: "この依頼では改修できないと判断されました",
      note: "渡したモジュールを書き換える形では対応できない、という" +
        "返答です。下の理由を読んで、依頼の書き方を変えるか、" +
        "別のやり方を考えてください。"
    }
  };

  function describeNoChange(verdict) {
    return Object.prototype.hasOwnProperty.call(noChangeWords, verdict)
      ? noChangeWords[verdict]
      : {
        label: "変更なしと判断されました",
        note: "変更するモジュールは無い、という返答です。" +
          "下の理由を読んで、どうするか決めてください。"
      };
  }

  // An answer that concludes nothing should change is a result, so it
  // is taken in and shown. There is no diff to look at and no workbook
  // to build, so the run stops on this screen instead of going on.
  function applyNoChange(parsed) {
    var described = describeNoChange(parsed.noChange);

    global.MacroStudioState.setNoChangeResult(
      parsed.noChange,
      parsed.summary || "");
    global.MacroStudioState.setLastError(null);
    clearToast();
    showToast(described.label + "。", "info");
    announce(described.label + "。");
    recordInfo("no change reported: " + parsed.noChange);
    return true;
  }

  function applyResponsePackage(text) {
    var state = global.MacroStudioState.getState();
    var parsed = global.MacroStudioResponse.parse(text, state.requestId);

    if (!parsed.ok) {
      return showIntakeError(parsed.message);
    }
    // A verdict of "nothing to change" is a whole answer however the
    // run asked for its modules, so it is taken before the split path
    // can sit waiting for a module 00 that is never coming.
    if (parsed.noChange) {
      return applyNoChange(parsed);
    }
    if (global.MacroStudioScreens.isSplitOutput(state)) {
      return applySplitPart(state, parsed);
    }
    // A part on its own is not the whole answer, so it is refused
    // instead of being taken in as if it were.
    if (parsed.part) {
      return showIntakeError(
        global.MacroStudioResponse.messages.partUnexpected);
    }
    return applyWholePackage(state, parsed);
  }

  // Emptying the intake, so a contradicting or muddled set of parts can
  // be collected again from the beginning.
  function restartIntake() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return false;
    }
    global.MacroStudioState.discardImportedModules();
    global.MacroStudioState.setLastError(null);
    clearToast();
    announce("取り込んだ内容を空にしました。もう一度取り込めます。");
    recordInfo("intake restarted");
    return true;
  }

  function importResponsePackage() {
    var state = global.MacroStudioState.getState();

    if (state.busyAction) {
      return Promise.resolve(null);
    }
    if (!state.requestId) {
      showIntakeError(
        "先に依頼文を作ってください。依頼の画面へ戻ると作成できます。");
      return Promise.resolve(null);
    }

    global.MacroStudioState.setBusyAction("readClipboard");
    return global.hostBridge.request("readClipboard").then(
      function (result) {
        global.MacroStudioState.setBusyAction(null);
        return applyResponsePackage(result.text || "");
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

    // Use the same equivalence rule as whole-package intake. A manual
    // edit that merely loses the final newline must not become a change.
    if (normalizePastedText(module.code || "") === normalizedText) {
      normalizedText = module.code;
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
    elements.editDiscardModal.showModal();
    return false;
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
        if (appInfo && Array.isArray(appInfo.presets)) {
          global.MacroStudioState.setAppInfo(appInfo);
        }
        return appInfo;
      },
      function (error) {
        handleHostError(error, "");
        return null;
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

    if (!global.MacroStudioState.canGoNext()) {
      return false;
    }
    if (state.screen === global.MacroStudioScreens.questionScreen) {
      global.MacroStudioState.setRequestText(
        composeRequestWithAnswers(state));
    }
    // The short way has no purpose screen, so the request id and the
    // answer rules are taken on the way to where the user writes.
    if (state.simple &&
        state.screen === global.MacroStudioScreens.bookScreen &&
        !state.requestId) {
      prepareSimpleRequest().then(function (result) {
        if (result) {
          global.MacroStudioState.goNext();
          elements.main.focus();
        }
        return result;
      });
      return true;
    }
    // Leaving the request screen is where the run folder and its two
    // files are written.
    if (state.screen === global.MacroStudioScreens.handoffScreen - 1) {
      prepareRequest().then(function (result) {
        if (result) {
          global.MacroStudioState.goNext();
          elements.main.focus();
        }
        return result;
      });
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
    if (action === "pick-book") {
      pickBook();
    } else if (action === "replace-book") {
      guardEditDraft(function () {
        goToScreen(global.MacroStudioScreens.bookScreen);
      });
    } else if (action === "toggle-disclosure") {
      toggleDisclosure(button.getAttribute("data-disclosure"));
    } else if (action === "select-mode") {
      selectMode(button.getAttribute("data-mode"));
    } else if (action === "start-simple") {
      startSimple();
    } else if (action === "go-question") {
      goToQuestion(button.getAttribute("data-index"));
    } else if (action === "answer-choice") {
      answerQuestion(
        button.getAttribute("data-question"),
        button.getAttribute("data-value"));
    } else if (action === "select-purpose") {
      selectPurpose(button.getAttribute("data-preset-file"));
    } else if (action === "copy-request-prompt") {
      copyRequestPrompt();
    } else if (action === "open-run-folder") {
      openRunFolder();
    } else if (action === "import-response") {
      importResponsePackage();
    } else if (action === "restart-intake") {
      restartIntake();
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
    }
  }

  function onMainInput(event) {
    if (event.target.hasAttribute &&
        event.target.hasAttribute("data-question")) {
      global.MacroStudioState.setAnswer(
        Number(event.target.getAttribute("data-question")),
        event.target.value);
      return;
    }
    if (event.target.id === "paste-edit-textarea") {
      pasteEditDraft = event.target.value;
      return;
    }
    if (event.target.id === "output-name") {
      global.MacroStudioState.setOutputName(event.target.value);
      return;
    }
    if (event.target.id === "split-output") {
      setSplitOutput(event.target.checked === true);
      return;
    }
    if (event.target.id === "simple-request-input") {
      global.MacroStudioState.setRequestText(event.target.value);
      return;
    }
    if (event.target.id !== "request-text") {
      return;
    }
    event.target.removeAttribute("aria-invalid");
    global.MacroStudioState.setRequestText(event.target.value);
  }

  // Ctrl+V on the intake screen does the same as the button.
  function onDocumentPaste(event) {
    var state = global.MacroStudioState.getState();
    var text = "";

    if (state.screen !== global.MacroStudioScreens.intakeScreen ||
        state.busyAction) {
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
    applyResponsePackage(text);
  }

  function onDocumentKeyDown(event) {
    var state = global.MacroStudioState.getState();

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
    if (files.length !== 1) {
      showToast("ブックは1つずつ選んでください。複数ファイルは読み込みませんでした。", "warning");
      return;
    }
    if (global.MacroStudioState.getState().busyAction) {
      showToast("処理中のため読み込みませんでした。完了後にもう一度選んでください。", "warning");
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

      pendingEditDiscardAction = null;
      elements.editDiscardModal.close();
      pasteEditDraft = "";
      global.MacroStudioState.cancelPasteEdit();
      announce("未反映の修正を破棄しました。");
      if (action) {
        action();
      }
    });
    elements.editDiscardModal.addEventListener("cancel", function () {
      pendingEditDiscardAction = null;
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
      if (data.paths && data.paths.length !== 1) {
        showToast("ブックは1つずつ選んでください。複数ファイルは読み込みませんでした。", "warning");
        return;
      }
      if (global.MacroStudioState.getState().busyAction) {
        showToast("処理中のため読み込みませんでした。完了後にもう一度選んでください。", "warning");
        return;
      }
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
    selectPurpose: selectPurpose,
    applyResponsePackage: applyResponsePackage,
    importResponsePackage: importResponsePackage,
    toggleDisclosure: toggleDisclosure,
    prepareRequest: prepareRequest,
    copyRequestPrompt: copyRequestPrompt,
    openRunFolder: openRunFolder,
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
    createIntakeScreen: createScreen5,
    createDoneScreen: createScreenDone,
    createModeScreen: createScreenMode,
    createRequestScreen: createScreen3,
    createReviewScreen: createScreen6,
    createBookScreen: createScreen0,
    createPurposeScreen: createScreen2,
    buildBook: buildBook,
    retryBuild: retryBuild,
    finishFlow: finishFlow,
    acceptPastedText: acceptPastedText,
    beginEditPaste: beginEditPaste,
    applyPasteEdit: applyPasteEdit,
    requestCancelPasteEdit: requestCancelPasteEdit,
    isEditDraftDirty: isEditDraftDirty,
    applyResponsePackage: applyResponsePackage,
    importResponsePackage: importResponsePackage,
    restartIntake: restartIntake,
    setSplitOutput: setSplitOutput,
    toggleDisclosure: toggleDisclosure,
    selectMode: selectMode,
    answerQuestion: answerQuestion,
    goToQuestion: goToQuestion,
    composeRequestWithAnswers: composeRequestWithAnswers,
    loadAppInfo: loadAppInfo,
    loadDemoState: global.MacroStudioState.loadDemoState
  };

  document.addEventListener("DOMContentLoaded", initialize);
}(window));
