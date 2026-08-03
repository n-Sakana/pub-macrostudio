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

var root = path.resolve(__dirname, "..");
var windowObject = {};
var context = vm.createContext({window: windowObject});
windowObject.window = windowObject;

["preset-document.js", "response-package.js", "diagnosis-package.js",
  "vba-lexer.js", "path-map.js", "screens.js", "state.js"]
  .forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    {filename: name});
});

var screens = windowObject.MacroStudioScreens;
var store = windowObject.MacroStudioState;
var DIAGNOSIS_ID_1 = "11111111-1111-4111-8111-111111111111";
var DIAGNOSIS_ID_2 = "22222222-2222-4222-8222-222222222222";
var REPAIR_ID_1 = "33333333-3333-4333-8333-333333333333";
var REPAIR_ID_2 = "44444444-4444-4444-8444-444444444444";

function current() {
  return store.getState();
}

function attach() {
  store.reset();
  // Nothing can be read until the run says what it is for, so every walk
  // through the flow starts at the entrance.
  store.setEntrance(macroEntrance);
  assert(store.canGoNext() && store.goNext() &&
    store.getState().screen === screens.bookScreen,
  "A usable entrance must lead to the workbook.");
  store.setBook({
    name: "受注管理.xlsm",
    path: "C:\\work\\受注管理.xlsm",
    ext: ".xlsm",
    totalLines: 12
  }, [
    {
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 4,
      code: "Option Explicit\r\nSub A()\r\n" +
        "x = \"C:\\old\\input.csv\"\r\nEnd Sub\r\n",
      attributes: ""
    },
    {
      name: "OrderRecord",
      type: "class",
      typeLabel: "クラスモジュール",
      ext: "cls",
      lineCount: 4,
      code: "Option Explicit\r\n",
      attributes: "Attribute VB_Name = \"OrderRecord\"\r\n"
    }
  ]);
  store.setTargetEnvironment({name: "新しい業務端末"}, "ENVIRONMENT-V1");
}

function diagnosisPackage(requestId, label) {
  return contracts.diagnosis(windowObject.MacroStudioDiagnosis, {
    requestId: requestId,
    modules: current().modules,
    environment: {
      constraints: [{
        key: "WIN32API_BLOCKED", effect: "blocked", basis: "declared"
      }]
    },
    findings: [{
      number: "1",
      className: "BLOCKER",
      confidence: "CONFIRMED",
      module: "Main",
      procedure: "A",
      lines: "2",
      environmentKey: "WIN32API_BLOCKED",
      title: label || "API が使えない",
      condition: "実行時",
      impact: "停止する",
      evidence: "2 行目"
    }]
  });
}

function commitDiagnosisRequest(id) {
  assert(store.commitDiagnosisRequest({
    requestId: id,
    requestText: "事実を診断してください。",
    prompt: "diagnose prompt",
    requestPath: "C:\\work\\run\\diagnose-request.md",
    runFolder: "C:\\work\\run"
  }), "The diagnosis request must commit after a host success.");
}

function acceptDiagnosis(id, label) {
  commitDiagnosisRequest(id);
  store.setDiagnosisHandoffProgress(true, true);
  assert(store.commitDiagnosis(
    diagnosisPackage(id, label),
    "C:\\work\\run\\diagnosis.md"),
  "A current diagnosis must commit after diagnosis.md is written.");
}

function chooseAiPreset(content) {
  assert(store.setRepairPreset({
    file: "01_マクロ改修\\\\02_改修\\\\01_refactor.md",
    name: "VBAリファクター",
    content: content || "# preset v1",
    parsed: {
      name: "VBAリファクター",
      engine: "AI",
      questions: [{text: "優先する動作は何ですか", choices: []}],
      behaviorCandidates: ["標準機能だけで動かす"],
      preserveItems: ["明示していない業務動作は変えない"],
      output: {body: "契約どおり返す"},
      splitOutput: null
    }
  }) !== false, "The AI preset must be selected.");
}

function fillRepairInput() {
  store.setAnswer(0, "元の動作を優先");
  store.setFindingSelected("1", true);
  store.setDesiredBehaviour("1", "標準機能だけで動かす");
}

