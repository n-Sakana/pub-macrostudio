"use strict";

// A reply can pass every structural check and still be the wrong answer.
// Nothing in the contract can tell: the checks read markers, not meaning.
// So the review screen says only that the answer arrived, shows what it
// changed, and offers the reader the one thing the tool cannot decide -
// that this answer is not the one.
//
// Also here: a full-rewrite reply of ten thousand lines, because "the
// answer is enormous" and "the answer is wrong" are the two ways a
// correct-looking reply goes badly, and both end on this screen.

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
var clipboard = [];
var logLines = [];

function loadApp() {
  var windowObject = {};
  var context = vm.createContext({
    window: windowObject,
    document: {
      createElement: dom.createElement,
      createTextNode: function (value) {
        var node = dom.createElement("span");
        node.nodeType = 3;
        node.textContent = String(value === undefined ? "" : value);
        return node;
      },
      addEventListener: function () {},
      getElementById: function () { return null; },
      querySelector: function () { return null; }
    },
    Promise: Promise,
    Uint8Array: Uint8Array,
    Math: Math,
    JSON: JSON,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  });

  windowObject.window = windowObject;
  windowObject.document = context.document;
  windowObject.setTimeout = setTimeout;
  windowObject.clearTimeout = clearTimeout;
  windowObject.console = {error: function () {}};
  windowObject.hostBridge = {
    request: function (action, payload) {
      if (action === "writeClipboard") {
        clipboard.push(payload.text);
        return Promise.resolve(null);
      }
      if (action === "writeLog") {
        logLines.push(payload.level + " " + payload.message);
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    },
    on: function () { return function () {}; }
  };
  ["icons.js", "handover.js", "diff.js", "diff-view.js", "vba-highlight.js",
    "preset-document.js", "response-package.js", "diagnosis-package.js",
    "screens.js", "state.js", "screens/workflow.js", "app.js"]
    .forEach(function (name) {
      vm.runInContext(readUtf8(path.join(root, "assets", "js", name)),
        context, {filename: name});
    });
  return windowObject;
}

var host = loadApp();
var app = host.MacroStudioApp;
var state = host.MacroStudioState;
var screens = host.MacroStudioScreens;
var REQUEST_ID = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
var DIAGNOSIS_ID = "11111111-1111-4111-8111-111111111111";

function bigCode(lines) {
  var parts = ["Option Explicit", "", "Sub Run()"];
  var index;

  for (index = 0; index < lines; index += 1) {
    parts.push("    Debug.Print \"" + index + "\"");
  }
  parts.push("End Sub");
  return parts.join("\r\n") + "\r\n";
}

function attach(code) {
  state.reset();
  state.setBook(
    {
      name: "受注管理.xlsm",
      path: "C:\\work\\受注管理.xlsm",
      ext: ".xlsm",
      totalLines: 4
    },
    [{
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 4,
      code: code || "Option Explicit\r\nSub Run()\r\n    Beep\r\nEnd Sub\r\n",
      attributes: ""
    }]);
  state.setTargetEnvironment({displayName: "端末", revision: "1"}, "ENV-1");
  state.commitDiagnosisRequest({
    requestId: DIAGNOSIS_ID,
    requestText: "",
    prompt: "p",
    requestPath: "diagnose-request.md",
    runFolder: "C:\\work\\MacroStudio\\run",
    outputTimestamp: "20260802_101010"
  });
  state.commitDiagnosis(contracts.diagnosis(host.MacroStudioDiagnosis, {
    requestId: DIAGNOSIS_ID,
    modules: state.getBookModules(),
    findings: [{
      number: "1",
      className: "DEFECT",
      confidence: "CONFIRMED",
      module: "Main",
      procedure: "Run",
      lines: "3",
      title: "音を鳴らしているだけで何もしていない"
    }]
  }), "diagnosis.md");
  state.setRepairPreset({
    file: "02_改修\\\\90_test.md",
    name: "テスト用ひな形",
    content: "preset",
    parsed: {
      engine: "AI",
      questions: [],
      behaviorCandidates: [],
      preserveItems: [],
      output: {title: "出力指示", body: "この形で返してください。"},
      splitOutput: null
    }
  });
  state.setFindingSelected("1", true);
  state.commitRepairRequest({
    requestId: REQUEST_ID,
    requestText: "指示",
    prompt: "prompt",
    requestPath: "repair-request.md"
  });
}

function reply(code) {
  return contracts.repair(host.MacroStudioResponse, {
    requestId: REQUEST_ID,
    modules: [{name: "Main", code: code}],
    existingModules: state.getBookModules(),
    diagnosis: state.getState().diagnosis,
    summary: "Main を全面的に書き直しました。"
  });
}

// ---------------------------------------------------------------------
// a reply that is structurally perfect and semantically wrong
// ---------------------------------------------------------------------

attach();
// It parses, it names a module the workbook has, its count matches. The
// contract has nothing to object to, and it deletes the work instead of
// doing it.
var wrong = reply("Option Explicit\r\nSub Run()\r\nEnd Sub\r\n");
assert(state.importPackage(wrong) === 1,
  "A structurally valid reply is taken in, whatever it says.");

var review = app.createReviewScreen(state.getState());
var text = dom.text(review);

assert(text.indexOf("AIの回答を取り込みました") >= 0,
  "The review screen states the affirmative fact and nothing else.");
["問題は見つかりません", "問題は見つかりませんでした", "内容は未確認",
  "まだ採用していません", "形式を読み取れました"].forEach(function (word) {
  assert(text.indexOf(word) < 0,
    "A structural check must never be reported as '" + word + "'.");
});
assert(text.indexOf("この回答は採用しない") >= 0,
  "The reader must be able to say the answer is not the one.");
assert(text.indexOf("変更内容を見る") >= 0,
  "The change itself must be reachable from the same screen.");

// The change is open on arrival: the reader is meant to look at it.
var openDisclosure = dom.collect(review, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-disclosure-box") === "change-detail";
})[0];
assert(openDisclosure && openDisclosure.getAttribute("data-open") === "true",
  "The change must be open by default on the review screen.");

