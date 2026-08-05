"use strict";

// Three ways through the repair step, one screen graph.
//
//   AI only      4 conditions -> 5 hand over/take back -> 6 diff -> build
//   table only   4 table, replace          -> 6 diff -> build
//   both         4 table, replace, then 4 conditions -> 5 -> 6 -> build
//
// The third is the one with an order that matters. The machine
// replacement runs first and the chat is handed the code it produced,
// because a chat asked to repair lines the table is about to rewrite
// answers with the old paths still in them. The workbook as it was read
// never moves: the diff on screen 6 is original -> final, whichever
// route produced the final.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");
var contracts = require("./helpers/contracts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Reading a template goes through the host, so anything that starts a
// read is finished on the next turn, not on the next line.
function settle() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
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
  Math: Math,
  JSON: JSON,
  Uint8Array: Uint8Array,
  Promise: Promise
});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js", "response-package.js", "diagnosis-package.js", "diff.js",
  "vba-lexer.js", "path-map.js", "preset-document.js", "prompt-template.js",
  "handover.js", "screens.js", "state.js", "screens/workflow.js"]
  .forEach(function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)),
      context, {filename: name});
  });

var screens = windowObject.MacroStudioScreens;
var store = windowObject.MacroStudioState;
var workflow = windowObject.MacroStudioWorkflow;
var pathMap = windowObject.MacroStudioPathMap;

var DIAGNOSIS_ID = "11111111-1111-4111-8111-111111111111";
var written = [];
var toasts = [];

var ORIGINAL = [
  "Option Explicit",
  "",
  "Sub Export()",
  "    Open \"S:\\eigyo\\report.csv\" For Output As #1",
  "    Sleep 100",
  "End Sub",
  ""
].join("\r\n");

var OTHER_ORIGINAL = [
  "Option Explicit",
  "",
  "Sub Archive()",
  "    FileCopy \"S:\\eigyo\\report.csv\", \"backup.csv\"",
  "End Sub",
  ""
].join("\r\n");

var AI_PRESET = [
  "# AIひな形", "", "## 説明", "", "AIへ改修を頼みます。", "",
  "## 分類", "", "試験用の操作", "",
  "## 改修指示", "", "指示です。", "",
  "## 出力指示", "", "'@MACROSTUDIO {{REQUEST_ID}} の形で返してください。"
].join("\r\n");

var TABLE_PRESET = [
  "# 置き換えのひな形", "", "## 説明", "", "文字列を置き換えます。", "",
  "## 分類", "", "試験用の操作", "",
  "## 推奨条件", "", "- FIXED_DRIVE_LETTER", "",
  "## 置換の候補", "",
  "- ドライブから始まる場所 | ^[A-Za-z]:[\\\\/] | 既定で選ぶ"
].join("\r\n");

var presetEntries = [
  {file: "02_改修\\\\90_ai.md", name: "AIひな形", content: AI_PRESET},
  {file: "02_改修\\\\91_table.md", name: "置き換えのひな形", content: TABLE_PRESET}
];

windowObject.hostBridge = {
  request: function (action, payload) {
    written.push({action: action, payload: payload});
    if (action === "readRequestTemplate") {
      return Promise.resolve({
        content: "【改修指示】\r\n{{REQUEST_TEXT}}\r\n\r\n" +
          "【診断結果】\r\n{{DIAGNOSIS}}\r\n\r\n" +
          "【選んだ指摘】\r\n{{SELECTED_FINDINGS}}\r\n\r\n" +
          "【想定動作環境】\r\n{{TARGET_ENVIRONMENT}}\r\n\r\n{{CHANGE_SCOPE}}{{OUTPUT_RULES}}"
      });
    }
    if (action === "writeRequestFiles") {
      return Promise.resolve({
        folderPath: "C:\\ms\\exports\\book_20260802_140000",
        handoffFolderPath: "C:\\ms\\temp\\book_20260802_140000",
        requestPath: "repair-request.md",
        aiCodePath: "source-code-for-ai.md"
      });
    }
    if (action === "readPreset") {
      var found = null;
      presetEntries.forEach(function (entry) {
        if (entry.file === payload.file) { found = entry; }
      });
      return found
        ? Promise.resolve({content: found.content})
        : Promise.reject({code: "E-PRESET-01"});
    }
    return Promise.resolve(null);
  }
};

windowObject.MacroStudioApp = {
  showToast: function (message, tone) {
    toasts.push({message: message, tone: tone});
  },
  handleHostError: function (error) { store.setLastError(error); },
  isBlockingAttachError: function () { return false; },
  createAttachErrorCard: function () { return dom.createElement("div"); },
  createOutputTimestamp: function () { return "20260802_140000"; },
  createCodeFileTimestamp: function () { return "2026-08-02 14:00:00"; },
  getDiagnosisPresetStatus: function () { return {ok: true}; },
  confirmDiscardManualChanges: function (action) { return action(); }
};

