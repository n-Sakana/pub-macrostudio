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
  Uint8Array: Uint8Array
});
Object.assign(windowObject, {
  window: windowObject,
  document: documentObject,
  Promise: Promise,
  Date: Date,
  Math: Math,
  Uint8Array: Uint8Array
});

["icons.js", "components.js", "target-environment.js", "preset-document.js", "response-package.js",
  "diagnosis-package.js", "prompt-template.js", "diff.js", "screens.js",
  "state.js", "screens/workflow.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
    {filename: name});
});

var diagnoseFile = "01_診断\\01_動くかどうかの監査.md";
var repairFile = "03_フリー依頼\\02_改修\\06_自分で改修内容を書く.md";
var diagnoseRaw = {
  file: diagnoseFile,
  content: readUtf8(path.join(root, "presets", "01_診断",
    "01_動くかどうかの監査.md"))
};
var repairRaw = {
  file: repairFile,
  content: readUtf8(path.join(root, "presets", "02_改修",
    "06_自分で改修内容を書く.md"))
};
var diagnoseTemplate = readUtf8(path.join(root, "templates",
  "diagnose-template.txt"));
var repairTemplate = readUtf8(path.join(root, "templates",
  "repair-template.txt"));
var writes = [];

windowObject.hostBridge = {
  request: function (action, parameters) {
    if (action === "readRequestTemplate") {
      return Promise.resolve({
        content: parameters.name === "diagnose-template"
          ? diagnoseTemplate
          : repairTemplate
      });
    }
    if (action === "writeRequestFiles") {
      writes.push(parameters);
      return Promise.resolve({
        folderPath: "C:\\books\\MacroStudio\\run",
        requestPath: "C:\\books\\MacroStudio\\run\\" +
          (parameters.stage === "diagnose"
            ? "diagnose-request.md"
            : "repair-request.md")
      });
    }
    if (action === "writeLog") {
      return Promise.resolve({});
    }
    return Promise.reject({code: "E-SYS-02", message: action});
  }
};

var store = windowObject.MacroStudioState;
var workflow = windowObject.MacroStudioWorkflow;
windowObject.MacroStudioApp = {
  createOutputTimestamp: function () { return "20260801_112233"; },
  createCodeFileTimestamp: function () { return "2026-08-01 11:22:33"; },
  showToast: function () {},
  handleHostError: function (error) { store.setLastError(error); },
  isBlockingAttachError: function () { return false; },
  createAttachErrorCard: function () { return dom.createElement("div"); }
};

var environmentText = "TARGET ENVIRONMENT\r\ndisplayName: test";
var concern = "相談入口から移した懸念 4a7f";
var extra = "自由質問入口から移した追加要望 91cd";
var diagnosis = {
  sections: {PURPOSE: "目的", FLOW: "流れ", DEPENDENCY: "依存", ENVIRONMENT: "環境"},
  findings: []
};

(async function () {
  // Both values live on their own screens: the concern on the diagnosis
  // screen, the extra request on the repair input.
  store.setAppInfo({
    presets: {},
    catalog: {
      diagnose: windowObject.MacroStudioPreset.describeAll(
        [diagnoseRaw], "diagnose"),
      repair: windowObject.MacroStudioPreset.describeAll(
        [repairRaw], "repair"),
      scope: require("./helpers/contracts").catalog(
        windowObject.MacroStudioPreset).scope,
      categories: [],
      diagnosisReady: true,
      scopeReady: true,
      defaultScope: ""
    }
  });
  store.setBook({
    name: "book.xlsm", path: "C:\\books\\book.xlsm", ext: ".xlsm",
    totalLines: 3
  }, [{
    name: "Main", type: "standard", typeLabel: "標準モジュール",
    ext: "bas", lineCount: 3,
    code: "Option Explicit\r\nPublic Sub Main()\r\nEnd Sub",
    attributes: ""
  }]);
  store.setTargetEnvironment({displayName: "test", revision: "1"},
    environmentText);
  store.setDiagnosisConcern(concern);
  await workflow.prepareDiagnosisRequest(false);

  assert(writes.length === 1 && writes[0].stage === "diagnose" &&
    writes[0].request.indexOf(concern) >= 0,
  "The former consultation value must be effective in diagnose-request.md " +
    "(writes=" + writes.length + ", error=" +
    JSON.stringify(store.getState().lastError) + ").");

  store.commitDiagnosis(diagnosis, "diagnosis.md");
  var parsedRepair = windowObject.MacroStudioPreset.parse(
    repairRaw.content, "repair");
  assert(parsedRepair.valid, "The shipped free-writing repair preset must parse.");
  store.setRepairPreset({
    file: repairFile,
    name: parsedRepair.name,
    content: repairRaw.content,
    parsed: parsedRepair
  });
  store.setExtraRequest(extra);
  store.goTo(windowObject.MacroStudioScreens.repairInputScreen, false);
  await workflow.prepareRepairRequest();

  assert(writes.length === 2 && writes[1].stage === "repair" &&
    writes[1].request.indexOf(extra) >= 0,
  "The former free-question value must be effective in repair-request.md.");
  assert(writes[1].request.indexOf(environmentText) >= 0 &&
    writes[1].request.indexOf("（指摘の選択なし。追加の要望のみ）") >= 0,
  "The migrated value must travel with the environment and explicit " +
    "zero-selection context.");

  console.log("test-preset-value-migration: PASS");
  console.log("the former consultation and free-question values are effective " +
    "in the two real request files");
}()).catch(function (error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