// ---------------------------------------------------------------------
// [この回答は採用しない] -> reason -> correction request on the clipboard
// ---------------------------------------------------------------------

assert(app.isRejectionOpen() === false,
  "The rejection form is closed until the reader opens it.");
app.openRejection();
assert(app.isRejectionOpen() === true, "Rejecting opens the reason field.");

var form = dom.text(app.createReviewScreen(state.getState()));
assert(form.indexOf("採用しない理由") >= 0,
  "The reason has a field of its own with a name that says what it is.");
assert(form.indexOf("修正依頼文をコピー") >= 0,
  "The reason turns into a correction request the reader can hand over.");

var copyButton = dom.collect(
  app.createReviewScreen(state.getState()),
  function (node) {
    return node.getAttribute &&
      node.getAttribute("data-action") === "copy-rejection-request";
  })[0];
assert(copyButton && copyButton.disabled === true,
  "With no reason written there is nothing to send, so the button is shut.");

app.setRejectionReason("Beep を消しただけで、依頼した集計処理が入っていません。");
copyButton = dom.collect(
  app.createReviewScreen(state.getState()),
  function (node) {
    return node.getAttribute &&
      node.getAttribute("data-action") === "copy-rejection-request";
  })[0];
assert(copyButton && copyButton.disabled === false,
  "A written reason opens the way to hand it back.");

var draft = app.createRejectionRequestText(state.getState());
assert(draft.indexOf("採用できませんでした") >= 0,
  "The correction request says the answer was not adopted.");
assert(draft.indexOf("依頼した集計処理が入っていません") >= 0,
  "The reader's reason is what goes back to the chat.");
assert(draft.indexOf(REQUEST_ID) >= 0,
  "The request the answer belongs to travels with the correction.");
assert(draft.indexOf("この形で返してください") >= 0,
  "The template's own output rules go back with it, unrewritten.");

var before = clipboard.length;
app.copyRejectionRequest().then(function (copied) {
  assert(copied === true, "The correction request reaches the clipboard.");
  assert(clipboard.length === before + 1,
    "Exactly one correction request is written.");
  assert(clipboard[clipboard.length - 1].indexOf(
    "依頼した集計処理が入っていません") >= 0,
  "What was copied is the correction that was drafted.");
  assert(logLines.some(function (line) {
    return line.indexOf("WARN repair answer rejected by reader") === 0;
  }), "A rejected answer is recorded, so support can reconstruct it.");
  assert(!logLines.some(function (line) {
    return line.indexOf("集計処理") >= 0;
  }), "The reason's text stays out of the log.");
  // The rejection form belongs to this visit to the screen: opening
  // another one starts from closed.
  app.cancelRejection();
  assert(app.isRejectionOpen() === false,
    "Leaving the rejection closes the form and clears the reason.");
  assert(app.createRejectionRequestText(state.getState())
    .indexOf("依頼した集計処理が入っていません") < 0,
  "The reason does not survive being cancelled.");

  // -------------------------------------------------------------------
  // a full-rewrite reply of ten thousand lines
  // -------------------------------------------------------------------
  var huge = bigCode(10000);
  attach();
  var accepted = state.importPackage(reply(huge));

  assert(accepted === 1, "A ten thousand line rewrite is one module.");
  var module = state.getState().modules[0];
  assert(module.status === "changed",
    "A full rewrite is a change, however large.");
  assert(module.pastedCode.split("\r\n").length > 10000,
    "The whole reply is kept, not a truncation of it.");
  assert(module.showChangesOnly === true,
    "A module this long opens on its changes rather than all of it.");
  assert(screens.countChanged(state.getState()) === 1 &&
    screens.isRepairIntakeCurrent(state.getState()),
  "The large reply belongs to the request that asked for it.");

  var large = dom.text(app.createReviewScreen(state.getState()));
  assert(large.indexOf("AIの回答を取り込みました") >= 0,
    "The same one affirmative sentence, at any size.");
  assert(large.indexOf("この回答は採用しない") >= 0,
    "The way to refuse a large answer is the same way.");

  console.log("test-reject-answer: PASS");
  console.log(
    "a structurally valid but wrong answer is reported only as taken in, " +
    "its change is open by default, the reader can refuse it and hand a " +
    "correction back through the existing clipboard route, the refusal " +
    "is logged without its text, and a ten thousand line full rewrite " +
    "goes through the same screen");
}).catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