function commitRepairRequest(id) {
  assert(store.commitRepairRequest({
    requestId: id,
    requestText: "直してください。",
    prompt: "repair prompt",
    requestPath: "C:\\work\\run\\repair-request.md"
  }), "The repair request must commit after a host success.");
  store.setRepairHandoffProgress(true, true);
}

// ---- canonical 11-screen table and the branches an entrance opens ----
// Handing the request to the chat and taking the reply back is one piece
// of work, so each stage owns one screen instead of two. Reading the
// diagnosis and choosing the work are two decisions, so they are two.
// The run says what it is for before it reads anything, so the entrance
// is screen 0 and everything else moved down by one (SPEC §2.2).

assert(screens.count === 11, "The flow must have eleven screens.");
assert(screens.majors.length === 4, "Progress must always have four steps.");
assert(JSON.stringify(screens.getMajors({})) === JSON.stringify(screens.majors),
  "The visible progress must never change by route or state.");
assert(
  screens.entranceScreen === 0 &&
  screens.bookScreen === 1 &&
  screens.diagnoseScreen === 2 &&
  screens.findingsScreen === 3 &&
  screens.nextStepScreen === 4 &&
  screens.repairInputScreen === 5 &&
  screens.repairScreen === 6 &&
  screens.reviewScreen === 7 &&
  screens.outputScreen === 8 &&
  screens.buildScreen === 9 &&
  screens.doneScreen === 10,
  "Named screens must match SPEC §2.2.");
assert(screens.diagnoseRequestScreen === screens.diagnoseScreen &&
  screens.diagnoseIntakeScreen === screens.diagnoseScreen &&
  screens.repairRequestScreen === screens.repairScreen &&
  screens.repairIntakeScreen === screens.repairScreen,
"Asking and importing are the same screen, under either name.");
assert(screens.modeScreen === undefined &&
  screens.isDiagnose === undefined && screens.isSimple === undefined &&
  screens.isChatOnly === undefined,
"Removed entrances and route modes must not survive in the screen API.");

var presetApi = windowObject.MacroStudioPreset;
var macroEntrance = contracts.entrance(presetApi, "01_マクロ改修");
var refactorEntrance = contracts.entrance(presetApi, "02_リファクタ");
var freeEntrance = contracts.entrance(presetApi, "03_フリー依頼");
var straight = {presetEngine: "AI", entrance: macroEntrance};

for (var index = screens.entranceScreen; index < screens.doneScreen;
  index += 1) {
  assert(screens.nextIndex(straight, index) === index + 1,
    "The longest route must not skip screen " + index + ".");
}
assert(screens.nextIndex(
  {presetEngine: "対応表による置換", entrance: macroEntrance},
  screens.repairInputScreen) === screens.reviewScreen,
"Only the fixed-path engine may branch from the repair input to review.");
assert(screens.nextIndex(
  {presetEngine: "AI", entrance: macroEntrance, questions: []},
  screens.nextStepScreen) === screens.repairInputScreen &&
  screens.nextIndex(
    {presetEngine: "AI", entrance: macroEntrance, questions: [{text: "Q"}]},
    screens.nextStepScreen) === screens.repairInputScreen,
"Questions change the repair input's content, not the graph.");
assert(screens.nextIndex(straight, screens.findingsScreen) ===
  screens.nextStepScreen,
"Reading the diagnosis leads to choosing the work, never past it.");

// Each entrance skips exactly what its own folder does not contain: a
// refactor has one repair template, so no choice of template; a free
// request has no diagnosis stage, so no hand-over and no result to read.
assert(screens.nextIndex(
  {entrance: refactorEntrance}, screens.findingsScreen) ===
  screens.repairInputScreen,
"One repair template means there is nothing to choose between.");
assert(screens.nextIndex(
  {entrance: freeEntrance}, screens.bookScreen) ===
  screens.repairInputScreen,
"An entrance with no diagnosis goes from the workbook to the request.");
assert(screens.nextIndex(
  {entrance: macroEntrance}, screens.bookScreen) === screens.diagnoseScreen,
"An entrance that diagnoses must go through the diagnosis.");

// ---- no hidden shortcut around diagnosis ----

attach();
assert(current().screen === screens.bookScreen,
  "The chosen entrance leads to the book screen.");
