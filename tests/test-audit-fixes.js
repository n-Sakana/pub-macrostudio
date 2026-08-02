"use strict";

// Regressions for the five findings of the 2026-07-30 code audit that
// live on the UI side. Each block names the finding it guards.
//
//   P1-1  a replacement package must not leave the previous one behind
//   P2-1  the way to take a corrected answer instead stays reachable
//   P2-2  the run's own artifacts are replaced, and a note that could
//         not be written is reported
//   P2-3  a build that runs longer than the client wait is reported as
//         running, never as failed
//
// P1-2 (the source workbook changing after the request was prepared)
// and the file-level half of P2-2 are host-side and live in
// tests\test-hostservices.ps1.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var contracts = require("./helpers/contracts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");

// ---- a document just real enough to build a screen into ----

function createElementShim(tagName) {
  var element = {
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    attributes: {},
    disabled: false,
    checked: false,
    type: "",
    id: "",
    value: "",
    title: "",
    spellcheck: false
  };

  function names() {
    return element.className.split(/\s+/).filter(function (name) {
      return name.length > 0;
    });
  }

  element.appendChild = function (child) {
    element.children.push(child);
    return child;
  };
  element.setAttribute = function (name, value) {
    element.attributes[name] = String(value);
  };
  element.getAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(element.attributes, name)
      ? element.attributes[name]
      : null;
  };
  element.hasAttribute = function (name) {
    return Object.prototype.hasOwnProperty.call(element.attributes, name);
  };
  element.querySelector = function () {
    return null;
  };
  element.classList = {
    add: function (name) {
      if (names().indexOf(name) < 0) {
        element.className = names().concat([name]).join(" ");
      }
    },
    remove: function (name) {
      element.className = names().filter(function (item) {
        return item !== name;
      }).join(" ");
    },
    contains: function (name) {
      return names().indexOf(name) >= 0;
    },
    toggle: function (name, on) {
      if (on) {
        element.classList.add(name);
      } else {
        element.classList.remove(name);
      }
    }
  };
  return element;
}

function walk(element, visit) {
  visit(element);
  element.children.forEach(function (child) {
    walk(child, visit);
  });
}

function findActions(element) {
  var actions = [];

  walk(element, function (node) {
    var action = node.getAttribute("data-action");
    if (action) {
      actions.push(action);
    }
  });
  return actions;
}

function collectText(element) {
  var text = "";

  walk(element, function (node) {
    text += node.textContent + "\n";
  });
  return text;
}

function loadApp() {
  var windowObject = {};
  var context = vm.createContext({
    window: windowObject,
    document: {
      createElement: createElementShim,
      addEventListener: function () {
      },
      getElementById: function () {
        return null;
      },
      querySelector: function () {
        return null;
      }
    },
    Promise: Promise,
    Uint8Array: Uint8Array,
    Math: Math,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  });

  windowObject.window = windowObject;
  windowObject.document = context.document;
  windowObject.setTimeout = setTimeout;
  windowObject.clearTimeout = clearTimeout;
  windowObject.console = { error: function () {} };
  // The screens are built and the state is driven here; nothing is sent
  // to the host, so the bridge only has to stay quiet.
  windowObject.hostBridge = {
    request: function () {
      return Promise.resolve(null);
    },
    on: function () {
      return function () {
      };
    }
  };
  ["icons.js",
    "handover.js", "diff.js",
    "diff-view.js",
    "vba-highlight.js",
    "preset-document.js",
    "response-package.js",
    "diagnosis-package.js",
    "screens.js",
    "state.js",
    "screens/workflow.js",
    "app.js"
  ].forEach(function (name) {
    vm.runInContext(
      fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
      context,
      { filename: name });
  });
  return windowObject;
}

var host = loadApp();
var app = host.MacroStudioApp;
var state = host.MacroStudioState;
var screens = host.MacroStudioScreens;
var response = host.MacroStudioResponse;
var workflow = host.MacroStudioWorkflow;

// ---- P2-1: the intake screen keeps its own way back ----

