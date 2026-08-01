"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var contracts = require("./helpers/contracts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function filesBelow(folder) {
  var result = [];

  fs.readdirSync(folder, {withFileTypes: true}).forEach(function (entry) {
    var fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      result = result.concat(filesBelow(fullPath));
    } else {
      result.push(fullPath);
    }
  });
  return result;
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var context = vm.createContext({window: windowObject});
var diagnosisId = "11111111-1111-4111-8111-111111111111";
var repairId = "33333333-3333-4333-8333-333333333333";
var modules = [{
  name: "Main",
  type: "standard",
  typeLabel: "標準モジュール",
  ext: "bas",
  lineCount: 4,
  code: "Option Explicit\r\nPublic Sub Run()\r\n" +
    "x = \"C:\\old\\input.csv\"\r\nEnd Sub\r\n",
  attributes: ""
}];

windowObject.window = windowObject;
["response-package.js", "diagnosis-package.js", "diff.js", "vba-lexer.js",
  "path-map.js", "screens.js", "state.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    {filename: name});
});

var response = windowObject.MacroStudioResponse;
var diagnosisApi = windowObject.MacroStudioDiagnosis;
var state = windowObject.MacroStudioState;
var productDiagnosis = contracts.diagnosis(diagnosisApi, {
  requestId: diagnosisId,
  modules: modules
});

assert(diagnosisApi.isProductResult(productDiagnosis),
  "A diagnosis returned by the product parser must carry its private brand.");
assert(!diagnosisApi.isProductResult({
  requestId: diagnosisId, sections: {}, findings: []
}), "A look-alike diagnosis must not carry the private brand.");
assert(diagnosisApi.formatForRecord({sections: {}, findings: []}) === "",
  "The diagnosis record writer must reject an unbranded look-alike.");

state.setBook({
  name: "book.xlsm", path: "C:\\books\\book.xlsm", ext: ".xlsm"
}, modules);
state.setTargetEnvironment({constraints: []}, "ENV");
state.commitDiagnosisRequest({requestId: diagnosisId});
assert(!state.commitDiagnosis({
  requestId: diagnosisId,
  sections: productDiagnosis.sections,
  findings: productDiagnosis.findings
}, "fake.md"), "State must reject an unbranded diagnosis object.");
assert(state.commitDiagnosis(productDiagnosis, "diagnosis.md"),
  "State must accept the diagnosis object returned by the product parser.");

state.setRepairPreset({
  file: "02_改修\\sample.md",
  name: "ひな形",
  content: "preset",
  parsed: {
    engine: "AI", questions: [], behaviorCandidates: [], preserveItems: [],
    output: {body: "rules"}, splitOutput: null
  }
});
state.setExtraRequest("改修する");
state.commitRepairRequest({requestId: repairId});

var productRepair = contracts.repair(response, {
  requestId: repairId,
  modules: [{
    name: "Main",
    code: "Option Explicit\r\nPublic Sub Run(): Beep: End Sub\r\n"
  }],
  existingModules: modules,
  diagnosis: productDiagnosis
});
var copiedRepair = Object.assign({}, productRepair);

assert(response.isProductResult(productRepair),
  "A described repair returned by the product contract must be branded.");
assert(!response.isProductResult(copiedRepair),
  "Copying a branded result must not copy its private brand.");
assert(!response.describe({ok: true, modules: []}, modules).ok,
  "The response describer must reject a hand-made parse result.");
assert(state.importPackage(copiedRepair) === 0,
  "State must reject an unbranded repair result.");
assert(state.importPackage(productRepair) === 1,
  "State must accept a repair that travelled through the product contract.");

var productNoChange = contracts.repair(response, {
  requestId: repairId,
  verdict: "UNNECESSARY",
  summary: "確認した結果、変更は不要です。",
  existingModules: modules,
  diagnosis: productDiagnosis
});
assert(!state.setNoChangeResult(Object.assign({}, productNoChange)),
  "State must reject an unbranded zero-change result.");
assert(state.setNoChangeResult(productNoChange),
  "State must accept a branded zero-change result.");