assert(store.startSimple === undefined && store.setMode === undefined,
  "The old simple and mode entrances must be gone.");
assert(store.canGoNext(), "An attached workbook enables diagnosis.");
assert(store.goNext() && current().screen === screens.diagnoseScreen,
  "The workbook screen can only lead to the diagnosis screen.");
assert(!store.canGoNext(),
  "The diagnosis screen only advances once a diagnosis has been taken in.");

// Handing over is no longer a gate of its own: the screen advances on
// the diagnosis coming back, which is the only thing findings need.
commitDiagnosisRequest(DIAGNOSIS_ID_1);
store.setDiagnosisHandoffProgress(true, false);
assert(!store.canGoNext(), "Copying the diagnosis prompt alone is insufficient.");
store.setDiagnosisHandoffProgress(null, true);
assert(!store.canGoNext(),
  "Handing the request over is not itself progress: no diagnosis, no next.");
assert(store.commitDiagnosis(
  diagnosisPackage(DIAGNOSIS_ID_1), "diagnosis.md"),
  "A current diagnosis must be accepted.");
assert(store.canGoNext(), "A valid zero-or-more-finding diagnosis enables next.");
assert(store.goNext() && current().screen === screens.findingsScreen,
  "The diagnosis screen leads to findings.");

// Reading the diagnosis is its own page; choosing the work is the next.
assert(store.canGoNext(), "An accepted diagnosis may always be read past.");
assert(store.goNext() && current().screen === screens.nextStepScreen,
  "Findings lead to the choice of work.");
assert(!store.canGoNext(), "No template chosen, no repair input.");
chooseAiPreset();
assert(store.canGoNext(), "Selecting one repair preset enables the next step.");
assert(store.goNext() && current().screen === screens.repairInputScreen,
  "The chosen template leads to the single repair-input screen.");
assert(!store.canGoNext(), "Empty repair input is not ready.");
store.setExtraRequest("診断にない追加要望");
assert(!store.canGoNext(), "An unanswered preset question still blocks next.");
store.setAnswer(0, "元の動作を優先");
assert(store.canGoNext(),
  "Answered questions plus an extra request may proceed without selection.");
// A selected finding is a complete instruction on its own: it states the
// problem, where it is and what breaks, so nothing further is asked.
store.setFindingSelected("1", true);
assert(store.canGoNext(),
  "A selected finding needs no restatement to be ready.");

// ---- transaction identities and snapshot invalidation ----

commitRepairRequest(REPAIR_ID_1);
store.importPackage(contracts.repair(windowObject.MacroStudioResponse, {
  requestId: REPAIR_ID_1,
  modules: [{
    name: "Main",
    code: "Option Explicit\r\nSub A(): Beep: End Sub\r\n"
  }],
  existingModules: store.getBookModules(),
  diagnosis: current().diagnosis
}));
assert(screens.isRepairIntakeCurrent(current()),
  "The imported package belongs to the committed repair identity.");

// A new repair request keeps the diagnosis but drops only repair results.
var diagnosisVersion = current().diagnosisVersion;
commitRepairRequest(REPAIR_ID_2);
assert(current().diagnosis && current().diagnosisVersion === diagnosisVersion,
  "Minting a repair id must preserve the accepted diagnosis.");
assert(!screens.isRepairIntakeCurrent(current()) &&
  screens.countImported(current()) === 0,
"A new repair id must invalidate only the old repair package.");

// Input mutation marks the written request as no longer current, but it
// does not tear it down: SPEC 2.6.1 confirms the discard only when the
// next request has actually been written. Screens read the snapshot, so
// nothing stale can be carried forward in the meantime.
store.setExtraRequest("別の追加要望");
assert(current().repairRequestId === REPAIR_ID_2 && current().diagnosis,
  "Changing repair input must not tear down the written request.");
assert(current().repairRequestSnapshot !== current().repairInputSnapshot,
  "Changed input must stop matching the snapshot the request answered.");
assert(!screens.isRepairIntakeCurrent(current()),
  "A changed input must stop the old package from counting as current.");
