"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readUtf8(filePath) {
  var text = fs.readFileSync(filePath, "utf8");
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var documentObject = {createElement: dom.createElement};
var context = vm.createContext({
  window: windowObject,
  document: documentObject,
  Promise: Promise,
  Date: Date,
  Math: Math,
  Uint8Array: Uint8Array,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
});
windowObject.window = windowObject;
windowObject.document = documentObject;
windowObject.Promise = Promise;
windowObject.Date = Date;
windowObject.Math = Math;
windowObject.Uint8Array = Uint8Array;
windowObject.setTimeout = setTimeout;
windowObject.clearTimeout = clearTimeout;

["icons.js",
  "target-environment.js",
  "preset-document.js",
  "response-package.js",
  "diagnosis-package.js",
  "prompt-template.js",
  "diff.js",
  "screens.js",
  "state.js",
  "screens/workflow.js"
].forEach(function (name) {
  vm.runInContext(
    readUtf8(path.join(root, "assets", "js", name)),
    context,
    {filename: name});
});

var store = windowObject.MacroStudioState;
var environmentApi = windowObject.MacroStudioTargetEnvironment;
var diagnosisApi = windowObject.MacroStudioDiagnosis;
var workflow = windowObject.MacroStudioWorkflow;
var rawEnvironment = readUtf8(path.join(
  root, "environment", "target-environment.json"));
var environment = environmentApi.parse(rawEnvironment);
var environmentText = environmentApi.renderForPrompt(environment);
var diagnosisPresetPath = path.join(
  root, "presets", "01_マクロ改修", "01_診断", "01_動くかどうかの監査.md");
var diagnosisPreset = {
  file: "01_マクロ改修\\01_診断\\01_動くかどうかの監査.md",
  content: readUtf8(diagnosisPresetPath)
};
var diagnoseTemplate = readUtf8(path.join(
  root, "templates", "diagnose-template.txt"));
var calls = [];
var toasts = [];
var failNextWrite = false;

windowObject.hostBridge = {
  request: function (action, parameters) {
    calls.push({action: action, parameters: parameters || {}});
    if (action === "readRequestTemplate") {
      return Promise.resolve({content: diagnoseTemplate});
    }
    if (action === "writeRequestFiles") {
      if (failNextWrite) {
        failNextWrite = false;
        return Promise.reject({code: "E-GEN-01", message: "write failed"});
      }
      return Promise.resolve({
        folderPath: "C:\\books\\MacroStudio\\book_20260801_010203",
        requestPath: "C:\\books\\MacroStudio\\book_20260801_010203\\diagnose-request.md",
        codePath: "C:\\books\\MacroStudio\\book_20260801_010203\\source-code.md"
      });
    }
    if (action === "writeDiagnosisFile") {
      return Promise.resolve({
        path: "C:\\books\\MacroStudio\\book_20260801_010203\\diagnosis.md"
      });
    }
    if (action === "writeLog") {
      return Promise.resolve({});
    }
    if (action === "writeClipboard") {
      return Promise.resolve({});
    }
    return Promise.reject({code: "E-SYS-02", message: action});
  }
};

windowObject.MacroStudioApp = {
  getDiagnosisPresetStatus: function () {
    var entry = windowObject.MacroStudioPreset.describe(
      diagnosisPreset,
      "diagnose");
    return {ok: true, entry: entry, validCount: 1, entries: [entry]};
  },
  createOutputTimestamp: function () { return "20260801_010203"; },
  createCodeFileTimestamp: function () { return "2026-08-01 01:02:03"; },
  showToast: function (message, tone) {
    toasts.push({message: message, tone: tone});
  },
  handleHostError: function (error) {
    store.setLastError({code: error.code, message: error.message || ""});
  }
};

function attach() {
  store.setAppInfo({version: "test", presets: {entrances: []}});
  // Which diagnosis is asked for belongs to the entrance, so the run
  // says what it is for before anything is written (SPEC §2.2.0).
  store.setEntrance(require("./helpers/contracts").entrance(
    windowObject.MacroStudioPreset, "01_マクロ改修"));
  store.setBook({
    name: "book.xlsm",
    path: "C:\\books\\book.xlsm",
    ext: ".xlsm",
    totalLines: 4
  }, [{
    name: "Main",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 4,
    code: "Option Explicit\r\nPublic Sub Main()\r\nEnd Sub\r\n",
    attributes: ""
  }]);
  store.setTargetEnvironment(environment, environmentText);
}