function modules(second) {
  var list = [{
    name: "Report",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 7,
    code: ORIGINAL,
    attributes: ""
  }];

  if (second) {
    list.push({
      name: "Archive",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 5,
      code: OTHER_ORIGINAL,
      attributes: ""
    });
  }
  return list;
}

function attach(second) {
  written.length = 0;
  toasts.length = 0;
  store.reset();
  // This walk is about the repair step, so the catalog holds these two
  // templates and the shipped change scopes.
  store.setAppInfo({
    version: "test",
    presets: {},
    catalog: {
      diagnose: [],
      repair: windowObject.MacroStudioPreset.describeAll(
        presetEntries, "repair"),
      scope: require("./helpers/contracts").catalog(
        windowObject.MacroStudioPreset).scope,
      categories: [],
      diagnosisReady: true,
      scopeReady: true,
      defaultScope: ""
    }
  });
  store.setBook({
    name: "book.xlsm",
    path: "C:\\work\\book.xlsm",
    ext: ".xlsm",
    totalLines: 7
  }, modules(second));
  store.setTargetEnvironment(
    {
      displayName: "端末",
      revision: "1",
      constraints: [{
        key: "FIXED_DRIVE_LETTER", title: "固定のドライブ",
        axis: "storage", effect: "changed", basis: "declared"
      }]
    },
    "ENV-1");
  store.commitDiagnosisRequest({
    requestId: DIAGNOSIS_ID,
    requestText: "",
    prompt: "p",
    requestPath: "diagnose-request.md",
    runFolder: "C:\\ms\\exports\\book_20260802_140000",
    handoffFolder: "C:\\ms\\temp\\book_20260802_140000",
    outputTimestamp: "20260802_140000"
  });
  store.commitDiagnosis(contracts.diagnosis(
    windowObject.MacroStudioDiagnosis,
    {
      requestId: DIAGNOSIS_ID,
      modules: modules(second),
      environment: {
        constraints: [{
          key: "FIXED_DRIVE_LETTER", effect: "changed", basis: "declared"
        }]
      },
      findings: [{
        number: "1", grade: "B", confidence: "CONFIRMED",
        module: "Report", procedure: "-", lines: "4",
        environmentKey: "FIXED_DRIVE_LETTER",
        title: "S ドライブが新しい端末にない"
      }]
    }), "diagnosis.md");
}

function fillTable(value) {
  var rows = store.getState().pathMap.rows;
  store.setPathMap(pathMap.updateRow(
    store.getState().pathMap, rows[0].groupKey, {to: value}));
}

function aiReply(code) {
  var id = store.getState().repairRequestId;
  return [
    "'@MACROSTUDIO " + id + " SUMMARY BEGIN",
    "Report を直しました。",
    "'@MACROSTUDIO " + id + " SUMMARY END",
    "'@MACROSTUDIO " + id + " BEGIN standard Report",
    code,
    "'@MACROSTUDIO " + id + " END standard Report",
    "'@MACROSTUDIO " + id + " COMPLETE 1"
  ].join("\r\n");
}

function finalCode() {
  return store.getState().modules.filter(function (module) {
    return module.status === "changed";
  })[0].pastedCode;
}

// =====================================================================
// route 1: AI only
// =====================================================================