commitRepairRequest("2f0a0f6f-1e2b-4a3c-8d4e-5f6a7b8c9d01");
assert(current().repairRequestSnapshot === current().repairInputSnapshot &&
  screens.countImported(current()) === 0,
"Writing the next request is what confirms the discard.");

// Preset content is part of the identity even when the file name is equal.
chooseAiPreset("# preset v2");
assert(Object.keys(current().answers).length === 0 &&
  current().extraRequest === "" &&
  JSON.stringify(current().selectedFindings) ===
    JSON.stringify(current().diagnosis.findings.filter(function (finding) {
      return finding["class"] === "BLOCKER" || finding["class"] === "DEFECT";
    }).map(function (finding) { return String(finding.number); })),
"Changed preset content must clear what the reader typed and reset the " +
  "selection to the mandatory findings.");

// Re-intaking a diagnosis increments its version and clears selection/input.
fillRepairInput();
var beforeReintake = current().diagnosisVersion;
assert(store.commitDiagnosis(
  diagnosisPackage(DIAGNOSIS_ID_1, "再診断"), "diagnosis.md"),
  "The same diagnosis request may be re-intaken.");
// Re-intake resets the repair input. The selection resets to the findings
// the target environment makes mandatory, not to nothing: work that stops
// the macro is not something the reader should have to go and find.
assert(current().diagnosisVersion === beforeReintake + 1 &&
  current().presetFile === null &&
  JSON.stringify(current().selectedFindings) ===
    JSON.stringify(current().diagnosis.findings.filter(function (finding) {
      return finding["class"] === "BLOCKER" || finding["class"] === "DEFECT";
    }).map(function (finding) { return String(finding.number); })),
"Diagnosis re-intake must increment the version, clear the repair input " +
  "and preselect exactly the mandatory findings.");

// A changed target environment invalidates the diagnosis identity and below.
store.setTargetEnvironment({name: "新しい業務端末"}, "ENVIRONMENT-V2");
assert(current().diagnosisRequestId === null && current().diagnosis === null &&
  current().presetFile === null,
"A changed canonical environment snapshot must drop diagnosis and downstream.");

// A new diagnosis request also drops everything at and below diagnosis.
commitDiagnosisRequest(DIAGNOSIS_ID_2);
assert(current().diagnosis === null && current().repairRequestId === null,
  "A new diagnosis identity cannot inherit downstream artifacts.");

// The concern is a draft until explicit rebuild; split toggling invalidates now.
store.setDiagnosisConcern("気になる点 A");
assert(store.isDiagnosisRequestDirty(),
  "Changed concern must mark the current diagnosis request dirty.");
commitDiagnosisRequest(DIAGNOSIS_ID_1);
assert(!store.isDiagnosisRequestDirty(),
  "A successful rebuild snapshots the concern.");
store.setDiagnosisSplit(true);
assert(current().diagnosisRequestId === null && current().diagnosisParts === null,
  "Toggling diagnosis split must invalidate request and received parts.");

// A fixed-path preset accepts only a branded, validated mapping and takes the
// one authorized branch from screen 4 to screen 7.
attach();
acceptDiagnosis(DIAGNOSIS_ID_1);
store.setRepairPreset({
  file: "01_マクロ改修\\\\02_改修\\\\03_path.md",
  name: "固定パスを新環境へ置き換える",
  content: "# path preset",
  parsed: {
    name: "固定パスを新環境へ置き換える",
    replaceRules: [{label: "ドライブ", pattern: "^[A-Za-z]:[\\\\/]", selectedByDefault: true}],
    questions: [],
    behaviorCandidates: [],
    preserveItems: [],
    output: null,
    splitOutput: null
  }
});
var pathApi = windowObject.MacroStudioPathMap;
var pathMapping = pathApi.detect(store.getBookModules(), store.getState().presetReplaceRules);
assert(!store.setPathMap(JSON.parse(JSON.stringify(pathMapping))),
  "State must reject an unbranded mapping look-alike.");
assert(store.setPathMap(pathMapping),
  "State must accept the product mapping contract.");
store.goTo(screens.repairInputScreen, false);
assert(!store.canGoNext(), "An unapplied mapping cannot branch.");
pathMapping = pathApi.updateRow(
  pathMapping,
  "C:\\old\\input.csv",
  {to: "D:\\new\\input.csv"});