var pathApi = windowObject.MacroStudioPathMap;
state.setRepairPreset({
  file: "02_改修\\03_path.md",
  name: "固定パスを新環境へ置き換える",
  content: "path preset",
  parsed: {
    replaceRules: [{label: "ドライブ", pattern: "^[A-Za-z]:[\\\\/]", selectedByDefault: true}], questions: [], behaviorCandidates: [],
    preserveItems: [], output: null, splitOutput: null
  }
});
var mapping = pathApi.detect(state.getBookModules(), state.getState().presetReplaceRules);
assert(pathApi.isProductResult(mapping),
  "The product path detector must brand its mapping contract.");
assert(!pathApi.isProductResult(JSON.parse(JSON.stringify(mapping))),
  "Cloning a path mapping must not copy its private brand.");
assert(!state.setPathMap(JSON.parse(JSON.stringify(mapping))),
  "State must reject an unbranded path mapping.");
mapping = pathApi.updateRow(
  mapping,
  "C:\\old\\input.csv",
  {to: "D:\\new\\input.csv"});
assert(state.setPathMap(mapping),
  "State must accept an updated product path mapping.");
var deterministic = pathApi.apply(mapping, state.getBookModules());
assert(pathApi.isProductResult(deterministic) && deterministic.ok,
  "The deterministic apply result must carry the product brand.");
assert(state.setDeterministicResult(Object.assign({}, deterministic)) === 0,
  "State must reject an unbranded deterministic look-alike.");
assert(state.setDeterministicResult(deterministic) === 1,
  "State must accept the exact deterministic product result.");
state.acceptModuleCode(
  "Main",
  deterministic.modules[0].code + "' manual\r\n",
  1);
assert(state.hasDeterministicManualEdits(),
  "A manual edit after deterministic apply must be detectable before reapply.");

// A parser implementation is allowed in exactly the two product contract files.
var allowedParsers = [
  path.normalize(path.join(root, "assets", "js", "response-package.js")),
  path.normalize(path.join(root, "assets", "js", "diagnosis-package.js"))
];
filesBelow(path.join(root, "assets", "js"))
  .concat(filesBelow(path.join(root, "tests")))
  .filter(function (filePath) { return /\.js$/i.test(filePath); })
  .forEach(function (filePath) {
    var normalized = path.normalize(filePath);
    var source;
    if (allowedParsers.indexOf(normalized) >= 0 ||
        normalized === path.normalize(__filename)) {
      return;
    }
    source = fs.readFileSync(filePath, "utf8");
    assert(!/function\s+readSentinel\s*\(/.test(source) &&
      !/\.directive\s*===/.test(source) &&
      !/switch\s*\(["handover.js", ^)]*directive/i.test(source),
    path.relative(root, filePath) + " contains a second response parser.");
  });

filesBelow(path.join(root, "assets", "js"))
  .filter(function (filePath) {
    return /\.js$/i.test(filePath) &&
      path.basename(filePath) !== "response-package.js";
  })
  .forEach(function (filePath) {
    assert(!/\bcreateRequestId\s*\(/.test(fs.readFileSync(filePath, "utf8")),
      path.relative(root, filePath) +
        " calls the request-id API without observing its security flag.");
  });

var appSource = fs.readFileSync(
  path.join(root, "assets", "js", "app.js"), "utf8");
filesBelow(path.join(root, "assets", "messages")).forEach(function (filePath) {
  var message = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "").trim();
  assert(!message || (!/[。！？]|\r|\n/.test(message)) ||
    appSource.indexOf(message) < 0,
    path.basename(filePath) + " is duplicated in app.js.");
});

var development = fs.readFileSync(
  path.join(root, "docs", "DEVELOPMENT.md"), "utf8");
var documented = [];
var match;
var nodeLine = /node tests\\(test-[^\r\n ]+\.js)/g;
while ((match = nodeLine.exec(development)) !== null) {
  documented.push(match[1]);
}
documented.sort();
var nodeTests = fs.readdirSync(path.join(root, "tests"))
  .filter(function (name) { return /^test-.*\.js$/.test(name); })
  .sort();
assert(JSON.stringify(documented) === JSON.stringify(nodeTests),
  "DEVELOPMENT.md must list every Node test exactly once and no stale test.");
nodeTests.forEach(function (name) {
  var source = fs.readFileSync(path.join(root, "tests", name), "utf8");
  assert(source.indexOf(path.basename(name, ".js") + ": PASS") >= 0,
    name + " does not print its own PASS marker.");
});

console.log("test-contract-singleton: PASS");
console.log(
  "private brands reject look-alikes, parser and request-id singletons hold, " +
  "and every Node runner is documented");
