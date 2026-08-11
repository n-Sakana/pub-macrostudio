"use strict";

// The retry lane never closes.
//
// A real run in 2026-08 failed intake over and over, and after the
// second refusal the tool stopped writing the asking-again to the
// clipboard and told the reader to change AIs. The reader had no way to
// move, and finally reshaped the reply by hand. This file fixes the
// contract that replaces that: every refusal - first, second, fourth,
// tenth - writes a fresh retry text built from the failure that just
// happened, the screen carries a button that copies it again, and a
// corrected reply is taken in exactly as if nothing had gone wrong.
//
// The fixtures include the real failure shape: a chat that aggregated
// several procedures into one finding was told "a procedure name or -",
// and chose "-" - hiding a location it knew (GetRequiredWorksheet). The
// refusal now has to say "split per procedure" and must not offer "-".

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
var documentObject = {
  createElement: dom.createElement,
  createTextNode: dom.createTextNode
};
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

["icons.js", "components.js",
  "target-environment.js",
  "handover.js",
  "preset-document.js",
  "response-package.js",
  "diagnosis-package.js",
  "prompt-template.js",
  "diff.js",
  "vba-highlight.js",
  "code-view.js",
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
var workflow = windowObject.MacroStudioWorkflow;
var environment = environmentApi.parse(readUtf8(path.join(
  root, "environment", "target-environment.json")));
var environmentText = environmentApi.renderForPrompt(environment);
var diagnosisPreset = {
  file: "01_診断\\01_動くかどうかの監査.md",
  content: readUtf8(path.join(
    root, "presets", "01_診断", "01_動くかどうかの監査.md"))
};
var diagnoseTemplate = readUtf8(path.join(
  root, "templates", "diagnose-template.txt"));
var calls = [];
var toasts = [];

windowObject.hostBridge = {
  request: function (action, parameters) {
    calls.push({action: action, parameters: parameters || {}});
    if (action === "readRequestTemplate") {
      return Promise.resolve({content: diagnoseTemplate});
    }
    if (action === "writeRequestFiles") {
      return Promise.resolve({
        folderPath: "C:\\ms\\book_20260801_010203",
        requestPath: "C:\\ms\\book_20260801_010203\\diagnose-request.md",
        codePath: "C:\\ms\\book_20260801_010203\\source-code.md"
      });
    }
    if (action === "writeDiagnosisFile") {
      return Promise.resolve({
        path: "C:\\ms\\book_20260801_010203\\diagnosis.md"
      });
    }
    if (action === "writeLog" || action === "writeClipboard") {
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

var MODULE_CODE = [
  "Option Explicit",
  "Private Declare PtrSafe Function Sleep Lib \"kernel32\" " +
    "(ByVal ms As Long) As Long",
  "Public Function GetRequiredWorksheet() As Object",
  "    Sleep 100",
  "End Function",
  "Public Sub PrepareData()",
  "    Sleep 200",
  "End Sub"
].join("\r\n");

function attach() {
  store.setAppInfo({
    version: "test",
    presets: {},
    catalog: require("./helpers/contracts").catalog(
      windowObject.MacroStudioPreset)
  });
  store.setBook({
    name: "book.xlsm",
    path: "C:\\books\\book.xlsm",
    ext: ".xlsm",
    totalLines: 8
  }, [{
    name: "DataModule",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 8,
    code: MODULE_CODE,
    attributes: ""
  }]);
  store.setTargetEnvironment(environment, environmentText);
}

function marker(requestId) {
  return "'@MACROSTUDIO " + requestId + " ";
}

function sections(requestId) {
  return [
    marker(requestId) + "SECTION PURPOSE 帳票を作るマクロです。",
    marker(requestId) + "SECTION FLOW GetRequiredWorksheet から始まります。",
    marker(requestId) + "SECTION DEPENDENCY Windows の Sleep を使います。",
    marker(requestId) + "SECTION ENVIRONMENT 対象環境では止まります。"
  ];
}

function findingLine(requestId, number, meta) {
  return marker(requestId) + "FINDING " + number + " " + meta;
}

function findingBody(number) {
  return [
    "TITLE: 待ち時間の処理が Windows の関数を直接呼んでいます。",
    "CONDITION: 指摘 " + number + " は実行すると必ず通ります。",
    "IMPACT: マクロが止まります。",
    "EVIDENCE: Sleep の宣言と呼び出しがあります。"
  ];
}

// The real failure shape: several procedures crammed into one finding.
function aggregatedReply(requestId) {
  return [
    marker(requestId) + "DIAG BEGIN 1"
  ].concat(sections(requestId)).concat([
    findingLine(requestId, 1,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=DataModule " +
        "PROC=GetRequiredWorksheet,PrepareData LINES=2,4,7 " +
        "ENVKEY=WIN32API_BLOCKED")
  ]).concat(findingBody(1)).concat([
    marker(requestId) + "DIAG COMPLETE 1",
    marker(requestId) + "DIAG END"
  ]).join("\r\n");
}

// Three more refusals, each for a different reason.
function missingKeyReply(requestId) {
  return [
    marker(requestId) + "DIAG BEGIN 1"
  ].concat(sections(requestId)).concat([
    findingLine(requestId, 1,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=DataModule " +
        "PROC=PrepareData LINES=7")
  ]).concat(findingBody(1)).concat([
    marker(requestId) + "DIAG COMPLETE 1",
    marker(requestId) + "DIAG END"
  ]).join("\r\n");
}

function wrongCountReply(requestId) {
  return [
    marker(requestId) + "DIAG BEGIN 2"
  ].concat(sections(requestId)).concat([
    findingLine(requestId, 1,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=DataModule " +
        "PROC=PrepareData LINES=7 ENVKEY=WIN32API_BLOCKED")
  ]).concat(findingBody(1)).concat([
    marker(requestId) + "DIAG COMPLETE 2",
    marker(requestId) + "DIAG END"
  ]).join("\r\n");
}

function unknownModuleReply(requestId) {
  return [
    marker(requestId) + "DIAG BEGIN 1"
  ].concat(sections(requestId)).concat([
    findingLine(requestId, 1,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=NoSuchModule " +
        "PROC=PrepareData LINES=1 ENVKEY=WIN32API_BLOCKED")
  ]).concat(findingBody(1)).concat([
    marker(requestId) + "DIAG COMPLETE 1",
    marker(requestId) + "DIAG END"
  ]).join("\r\n");
}

// The corrected reply: the same cause, split per procedure, both wearing
// the same environment key - exactly what the refusals asked for.
function correctedReply(requestId) {
  return [
    marker(requestId) + "DIAG BEGIN 2"
  ].concat(sections(requestId)).concat([
    findingLine(requestId, 1,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=DataModule " +
        "PROC=GetRequiredWorksheet LINES=2,4 ENVKEY=WIN32API_BLOCKED")
  ]).concat(findingBody(1)).concat([
    findingLine(requestId, 2,
      "GRADE=B CONFIDENCE=CONFIRMED MODULE=DataModule " +
        "PROC=PrepareData LINES=7 ENVKEY=WIN32API_BLOCKED")
  ]).concat(findingBody(2)).concat([
    marker(requestId) + "DIAG COMPLETE 2",
    marker(requestId) + "DIAG END"
  ]).join("\r\n");
}

function clipboardTexts() {
  return calls.filter(function (call) {
    return call.action === "writeClipboard";
  }).map(function (call) {
    return String(call.parameters.text || "");
  });
}

function lastClipboard() {
  var texts = clipboardTexts();

  return texts.length > 0 ? texts[texts.length - 1] : "";
}

function retryButtonsOf(screen) {
  return dom.collect(screen, function (node) {
    return node.getAttribute &&
      node.getAttribute("data-action") === "copy-intake-retry";
  });
}

(async function () {
  attach();
  store.setDiagnosisConcern("月末だけ失敗します。");
  await workflow.prepareDiagnosisRequest(false);

  var requestId = store.getState().diagnosisRequestId;

  assert(requestId, "The request must be prepared.");

  // ---- failure 1: the real aggregation failure ----
  await workflow.applyDiagnosisText(aggregatedReply(requestId));
  var state = store.getState();

  assert(state.diagnosis === null || state.diagnosis === undefined ||
    !state.diagnosis,
  "An aggregated finding must be refused, not read.");
  assert(state.intakeError.diagnose &&
    state.intakeError.diagnose.validationId === "D09" &&
    state.intakeError.diagnose.count === 1,
  "The refusal is on the screen with its check number and count.");
  var retry1 = lastClipboard();

  assert(retry1.indexOf("さきほどの返答は取り込めませんでした。") === 0,
    "The first refusal writes the asking-again to the clipboard.");
  assert(retry1.indexOf("手続きごとに別の FINDING へ分ける") >= 0,
    "The fix says to split per procedure: " + retry1.slice(0, 400));
  assert(retry1.indexOf("PROC を手続き名か - にする") < 0,
    "The fix must not offer - as the way out of a known location.");

  // ---- failure 2: a different reason, a fresh retry ----
  await workflow.applyDiagnosisText(missingKeyReply(requestId));
  state = store.getState();
  assert(state.intakeError.diagnose.count === 2,
    "The second refusal counts as the second.");
  var retry2 = lastClipboard();

  assert(retry2 !== retry1,
    "The second retry is written from the second failure, not replayed.");
  assert(retry2.indexOf("ENVKEY が書かれていません") >= 0,
    "The second retry names the second failure: " + retry2.slice(0, 400));

  // ---- failures 3 and 4: the lane stays open past any cap ----
  await workflow.applyDiagnosisText(wrongCountReply(requestId));
  var retry3 = lastClipboard();

  assert(store.getState().intakeError.diagnose.validationId === "D19" &&
    retry3.indexOf("DIAG COMPLETE") >= 0,
  "The third failure writes its own retry.");
  await workflow.applyDiagnosisText(unknownModuleReply(requestId));
  state = store.getState();
  var retry4 = lastClipboard();

  assert(state.intakeError.diagnose.validationId === "D13" &&
    state.intakeError.diagnose.count === 4,
  "The fourth failure is refused for its own reason and counted.");
  assert(retry4.indexOf("MODULE") >= 0 && retry4 !== retry3,
    "The fourth retry is built from the fourth failure.");
  assert(clipboardTexts().length === 4,
    "Four failures, four retries - none withheld: " +
      clipboardTexts().length);
  assert(toasts.filter(function (toast) {
    return toast.tone === "error" &&
      toast.message.indexOf("クリップボードに入れました") >= 0;
  }).length === 4,
  "Every failure told the reader the retry text is on the clipboard.");
  assert(toasts.some(function (toast) {
    return toast.message.indexOf("別のAI") >= 0 &&
      toast.message.indexOf("クリップボードに入れました") >= 0;
  }), "From the third failure the other-AI road is offered beside the " +
    "retry, never instead of it.");

  // ---- the screen carries the refusal and a re-copy button ----
  var screen = workflow.createDiagnoseScreen(store.getState());
  var buttons = retryButtonsOf(screen);

  assert(dom.text(screen).indexOf("この返答は取り込めませんでした") >= 0 &&
    dom.text(screen).indexOf("4 回目") >= 0,
  "The refusal stays on the screen, with how many times in a row.");
  assert(buttons.length === 1,
    "The screen offers to copy the asking-again again: " + buttons.length);

  calls.length = 0;
  await workflow.handleAction("copy-intake-retry", {
    getAttribute: function (name) {
      return name === "data-intake-stage" ? "diagnose" : null;
    }
  });
  // handleAction fires the copy without waiting; give the promise a turn.
  await Promise.resolve();
  assert(clipboardTexts().length === 1 &&
    lastClipboard() === retry4,
  "The button rewrites the latest refusal's asking-again.");

  // ---- the inputs survived every failure ----
  assert(store.getState().diagnosisConcern === "月末だけ失敗します。",
    "The reader's own input is untouched by any number of refusals.");
  assert(store.getState().diagnosisRequestId === requestId,
    "The request identity is untouched: the same request is being " +
      "answered, however many tries it takes.");

  // ---- the corrected reply is taken in as if nothing had happened ----
  await workflow.applyDiagnosisText(correctedReply(requestId));
  state = store.getState();
  assert(state.diagnosis && state.diagnosis.findings.length === 2,
    "The corrected reply - split per procedure - is accepted.");
  assert(state.intakeError.diagnose === null &&
    state.intakeFailures.diagnose === 0,
  "Success clears the refusal and the count.");

  // The two split findings wear one environment key, so the result page
  // reunites them: one problem, two places. This is the other half of
  // the contract that makes splitting the honest answer.
  var findingsScreen = workflow.createFindingsScreen(state);
  var groupRows = dom.collect(findingsScreen, function (node) {
    return node.classList && node.classList.contains("group-row");
  });

  assert(groupRows.length === 1,
    "Split findings with one key are one problem on screen: " +
      groupRows.length);
  assert(dom.text(groupRows[0]).indexOf("該当 2 か所") >= 0,
    "And the row counts both places.");

  console.log("test-intake-retry: PASS");
  console.log("four refusals for four different reasons, four fresh retry " +
    "texts, the re-copy button, inputs surviving, the real aggregated-" +
    "procedure failure told to split (never to write -), and the split " +
    "reply accepted and reunited on screen");
}()).catch(function (error) {
  console.error(error && error.stack || error);
  process.exit(1);
});