assert(store.setPathMap(pathMapping) && store.canGoNext(),
  "One valid applied row must enable deterministic apply.");
assert(store.goNext() && current().screen === screens.reviewScreen,
  "The fixed-path engine must branch directly from repair input to review.");

// ---- actual back path and build lock ----

attach();
acceptDiagnosis(DIAGNOSIS_ID_1);
store.goTo(screens.diagnoseScreen, false);
store.goTo(screens.nextStepScreen, true);
chooseAiPreset();
store.goNext();
assert(current().screen === screens.repairInputScreen,
  "Repair input is visited after the work is chosen.");
assert(store.goBack() && current().screen === screens.nextStepScreen,
  "Back returns along the actual history stack.");

store.goTo(screens.buildScreen, false);
assert(!store.canGoBack() && !store.canGoNext(),
  "The build screen permits neither direction while it runs.");
store.goTo(screens.doneScreen, false);
assert(store.canGoBack() && !store.canGoNext() &&
  screens.canFinish(current(), screens.doneScreen),
"Done is terminal but may return to the actual previous state.");

// ---- leaving the completion screen does not undo the run ----
//
// The workbook, the diff report and the memo are on disk by the time this
// screen appears. Back used to clear buildResult, so an earlier screen
// showed no sign that any of it existed and [次へ] would have quietly
// built a second generation. Being able to go back and knowing the run
// finished are not in conflict; the state has to carry both.
store.setBuildConfirmation("20260803_120000");
store.setBuildResult({
  status: "ok",
  success: true,
  outputPath: "C:\\out\\book-Modified.xlsm",
  results: []
});
store.goTo(screens.doneScreen, false);
assert(current().buildResult !== null && current().buildTimestamp !== null,
  "The completion screen knows what was built.");
assert(store.goBack(), "Back off the completion screen is allowed.");
assert(current().screen !== screens.doneScreen,
  "Back actually leaves the completion screen.");
assert(current().buildResult !== null,
  "The created workbook still exists, so the run still knows it was made.");
assert(current().buildTimestamp !== null,
  "The stamp that names the created folder survives going back.");
assert(current().book !== null,
  "Going back does not drop the workbook the run is about.");

// Work that genuinely invalidates the output still clears it - the point
// is that walking backwards is not that kind of work.
store.setBuildConfirmation("20260803_130000");
assert(current().buildResult === null,
  "Starting another build clears the previous result.");

store.setBusyAction("writeRequestFiles");
assert(!store.canGoBack() && !store.canGoNext(),
  "A host transaction freezes navigation.");
store.setBusyAction(null);

// ---- more than one template may be chosen ----
// The reader may want two kinds of work in one round. Their instructions
// go into one request, so the chat is asked once for the whole job.

attach();
// The order the templates are offered in is the entrance's own order.
store.setEntrance({
  folder: "09_順序テスト",
  name: "順序テスト",
  valid: true,
  hasDiagnosis: true,
  diagnosisReady: true,
  choosesTemplate: true,
  diagnose: [],
  repair: [
    {file: "09_順序テスト\\02_改修\\01_win.md", content: "# a"},
    {file: "09_順序テスト\\02_改修\\02_path.md", content: "# b"},
    {file: "09_順序テスト\\02_改修\\03_refactor.md", content: "# c"}
  ]
});
acceptDiagnosis(DIAGNOSIS_ID_1);

function chooseTemplate(file, name, rules) {
  return store.setRepairPreset({
    file: file,
    name: name,
    content: "# " + name,
    parsed: {
      name: name,
      replaceRules: rules || null,
      questions: [],
      behaviorCandidates: [],
      preserveItems: [],
      instruction: rules ? null : {body: name + " の指示"},
      output: rules ? null : {body: "契約どおり返す"},
      splitOutput: null
    }
  });
}

chooseTemplate("09_順序テスト\\02_改修\\03_refactor.md", "リファクター");
chooseTemplate("09_順序テスト\\02_改修\\01_win.md", "Win32を外す");
assert(current().presetFiles.length === 2,
  "Two chat templates must both stay chosen: " +
  JSON.stringify(current().presetFiles));