function zeroFindingPackage(requestId) {
  return [
    "'@MACROSTUDIO " + requestId + " DIAG BEGIN 0",
    "'@MACROSTUDIO " + requestId + " SECTION BEGIN PURPOSE",
    "帳票を作るマクロです。",
    "'@MACROSTUDIO " + requestId + " SECTION END PURPOSE",
    "'@MACROSTUDIO " + requestId + " SECTION BEGIN FLOW",
    "Main を実行します。",
    "'@MACROSTUDIO " + requestId + " SECTION END FLOW",
    "'@MACROSTUDIO " + requestId + " SECTION BEGIN DEPENDENCY",
    "外部依存は確認できません。",
    "'@MACROSTUDIO " + requestId + " SECTION END DEPENDENCY",
    "'@MACROSTUDIO " + requestId + " SECTION BEGIN ENVIRONMENT",
    "阻害要因は確認できません。",
    "'@MACROSTUDIO " + requestId + " SECTION END ENVIRONMENT",
    "'@MACROSTUDIO " + requestId + " DIAG NOFINDING SCOPE_CLEAR",
    "'@MACROSTUDIO " + requestId + " DIAG COMPLETE 0",
    "'@MACROSTUDIO " + requestId + " DIAG END"
  ].join("\r\n");
}

