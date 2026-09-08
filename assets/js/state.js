(function (global) {
  "use strict";

  var listeners = [];

  function createInitialState() {
    return {
      screen: 0,
      history: [],
      appInfo: null,
      book: null,
      modules: [],
      selectedModuleName: null,
      pasteEditing: false,
      mode: null,
      // The short way through the same run: fewer screens, nothing else
      // different. Off unless the opening screen turns it on.
      simple: false,
      presetFile: null,
      presetName: "",
      questions: [],
      answers: {},
      questionIndex: 0,
      requestBase: "",
      requestId: null,
      intakeResult: null,
      // An answer that concluded nothing should change: which verdict
      // it reached, why, and which request it answered. It is a result
      // in its own right, so it is kept apart from an import and never
      // counts as one.
      noChangeResult: null,
      // Which request the imported package answered. A package only
      // counts while it belongs to the request that is on screen.
      intakeRequestId: null,
      requestText: "",
      outputRules: null,
      splitOutputRules: null,
      splitOutput: false,
      intakeParts: null,
      requestFilePath: null,
      requestPrompt: null,
      runFolder: null,
      promptCopied: false,
      codeFolderOpened: false,
      outputName: "",
      // The date the produced files carry, fixed when the workbook is
      // read so every file of one run agrees.
      outputDateStamp: "",
      buildTimestamp: null,
      buildResult: null,
      buildSlow: false,
      lastError: null,
      busyAction: null
    };
  }

  var state = createInitialState();

  function notify() {
    listeners.slice().forEach(function (listener) {
      listener(state);
    });
  }

  function getState() {
    return state;
  }

  function getChangedModuleCount() {
    var count = 0;
    state.modules.forEach(function (module) {
      if (module.status === "changed") {
        count += 1;
      }
    });
    return count;
  }

  // Files that fail to parse are listed with their reason but are not
  // usable presets, so they must not become a guide target.
  function countUsablePresets() {
    var presets = state.appInfo && state.appInfo.presets
      ? state.appInfo.presets
      : [];

    if (global.MacroStudioPreset) {
      return global.MacroStudioPreset.countValid(presets);
    }
    return presets.length;
  }

  function getAcceptedModuleCount() {
    var count = 0;

    state.modules.forEach(function (module) {
      if (module.status === "changed" && module.accepted === true) {
        count += 1;
      }
    });
    return count;
  }

  function getLineCount(value) {
    var text = typeof value === "string" ? value : "";
    var lines;

    if (!text) {
      return 0;
    }
    lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.length;
  }

  // Screen flow. The screen table (screens.js) owns the order and the
  // readiness rules; the state owns where we are and how we got here.
  function screenApi() {
    return global.MacroStudioScreens;
  }

  function canGoNext() {
    var api = screenApi();

    return api ? api.canAdvance(state, state.screen) : false;
  }

  function canGoBack() {
    var api = screenApi();

    return api ? api.canGoBack(state, state.screen) : false;
  }

  function goTo(index, remember) {
    var api = screenApi();
    var count = api ? api.count : 1;
    var next = Math.max(0, Math.min(count - 1, Number(index) || 0));

    if (next === state.screen) {
      return false;
    }
    if (remember !== false) {
      state.history.push(state.screen);
    }
    state.screen = next;
    state.pasteEditing = false;
    notify();
    return true;
  }

  function goNext() {
    var api = screenApi();

    if (!api || !canGoNext()) {
      return false;
    }
    return goTo(api.nextIndex(state, state.screen), true);
  }

  function goBack() {
    var api = screenApi();
    var target;

    if (!canGoBack()) {
      return false;
    }
    target = state.history.length > 0
      ? state.history.pop()
      : state.screen - 1;
    if (api && state.screen === api.doneScreen) {
      state.buildResult = null;
    }
    return goTo(target, false);
  }

  // yyyyMMdd of the given local date, fixed width, for the names of the
  // files a run produces.
  function formatDateStamp(dateValue) {
    var value = dateValue || new Date();

    function pad(part) {
      return part < 10 ? "0" + String(part) : String(part);
    }

    return String(value.getFullYear()) +
      pad(value.getMonth() + 1) +
      pad(value.getDate());
  }

  function getBookBaseName(book) {
    var name;
    var extension;

    if (!book || !book.name) {
      return "";
    }
    extension = book.ext ? String(book.ext) : "";
    name = String(book.name);
    if (extension &&
        name.toLowerCase().slice(-extension.length) ===
          extension.toLowerCase()) {
      name = name.slice(0, name.length - extension.length);
    }
    return name;
  }

  // Both names carry the same date, taken once when the workbook is read
  // and kept for the whole run. One date for the whole run matters more
  // than a fresh one per file: a rebuild must replace the report it made
  // before instead of leaving a second one beside it.
  //
  // <base>-Modified-<yyyyMMdd><original extension>. The user can rename
  // it on the output screen; this is only what the field starts with.
  function getDefaultOutputName(book, dateStamp) {
    var base = getBookBaseName(book);

    if (!base) {
      return "";
    }
    var suffix = "-Modified-" + String(dateStamp || "") +
      (book.ext ? String(book.ext) : "");
    return shortenBaseName(base, suffix) + suffix;
  }

  // <base>-Diff-Report-<yyyyMMdd>.html, beside the workbook it describes.
  function getDiffReportName(book, dateStamp) {
    var base = getBookBaseName(book);

    if (!base) {
      return "";
    }
    var suffix = "-Diff-Report-" + String(dateStamp || "") + ".html";
    return shortenBaseName(base, suffix) + suffix;
  }

  function shortenBaseName(base, suffix) {
    return base.slice(0, Math.max(1, 120 - suffix.length))
      .replace(/[\uD800-\uDBFF]$/, "");
  }

  // Artifacts and answers only describe the request that created them.
  function clearPreparedArtifacts() {
    state.requestFilePath = null;
    state.requestPrompt = null;
    state.runFolder = null;
    state.promptCopied = false;
    state.codeFolderOpened = false;
    state.buildTimestamp = null;
    state.buildResult = null;
    state.buildSlow = false;
  }

  function invalidateRequestRevision() {
    var oldId = state.requestId;
    var issued = Boolean(state.requestPrompt || state.intakeRequestId ||
      state.noChangeResult || state.intakeParts);

    if (oldId && issued) {
      state.requestId = global.MacroStudioResponse.createRequestId();
      [state.outputRules, state.splitOutputRules].forEach(function (rules) {
        if (rules && typeof rules.body === "string") {
          rules.body = rules.body.split(oldId).join(state.requestId);
        }
      });
      state.requestBase = state.requestBase.split(oldId).join(state.requestId);
    }
    clearImportedModules();
    clearPreparedArtifacts();
  }

  // Reading a workbook is the second decision now: the work was chosen
  // on the first screen, so the mode survives here. Everything the
  // previous workbook produced does not.
  function setBook(book, modules) {
    var api = screenApi();

    state.screen = api ? api.bookScreen : 1;
    state.history = [];
    state.book = book;
    state.requestBase = "";
    state.questionIndex = 0;
    state.modules = modules || [];
    state.modules.forEach(function (module) {
      module.status = "pending";
      module.changedLineCount = 0;
      module.written = false;
      module.accepted = false;
      module.pastedCode = null;
      module.showChangesOnly = module.lineCount > 200;
      module.wrapDiff = true;
    });
    state.selectedModuleName = null;
    state.pasteEditing = false;
    state.presetFile = null;
    state.presetName = "";
    state.questions = [];
    state.answers = {};
    state.requestId = null;
    state.intakeResult = null;
    state.noChangeResult = null;
    state.intakeRequestId = null;
    state.intakeParts = null;
    state.requestText = "";
    state.outputRules = null;
    state.splitOutputRules = null;
    state.splitOutput = false;
    state.requestFilePath = null;
    state.requestPrompt = null;
    state.runFolder = null;
    state.promptCopied = false;
    state.codeFolderOpened = false;
    state.outputDateStamp = formatDateStamp(new Date());
    state.outputName = getDefaultOutputName(book, state.outputDateStamp);
    state.buildTimestamp = null;
    state.buildResult = null;
    state.buildSlow = false;
    state.lastError = null;
    notify();
  }

  function setAppInfo(appInfo) {
    state.appInfo = appInfo;
    notify();
  }

  function hasImportedModules() {
    return state.modules.some(function (module) {
      return module.status === "changed" ||
        module.status === "unchanged";
    });
  }

  // The modules the workbook itself has. A module a previous answer
  // added is not one of them, so a replacement package is always
  // measured against the workbook and never against an earlier answer.
  function getBookModules() {
    return state.modules.filter(function (module) {
      return module.isNew !== true;
    });
  }

  // Takes the whole imported package back out. Used both by the
  // explicit discard and by every path that replaces one package with
  // another, so nothing from the previous answer can survive into the
  // build. Callers notify once they are done.
  function clearImportedModules() {
    var kept = [];
    var discarded = 0;

    state.modules.forEach(function (module) {
      if (module.isNew === true &&
          (module.status === "changed" ||
           module.status === "unchanged")) {
        discarded += 1;
        return;
      }
      if (module.status === "changed" || module.status === "unchanged") {
        discarded += 1;
        module.status = "pending";
        module.changedLineCount = 0;
        module.pastedCode = null;
        module.accepted = false;
        module.written = false;
        module.showChangesOnly = module.lineCount > 200;
        module.wrapDiff = true;
      }
      kept.push(module);
    });
    state.modules = kept;
    state.selectedModuleName = null;
    state.pasteEditing = false;
    state.intakeResult = null;
    state.noChangeResult = null;
    state.intakeRequestId = null;
    state.intakeParts = null;
    return discarded;
  }

  function selectModule(moduleName) {
    var found = state.modules.some(function (module) {
      return module.name === moduleName;
    });

    if (!found) {
      return false;
    }

    state.selectedModuleName = moduleName;
    state.pasteEditing = false;
    notify();
    return true;
  }

  function findModule(moduleName) {
    var found = null;

    state.modules.some(function (module) {
      if (module.name === moduleName) {
        found = module;
        return true;
      }
      return false;
    });
    return found;
  }

  function acceptModuleCode(moduleName, code, changedLineCount) {
    var module = findModule(moduleName);

    if (!module) {
      return null;
    }

    module.pastedCode = code;
    module.changedLineCount = changedLineCount || 0;
    module.status = code === module.code ? "unchanged" : "changed";
    module.accepted = module.status === "changed";
    if (module.status === "unchanged") {
      module.changedLineCount = 0;
    }
    if (module.isNew === true) {
      module.lineCount = getLineCount(code);
    }
    module.written = false;
    module.showChangesOnly = Math.max(
      module.lineCount || 0,
      getLineCount(code)) > 200;
    module.wrapDiff = true;
    state.pasteEditing = false;
    notify();
    return module;
  }

  function beginPasteEdit() {
    var module = findModule(state.selectedModuleName);

    if (state.screen !== global.MacroStudioScreens.reviewScreen ||
        !module ||
        (module.status !== "changed" &&
         module.status !== "unchanged")) {
      return false;
    }

    state.pasteEditing = true;
    notify();
    return true;
  }

  function cancelPasteEdit() {
    if (!state.pasteEditing) {
      return false;
    }

    state.pasteEditing = false;
    notify();
    return true;
  }

  function setModuleShowChangesOnly(moduleName, showChangesOnly) {
    var module = findModule(moduleName);

    if (!module ||
        (module.status !== "changed" &&
         module.status !== "unchanged")) {
      return false;
    }

    module.showChangesOnly = showChangesOnly === true;
    notify();
    return true;
  }

  function setModuleWrapDiff(moduleName, wrapDiff) {
    var module = findModule(moduleName);

    if (!module ||
        (module.status !== "changed" &&
         module.status !== "unchanged")) {
      return false;
    }

    module.wrapDiff = wrapDiff !== false;
    notify();
    return true;
  }

  function setRequestState(requestText, requestFilePath) {
    state.requestText = requestText || "";
    state.requestFilePath = requestFilePath || null;
    notify();
  }

  function setRequestText(requestText) {
    var next = requestText || "";
    var oldId = state.requestId;
    if (next === state.requestText) {
      return false;
    }
    invalidateRequestRevision();
    state.requestText = oldId && oldId !== state.requestId
      ? next.split(oldId).join(state.requestId)
      : next;
    notify();
    return true;
  }

  // The text the preset supplied, before the answers are folded in.
  function setRequestBase(requestBase) {
    state.requestBase = requestBase || "";
    notify();
  }

  // The applied preset supplies the output rules. Applying another
  // preset replaces them; the request text keeps appending.
  function setOutputRules(outputRules) {
    state.outputRules = outputRules || null;
    notify();
  }

  // The same preset file may also carry rules for answering one module
  // per reply. Only a preset that carries them can offer the option.
  function setSplitOutputRules(outputRules) {
    state.splitOutputRules = outputRules || null;
    if (!state.splitOutputRules) {
      state.splitOutput = false;
    }
    notify();
  }

  // The optional way of answering: one module per reply, for macros
  // whose code is too long to come back in a single answer.
  function setSplitOutput(enabled) {
    var next = enabled === true && Boolean(state.splitOutputRules);

    if (next === state.splitOutput) {
      return false;
    }
    state.splitOutput = next;
    invalidateRequestRevision();
    notify();
    return true;
  }

  // What has arrived so far when the answer comes one module at a time.
  function setIntakeParts(parts) {
    state.intakeParts = parts || null;
    notify();
  }

  function setRequestFilePath(requestFilePath) {
    state.requestFilePath = requestFilePath || null;
    notify();
  }

  function setRequestPrompt(requestPrompt) {
    state.requestPrompt = requestPrompt || null;
    notify();
  }

  // Refactor or diagnose. Changing the answer drops the preset that
  // belonged to the previous one, and with it the request id an
  // imported package would have answered.
  // Starting the short way is choosing a refactoring run and moving on
  // to the workbook in one press: there is no separate work to pick.
  function startSimple() {
    var api = screenApi();

    state.simple = true;
    state.mode = "refactor";
    state.presetFile = null;
    state.presetName = "";
    state.questions = [];
    state.answers = {};
    state.questionIndex = 0;
    state.requestBase = "";
    state.requestId = null;
    state.requestText = "";
    state.outputRules = null;
    state.splitOutputRules = null;
    state.splitOutput = false;
    state.lastError = null;
    clearImportedModules();
    clearPreparedArtifacts();
    state.history = [];
    state.screen = api ? api.bookScreen : 1;
    notify();
    return true;
  }

  function setMode(mode) {
    var next = mode === "diagnose" ? "diagnose" : "refactor";

    if (state.mode === next && state.simple === false) {
      return false;
    }
    state.simple = false;
    state.mode = next;
    state.presetFile = null;
    state.presetName = "";
    state.questions = [];
    state.answers = {};
    state.questionIndex = 0;
    state.requestBase = "";
    state.requestId = null;
    state.requestText = "";
    state.outputRules = null;
    state.splitOutputRules = null;
    state.splitOutput = false;
    clearImportedModules();
    clearPreparedArtifacts();
    notify();
    return true;
  }

  // One purpose, one preset file, one request id. The questions the
  // preset asks come with it, and switching preset drops old answers.
  // A new request id also drops whatever the previous request had
  // already taken in: that answer belongs to a request that is gone.
  function setPurpose(file, name, requestId, questions) {
    var nextId = requestId || null;

    if (nextId !== state.requestId) {
      clearImportedModules();
      clearPreparedArtifacts();
      state.splitOutput = false;
    }
    state.presetFile = file || null;
    state.presetName = name || "";
    state.requestId = nextId;
    state.questions = Array.isArray(questions) ? questions : [];
    state.answers = {};
    state.questionIndex = 0;
    state.intakeResult = null;
    state.noChangeResult = null;
    notify();
  }

  // One question fills the screen at a time, so the form needs to know
  // which one that is.
  function setQuestionIndex(index) {
    var next = Math.max(
      0,
      Math.min(state.questions.length - 1, Number(index) || 0));

    if (state.questions.length === 0 || next === state.questionIndex) {
      return false;
    }
    state.questionIndex = next;
    notify();
    return true;
  }

  function setAnswer(index, value) {
    var key = String(index);

    if (!state.questions[index]) {
      return false;
    }
    state.answers[key] = String(value === undefined ? "" : value);
    notify();
    return true;
  }

  function setRunFolder(runFolder) {
    state.runFolder = runFolder || null;
    notify();
  }

  function setHandoffProgress(promptCopied, codeFolderOpened) {
    if (promptCopied !== undefined && promptCopied !== null) {
      state.promptCopied = promptCopied === true;
    }
    if (codeFolderOpened !== undefined && codeFolderOpened !== null) {
      state.codeFolderOpened = codeFolderOpened === true;
    }
    notify();
  }

  function setOutputName(outputName) {
    state.outputName = outputName === undefined || outputName === null
      ? ""
      : String(outputName);
    notify();
  }

  // The accept decision on the review screen is what puts a module in
  // the build. Pasting alone never does.
  function acceptModuleChange(moduleName) {
    var module = findModule(moduleName);

    if (!module || module.status !== "changed") {
      return false;
    }
    module.accepted = true;
    notify();
    return true;
  }

  // One package at a time. Whatever a previous answer put in is taken
  // back out first, so a replacement package leaves nothing of the old
  // one behind: what the build writes is exactly what came in last.
  // Callers apply this only after the whole new package has passed its
  // checks, so a refused answer never disturbs what is already there.
  function importPackage(items) {
    var applied = [];

    clearImportedModules();
    (items || []).forEach(function (item) {
      var module = findModule(item.name);

      if (!module) {
        module = {
          name: item.name,
          type: "standard",
          typeLabel: "標準モジュール",
          ext: "bas",
          lineCount: item.lineCount || 0,
          code: "",
          attributes: "",
          isNew: true
        };
        state.modules.push(module);
      }
      module.pastedCode = item.code;
      module.status = item.code === module.code ? "unchanged" : "changed";
      module.changedLineCount = module.status === "changed"
        ? item.changedLineCount || 0
        : 0;
      // Taking the answer in IS the decision: there is no separate
      // accept step on the review screen.
      module.accepted = module.status === "changed";
      module.written = false;
      module.showChangesOnly = Math.max(
        module.lineCount || 0,
        item.lineCount || 0) > 200;
      module.wrapDiff = true;
      if (module.isNew === true) {
        module.lineCount = item.lineCount || 0;
      }
      applied.push(module);
    });
    state.selectedModuleName = applied.length > 0
      ? applied[0].name
      : state.selectedModuleName;
    state.pasteEditing = false;
    state.intakeRequestId = state.requestId;
    notify();
    return applied.length;
  }

  function setIntakeResult(result) {
    state.intakeResult = result || null;
    notify();
  }

  // An answer that concluded nothing should change. It replaces any
  // package taken in before it, because both cannot be the answer to
  // the same request, and it carries the request it answered so a
  // later one cannot inherit it.
  function setNoChangeResult(verdict, summary) {
    clearImportedModules();
    state.noChangeResult = verdict
      ? {
        verdict: String(verdict),
        summary: String(summary === undefined ? "" : summary),
        requestId: state.requestId
      }
      : null;
    notify();
    return state.noChangeResult !== null;
  }

  // Taking the whole answer back out again, so a wrong package leaves
  // nothing behind.
  function discardImportedModules() {
    var discarded = clearImportedModules();

    notify();
    return discarded;
  }

  function setBuildResult(result) {
    state.buildResult = result || null;
    notify();
  }

  function setBuildConfirmation(timestamp) {
    state.buildTimestamp = timestamp || null;
    state.buildResult = null;
    state.buildSlow = false;
    state.lastError = null;
    notify();
  }

  // A build that runs long is still running. Saying so is not a result:
  // only the host's answer ends the build, however long it takes.
  function setBuildSlow(slow) {
    var next = slow === true;

    if (next === state.buildSlow) {
      return false;
    }
    state.buildSlow = next;
    notify();
    return true;
  }

  function markModulesWritten(results) {
    (results || []).forEach(function (result) {
      var module;

      if (!result || result.result !== "written") {
        return;
      }
      module = findModule(result.name);
      if (module) {
        module.written = true;
      }
    });
    notify();
  }

  function setLastError(error) {
    state.lastError = error || null;
    notify();
  }

  function setBusyAction(action) {
    state.busyAction = action || null;
    notify();
  }

  function subscribe(listener) {
    listeners.push(listener);
    return function () {
      var index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    };
  }

  function reset() {
    state = createInitialState();
    notify();
  }

  // ?demo opens the review screen with one package already taken in.
  function loadDemoState() {
    state = createInitialState();
    state.screen = global.MacroStudioScreens.reviewScreen;
    state.appInfo = {
      version: "1.0",
      presets: [
        {
          file: "sample.md",
          content: [
            "# デモ用プリセット",
            "",
            "## 改修指示",
            "",
            "デモ用のひな形です。",
            "",
            "## 出力指示",
            "",
            "デモ用の出力指示です。",
            ""
          ].join("\n")
        }
      ]
    };
    state.book = {
      name: "受注管理.xlsm",
      path: "samples\\受注管理.xlsm",
      ext: ".xlsm",
      totalLines: 306
    };
    state.outputDateStamp = "20260729";
    state.outputName = getDefaultOutputName(
      state.book,
      state.outputDateStamp);
    state.runFolder = "samples\\MacroStudio\\受注管理_20260729_101500";
    state.presetFile = "sample.md";
    state.presetName = "デモ用プリセット";
    state.requestId = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
    state.promptCopied = true;
    state.codeFolderOpened = true;
    state.modules = [
      {
        name: "Sheet1",
        type: "document",
        typeLabel: "ドキュメントモジュール",
        ext: "cls",
        lineCount: 31,
        code: "Option Explicit\r\n\r\nPrivate Sub Worksheet_Activate()\r\nEnd Sub\r\n",
        attributes: "",
        pastedCode: null,
        status: "pending",
        changedLineCount: 0,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      },
      {
        name: "ThisWorkbook",
        type: "document",
        typeLabel: "ドキュメントモジュール",
        ext: "cls",
        lineCount: 18,
        code: "Option Explicit\r\n",
        attributes: "",
        pastedCode: null,
        status: "pending",
        changedLineCount: 0,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      },
      {
        name: "ExportHelpers",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 54,
        code: "Option Explicit\r\n\r\nPublic Sub ExportData()\r\nEnd Sub\r\n",
        attributes: "",
        pastedCode: "Option Explicit\r\n\r\nPublic Sub ExportData()\r\n    Debug.Print \"done\"\r\nEnd Sub\r\n",
        status: "changed",
        changedLineCount: 2,
        accepted: false,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      },
      {
        name: "Main",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 84,
        code: "Option Explicit\r\n\r\nPrivate Sub SaveRecord()\r\n    If Range(\"A2\").Value = \"\" Then Exit Sub\r\n    Range(\"D2\").Value = Now\r\nEnd Sub\r\n",
        attributes: "",
        pastedCode: "Option Explicit\r\n\r\nPrivate Sub SaveRecord()\r\n    If Len(Trim$(Range(\"A2\").Value)) = 0 Then\r\n        MsgBox \"伝票番号を入力してください。\"\r\n        Exit Sub\r\n    End If\r\n    Range(\"D2\").Value = Now\r\nEnd Sub\r\n",
        status: "changed",
        changedLineCount: 4,
        accepted: false,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      },
      {
        name: "CompatHelpers",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 4,
        code: "",
        attributes: "",
        pastedCode: "Option Explicit\r\n\r\nPublic Sub WaitMilliseconds(ByVal ms As Long)\r\nEnd Sub\r\n",
        status: "changed",
        changedLineCount: 4,
        accepted: false,
        isNew: true,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      },
      {
        name: "OrderRecord",
        type: "class",
        typeLabel: "クラスモジュール",
        ext: "cls",
        lineCount: 43,
        code: "Option Explicit\r\n",
        attributes: "",
        pastedCode: null,
        status: "pending",
        changedLineCount: 0,
        showChangesOnly: false,
        wrapDiff: true,
        written: false
      }
    ];
    state.intakeResult = { total: 3, existing: 2, added: 1 };
    state.intakeRequestId = state.requestId;
    state.selectedModuleName = "Main";
    notify();
  }

  global.MacroStudioState = {
    getState: getState,
    getChangedModuleCount: getChangedModuleCount,
    getAcceptedModuleCount: getAcceptedModuleCount,
    getDefaultOutputName: getDefaultOutputName,
    getDiffReportName: getDiffReportName,
    formatDateStamp: formatDateStamp,
    canGoNext: canGoNext,
    canGoBack: canGoBack,
    goTo: goTo,
    goNext: goNext,
    goBack: goBack,
    setBook: setBook,
    setAppInfo: setAppInfo,
    hasImportedModules: hasImportedModules,
    getBookModules: getBookModules,
    selectModule: selectModule,
    findModule: findModule,
    acceptModuleCode: acceptModuleCode,
    beginPasteEdit: beginPasteEdit,
    cancelPasteEdit: cancelPasteEdit,
    setModuleShowChangesOnly: setModuleShowChangesOnly,
    setModuleWrapDiff: setModuleWrapDiff,
    setRequestState: setRequestState,
    setRequestText: setRequestText,
    setRequestBase: setRequestBase,
    setMode: setMode,
    startSimple: startSimple,
    setPurpose: setPurpose,
    setAnswer: setAnswer,
    setQuestionIndex: setQuestionIndex,
    setRunFolder: setRunFolder,
    setHandoffProgress: setHandoffProgress,
    setOutputName: setOutputName,
    acceptModuleChange: acceptModuleChange,
    importPackage: importPackage,
    setIntakeResult: setIntakeResult,
    setNoChangeResult: setNoChangeResult,
    setIntakeParts: setIntakeParts,
    discardImportedModules: discardImportedModules,
    setOutputRules: setOutputRules,
    setSplitOutputRules: setSplitOutputRules,
    setSplitOutput: setSplitOutput,
    setRequestFilePath: setRequestFilePath,
    setRequestPrompt: setRequestPrompt,
    setBuildResult: setBuildResult,
    setBuildConfirmation: setBuildConfirmation,
    setBuildSlow: setBuildSlow,
    markModulesWritten: markModulesWritten,
    setLastError: setLastError,
    setBusyAction: setBusyAction,
    subscribe: subscribe,
    reset: reset,
    loadDemoState: loadDemoState
  };
}(window));