assert(current().presetFiles[0] === "09_順序テスト\\02_改修\\01_win.md",
  "The chosen templates must keep the order they are offered in, not " +
  "the order they were ticked: " + JSON.stringify(current().presetFiles));
assert(current().presetName.indexOf("・") > 0,
  "The screen must name every template chosen: " + current().presetName);

chooseTemplate("09_順序テスト\\02_改修\\01_win.md", "Win32を外す");
assert(current().presetFiles.length === 1,
  "Ticking a chosen template again must remove it.");

// The one that asks for the replacement table sends nothing to a chat,
// so it sits alongside the ones that do: the chat answers first, the
// reply is taken in, and the replacements are made on what comes back.
chooseTemplate("09_順序テスト\\02_改修\\02_path.md", "置き換える", [
  {label: "ドライブ", pattern: "^[A-Za-z]:", selectedByDefault: true}
]);
assert(current().presetFiles.length === 2 &&
  current().presetReplaceRules !== null,
"The table must be choosable alongside a chat template: " +
  JSON.stringify(current().presetFiles));
assert(current().presetEngine === "AI",
  "A run with something to send is a chat run; the table is a stage " +
  "inside it, not a different kind of run.");

// On its own it is the whole run, and nothing is sent anywhere.
chooseTemplate("09_順序テスト\\02_改修\\03_refactor.md", "リファクター");
assert(current().presetFiles.length === 1 &&
  current().presetEngine === "対応表による置換",
"With nothing to send, the table is the run: " +
  JSON.stringify(current().presetFiles));

// ---- a run that does not diagnose ----
// Someone who already knows what to change should not have to stage a
// diagnosis they will not read. That used to be a checkbox on the
// diagnosis screen; it is the free-request entrance now, and the folder
// itself is what says so: no 01_診断, no diagnosis (SPEC §2.2.0).

assert(store.setDiagnosisSkipped === undefined,
  "The skip is a property of the entrance, not a switch on the run.");

store.reset();
store.setEntrance(freeEntrance);
assert(screens.isDiagnosisSkipped(current()),
  "The free-request entrance is a run that does not diagnose.");
assert(store.canGoNext() && store.goNext() &&
  current().screen === screens.bookScreen,
"The free-request entrance still starts by reading the workbook.");
store.setBook({
  name: "受注管理.xlsm", path: "C:\\work\\受注管理.xlsm", ext: ".xlsm",
  totalLines: 4
}, [{
  name: "Main", type: "standard", typeLabel: "標準モジュール", ext: "bas",
  lineCount: 4, code: "Option Explicit\r\n", attributes: ""
}]);
store.setTargetEnvironment({name: "新しい業務端末"}, "ENVIRONMENT-V1");
assert(store.canGoNext(), "An attached workbook is enough on its own here.");
// One template and no diagnosis: both the hand-over and the choice of
// work are pages this entrance never had anything to put on.
assert(store.goNext() && current().screen === screens.repairInputScreen,
  "The workbook must lead straight to the request, got screen " +
    current().screen);
assert(!store.canGoNext(),
  "With no findings and nothing written there is nothing to ask for.");
// The entrance's one template is what this run is; the screen ticks it
// on arrival, and the store is told the same way any choice is made.
chooseAiPreset();
store.setAnswer(0, "元の動作を優先");
store.setExtraRequest("待ち時間の処理を標準機能へ直してください。");
assert(store.canGoNext(),
  "What the reader wrote is the whole request when there is no diagnosis.");
assert(store.commitRepairRequest({requestId: REPAIR_ID_1, prompt: "p"}),
  "A run that does not diagnose must still mint a repair request.");

// And the diagnosing entrance keeps the findings page in the way.
store.reset();
store.setEntrance(macroEntrance);
assert(!screens.isDiagnosisSkipped(current()),
  "An entrance with a diagnosis folder is not a skipped run.");
assert(screens.nextIndex(current(), screens.diagnoseScreen) ===
  screens.findingsScreen,
"With a diagnosis asked for, the findings page is in the way.");

console.log("test-flow-state: PASS");
console.log("11-screen graph, three entrances and the routes their folders " +
  "open, ownership snapshots, invalidation, history and engine branch " +
  "behave as specified");