(async function () {
  attach();
  store.setDiagnosisConcern("保存先の前提も確認してください。");
  await workflow.prepareDiagnosisRequest(false);

  var state = store.getState();
  var writeCall = calls.filter(function (call) {
    return call.action === "writeRequestFiles";
  })[0];
  assert(writeCall && writeCall.parameters.stage === "diagnose",
    "The first request must use the diagnose host stage.");
  assert(writeCall.parameters.request.indexOf(environmentText) >= 0,
    "The canonical target environment must be embedded in the prompt.");
  assert(writeCall.parameters.request.indexOf(
    "保存先の前提も確認してください。") >= 0,
  "The screen-1 concern must be effective in diagnose-request.md.");
  assert(writeCall.parameters.code.indexOf("book.xlsm - VBA Source Code") >= 0,
    "source-code.md must carry the complete workbook source.");
  assert(state.diagnosisRequestId && state.runFolder &&
    state.outputTimestamp === "20260801_010203",
  "The diagnosis identity and run folder commit only after host success.");

  // Failed generation replacement preserves the old identity and snapshot.
  var oldId = state.diagnosisRequestId;
  var oldSnapshot = JSON.stringify(state.diagnosisRequestSnapshot);
  store.setDiagnosisConcern("別の懸念");
  failNextWrite = true;
  await workflow.prepareDiagnosisRequest(true);
  state = store.getState();
  assert(state.diagnosisRequestId === oldId &&
    JSON.stringify(state.diagnosisRequestSnapshot) === oldSnapshot,
  "A failed host write must not commit a new diagnosis identity.");
  assert(store.isDiagnosisRequestDirty(),
    "The uncommitted concern must remain visibly dirty after failure.");

  // Restore the committed concern, then accept a valid zero-finding package.
  store.setDiagnosisConcern(
    state.diagnosisRequestSnapshot.concern);
  await workflow.applyDiagnosisText(zeroFindingPackage(oldId));
  state = store.getState();
  assert(state.diagnosis && state.diagnosis.findings.length === 0 &&
    state.diagnosisVersion === 1,
  "A valid zero-finding diagnosis must be accepted and versioned.");
  assert(state.diagnosisFilePath &&
    calls.some(function (call) {
      return call.action === "writeDiagnosisFile" &&
        call.parameters.markdown.indexOf("# 診断結果") === 0;
    }),
  "The accepted diagnosis must be formatted and written to diagnosis.md.");

  // Parser failure leaves diagnosis and its version untouched.
  var accepted = state.diagnosis;
  var version = state.diagnosisVersion;
  var clipboardBefore = calls.filter(function (call) {
    return call.action === "writeClipboard";
  }).length;

  await workflow.applyDiagnosisText("not a package");
  assert(store.getState().diagnosis === accepted &&
    store.getState().diagnosisVersion === version,
  "E-DIAG-01 must leave accepted state unchanged.");

  // A reply in the wrong shape is usually fixable by asking again, so
  // the first failure hands the reader the asking instead of a
  // description of what went wrong.
  var retryWrites = calls.filter(function (call) {
    return call.action === "writeClipboard";
  });

  assert(retryWrites.length === clipboardBefore + 1,
    "The first failed intake must put the retry on the clipboard.");
  assert(retryWrites[retryWrites.length - 1].parameters.text
    .indexOf("ひとつだけのコードブロック") >= 0,
  "The retry must carry the template's own output rules, not a second " +
    "copy of them written here.");
  assert(toasts.some(function (toast) {
    return toast.tone === "error" &&
      toast.message.indexOf("クリップボードに入れました") >= 0;
  }), "The first failure must tell the reader what is on the clipboard.");

  // Twice in a row means asking the same chat again is not the answer.
  toasts.length = 0;
  await workflow.applyDiagnosisText("not a package either");
  assert(calls.filter(function (call) {
    return call.action === "writeClipboard";
  }).length === retryWrites.length,
  "A second failure must not put the same retry on the clipboard again.");
  assert(toasts.some(function (toast) {
    return toast.tone === "error" && toast.message.indexOf("別のAI") >= 0;
  }), "A second failure must point somewhere other than the same chat.");

  // Split progress is product collection data, including exact missing parts.
  var collection = diagnosisApi.createPartCollection();
  collection.total = 3;
  collection.parts = [{index: 0, parsed: {}}, {index: 2, parsed: {}}];
  store.setDiagnosisParts(collection);
  assert(JSON.stringify(diagnosisApi.listMissingParts(
    store.getState().diagnosisParts)) === JSON.stringify([1]),
  "Split diagnosis progress must identify the exact missing part.");

  // E-ENV-01/null environment cannot create or commit a diagnosis request.
  attach();
  store.setTargetEnvironment(null, "");
  var writesBefore = calls.filter(function (call) {
    return call.action === "writeRequestFiles";
  }).length;
  await workflow.prepareDiagnosisRequest(false);
  assert(store.getState().diagnosisRequestId === null &&
    calls.filter(function (call) {
      return call.action === "writeRequestFiles";
    }).length === writesBefore,
  "A missing target environment must stop before host generation.");

  // ---- one filled button at a time ----
  // A screen offering two equally weighted actions does not say which
  // one is now. The reference this design follows keeps exactly one
  // filled control per view, and so does this screen: the copy is the
  // action until the request has gone out, the intake is the action
  // after it has, and once the reply is in neither is - [次へ] is.
  function primaryLabels() {
    return dom.collect(
      workflow.createDiagnoseScreen(store.getState()),
      function (node) {
        return node.classList &&
          node.classList.contains("button") &&
          node.classList.contains("button--primary");
      }).map(function (node) {
      return dom.text(node);
    });
  }

  attach();
  await workflow.prepareDiagnosisRequest(false);

  var beforeCopy = primaryLabels();

  assert(beforeCopy.length === 1 && beforeCopy[0].indexOf("コピー") >= 0,
    "Before the request goes out, the copy is the only filled action: " +
    JSON.stringify(beforeCopy));

  store.setDiagnosisHandoffProgress(true, false);
  var afterCopy = primaryLabels();

  assert(afterCopy.length === 1 && afterCopy[0].indexOf("取り込む") >= 0,
    "Once the request has gone out, the intake becomes the only filled " +
    "action: " + JSON.stringify(afterCopy));

  await workflow.applyDiagnosisText(
    zeroFindingPackage(store.getState().diagnosisRequestId));
  assert(store.getState().diagnosis !== null &&
    primaryLabels().length === 0,
  "With the reply in, neither button is the action any more: " +
    JSON.stringify(primaryLabels()));

  console.log("test-diagnose-flow: PASS");
  console.log("screen-1 generation, transaction rollback, zero findings, " +
    "split progress, E-ENV stop, one filled button at a time and the " +
    "two-stage retry after a failed intake behave as specified");
}()).catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
