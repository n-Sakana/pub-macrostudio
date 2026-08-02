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

["response-package.js", "diagnosis-package.js", "vba-lexer.js",
  "path-map.js", "screens.js", "state.js"]
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
    file: "02_改修\\01_refactor.md",
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

// ---- canonical 10-screen table and the only path branch ----
// Handing the request to the chat and taking the reply back is one piece
// of work, so each stage owns one screen instead of two. Reading the
// diagnosis and choosing the work are two decisions, so they are two.

assert(screens.count === 10, "The β2 flow must have ten screens.");
assert(screens.majors.length === 4, "Progress must always have four steps.");
assert(JSON.stringify(screens.getMajors({})) === JSON.stringify(screens.majors),
  "The visible progress must never change by route or state.");
assert(
  screens.bookScreen === 0 &&
  screens.diagnoseScreen === 1 &&
  screens.findingsScreen === 2 &&
  screens.nextStepScreen === 3 &&
  screens.repairInputScreen === 4 &&
  screens.repairScreen === 5 &&
  screens.reviewScreen === 6 &&
  screens.outputScreen === 7 &&
  screens.buildScreen === 8 &&
  screens.doneScreen === 9,
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

var straight = {presetEngine: "AI"};
for (var index = screens.bookScreen; index < screens.doneScreen; index += 1) {
  assert(screens.nextIndex(straight, index) === index + 1,
    "The AI route must not skip screen " + index + ".");
}
assert(screens.nextIndex(
  {presetEngine: "対応表による置換"},
  screens.repairInputScreen) === screens.reviewScreen,
"Only the fixed-path engine may branch from the repair input to review.");
assert(screens.nextIndex(
  {presetEngine: "AI", questions: []},
  screens.nextStepScreen) === screens.repairInputScreen &&
  screens.nextIndex(
    {presetEngine: "AI", questions: [{text: "Q"}]},
    screens.nextStepScreen) === screens.repairInputScreen,
"Questions change the repair input's content, not the graph.");
assert(screens.nextIndex(straight, screens.findingsScreen) ===
  screens.nextStepScreen,
"Reading the diagnosis leads to choosing the work, never past it.");

// ---- no hidden shortcut around diagnosis ----

attach();
assert(current().screen === screens.bookScreen,
  "The single entrance is the book screen.");
assert(store.startSimple === undefined && store.setMode === undefined,
  "The old simple and mode entrances must be gone.");
assert(store.canGoNext(), "An attached workbook enables diagnosis.");
assert(store.goNext() && current().screen === screens.diagnoseScreen,
  "Screen 0 can only lead to the diagnosis screen.");
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
  file: "02_改修\\03_path.md",
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

store.setBusyAction("writeRequestFiles");
assert(!store.canGoBack() && !store.canGoNext(),
  "A host transaction freezes navigation.");
store.setBusyAction(null);

// ---- more than one template may be chosen ----
// The reader may want two kinds of work in one round. Their instructions
// go into one request, so the chat is asked once for the whole job.

attach();
acceptDiagnosis(DIAGNOSIS_ID_1);
store.setAppInfo({
  version: "test",
  presets: {
    diagnose: [],
    repair: [
      {file: "02_改修\\01_win.md", content: "# a"},
      {file: "02_改修\\02_path.md", content: "# b"},
      {file: "02_改修\\03_refactor.md", content: "# c"}
    ]
  }
});

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

chooseTemplate("02_改修\\03_refactor.md", "リファクター");
chooseTemplate("02_改修\\01_win.md", "Win32を外す");
assert(current().presetFiles.length === 2,
  "Two chat templates must both stay chosen: " +
  JSON.stringify(current().presetFiles));
assert(current().presetFiles[0] === "02_改修\\01_win.md",
  "The chosen templates must keep the order they are offered in, not " +
  "the order they were ticked: " + JSON.stringify(current().presetFiles));
assert(current().presetName.indexOf("・") > 0,
  "The screen must name every template chosen: " + current().presetName);

chooseTemplate("02_改修\\01_win.md", "Win32を外す");
assert(current().presetFiles.length === 1,
  "Ticking a chosen template again must remove it.");

// The one that asks for the replacement table sends nothing to a chat,
// so it sits alongside the ones that do: the chat answers first, the
// reply is taken in, and the replacements are made on what comes back.
chooseTemplate("02_改修\\02_path.md", "置き換える", [
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
chooseTemplate("02_改修\\03_refactor.md", "リファクター");
assert(current().presetFiles.length === 1 &&
  current().presetEngine === "対応表による置換",
"With nothing to send, the table is the run: " +
  JSON.stringify(current().presetFiles));

// ---- a run that declares it wants no diagnosis ----
// Someone who already knows what to change should not have to stage a
// diagnosis they will not read. Skipping is a declared choice: it opens
// the way forward and steps over the page that would have nothing on it.

attach();
store.goNext();
commitDiagnosisRequest(DIAGNOSIS_ID_1);
assert(current().screen === screens.diagnoseScreen && !store.canGoNext(),
  "Without a diagnosis there is nothing to read.");
store.setDiagnosisSkipped(true);
assert(store.canGoNext(), "A declared skip must open the way forward.");
assert(screens.nextIndex(current(), screens.diagnoseScreen) ===
  screens.nextStepScreen,
"A skipped diagnosis must step over the findings page.");
assert(store.goNext() && current().screen === screens.nextStepScreen,
  "The skip must land on the choice of work.");
chooseAiPreset();
assert(store.goNext() && current().screen === screens.repairInputScreen,
  "A template may still be chosen without a diagnosis.");
assert(!store.canGoNext(),
  "With no findings and no request there is still nothing to ask for.");
store.setExtraRequest("待ち時間の処理を標準機能へ直してください。");
assert(!store.canGoNext(),
  "The template's own question is still required.");
store.setAnswer(0, "元の動作を優先");
assert(store.canGoNext(),
  "What the reader wrote is the whole request when there is no diagnosis.");
assert(store.commitRepairRequest({requestId: REPAIR_ID_1, prompt: "p"}),
  "A skipped run must still be able to mint a repair request.");

// Taking a diagnosis in again cancels the skip rather than living beside it.
attach();
commitDiagnosisRequest(DIAGNOSIS_ID_1);
store.setDiagnosisSkipped(true);
assert(store.commitDiagnosis(
  diagnosisPackage(DIAGNOSIS_ID_1), "diagnosis.md"),
  "A diagnosis may still arrive after a skip was declared.");
assert(!screens.isDiagnosisSkipped(current()),
  "A run holding a diagnosis is not a skipped run.");
assert(screens.nextIndex(current(), screens.diagnoseScreen) ===
  screens.findingsScreen,
"With a diagnosis present the findings page is back in the way.");

console.log("test-flow-state: PASS");
console.log("10-screen graph, single entrance, ownership snapshots, invalidation, " +
  "history and engine branch behave as specified");
