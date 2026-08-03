(function (global) {
  "use strict";

  var listeners = [];

  function isDiagnosisProduct(result) {
    return Boolean(global.MacroStudioDiagnosis) &&
      typeof global.MacroStudioDiagnosis.isProductResult === "function" &&
      global.MacroStudioDiagnosis.isProductResult(result);
  }

  function isResponseProduct(result) {
    return Boolean(global.MacroStudioResponse) &&
      typeof global.MacroStudioResponse.isProductResult === "function" &&
      global.MacroStudioResponse.isProductResult(result);
  }

  function isPathMapProduct(result) {
    return Boolean(global.MacroStudioPathMap) &&
      typeof global.MacroStudioPathMap.isProductResult === "function" &&
      global.MacroStudioPathMap.isProductResult(result);
  }

  function createInitialState() {
    return {
      screen: 0,
      history: [],
      appInfo: null,
      book: null,
      bookInventory: null,
      bookSnapshot: "",
      modules: [],
      selectedModuleName: null,
      pasteEditing: false,


      targetEnvironment: null,
      targetEnvironmentSnapshot: "",
      diagnosisConcern: "",
      diagnosisSkipped: false,
      diagnosisSplit: false,
      diagnosisRequestId: null,
      diagnosisRequestSnapshot: null,
      diagnosisRequestText: "",
      diagnosisRequestFilePath: null,
      diagnosisPrompt: null,
      diagnosisPromptCopied: false,
      diagnosisFolderOpened: false,
      diagnosisParts: null,
      diagnosis: null,
      diagnosisAttribution: null,
      diagnosisVersion: 0,
      diagnosisFilePath: null,

      // How many times in a row a reply could not be taken in. The first
      // failure is worth a retry; a second means retrying the same way
      // is not the answer.
      intakeFailures: {diagnose: 0, repair: 0},

      // Why the last reply was refused, kept on the screen until one is
      // taken in. A toast that has already faded cannot be read while
      // fixing the paste, which is exactly when it is needed.
      intakeError: {diagnose: null, repair: null},
      presetFile: null,
      presetName: "",
      presetFiles: [],
      presets: [],
      presetContent: "",
      presetReplaceRules: null,
      presetEngine: null,
      presetSnapshot: null,
      questions: [],
      answers: {},
      behaviorCandidates: [],
      preserveItems: [],
      selectedFindings: [],
      desiredBehaviour: {},
      extraRequest: "",
      pathMap: null,
      // The exact module text the current candidates were detected in.
      // Applying reads this and nothing else, so pressing the button a
      // second time starts from the same place the first press did.
      pathMapBasis: null,
      repairInputSnapshot: "",

      repairRequestId: null,
      repairRequestSnapshot: null,
      repairRequestText: "",
      repairRequestFilePath: null,
      repairPrompt: null,
      repairPromptCopied: false,
      repairFolderOpened: false,
      intakeResult: null,
      noChangeResult: null,
      repairIntakeRequestId: null,
      repairResultSnapshot: null,
      repairResultEngine: null,
      deterministicCodeSnapshot: null,
      // What the replacement table actually carried out in this run.
      // It outlives a chat answer that comes afterwards, because the
      // record of the run has to say the tool made those replacements
      // even when a chat then edited the same code.
      appliedMapping: null,
      outputRules: null,
      splitOutputRules: null,
      splitOutput: false,
      repairIntakeParts: null,

      runFolder: null,
      // Where the one file the chat is given lives. Separate from the
      // run folder on purpose: the deliverables never mix with it.
      handoffFolder: null,
      outputTimestamp: null,
      outputName: "",
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

  // Leaving the completion screen does not undo the run. The workbook,
  // the diff report and the memo are already written to disk, so
  // forgetting the result here would have left the reader on an earlier
  // screen with no sign that any of it exists - and pressing [次へ]
  // again would build a second generation without ever saying there was
  // a first. The result is kept, and the screens say so; only work that
  // genuinely invalidates the output clears it (invalidateRepairPackage,
  // setPathMap, setBuildConfirmation).
  function goBack() {
    var target;

    if (!canGoBack()) {
      return false;
    }
    target = state.history.length > 0
      ? state.history.pop()
      : Math.max(0, state.screen - 1);
    return goTo(target, false);
  }

  function formatDateStamp(dateValue) {
    var value = dateValue || new Date();
    function pad(part) {
      return part < 10 ? "0" + String(part) : String(part);
    }
    return String(value.getFullYear()) + pad(value.getMonth() + 1) +
      pad(value.getDate());
  }

  function getBookBaseName(book) {
    var name;
    var extension;

    if (!book || !book.name) {
      return "";
    }
    name = String(book.name);
    extension = book.ext ? String(book.ext) : "";
    if (extension && name.toLowerCase().slice(-extension.length) ===
        extension.toLowerCase()) {
      name = name.slice(0, name.length - extension.length);
    }
    return name;
  }

  function getDefaultOutputName(book, dateStamp) {
    var base = getBookBaseName(book);
    return base ? base + "-Modified-" + String(dateStamp || "") +
      (book.ext ? String(book.ext) : "") : "";
  }

  function getDiffReportName(book, dateStamp) {
    var base = getBookBaseName(book);
    return base ? base + "-Diff-Report-" + String(dateStamp || "") +
      ".html" : "";
  }

  function getLineCount(value) {
    var text = typeof value === "string" ? value : "";
    var lines;

    if (!text) {
      return 0;
    }
    lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.length;
  }

  // The complete canonical value is retained instead of a short hash, so a
  // collision cannot make a package current for different workbook content.
  function createBookSnapshot(book, modules) {
    return JSON.stringify({
      path: book && book.path ? String(book.path) : "",
      name: book && book.name ? String(book.name) : "",
      ext: book && book.ext ? String(book.ext) : "",
      modules: (modules || []).map(function (module) {
        return {
          name: String(module.name || ""),
          type: String(module.type || ""),
          attributes: String(module.attributes || ""),
          code: String(module.code || "")
        };
      })
    });
  }

  function normalizeFindingId(value) {
    return String(Number(value));
  }

  function sortedFindingIds(values) {
    return (values || []).map(normalizeFindingId).sort(function (left, right) {
      return Number(left) - Number(right);
    });
  }

  function createRepairInputSnapshot() {
    var answers = state.questions.map(function (_question, index) {
      return String(state.answers[String(index)] || "");
    });
    var selected = sortedFindingIds(state.selectedFindings);
    var desired = selected.map(function (id) {
      var value = state.desiredBehaviour[id] || {};
      return {
        finding: id,
        behaviour: String(value.behaviour || ""),
        supplement: String(value.supplement || "")
      };
    });
    var mapping = state.pathMap && Array.isArray(state.pathMap.rows)
      ? state.pathMap.rows.map(function (row) {
      return {
        groupKey: String(row && row.groupKey || ""),
        from: String(row && row.from || ""),
        to: String(row && row.to || ""),
        included: row && row.included === true,
        applied: row && row.applied === true,
        validationId: String(row && row.validationId || "")
      };
    }) : [];

    return JSON.stringify({
      diagnosisVersion: state.diagnosisVersion,
      presetFiles: (state.presetFiles || []).join("|"),
      presetContent: state.presetContent || "",
      answers: answers,
      selectedFindings: selected,
      desiredBehaviour: desired,
      extraRequest: state.extraRequest,
      splitOutput: state.splitOutput === true,
      pathMap: mapping
    });
  }

  function refreshRepairInputSnapshot() {
    state.repairInputSnapshot = createRepairInputSnapshot();
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

  // Taking an answer away takes the answer away. When the tool itself
  // replaced strings earlier in the run, that replacement is the ground
  // the answer stood on, and `keepReplacement` says to leave the record
  // of it in place. Putting the code back is `restoreReplacedModules`,
  // which the caller does once it knows what goes on top.
  function clearImportedModulesInternal(keepReplacement) {
    var snapshot = state.deterministicCodeSnapshot;
    var mapping = state.appliedMapping;
    var kept = [];
    var discarded = 0;

    state.modules.forEach(function (module) {
      if (module.isNew === true &&
          (module.status === "changed" || module.status === "unchanged")) {
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
    state.repairIntakeRequestId = null;
    state.repairIntakeParts = null;
    state.repairResultSnapshot = null;
    state.repairResultEngine = null;
    state.deterministicCodeSnapshot = keepReplacement ? snapshot : null;
    state.appliedMapping = keepReplacement ? mapping : null;
    return discarded;
  }

  // Puts the code the replacement table produced back onto the modules,
  // for every module it touched. A chat answer is then layered on top of
  // this, so a reply that names one module leaves the others replaced
  // rather than reverting them to the workbook.
  function restoreReplacedModules() {
    var snapshot = state.deterministicCodeSnapshot;

    if (!snapshot || !state.appliedMapping) {
      return;
    }
    Object.keys(snapshot).forEach(function (name) {
      var module = findModule(name);

      if (!module) {
        return;
      }
      module.pastedCode = snapshot[name];
      module.status = snapshot[name] === module.code ? "unchanged" : "changed";
      module.changedLineCount = module.status === "changed"
        ? countChangedLines(module.code, snapshot[name])
        : 0;
      module.accepted = module.status === "changed";
      module.written = false;
      module.showChangesOnly = (module.lineCount || 0) > 200;
      module.wrapDiff = true;
    });
    state.repairResultEngine = "対応表による置換";
  }

  function resetOutputName() {
    state.outputName = getDefaultOutputName(state.book, state.outputDateStamp);
  }

  function invalidateRepairPackage(keepReplacement) {
    clearImportedModulesInternal(keepReplacement);
    state.buildTimestamp = null;
    state.buildResult = null;
    state.buildSlow = false;
    resetOutputName();
  }

  function invalidateRepairRequest() {
    state.repairRequestId = null;
    state.repairRequestSnapshot = null;
    state.repairRequestText = "";
    state.repairRequestFilePath = null;
    state.repairPrompt = null;
    state.repairPromptCopied = false;
    state.repairFolderOpened = false;
    invalidateRepairPackage();
  }

  // A finding the target environment stops the macro on is not optional
  // work, so it starts selected. The reader unticks what they do not want
  // rather than hunting for what they must not miss.
  var REQUIRED_FINDING_CLASSES = ["BLOCKER", "DEFECT"];

  function requiredFindingIds() {
    var findings = state.diagnosis && Array.isArray(state.diagnosis.findings)
      ? state.diagnosis.findings
      : [];

    return findings.filter(function (finding) {
      return REQUIRED_FINDING_CLASSES.indexOf(finding["class"]) >= 0;
    }).map(function (finding) {
      return String(finding.number);
    });
  }

  function clearRepairInput() {
    state.presetFile = null;
    state.presetFiles = [];
    state.presets = [];
    state.presetName = "";
    state.presetContent = "";
    state.presetReplaceRules = null;
    state.presetEngine = null;
    state.presetSnapshot = null;
    state.questions = [];
    state.answers = {};
    state.behaviorCandidates = [];
    state.preserveItems = [];
    state.selectedFindings = requiredFindingIds();
    state.desiredBehaviour = {};
    state.extraRequest = "";
    state.pathMap = null;
    state.pathMapBasis = null;
    refreshRepairInputSnapshot();
    invalidateRepairRequest();
  }

  function invalidateDiagnosisResult() {
    state.diagnosisParts = null;
    state.diagnosis = null;
    state.diagnosisAttribution = null;
    state.diagnosisFilePath = null;
    clearRepairInput();
  }

  function invalidateDiagnosisRequest() {
    state.diagnosisRequestId = null;
    state.diagnosisRequestSnapshot = null;
    state.diagnosisRequestText = "";
    state.diagnosisRequestFilePath = null;
    state.diagnosisPrompt = null;
    state.diagnosisPromptCopied = false;
    state.diagnosisFolderOpened = false;
    invalidateDiagnosisResult();
  }

  // What the workbook carries besides its code. It belongs to the book,
  // so it arrives and departs with it.
  function setBookInventory(inventory) {
    state.bookInventory = inventory || null;
    notify();
  }

  function setBook(book, modules) {
    var api = screenApi();
    var appInfo = state.appInfo;

    state = createInitialState();
    state.appInfo = appInfo;
    state.screen = api ? api.bookScreen : 0;
    state.book = book || null;
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
    state.bookSnapshot = createBookSnapshot(state.book, state.modules);
    state.outputDateStamp = formatDateStamp(new Date());
    resetOutputName();
    refreshRepairInputSnapshot();
    notify();
  }

  function setAppInfo(appInfo) {
    state.appInfo = appInfo;
    notify();
  }

  function setTargetEnvironment(profile, canonicalSnapshot) {
    var snapshot = String(canonicalSnapshot || "");
    var changed = Boolean(state.targetEnvironmentSnapshot) &&
      state.targetEnvironmentSnapshot !== snapshot;

    state.targetEnvironment = profile || null;
    state.targetEnvironmentSnapshot = snapshot;
    if (changed && state.diagnosisRequestId) {
      invalidateDiagnosisRequest();
    }
    notify();
    return changed;
  }

  function setDiagnosisConcern(value) {
    var next = String(value === undefined || value === null ? "" : value);
    if (next === state.diagnosisConcern) {
      return false;
    }
    state.diagnosisConcern = next;
    notify();
    return true;
  }

  // Skipping is a declared choice, not a silent absence: the run records
  // that no diagnosis was asked for, and any diagnosis already taken in
  // is dropped so the request cannot claim facts it did not use.
  function setDiagnosisSkipped(enabled) {
    var next = enabled === true;

    if (next === state.diagnosisSkipped) {
      return false;
    }
    state.diagnosisSkipped = next;
    if (next) {
      invalidateDiagnosisResult();
    }
    clearRepairInput();
    notify();
    return true;
  }

  function setDiagnosisSplit(enabled) {
    var next = enabled === true;
    if (next === state.diagnosisSplit) {
      return false;
    }
    state.diagnosisSplit = next;
    if (state.diagnosisRequestId || state.diagnosis) {
      invalidateDiagnosisRequest();
    }
    notify();
    return true;
  }

  function isDiagnosisRequestDirty() {
    var snapshot = state.diagnosisRequestSnapshot;
    return Boolean(snapshot) &&
      (snapshot.bookSnapshot !== state.bookSnapshot ||
       snapshot.environmentSnapshot !== state.targetEnvironmentSnapshot ||
       snapshot.concern !== state.diagnosisConcern ||
       snapshot.split !== state.diagnosisSplit);
  }

  // Called only after the host has atomically written the request files.
  function commitDiagnosisRequest(value) {
    var next = value || {};
    var requestId = String(next.requestId || "");

    if (!requestId) {
      return false;
    }
    if (state.diagnosisRequestId !== requestId) {
      invalidateDiagnosisResult();
    }
    state.diagnosisRequestId = requestId;
    state.diagnosisRequestSnapshot = {
      requestId: requestId,
      bookSnapshot: state.bookSnapshot,
      environmentSnapshot: state.targetEnvironmentSnapshot,
      concern: state.diagnosisConcern,
      split: state.diagnosisSplit
    };
    state.diagnosisRequestText = String(next.requestText || "");
    state.diagnosisRequestFilePath = next.requestPath || null;
    state.diagnosisPrompt = next.prompt || null;
    // A refusal belongs to the reply it refused. Writing a fresh request
    // is the reader acting on it, so it stops being the current news.
    state.intakeError.diagnose = null;
    state.runFolder = next.runFolder || state.runFolder;
    state.handoffFolder = next.handoffFolder || state.handoffFolder;
    state.outputTimestamp = next.outputTimestamp || state.outputTimestamp;
    state.diagnosisPromptCopied = false;
    state.diagnosisFolderOpened = false;
    state.lastError = null;
    notify();
    return true;
  }

  function setDiagnosisHandoffProgress(promptCopied, folderOpened) {
    if (promptCopied !== undefined && promptCopied !== null) {
      state.diagnosisPromptCopied = promptCopied === true;
    }
    if (folderOpened !== undefined && folderOpened !== null) {
      state.diagnosisFolderOpened = folderOpened === true;
    }
    notify();
  }

  function setDiagnosisParts(parts) {
    if (parts && !isDiagnosisProduct(parts)) {
      return false;
    }
    state.diagnosisParts = parts || null;
    notify();
    return true;
  }

  // Called only after diagnosis.md has been atomically written.
  function commitDiagnosis(diagnosis, filePath) {
    if (!isDiagnosisProduct(diagnosis) || !state.diagnosisRequestId ||
        diagnosis.requestId !== state.diagnosisRequestId ||
        isDiagnosisRequestDirty()) {
      return false;
    }
    state.diagnosisVersion += 1;
    state.diagnosis = diagnosis;
    state.diagnosisAttribution = {
      requestId: state.diagnosisRequestId,
      bookSnapshot: state.bookSnapshot,
      environmentSnapshot: state.targetEnvironmentSnapshot,
      version: state.diagnosisVersion
    };
    state.diagnosisFilePath = filePath || null;
    state.diagnosisParts = null;
    clearRepairInput();
    notify();
    return true;
  }

  // A reply that could not be taken in. Counted per stage so the second
  // failure can say something different from the first.
  function noteIntakeFailure(stage) {
    var key = stage === "repair" ? "repair" : "diagnose";

    state.intakeFailures[key] = Number(state.intakeFailures[key] || 0) + 1;
    notify();
    return state.intakeFailures[key];
  }

  function clearIntakeFailures(stage) {
    var key = stage === "repair" ? "repair" : "diagnose";

    if (!state.intakeFailures[key] && !state.intakeError[key]) {
      return false;
    }
    state.intakeFailures[key] = 0;
    state.intakeError[key] = null;
    notify();
    return true;
  }

  // What the contract found wrong, in the words the screen shows. Never
  // the reply itself (SPEC 8.4): a check number, a reason code and the
  // two sentences that go with them.
  function setIntakeError(stage, error) {
    var key = stage === "repair" ? "repair" : "diagnose";

    state.intakeError[key] = error
      ? {
        code: String(error.code || ""),
        validationId: String(error.validationId || ""),
        reason: String(error.reason || ""),
        message: String(error.message || ""),
        detail: String(error.detail || ""),
        count: Number(error.count || 1)
      }
      : null;
    notify();
    return state.intakeError[key];
  }

  // More than one template can be chosen. Their instructions go into one
  // request, in the order the templates are offered, so the chat is asked
  // once for the whole job rather than once per template.
  //
  // A template that asks for the replacement table sends nothing to a
  // chat, so it can be chosen alongside ones that do: the chat answers
  // first, the reply is taken in, and the replacements are made on the
  // code that comes back.
  function usesTable(entry) {
    return Boolean(entry && entry.parsed &&
      Array.isArray(entry.parsed.replaceRules));
  }

  function sendsRequest(entry) {
    return Boolean(entry && entry.parsed && entry.parsed.instruction);
  }

  function applyPresetSelection(entries) {
    var chosen = entries.slice();
    var first = chosen[0] || null;
    // The chat stage needs a template that actually has something to send.
    // Taking simply the first chosen one meant that picking 固定パス (02)
    // together with リファクター (03) handed the table template to the chat
    // stage: parsing it as a repair template failed, prepareRepairRequest
    // returned in silence, and screen 4 dead-ended with [次へ] enabled and
    // nothing happening. Picking 01 Win32 instead hid the bug, because that
    // one sorts first and does send a request.
    var speaker = null;
    var parsed;
    var rules = [];

    chosen.forEach(function (entry) {
      if (!speaker && sendsRequest(entry)) {
        speaker = entry;
      }
    });
    if (!speaker) {
      speaker = first;
    }
    parsed = speaker ? (speaker.parsed || {}) : {};

    state.presets = chosen;
    state.presetFiles = chosen.map(function (entry) {
      return entry.file;
    });
    state.presetFile = speaker ? speaker.file : null;
    state.presetName = chosen.map(function (entry) {
      return entry.name;
    }).join("・");
    state.presetContent = speaker ? speaker.content : "";
    chosen.forEach(function (entry) {
      if (usesTable(entry)) {
        rules = rules.concat(entry.parsed.replaceRules);
      }
    });
    state.presetReplaceRules = rules.length > 0 ? rules : null;
    // A run is a chat run if anything chosen has something to send. The
    // table is a stage inside such a run, not a different kind of run;
    // only when nothing is being sent is the table the whole of it.
    state.presetEngine = chosen.some(sendsRequest)
      ? "AI"
      : (state.presetReplaceRules ? "対応表による置換" : "AI");
    state.presetSnapshot = JSON.stringify(chosen.map(function (entry) {
      return {file: entry.file, content: entry.content};
    }));
    // The reply contract is one contract, so the first template's rules
    // govern. The reader-facing lists gather from every template chosen.
    state.questions = [];
    state.behaviorCandidates = [];
    state.preserveItems = [];
    chosen.forEach(function (entry) {
      var each = entry.parsed || {};

      state.questions = state.questions.concat(
        Array.isArray(each.questions) ? each.questions : []);
      state.behaviorCandidates = state.behaviorCandidates.concat(
        Array.isArray(each.behaviorCandidates) ? each.behaviorCandidates : []);
      state.preserveItems = state.preserveItems.concat(
        Array.isArray(each.preserveItems) ? each.preserveItems : []);
    });
    state.outputRules = parsed.output ? parsed.output.body : null;
    state.splitOutputRules = parsed.splitOutput
      ? parsed.splitOutput.body
      : null;
    if (!state.splitOutputRules) {
      state.splitOutput = false;
    }
  }

  function setRepairPreset(value) {
    var next = value || {};
    var parsed = next.parsed || {};
    var file = String(next.file || "");
    var content = String(next.content || "");
    var entry;
    var kept;
    var already;

    if (!file || !content) {
      return false;
    }
    entry = {
      file: file,
      name: String(next.name || parsed.name || ""),
      content: content,
      parsed: parsed
    };
    already = state.presetFiles.indexOf(file) >= 0;
    if (already) {
      kept = state.presets.filter(function (item) {
        return item.file !== file;
      });
    } else {
      kept = orderPresets(state.presets.concat([entry]));
    }
    invalidateRepairRequest();
    state.answers = {};
    state.selectedFindings = requiredFindingIds();
    state.desiredBehaviour = {};
    state.extraRequest = "";
    state.pathMap = null;
    state.pathMapBasis = null;
    applyPresetSelection(kept);
    refreshRepairInputSnapshot();
    notify();
    return true;
  }

  // The order the templates are offered in, so a request reads the same
  // way whichever order the reader ticked them.
  function orderPresets(entries) {
    var offered = state.appInfo && state.appInfo.presets &&
      Array.isArray(state.appInfo.presets.repair)
      ? state.appInfo.presets.repair.map(function (item) {
        return item.file;
      })
      : [];

    return entries.slice().sort(function (left, right) {
      return offered.indexOf(left.file) - offered.indexOf(right.file);
    });
  }

  // Typing on screen 4 changes what the next request would say. It does
  // not, by itself, throw away a request that has already been written or
  // an answer that has already come back: SPEC 2.6.1 confirms the discard
  // only once the new request has actually been written. Until then the
  // snapshot comparison is what marks the old work as no longer current,
  // so nothing stale can be carried forward.
  function changeRepairInput(mutator) {
    mutator();
    refreshRepairInputSnapshot();
    notify();
    return true;
  }

  function setAnswer(index, value) {
    var key = String(index);
    var next = String(value === undefined || value === null ? "" : value);
    if (!state.questions[index] || state.answers[key] === next) {
      return false;
    }
    return changeRepairInput(function () {
      state.answers[key] = next;
    });
  }

  function setFindingSelected(findingId, selected) {
    var id = normalizeFindingId(findingId);
    var values = sortedFindingIds(state.selectedFindings);
    var index = values.indexOf(id);
    var shouldSelect = selected === true;

    if ((index >= 0) === shouldSelect) {
      return false;
    }
    return changeRepairInput(function () {
      if (shouldSelect) {
        values.push(id);
      } else {
        values.splice(index, 1);
      }
      state.selectedFindings = sortedFindingIds(values);
      if (!state.desiredBehaviour[id]) {
        state.desiredBehaviour[id] = {behaviour: "", supplement: ""};
      }
    });
  }

  function updateDesiredBehaviour(findingId, field, value) {
    var id = normalizeFindingId(findingId);
    var next = String(value === undefined || value === null ? "" : value);
    var current = state.desiredBehaviour[id] || {
      behaviour: "",
      supplement: ""
    };

    if (String(current[field] || "") === next) {
      return false;
    }
    return changeRepairInput(function () {
      state.desiredBehaviour[id] = {
        behaviour: field === "behaviour" ? next : current.behaviour || "",
        supplement: field === "supplement" ? next : current.supplement || ""
      };
    });
  }

  function setDesiredBehaviour(findingId, value) {
    return updateDesiredBehaviour(findingId, "behaviour", value);
  }

  function setFindingSupplement(findingId, value) {
    return updateDesiredBehaviour(findingId, "supplement", value);
  }

  function setExtraRequest(value) {
    var next = String(value === undefined || value === null ? "" : value);
    if (next === state.extraRequest) {
      return false;
    }
    return changeRepairInput(function () {
      state.extraRequest = next;
    });
  }

  // `basis` is the module text detection just read. Only the detect call
  // sites pass it; editing a row keeps the basis the rows were found in.
  function setPathMap(rows, basis) {
    var next = rows;

    if (!isPathMapProduct(next) || next.kind !== "mapping") {
      return false;
    }
    if (Array.isArray(basis)) {
      state.pathMapBasis = basis.map(function (module) {
        return {
          name: String(module && module.name || ""),
          code: String(module && module.code || "")
        };
      });
    }
    if (next === state.pathMap ||
        JSON.stringify(next) === JSON.stringify(state.pathMap)) {
      return false;
    }
    state.pathMap = next;
    state.buildTimestamp = null;
    state.buildResult = null;
    state.buildSlow = false;
    resetOutputName();
    refreshRepairInputSnapshot();
    notify();
    return true;
  }

  // Called only after repair-request.md has been atomically written.
  function commitRepairRequest(value) {
    var next = value || {};
    var requestId = String(next.requestId || "");
    // A run that skipped the diagnosis has no findings to carry, but it
    // still has a template and a request of its own.
    if (!requestId || !state.presetFile ||
        (!state.diagnosis && state.diagnosisSkipped !== true)) {
      return false;
    }
    // The request was written from the code the table produced, so
    // writing it does not throw that replacement away.
    invalidateRepairPackage(true);
    state.repairRequestId = requestId;
    state.repairRequestSnapshot = state.repairInputSnapshot;
    state.repairRequestText = String(next.requestText || "");
    state.repairRequestFilePath = next.requestPath || null;
    state.handoffFolder = next.handoffFolder || state.handoffFolder;
    state.repairPrompt = next.prompt || null;
    state.repairPromptCopied = false;
    state.repairFolderOpened = false;
    state.lastError = null;
    state.intakeError.repair = null;
    notify();
    return true;
  }

  function setRepairHandoffProgress(promptCopied, folderOpened) {
    if (promptCopied !== undefined && promptCopied !== null) {
      state.repairPromptCopied = promptCopied === true;
    }
    if (folderOpened !== undefined && folderOpened !== null) {
      state.repairFolderOpened = folderOpened === true;
    }
    notify();
  }

  function setSplitOutputRules(outputRules) {
    state.splitOutputRules = outputRules || null;
    if (!state.splitOutputRules) {
      state.splitOutput = false;
    }
    notify();
  }

  function setSplitOutput(enabled) {
    var next = enabled === true && Boolean(state.splitOutputRules);
    if (next === state.splitOutput) {
      return false;
    }
    state.splitOutput = next;
    invalidateRepairRequest();
    refreshRepairInputSnapshot();
    notify();
    return true;
  }

  function setRepairIntakeParts(parts) {
    state.repairIntakeParts = parts || null;
    notify();
  }

  function hasImportedModules() {
    return state.modules.some(function (module) {
      return module.status === "changed" || module.status === "unchanged";
    });
  }

  function getBookModules() {
    return state.modules.filter(function (module) {
      return module.isNew !== true;
    });
  }

  // The code as it stands right now: what came back from the chat where
  // there is a reply, and the workbook's own text where there is not.
  // Replacing has to read and rewrite this, or it would work from the
  // text the chat has already changed.
  function getCurrentModules() {
    return state.modules.map(function (module) {
      return {
        name: module.name,
        code: typeof module.pastedCode === "string"
          ? module.pastedCode
          : String(module.code || "")
      };
    });
  }

  // SPEC 7.7.1: replacing always recomputes from the same text the
  // candidates were found in, never from a previous replacement. Without
  // this, pressing the button a second time reads code the first press
  // already rewrote and E-MAP-02 is certain.
  function getPathMapBaseModules() {
    if (Array.isArray(state.pathMapBasis)) {
      return state.pathMapBasis.map(function (module) {
        return {name: module.name, code: module.code};
      });
    }
    return getBookModules().map(function (module) {
      return {name: module.name, code: String(module.code || "")};
    });
  }

  // ---- the run's own record ----
  //
  // One set of confirmed values, written beside the artifacts it
  // describes. The screen reads them from state, result.md is built from
  // the same state, and a session that starts again reads them back from
  // here - so no second copy can disagree with the first.

  var MANIFEST_VERSION = 1;

  function createRunManifest() {
    if (!state.runFolder || !state.book) {
      return null;
    }
    return {
      schemaVersion: MANIFEST_VERSION,
      screen: state.screen,
      book: {
        name: state.book.name,
        path: state.book.path,
        ext: state.book.ext,
        totalLines: state.book.totalLines
      },
      bookSnapshot: state.bookSnapshot,
      environmentSnapshot: state.targetEnvironmentSnapshot,
      runFolder: state.runFolder,
      handoffFolder: state.handoffFolder,
      outputTimestamp: state.outputTimestamp,
      outputDateStamp: state.outputDateStamp,
      outputName: state.outputName,
      diagnosis: {
        requestId: state.diagnosisRequestId,
        requestSnapshot: state.diagnosisRequestSnapshot,
        requestPath: state.diagnosisRequestFilePath,
        concern: state.diagnosisConcern,
        split: state.diagnosisSplit === true,
        skipped: state.diagnosisSkipped === true,
        version: state.diagnosisVersion,
        filePath: state.diagnosisFilePath,
        attribution: state.diagnosisAttribution,
        accepted: state.diagnosis
      },
      repair: {
        presets: (state.presets || []).map(function (entry) {
          return {
            file: entry.file,
            name: entry.name,
            content: entry.content
          };
        }),
        answers: state.answers,
        selectedFindings: state.selectedFindings,
        extraRequest: state.extraRequest,
        splitOutput: state.splitOutput === true,
        requestId: state.repairRequestId,
        requestSnapshot: state.repairRequestSnapshot,
        requestPath: state.repairRequestFilePath
      }
    };
  }

  function selectModule(moduleName) {
    if (!findModule(moduleName)) {
      return false;
    }
    state.selectedModuleName = moduleName;
    state.pasteEditing = false;
    notify();
    return true;
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
    if (!global.MacroStudioScreens ||
        state.screen !== global.MacroStudioScreens.reviewScreen ||
        !module || (module.status !== "changed" &&
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
    if (!module || (module.status !== "changed" &&
                    module.status !== "unchanged")) {
      return false;
    }
    module.showChangesOnly = showChangesOnly === true;
    notify();
    return true;
  }

  function setModuleWrapDiff(moduleName, wrapDiff) {
    var module = findModule(moduleName);
    if (!module || (module.status !== "changed" &&
                    module.status !== "unchanged")) {
      return false;
    }
    module.wrapDiff = wrapDiff !== false;
    notify();
    return true;
  }

  function countChangedLines(original, changed) {
    var count = 0;

    if (!global.MacroStudioDiff) {
      return original === changed ? 0 : 1;
    }
    global.MacroStudioDiff.compare(original || "", changed || "")
      .forEach(function (row) {
        if (row.type === "added" || row.type === "removed" ||
            row.type === "changed") {
          count += 1;
        }
      });
    return count;
  }

  function importPackageItems(items, engine) {
    var applied = [];
    // The chat was handed the replaced code, so that - not the workbook
    // - is what its reply sits on top of. A second pass of the table
    // itself is a redo and starts from the workbook again.
    var keepReplacement = engine !== "対応表による置換";

    clearImportedModulesInternal(keepReplacement);
    restoreReplacedModules();
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
    state.selectedModuleName = applied.length ? applied[0].name : null;
    state.repairIntakeRequestId = state.repairRequestId;
    state.repairResultSnapshot = state.repairRequestSnapshot;
    state.repairResultEngine = engine;
    state.pasteEditing = false;
    return applied.length;
  }

  function importPackage(result) {
    var items;
    var count;

    if (!isResponseProduct(result) || result.ok !== true ||
        result.requestId !== state.repairRequestId ||
        result.noChange || !Array.isArray(result.modules)) {
      return 0;
    }
    items = result.modules.map(function (item) {
      var existing = findModule(item.name);
      return {
        name: item.name,
        code: item.code,
        lineCount: String(item.code || "")
          .replace(/\r\n/g, "\n").split("\n").length,
        changedLineCount: countChangedLines(
          existing ? existing.code : "",
          item.code)
      };
    });
    count = importPackageItems(items, "AI");
    state.intakeResult = result;
    notify();
    return count;
  }

  function setDeterministicResult(result) {
    var snapshot = {};
    var items;
    var count;

    if (!isPathMapProduct(result) || result.ok !== true ||
        result.kind !== "apply" || !Array.isArray(result.modules)) {
      return 0;
    }
    items = result.modules.map(function (item) {
      var existing = findModule(item.name);
      var code = String(item.code || "");

      snapshot[item.name] = code;
      return {
        name: item.name,
        code: code,
        lineCount: getLineCount(code),
        changedLineCount: countChangedLines(
          existing ? existing.code : "",
          code)
      };
    });
    count = importPackageItems(items, "対応表による置換");
    state.repairIntakeRequestId = null;
    state.repairResultSnapshot = state.repairInputSnapshot;
    state.repairResultEngine = "対応表による置換";
    state.deterministicCodeSnapshot = snapshot;
    state.appliedMapping = result;
    state.intakeResult = result;
    notify();
    return count;
  }

  function hasDeterministicManualEdits() {
    var snapshot = state.deterministicCodeSnapshot;
    var names;

    if (state.repairResultEngine !== "対応表による置換" || !snapshot) {
      return false;
    }
    names = Object.keys(snapshot);
    return names.some(function (name) {
      var module = findModule(name);
      return !module || String(module.pastedCode || "") !== snapshot[name];
    });
  }

  function setIntakeResult(result) {
    if (result && (!isResponseProduct(result) ||
        result.requestId !== state.repairRequestId)) {
      return false;
    }
    state.intakeResult = result || null;
    notify();
    return true;
  }

  // A repair answer refuses in one of three ways, and none of them is a
  // question. Anything else is not a refusal this run can record.
  function isRefusalVerdict(verdict) {
    return verdict === "UNNECESSARY" || verdict === "IMPOSSIBLE" ||
      verdict === "UNCLEAR";
  }

  function setNoChangeResult(result) {
    if (!isResponseProduct(result) || result.ok !== true ||
        result.requestId !== state.repairRequestId ||
        !isRefusalVerdict(result.noChange)) {
      return false;
    }
    // "改修できません" is an answer about the chat's part of the work.
    // What the tool replaced itself still stands.
    clearImportedModulesInternal(true);
    restoreReplacedModules();
    state.noChangeResult = {
      verdict: result.noChange,
      summary: String(result.summary || ""),
      requestId: state.repairRequestId
    };
    notify();
    return true;
  }

  function discardImportedModules() {
    // Starting the intake over goes back to the code the chat was
    // given, not to the workbook.
    var discarded = clearImportedModulesInternal(true);
    restoreReplacedModules();
    notify();
    return discarded;
  }

  function getChangedModuleCount() {
    return state.modules.filter(function (module) {
      return module.status === "changed";
    }).length;
  }

  function getAcceptedModuleCount() {
    return state.modules.filter(function (module) {
      return module.status === "changed" && module.accepted === true;
    }).length;
  }

  function setOutputName(value) {
    state.outputName = value === undefined || value === null
      ? ""
      : String(value);
    notify();
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
      var module = result && result.result === "written"
        ? findModule(result.name)
        : null;
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

  function loadDemoState() {
    state = createInitialState();
    state.appInfo = {version: "2.00", presets: {diagnose: [], repair: []}};
    state.book = {
      name: "受注管理.xlsm",
      path: "samples\\受注管理.xlsm",
      ext: ".xlsm",
      totalLines: 84
    };
    state.modules = [{
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 4,
      code: "Option Explicit\r\nPublic Sub Main()\r\nEnd Sub\r\n",
      attributes: "",
      pastedCode: "Option Explicit\r\nPublic Sub Main()\r\n    Debug.Print \"done\"\r\nEnd Sub\r\n",
      status: "changed",
      changedLineCount: 1,
      accepted: true,
      showChangesOnly: false,
      wrapDiff: true,
      written: false
    }];
    state.bookSnapshot = createBookSnapshot(state.book, state.modules);
    state.outputDateStamp = "20260801";
    resetOutputName();
    state.repairInputSnapshot = createRepairInputSnapshot();
    state.repairResultSnapshot = state.repairInputSnapshot;
    state.repairResultEngine = "対応表による置換";
    state.selectedModuleName = "Main";
    state.screen = global.MacroStudioScreens.reviewScreen;
    notify();
  }

  global.MacroStudioState = {
    getState: getState,
    getChangedModuleCount: getChangedModuleCount,
    getAcceptedModuleCount: getAcceptedModuleCount,
    getDefaultOutputName: getDefaultOutputName,
    getDiffReportName: getDiffReportName,
    formatDateStamp: formatDateStamp,
    createBookSnapshot: createBookSnapshot,
    createRepairInputSnapshot: createRepairInputSnapshot,
    canGoNext: canGoNext,
    canGoBack: canGoBack,
    goTo: goTo,
    goNext: goNext,
    goBack: goBack,
    setBook: setBook,
    setBookInventory: setBookInventory,
    setAppInfo: setAppInfo,
    setTargetEnvironment: setTargetEnvironment,
    setDiagnosisConcern: setDiagnosisConcern,
    setDiagnosisSkipped: setDiagnosisSkipped,
    setDiagnosisSplit: setDiagnosisSplit,
    isDiagnosisRequestDirty: isDiagnosisRequestDirty,
    commitDiagnosisRequest: commitDiagnosisRequest,
    setDiagnosisHandoffProgress: setDiagnosisHandoffProgress,
    setDiagnosisParts: setDiagnosisParts,
    commitDiagnosis: commitDiagnosis,
    setRepairPreset: setRepairPreset,
    noteIntakeFailure: noteIntakeFailure,
    clearIntakeFailures: clearIntakeFailures,
    setIntakeError: setIntakeError,
    setAnswer: setAnswer,
    setFindingSelected: setFindingSelected,
    setDesiredBehaviour: setDesiredBehaviour,
    setFindingSupplement: setFindingSupplement,
    setExtraRequest: setExtraRequest,
    setPathMap: setPathMap,
    commitRepairRequest: commitRepairRequest,
    setRepairHandoffProgress: setRepairHandoffProgress,
    setSplitOutputRules: setSplitOutputRules,
    setSplitOutput: setSplitOutput,
    setRepairIntakeParts: setRepairIntakeParts,
    hasImportedModules: hasImportedModules,
    getBookModules: getBookModules,
    getCurrentModules: getCurrentModules,
    getPathMapBaseModules: getPathMapBaseModules,
    createRunManifest: createRunManifest,
    selectModule: selectModule,
    findModule: findModule,
    acceptModuleCode: acceptModuleCode,
    beginPasteEdit: beginPasteEdit,
    cancelPasteEdit: cancelPasteEdit,
    setModuleShowChangesOnly: setModuleShowChangesOnly,
    setModuleWrapDiff: setModuleWrapDiff,
    importPackage: importPackage,
    setDeterministicResult: setDeterministicResult,
    hasDeterministicManualEdits: hasDeterministicManualEdits,
    setIntakeResult: setIntakeResult,
    setNoChangeResult: setNoChangeResult,
    discardImportedModules: discardImportedModules,
    setOutputName: setOutputName,
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