attach();
workflow.selectRepairPreset("02_改修\\\\90_ai.md").then(function () {
  assert(screens.getEngine(store.getState()) === "AI",
    "A template that sends a request is the AI route.");
  assert(!screens.hasReplacementStage(store.getState()),
    "The AI route has no replacement stage.");

  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);
  assert(screens.isRepairInputReady(store.getState()),
    "AI only: a selected finding is enough to go on.");
  return workflow.prepareRepairRequest();
}).then(function () {
  assert(store.getState().screen === screens.repairScreen,
    "AI only: screen 4 leads to screen 5.");
  assert(workflow.applyRepairText(aiReply(
    "Option Explicit\r\n\r\nSub Export()\r\n" +
      "    Open \"S:\\eigyo\\report.csv\" For Output As #1\r\n" +
      "    Application.Wait Now\r\nEnd Sub\r\n")),
  "AI only: the reply is taken in.");
  assert(store.canGoNext() && store.goNext() &&
    store.getState().screen === screens.reviewScreen,
  "AI only: screen 5 leads to the diff.");
  assert(finalCode().indexOf("Application.Wait") >= 0,
    "AI only: the chat's change is what ends up in the code.");
  assert(store.getState().modules[0].code === ORIGINAL,
    "AI only: the workbook as it was read never moves.");

  // =================================================================
  // route 2: the table only
  // =================================================================
  attach();
  return workflow.selectRepairPreset("02_改修\\\\91_table.md");
}).then(function () {
  assert(screens.getEngine(store.getState()) === "対応表による置換",
    "A template that only carries rules is the table route.");
  store.goTo(screens.repairInputScreen, false);
  fillTable("D:\\eigyo\\report.csv");
  assert(screens.isRepairInputReady(store.getState()),
    "Table only: a filled row is enough to carry out.");
  assert(workflow.handleNext(store.getState()),
    "Table only: screen 4 carries out the replacement.");
  assert(store.getState().screen === screens.reviewScreen,
    "Table only: screen 4 leads straight to the diff, with no AI screen.");
  assert(finalCode().indexOf("D:\\eigyo\\report.csv") >= 0,
    "Table only: the typed value is written.");
  assert(store.getState().modules[0].code === ORIGINAL,
    "Table only: the workbook as it was read never moves.");
  assert(!written.some(function (call) {
    return call.action === "writeRequestFiles" &&
      call.payload.stage === "repair";
  }), "Table only: no repair request is ever written.");

  // =================================================================
  // route 3: both, in the order that matters
  // =================================================================
  attach();
  return workflow.selectRepairPreset("02_改修\\\\91_table.md");
}).then(function () {
  return workflow.selectRepairPreset("02_改修\\\\90_ai.md");
}).then(function () {
  var state = store.getState();

  assert(screens.getEngine(state) === "AI",
    "Both: the run still sends a request, so it is a chat run.");
  assert(screens.hasReplacementStage(state) &&
    screens.isReplacementPending(state),
  "Both: the replacement is a stage that has not happened yet.");

  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);

  // Stage A: the table. The screen shows it, and being ready means the
  // table is ready - not the AI input.
  var screen = workflow.build(screens.repairInputScreen, store.getState());
  assert(dom.text(screen).indexOf("置換の候補") >= 0,
    "Both: screen 4 shows the table first.");
  fillTable("E:\\eigyo\\report.csv");
  assert(screens.isRepairInputReady(store.getState()),
    "Both: the filled table is what screen 4 is waiting for.");

  assert(workflow.handleNext(store.getState()),
    "Both: pressing on carries out the replacement.");
  assert(store.getState().screen === screens.repairInputScreen,
    "Both: carrying out the replacement stays on screen 4.");
  assert(screens.isReplacementDone(store.getState()),
    "Both: the replacement has run.");
  assert(store.getState().modules[0].pastedCode
    .indexOf("E:\\eigyo\\report.csv") >= 0,
  "Both: the replacement wrote the typed value.");
  assert(store.getState().modules[0].code === ORIGINAL,
    "Both: the workbook as it was read never moves.");

  // Stage B: now the same screen asks what the chat should repair.
  screen = workflow.build(screens.repairInputScreen, store.getState());
  assert(dom.text(screen).indexOf("置換の候補") < 0,
    "Both: once the table has run, screen 4 stops showing it.");
  assert(dom.text(screen).indexOf("改修する指摘") >= 0,
    "Both: screen 4 now asks what the chat should repair.");
  return workflow.prepareRepairRequest();
}).then(function () {
  var request = written.filter(function (call) {
    return call.action === "writeRequestFiles" &&
      call.payload.stage === "repair";
  })[0];

  assert(store.getState().screen === screens.repairScreen,
    "Both: the AI stage leads to screen 5.");
  assert(request, "Both: a repair request is written.");

  // Nothing a chat sent was thrown away here - the run has not asked
  // one yet - so the screen must not announce that it was.
  assert(!toasts.some(function (toast) {
    return String(toast.message).indexOf("前の回答") >= 0;
  }), "Both: writing the request drops no answer and announces none.");

  // The chat is given the replaced code, and told not to undo it.
  assert(request.payload.aiCode.indexOf("E:\\eigyo\\report.csv") >= 0,
    "Both: the file handed to the chat carries the replaced value.");
  assert(request.payload.aiCode.indexOf("S:\\eigyo\\report.csv") < 0,
    "Both: and no longer carries the old one.");
  var prompt = store.getState().repairPrompt;
  assert(prompt.indexOf("置き換え済みです") >= 0,
    "Both: the request says the code was already replaced.");
  assert(prompt.indexOf("元の値へ戻さないでください") >= 0,
    "Both: and contracts the chat not to put the old value back.");
  assert(prompt.indexOf("S:\\eigyo\\report.csv → E:\\eigyo\\report.csv") >= 0,
    "Both: naming which value became which.");

  assert(workflow.applyRepairText(aiReply(
    "Option Explicit\r\n\r\nSub Export()\r\n" +
      "    Open \"E:\\eigyo\\report.csv\" For Output As #1\r\n" +
      "    Application.Wait Now\r\nEnd Sub\r\n")),
  "Both: the chat's answer is taken in.");
  // Pressing on from the hand-over screen goes through the workflow
  // first. It has nothing left to do here - the replacement ran before
  // the chat was asked - and must not run a second pass over the reply.
  assert(workflow.handleNext(store.getState()) === false,
    "Both: leaving screen 5 is an ordinary step forward.");
  assert(store.canGoNext() && store.goNext() &&
    store.getState().screen === screens.reviewScreen,
  "Both: screen 5 leads to the diff.");

  // The diff is original -> final: both changes are in it.
  var diff = windowObject.MacroStudioDiff.compare(
    store.getState().modules[0].code, finalCode());
  var changed = diff.filter(function (row) {
    return row.type !== "same";
  });
  assert(finalCode().indexOf("E:\\eigyo\\report.csv") >= 0 &&
    finalCode().indexOf("Application.Wait") >= 0,
  "Both: the final code carries the replacement and the repair.");
  assert(changed.length >= 2,
    "Both: the diff runs from the original code to the final one.");
  assert(store.getState().modules[0].code === ORIGINAL,
    "Both: and the workbook as it was read is still untouched.");

  // ===================================================================
  // which route it is, is the reader's to decide
  // ===================================================================
  attach();
  store.goTo(screens.nextStepScreen, false);
  // Arriving reads the template, so the tick lands a turn later.
  workflow.enter(store.getState());
  return settle();
}).then(function () {
  assert(store.getState().presetFiles.indexOf("02_改修\\\\91_table.md") >= 0,
    "The template the diagnosis points at arrives already ticked.");
  return workflow.selectRepairPreset("02_改修\\\\91_table.md");
}).then(function () {
  // The screen is redrawn after every change and enter() runs each
  // time, so ticking it back on would leave no way to take it off.
  workflow.enter(store.getState());
  workflow.enter(store.getState());
  return settle();
}).then(function () {
  assert(store.getState().presetFiles.length === 0,
    "Unticking what arrived ticked leaves it unticked.");
  assert(!screens.hasReplacementStage(store.getState()),
    "So the replacement stage goes away with it.");

  // ===================================================================
  // a reply that names one module does not undo the rest
  // ===================================================================
  attach(true);
  return workflow.selectRepairPreset("02_改修\\\\91_table.md");
}).then(function () {
  return workflow.selectRepairPreset("02_改修\\\\90_ai.md");
}).then(function () {
  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);
  workflow.build(screens.repairInputScreen, store.getState());
  fillTable("E:\\eigyo\\report.csv");
  assert(workflow.handleNext(store.getState()),
    "Partial: the replacement runs over both modules.");
  assert(store.getState().modules[1].pastedCode
    .indexOf("E:\\eigyo\\report.csv") >= 0,
  "Partial: including the one the chat will not be asked about.");
  return workflow.prepareRepairRequest();
}).then(function () {
  // The chat answers about Report only, which is what the contract
  // asks for: return the modules you changed. Archive was replaced by
  // the table, and the reply saying nothing about it must leave that
  // replacement standing rather than reverting it to the workbook.
  assert(workflow.applyRepairText(aiReply(
    "Option Explicit\r\n\r\nSub Export()\r\n" +
      "    Open \"E:\\eigyo\\report.csv\" For Output As #1\r\n" +
      "    Application.Wait Now\r\nEnd Sub\r\n")),
  "Partial: the answer is taken in.");
  var archive = store.getState().modules.filter(function (module) {
    return module.name === "Archive";
  })[0];
  assert(archive.status === "changed" &&
    String(archive.pastedCode).indexOf("E:\\eigyo\\report.csv") >= 0,
  "Partial: the module the reply left out keeps its replacement.");
  assert(archive.code === OTHER_ORIGINAL,
    "Partial: and the workbook as it was read is still untouched.");
  assert(store.getState().appliedMapping,
    "Partial: the run still records that the tool replaced strings.");

  console.log("test-three-routes: PASS");
  console.log(
    "AI only goes 4-5-6, the table alone goes 4-6 without an AI screen, " +
    "and both runs the replacement first on screen 4, hands the replaced " +
    "code to the chat with a contract not to undo it, and diffs from the " +
    "original code to the final one; what the diagnosis recommends " +
    "arrives ticked and can be unticked");
}).catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