function attach() {
  state.reset();
  state.setBook(
    {
      name: "受注管理.xlsm",
      path: "C:\\work\\受注管理.xlsm",
      ext: ".xlsm",
      totalLines: 6
    },
    [
      {
        name: "Main",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 2,
        code: "Option Explicit\r\nSub A(): End Sub\r\n",
        attributes: ""
      },
      {
        name: "Helper",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 2,
        code: "Option Explicit\r\nSub B(): End Sub\r\n",
        attributes: ""
      }
    ]);
  state.setTargetEnvironment({displayName: "test", revision: "1"}, "ENV");
  state.commitDiagnosisRequest({
    requestId: response.createRequestId(),
    runFolder: "C:\\work\\MacroStudio\\受注管理_20260730_010203",
    outputTimestamp: "20260730_010203"
  });
  state.commitDiagnosis(contracts.diagnosis(host.MacroStudioDiagnosis, {
    requestId: state.getState().diagnosisRequestId,
    modules: state.getState().modules
  }), "diagnosis.md");
  state.setRepairPreset({
    file: "02_改修\\sample.md",
    name: "ひな形",
    content: "preset",
    parsed: {
      engine: "AI", questions: [], behaviorCandidates: [], preserveItems: [],
      output: {body: "rules"}, splitOutput: null
    }
  });
  state.setExtraRequest("この改修を行う");
  state.commitRepairRequest({requestId: response.createRequestId()});
}

function importModules(items, summary) {
  return state.importPackage(contracts.repair(response, {
    requestId: state.getState().repairRequestId,
    modules: items.map(function (item) {
      return {
        name: item.name,
        kind: item.kind || "standard",
        code: item.code
      };
    }),
    existingModules: state.getBookModules(),
    diagnosis: state.getState().diagnosis,
    summary: summary || "Main を直しました。"
  }));
}

attach();
state.goTo(screens.repairIntakeScreen, false);

var emptyIntake = workflow.createRepairIntakeScreen(state.getState());
assert(
  findActions(emptyIntake).indexOf("import-repair") >= 0,
  "The empty intake screen must offer the intake button.");

importModules([
  {
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  }
]);

var filledIntake = workflow.createRepairIntakeScreen(state.getState());
var filledActions = findActions(filledIntake);
var filledText = collectText(filledIntake);

assert(
  filledActions.indexOf("import-repair") >= 0,
  "P2-1: after a package came in, the intake button must still be " +
  "in the screen.");
assert(
  filledText.indexOf("クリップボードから改修結果を取り込む") >= 0,
  "P2-1: the screen must keep the way to take another answer.");
assert(
  filledText.indexOf("AIの回答を取り込みました") >= 0,
  "The intake result must stay on the screen next to the button.");
assert(
  state.getState().intakeResult.summary === "Main を直しました。",
  "The AI's own account of the change must remain in accepted state.");

// ---- P1-1: one package at a time ----

// A second, valid answer to the same request replaces the first one
// completely: what the first answer changed or added must not survive.
attach();
state.goTo(screens.repairIntakeScreen, false);
importModules([
  {
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  },
  {
    name: "OldHelper",
    code: "Option Explicit\r\nSub Old(): End Sub\r\n",
    changedLineCount: 2,
    lineCount: 2
  }
]);
assert(
  screens.countImported(state.getState()) === 2,
  "The first package must come in.");

importModules([
  {
    name: "Helper",
    code: "Option Explicit\r\nSub B(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  }
]);
assert(
  screens.countImported(state.getState()) === 1 &&
    state.findModule("Helper").status === "changed",
  "P1-1: only the replacement package may be imported.");
assert(
  state.findModule("Main").status === "pending" &&
    state.findModule("Main").pastedCode === null,
  "P1-1: a module the replacement did not mention must go back to " +
  "untouched.");
assert(
  state.findModule("OldHelper") === null,
  "P1-1: a module only the previous answer added must be gone.");
assert(
  app.createBuildModules(state.getState()).length === 1,
  "P1-1: the build payload must hold only the replacement package.");

// A new request id invalidates whatever the previous request took in.
attach();
state.goTo(screens.repairIntakeScreen, false);
importModules([
  {
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  }
]);
assert(
  screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "An answer to the current request lets the flow continue.");

state.commitRepairRequest({requestId: response.createRequestId()});
assert(
  screens.countImported(state.getState()) === 0,
  "P1-1: a new request id must drop the answer to the old request.");
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "P1-1: the intake must not pass on an answer to a request that is " +
  "gone.");
assert(
  !screens.isRepairIntakeCurrent(state.getState()),
  "P1-1: an imported package belongs to the request it answered.");

// Choosing the same purpose again keeps what is already in: going back
// and forward through the screens is not a reason to lose an answer.
attach();
state.goTo(screens.repairIntakeScreen, false);
importModules([
  {
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  }
]);
state.goTo(screens.repairRequestScreen, false);
state.goTo(screens.repairIntakeScreen, false);
assert(
  screens.countImported(state.getState()) === 1 &&
    screens.isRepairIntakeCurrent(state.getState()),
  "Re-entering the same request path must keep the imported package.");

