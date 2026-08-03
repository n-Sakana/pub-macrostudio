"use strict";

// The 2026-08-02 audit found both P1 defects behind [戻る], a control the
// app puts on every screen. No test had ever pressed it, so both stayed
// green. This one walks the round trips.
//
//   5 -> 4 -> 5   the repair request and the answer already taken in
//                 survive a look back at the input
//   7 -> 4 -> 7   the replacement can be corrected and carried out again
//   value redo    a mistyped path can be fixed without E-MAP-02
//
// and, from the same audit: a refusal is recorded with the check number
// that caused it, a success notice says only that it succeeded, and a
// run can be picked up again from the record it wrote.

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
  Uint8Array: Uint8Array,
  Promise: Promise,
  JSON: JSON
});
windowObject.window = windowObject;
windowObject.document = documentObject;
windowObject.Math = Math;
windowObject.Uint8Array = Uint8Array;

["icons.js", "response-package.js", "diagnosis-package.js", "diff.js",
  "vba-lexer.js", "path-map.js", "preset-document.js", "prompt-template.js",
  "handover.js", "screens.js", "state.js", "screens/workflow.js"]
  .forEach(function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var screens = windowObject.MacroStudioScreens;
var store = windowObject.MacroStudioState;
var workflow = windowObject.MacroStudioWorkflow;
var pathMap = windowObject.MacroStudioPathMap;

var DIAGNOSIS_ID = "11111111-1111-4111-8111-111111111111";
var toasts = [];
var logLines = [];
var hostCalls = [];
var writtenManifest = null;

var REPAIR_TEMPLATE = [
  "【想定動作環境】",
  "{{TARGET_ENVIRONMENT}}",
  "",
  "【診断結果】",
  "{{DIAGNOSIS}}",
  "",
  "【選んだ指摘】",
  "{{SELECTED_FINDINGS}}",
  "",
  "【改修指示】",
  "{{REQUEST_TEXT}}",
  "",
  "{{OUTPUT_RULES}}"
].join("\r\n");

var DIAGNOSE_TEMPLATE = readUtf8(
  path.join(root, "templates", "diagnose-template.txt"));

var DIAGNOSE_PRESET = readUtf8(
  path.join(root, "presets", "01_マクロ改修", "01_診断", "01_動くかどうかの監査.md"));

var AI_PRESET = [
  "# テスト用ひな形",
  "",
  "## 説明",
  "",
  "テストのための改修です。",
  "",
  "## 改修指示",
  "",
  "指示です。",
  "",
  "## 出力指示",
  "",
  "'@MACROSTUDIO {{REQUEST_ID}} の形で返してください。"
].join("\r\n");

var TABLE_PRESET = [
  "# 置き換えのひな形",
  "",
  "## 説明",
  "",
  "固定の文字列を置き換えます。",
  "",
  "## 置換の候補",
  "",
  "- ドライブから始まる場所 | ^[A-Za-z]:[\\\\/] | 既定で選ぶ"
].join("\r\n");

var WRITE_IN_PRESET = [
  "# 自分で書く",
  "",
  "## 説明",
  "",
  "自分の言葉で書きます。",
  "",
  "## 記入欄",
  "",
  "改修してほしい内容",
  "",
  "## 改修指示",
  "",
  "【追加の要望】に書かれた内容に従ってください。",
  "",
  "## 出力指示",
  "",
  "'@MACROSTUDIO {{REQUEST_ID}} の形で返してください。"
].join("\r\n");

var MODULE_CODE = [
  "Option Explicit",
  "",
  "Sub Export()",
  "    Open \"S:\\eigyo\\report.csv\" For Output As #1",
  "    Close #1",
  "End Sub",
  ""
].join("\r\n");

var presetEntries = [
  {file: "01_マクロ改修\\\\02_改修\\\\90_test.md", name: "テスト用ひな形", content: AI_PRESET},
  {file: "01_マクロ改修\\\\02_改修\\\\91_table.md", name: "置き換えのひな形", content: TABLE_PRESET},
  {file: "01_マクロ改修\\\\02_改修\\\\92_writein.md", name: "自分で書く", content: WRITE_IN_PRESET}
];

windowObject.hostBridge = {
  request: function (action, payload) {
    hostCalls.push({action: action, payload: payload});
    if (action === "readRequestTemplate") {
      return Promise.resolve({
        content: payload.name === "diagnose-template"
          ? DIAGNOSE_TEMPLATE
          : REPAIR_TEMPLATE
      });
    }
    if (action === "writeRequestFiles") {
      return Promise.resolve({
        folderPath: "C:\\work\\MacroStudio\\book_20260802_101010",
        requestPath: "C:\\work\\MacroStudio\\book_20260802_101010\\" +
          (payload.stage === "diagnose"
            ? "diagnose-request.md"
            : "repair-request.md")
      });
    }
    if (action === "writeDiagnosisFile") {
      return Promise.resolve({
        path: "C:\\work\\MacroStudio\\book_20260802_101010\\diagnosis.md"
      });
    }
    if (action === "writeRunManifest") {
      writtenManifest = payload.manifest;
      return Promise.resolve({path: "run-manifest.json"});
    }
    if (action === "writeLog") {
      logLines.push(payload.level + " " + payload.message);
      return Promise.resolve(null);
    }
    if (action === "writeClipboard" || action === "readPreset") {
      if (action === "readPreset") {
        var found = null;
        presetEntries.forEach(function (entry) {
          if (entry.file === payload.file) {
            found = entry;
          }
        });
        return found
          ? Promise.resolve({content: found.content})
          : Promise.reject({code: "E-PRESET-01"});
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }
};

windowObject.MacroStudioApp = {
  showToast: function (message, tone) {
    toasts.push({message: message, tone: tone});
  },
  handleHostError: function (error) {
    store.setLastError(error);
  },
  isBlockingAttachError: function () { return false; },
  createAttachErrorCard: function () { return dom.createElement("div"); },
  createOutputTimestamp: function () { return "20260802_101010"; },
  createCodeFileTimestamp: function () { return "2026-08-02 10:10:10"; },
  getDiagnosisPresetStatus: function () {
    return {
      ok: true,
      entry: windowObject.MacroStudioPreset.describe(
        {file: "01_診断\\01.md", content: DIAGNOSE_PRESET}, "diagnose"),
      validCount: 1
    };
  },
  getResumeCandidate: function () { return null; },
  confirmDiscardManualChanges: function (action) { return action(); }
};

function modules() {
  return [{
    name: "Report",
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: 7,
    code: MODULE_CODE,
    attributes: ""
  }];
}

function attach() {
  store.reset();
  store.setAppInfo({
    version: "test",
    presets: {
      diagnose: [{file: "01_診断\\01.md", content: DIAGNOSE_PRESET}],
      repair: presetEntries
    }
  });
  store.setBook({
    name: "book.xlsm",
    path: "C:\\work\\book.xlsm",
    ext: ".xlsm",
    totalLines: 7
  }, modules());
  store.setBookInventory({
    sha256: "abc",
    sizeBytes: 10,
    modifiedUtc: "2026-08-02 00:00:00Z",
    references: ["stdole", "Office"],
    connections: [],
    barcodeFonts: [],
    hasPowerQuery: true,
    activeXCount: 0,
    externalLinkCount: 2,
    hasVbaSignature: false,
    complete: true
  });
  store.setTargetEnvironment(
    {
      displayName: "新しい業務端末",
      revision: "2026-08-01",
      constraints: [{
        key: "FIXED_DRIVE_LETTER",
        title: "固定のドライブ文字",
        axis: "storage",
        effect: "blocked",
        basis: "declared"
      }]
    },
    "ENVIRONMENT-V1");
  store.commitDiagnosisRequest({
    requestId: DIAGNOSIS_ID,
    requestText: "",
    prompt: "prompt",
    requestPath: "diagnose-request.md",
    runFolder: "C:\\work\\MacroStudio\\book_20260802_101010",
    outputTimestamp: "20260802_101010"
  });
  store.commitDiagnosis(contracts.diagnosis(
    windowObject.MacroStudioDiagnosis,
    {
      requestId: DIAGNOSIS_ID,
      modules: modules(),
      environment: {
        constraints: [{
          key: "FIXED_DRIVE_LETTER", effect: "blocked", basis: "declared"
        }]
      },
      findings: [{
        number: "1",
        className: "BLOCKER",
        confidence: "CONFIRMED",
        module: "Report",
        procedure: "Export",
        lines: "4",
        environmentKey: "FIXED_DRIVE_LETTER",
        title: "S ドライブが新しい端末にない"
      }]
    }), "diagnosis.md");
}

function chooseAiPreset() {
  return workflow.selectRepairPreset("01_マクロ改修\\\\02_改修\\\\90_test.md");
}

function replyText(requestId, body) {
  return [
    "'@MACROSTUDIO " + requestId + " SUMMARY BEGIN",
    "Report を直しました。",
    "'@MACROSTUDIO " + requestId + " SUMMARY END",
    "'@MACROSTUDIO " + requestId + " BEGIN standard Report",
    body,
    "'@MACROSTUDIO " + requestId + " END standard Report",
    "'@MACROSTUDIO " + requestId + " COMPLETE 1"
  ].join("\r\n");
}

// ---------------------------------------------------------------------
// 5 -> 4 -> 5 with the input untouched
// ---------------------------------------------------------------------

attach();
return chooseAiPreset().then(function () {
  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);
  return workflow.prepareRepairRequest();
}).then(function () {
  var firstId = store.getState().repairRequestId;

  assert(firstId, "A repair request must be minted on the way to screen 5.");
  assert(store.getState().screen === screens.repairScreen,
    "Preparing the repair request moves to the repair screen.");
  assert(workflow.applyRepairText(replyText(firstId, "Option Explicit")),
    "A well formed reply for the current request must be taken in.");
  assert(screens.isRepairIntakeCurrent(store.getState()),
    "The reply belongs to the request that asked for it.");

  // [戻る] then [次へ], with nothing typed in between.
  store.goBack();
  assert(store.getState().screen === screens.repairInputScreen,
    "Going back from the repair screen lands on the repair input.");
  assert(store.getState().repairRequestId === firstId,
    "Looking back at the input must not mint a new request id.");
  assert(screens.countImported(store.getState()) === 1,
    "Looking back at the input must not discard the reply.");

  return workflow.prepareRepairRequest().then(function () {
    assert(store.getState().repairRequestId === firstId,
      "P1-01: an unchanged input must keep the same repair request id.");
    assert(store.getState().screen === screens.repairScreen,
      "The unchanged round trip still moves forward.");
    assert(screens.countImported(store.getState()) === 1 &&
      screens.isRepairIntakeCurrent(store.getState()),
    "P1-01: the answer already taken in must survive 5 -> 4 -> 5.");

    // A success notice says one thing, and that thing is affirmative.
    var success = toasts.filter(function (toast) {
      return toast.tone === "success" &&
        toast.message.indexOf("取り込みました") >= 0;
    });
    assert(success.length > 0, "Taking a reply in reports success.");
    success.forEach(function (toast) {
      ["未確認", "まだ", "読み取れました", "問題は見つかり", "できません"]
        .forEach(function (word) {
          assert(toast.message.indexOf(word) < 0,
            "A success notice must not carry '" + word + "': " +
              toast.message);
        });
    });
    return null;
  });
}).then(function () {
  // -------------------------------------------------------------------
  // a changed input is not thrown away until the next request is written
  // -------------------------------------------------------------------
  var keptId = store.getState().repairRequestId;

  store.goBack();
  store.setExtraRequest("ついでに待ち時間も直してください。");
  assert(store.getState().repairRequestId === keptId,
    "Typing must not tear down the request that is already written.");
  assert(screens.countImported(store.getState()) === 1,
    "Typing must not discard the answer before anything replaces it.");
  assert(!screens.isRepairIntakeCurrent(store.getState()),
    "A changed input must stop the old answer from counting as current.");

  return workflow.prepareRepairRequest().then(function () {
    assert(store.getState().repairRequestId !== keptId,
      "A changed input must mint a new repair request.");
    assert(screens.countImported(store.getState()) === 0,
      "Writing the new request is what confirms the discard.");
    assert(toasts.some(function (toast) {
      return toast.message.indexOf("前の回答") >= 0;
    }), "Dropping the previous answer must be said out loud.");
    return null;
  });
}).then(function () {
  // -------------------------------------------------------------------
  // the replacement table: redo after correcting a value
  // -------------------------------------------------------------------
  attach();
  return workflow.selectRepairPreset("01_マクロ改修\\\\02_改修\\\\91_table.md");
}).then(function () {
  var state = store.getState();
  var row;

  assert(screens.getEngine(state) === "対応表による置換",
    "A template that only carries replacement rules is the table route.");
  assert(pathMap.isProductResult(state.pathMap) &&
    state.pathMap.rows.length === 1,
  "The rules the template declared must find the one literal.");
  row = state.pathMap.rows[0];
  store.setPathMap(pathMap.updateRow(state.pathMap, row.groupKey, {
    to: "D:\\eigyo\\report.csv"
  }));
  store.goTo(screens.repairInputScreen, false);
  assert(workflow.handleNext(store.getState()),
    "The table route carries out the replacement from screen 4.");
  assert(store.getState().screen === screens.reviewScreen,
    "The table route merges into the review screen.");
  assert(screens.countChanged(store.getState()) === 1,
    "The replacement must change the one module it found the value in.");

  // Back to 4, fix the value, and do it again. This is the operation the
  // audit found could never succeed.
  store.goBack();
  assert(store.getState().screen === screens.repairInputScreen,
    "Going back from the review lands on the repair input.");
  store.setPathMap(pathMap.updateRow(
    store.getState().pathMap,
    store.getState().pathMap.rows[0].groupKey,
    {to: "E:\\eigyo\\report.csv"}));
  assert(workflow.handleNext(store.getState()),
    "P1-02: the corrected value must be able to replace again.");
  assert(store.getState().screen === screens.reviewScreen,
    "P1-02: the redo must reach the review screen, not E-MAP-02.");

  var changed = store.getState().modules.filter(function (module) {
    return module.status === "changed";
  })[0];
  assert(changed.pastedCode.indexOf("E:\\eigyo\\report.csv") >= 0,
    "The redo must write the corrected value.");
  assert(changed.pastedCode.indexOf("D:\\eigyo\\report.csv") < 0,
    "The redo must not stack on top of the previous replacement.");
  assert(!toasts.some(function (toast) {
    return toast.message.indexOf("ブックを読み込み直して") >= 0;
  }), "Nothing may tell the reader the workbook changed when it did not.");
  return null;
}).then(function () {
  // -------------------------------------------------------------------
  // a refusal is recorded, with the check number that caused it
  // -------------------------------------------------------------------
  attach();
  return chooseAiPreset();
}).then(function () {
  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);
  return workflow.prepareRepairRequest();
}).then(function () {
  var before = logLines.length;
  var id = store.getState().repairRequestId;

  assert(workflow.applyRepairText("ただの日本語の文章です。") === false,
    "A reply with no markers must be refused.");
  assert(logLines.length > before,
    "P2-01: a refusal must reach the product log.");
  assert(logLines.some(function (line) {
    return line.indexOf("WARN intake refused") === 0 &&
      line.indexOf("stage=repair") >= 0 && line.indexOf("reason=") >= 0;
  }), "The refusal line must name the stage and the contract's reason.");
  assert(!logLines.some(function (line) {
    return line.indexOf("ただの日本語") >= 0;
  }), "The refused text itself must never be written to the log.");
  // The retry text goes to the clipboard first, so the toast lands a
  // microtask later.
  return Promise.resolve().then(function () {
    assert(toasts[toasts.length - 1].message
      .indexOf("AIの回答を取り込めませんでした") === 0,
    "A refusal says it could not take the answer in, then why.");
    return id;
  });
}).then(function (id) {
  // A reply that names a kind the workbook disagrees with is taken in on
  // the workbook's terms, and the reader is told which way it was read.
  var kindReply = [
    "'@MACROSTUDIO " + id + " SUMMARY BEGIN",
    "Report を直しました。",
    "'@MACROSTUDIO " + id + " SUMMARY END",
    "'@MACROSTUDIO " + id + " BEGIN class Report",
    "Option Explicit",
    "'@MACROSTUDIO " + id + " END class Report",
    "'@MACROSTUDIO " + id + " COMPLETE 1"
  ].join("\r\n");
  assert(workflow.applyRepairText(kindReply),
    "A kind the workbook disagrees with is corrected, not refused.");
  assert(String(store.getState().intakeResult.kindWarning).indexOf("Report") >= 0,
    "P2-02: the correction must travel with the result the screen reads.");
  return null;
}).then(function () {
  // -------------------------------------------------------------------
  // what the workbook carries besides code reaches the request
  // -------------------------------------------------------------------
  attach();
  var text = workflow.composeOutsideCode(store.getState());

  assert(text.indexOf("Power Query") >= 0 && text.indexOf("外部リンク") >= 0,
    "P2-03: the facts read out of the workbook must reach the request.");
  assert(text.indexOf("ActiveX") < 0,
    "A category with nothing in it must not be listed.");
  assert(text.indexOf("コード署名") < 0,
    "An absent signature is an absence, not a fact to list.");
  return null;
}).then(function () {
  // -------------------------------------------------------------------
  // a template that says it wants a write-in field gets one by name
  // -------------------------------------------------------------------
  attach();
  return workflow.selectRepairPreset("01_マクロ改修\\\\02_改修\\\\92_writein.md");
}).then(function () {
  var parsed = windowObject.MacroStudioPreset.parse(WRITE_IN_PRESET, "repair");
  var screen;
  var text;

  assert(parsed.valid && parsed.writeIn === "改修してほしい内容",
    "P2-04: the template names the field the reader writes in.");
  store.goTo(screens.repairInputScreen, false);
  screen = workflow.build(screens.repairInputScreen, store.getState());
  text = dom.text(screen);
  assert(text.indexOf("改修してほしい内容") >= 0,
    "P2-04: the field must be on the screen under the name the " +
    "template gave it.");
  assert(text.indexOf("追加の要望を書く（任意）") < 0,
    "P2-04: the write-in must not hide behind a row that says optional.");
  return null;
}).then(function () {
  // -------------------------------------------------------------------
  // the run writes a record of itself, and nothing reads it back
  // -------------------------------------------------------------------
  attach();
  return chooseAiPreset();
}).then(function () {
  store.goTo(screens.repairInputScreen, false);
  store.setFindingSelected("1", true);
  return workflow.prepareRepairRequest();
}).then(function () {
  var manifest = store.createRunManifest();

  assert(manifest && manifest.schemaVersion === 1,
    "A run with a folder has a record of itself.");
  assert(manifest.diagnosis.accepted &&
    manifest.diagnosis.requestId === DIAGNOSIS_ID &&
    manifest.repair.requestId === store.getState().repairRequestId,
  "The record carries the confirmed identities of both stages.");
  assert(manifest.runFolder && manifest.outputTimestamp,
    "The record says which run it belongs to.");

  // Picking a session back up was removed: a run is always a new run.
  assert(typeof store.restoreRunManifest !== "function",
    "Nothing may restore a half-finished session into a running app.");
  assert(typeof workflow.resumeRun !== "function",
    "There is no way to resume from the workflow either.");
  return null;
}).then(function () {
  console.log("test-back-and-forth: PASS");
  console.log(
    "5->4->5 keeps the request and the answer, a changed input is only " +
    "dropped when the next request is written, 7->4->7 replaces again " +
    "from the code the candidates were found in, refusals reach the log " +
    "with their check number, the facts outside the code reach the " +
    "request, a template names its own write-in field, and a run " +
    "writes a record of itself that nothing reads back");
}).catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