// A module a previous answer added is measured against the workbook, not
// against that answer: the same new module may come back again.
attach();
state.goTo(screens.repairIntakeScreen, false);
assert(
  workflow.applyRepairText([
    response.beginLine(
      state.getState().repairRequestId,
      "standard",
      "CompatHelpers"),
    "Option Explicit",
    "Public Sub W(): End Sub",
    response.endLine(
      state.getState().repairRequestId,
      "standard",
      "CompatHelpers"),
    response.completeLine(state.getState().repairRequestId, 1)
  ].join("\r\n")),
  "A package adding a standard module must be accepted.");
assert(
  workflow.applyRepairText([
    response.beginLine(
      state.getState().repairRequestId,
      "standard",
      "CompatHelpers"),
    "Option Explicit",
    "Public Sub W(): Beep: End Sub",
    response.endLine(
      state.getState().repairRequestId,
      "standard",
      "CompatHelpers"),
    response.completeLine(state.getState().repairRequestId, 1)
  ].join("\r\n")),
  "P1-1: a corrected answer may add the same module again.");
assert(
  state.findModule("CompatHelpers").pastedCode.indexOf("Beep") >= 0,
  "P1-1: the corrected code must be the one that is kept.");
assert(
  screens.countImported(state.getState()) === 1,
  "P1-1: the corrected answer must not add the module twice.");

// ---- P2-2: a summary note that could not be written is reported ----

attach();
state.goTo(screens.repairIntakeScreen, false);
importModules([
  {
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n",
    changedLineCount: 1,
    lineCount: 2
  }
]);
state.setBuildResult({
  status: "success",
  success: true,
  outputPath: "C:\\work\\MacroStudio\\受注管理_20260730_010203\\out.xlsm",
  results: [{ name: "Main", result: "written" }],
  diffPath: "C:\\work\\MacroStudio\\受注管理_20260730_010203\\diff-report.html",
  diffError: "",
  resultPath: "",
  resultError: "The result file could not be created."
});
state.goTo(screens.doneScreen, false);

var doneText = collectText(app.createDoneScreen(state.getState()));

assert(
  doneText.indexOf("result.md") >= 0,
  "P2-2: a summary note that failed must be named on the last screen.");
assert(
  doneText.indexOf("改修版ブックは正常に作成されています") >= 0,
  "P2-2: the note failing must not read as the build failing.");

// With everything written there is no note to show.
state.setBuildResult({
  status: "success",
  success: true,
  outputPath: "C:\\work\\MacroStudio\\受注管理_20260730_010203\\out.xlsm",
  results: [{ name: "Main", result: "written" }],
  diffPath: "C:\\work\\MacroStudio\\受注管理_20260730_010203\\diff-report.html",
  diffError: "",
  resultPath: "C:\\work\\MacroStudio\\受注管理_20260730_010203\\result.md",
  resultError: ""
});
assert(
  collectText(app.createDoneScreen(state.getState()))
    .indexOf("作成できませんでした") < 0,
  "A complete build must not report a missing file.");

// ---- P2-3: a long build is reported as running ----

// The build screen has its own wording while the host is still working,
// and the flow stays frozen instead of moving on to a failure.
attach();
state.setBuildSlow(true);
assert(
  screens.describe(state.getState(), screens.buildScreen)
    .context.indexOf("時間がかかっています") >= 0,
  "P2-3: a build that runs long must say so on the build screen.");
state.goTo(screens.buildScreen, false);
state.setBusyAction("buildBook");
assert(
  !screens.canAdvance(state.getState(), screens.buildScreen) &&
    !screens.canGoBack(state.getState(), screens.buildScreen),
  "P2-3: a running build must keep the flow where it is.");
state.setBusyAction(null);
state.setBuildSlow(false);

// ---- WP-01: clipboard failures keep both recovery routes visible ----

assert(
  app.getHostErrorMessage({ code: "E-GEN-04" }).indexOf("Ctrl+V") >= 0,
  "A clipboard read failure must name the paste-event recovery route.");
var appSource = fs.readFileSync(
  path.join(root, "assets", "js", "app.js"),
  "utf8");
var workflowSource = fs.readFileSync(
  path.join(root, "assets", "js", "screens", "workflow.js"),
  "utf8");
assert(
  workflowSource.indexOf('name: "retry-copy-request"') >= 0 &&
    workflowSource.indexOf('label: "もう一度コピー"') >= 0 &&
    appSource.indexOf("function onToastClick") >= 0,
  "A clipboard write failure must render a working retry action.");

console.log("test-audit-fixes: PASS");
console.log(
  "one package at a time, a reachable way to take another answer, " +
  "clipboard recovery, a reported summary-note failure and a long " +
  "build that stays a build behave as specified");
