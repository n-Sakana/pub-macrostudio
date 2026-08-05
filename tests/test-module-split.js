"use strict";

// The optional way of answering: one module per reply, for macros whose
// code is too long to come back in a single answer.
//
// The request side (which rules the prompt carries), the intake side
// (collecting the parts and merging them into one package) and the
// refusals (a foreign request, a missing number, a contradicting repeat,
// several modules at once, and a part pasted while the option is off)
// are all checked here. The default one-paste route is checked as well,
// so turning the option off changes nothing about it.

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

function readUtf8(filePath) {
  var text = fs.readFileSync(filePath, "utf8");

  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

function flatten(text) {
  return String(text).replace(/\r?\n[ \t]*/g, "");
}

var windowObject = {};
// app.js is loaded too, so the intake can be driven the way the button
// drives it. Nothing is rendered here and nothing reaches the host: the
// screens are checked in tests\test-audit-fixes.js.
var context = vm.createContext({
  window: windowObject,
  document: {
    createElement: function () {
      return {
        setAttribute: function () {
        },
        appendChild: function () {
        },
        classList: {
          add: function () {
          },
          toggle: function () {
          }
        }
      };
    },
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
  "prompt-template.js",
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

var presetApi = windowObject.MacroStudioPreset;
var promptApi = windowObject.MacroStudioPrompt;
var api = windowObject.MacroStudioResponse;
var screens = windowObject.MacroStudioScreens;
var state = windowObject.MacroStudioState;
var app = windowObject.MacroStudioApp;
var workflow = windowObject.MacroStudioWorkflow;

var id = api.createRequestId();
var other = api.createRequestId();
var diagnosisId = "11111111-1111-4111-8111-111111111111";

function part(requestId, index, total, module, options) {
  var settings = options || {};
  var lines = [];

  if (settings.summary) {
    lines.push(api.summaryBeginLine(requestId));
    lines.push(settings.summary);
    lines.push(api.summaryEndLine(requestId));
  }
  if (!settings.skipPart) {
    lines.push(api.partLine(requestId, index, total));
  }
  [].concat(module).forEach(function (item) {
    lines.push(api.beginLine(requestId, item.kind, item.name));
    lines.push(item.code);
    lines.push(api.endLine(requestId, item.kind, item.name));
  });
  lines.push(api.completeLine(
    requestId,
    settings.count === undefined
      ? [].concat(module).length
      : settings.count));
  return lines.join("\r\n");
}

var main = {
  name: "Main",
  kind: "standard",
  code: "Option Explicit\r\nPublic Sub Run()\r\n    Beep\r\nEnd Sub"
};
var helper = {
  name: "Helper",
  kind: "class",
  code: "Option Explicit\r\nPrivate value As Long"
};
var added = {
  name: "CompatHelpers",
  kind: "standard",
  code: "Option Explicit\r\nPublic Sub Wait(): End Sub"
};

// ---- the part sentinel ----

var firstParsed = api.parse(
  part(id, 0, 3, main, { summary: "Main を直しました。" }),
  id);

assert(
  firstParsed.ok,
  "A part must parse: " + firstParsed.message);
assert(
  firstParsed.part &&
    firstParsed.part.index === 0 &&
    firstParsed.part.total === 3,
  "The part sentinel must carry its number and the total.");
assert(
  firstParsed.modules.length === 1 &&
    firstParsed.modules[0].code === main.code,
  "A part carries exactly the one module it names.");
assert(
  firstParsed.summary === "Main を直しました。",
  "A part may carry the summary.");
assert(
  api.partLine(id, 0, 3) ===
    "'@MACROSTUDIO " + id + " PART 00 OF 03",
  "The part sentinel is written with two digit numbers.");

["1.0", "01"].forEach(function (count) {
  var invalid = api.parse(
    part(id, 0, 3, main, { count: count }),
    id);

  assert(
    !invalid.ok && invalid.validationId === "R1",
    "COMPLETE " + count +
      " must be refused while PART keeps its existing numbering.");
});

// A whole answer has no part sentinel at all.
assert(
  api.parse(
    [
      api.beginLine(id, "standard", "Main"),
      main.code,
      api.endLine(id, "standard", "Main"),
      api.completeLine(id, 1)
    ].join("\r\n"),
    id).part === null,
  "A one-block answer must not claim to be a part.");

// Malformed part sentinels are refused, not guessed at.
[
  { label: "no OF keyword", text: "'@MACROSTUDIO " + id + " PART 00 03" },
  { label: "number past the total", text: api.partLine(id, 3, 3) },
  { label: "a total of zero", text: api.partLine(id, 0, 0) },
  { label: "a number that is not one", text: "'@MACROSTUDIO " + id + " PART x OF 03" }
].forEach(function (item) {
  var text = [
    item.text,
    api.beginLine(id, "standard", "Main"),
    main.code,
    api.endLine(id, "standard", "Main"),
    api.completeLine(id, 1)
  ].join("\r\n");
  var result = api.parse(text, id);

  assert(
    !result.ok && result.reason === "partShape",
    "This part sentinel must be refused: " + item.label);
});

assert(
  !api.parse(
    [
      api.partLine(id, 0, 3),
      api.partLine(id, 1, 3),
      api.beginLine(id, "standard", "Main"),
      main.code,
      api.endLine(id, "standard", "Main"),
      api.completeLine(id, 1)
    ].join("\r\n"),
    id).ok,
  "Two part sentinels in one answer must be refused.");

// ---- collecting the parts ----

var collection = api.createPartCollection();
var step = api.addPart(collection, api.parse(
  part(id, 0, 3, main, { summary: "Main を直しました。" }),
  id));

assert(step.ok && step.added, "The first part must be collected.");
assert(!step.complete, "One of three parts is not the whole answer.");
assert(
  step.missing.join(",") === "1,2",
  "What is still missing must be named: " + step.missing.join(","));
assert(
  api.describeMissingParts(step.collection).indexOf("01") >= 0 &&
    api.describeMissingParts(step.collection).indexOf("02") >= 0,
  "The outstanding numbers must be said in plain words.");

step = api.addPart(step.collection, api.parse(part(id, 2, 3, added), id));
assert(
  step.ok && step.added && !step.complete,
  "Parts may arrive out of order.");
assert(
  step.missing.join(",") === "1",
  "Only the part that has not arrived is missing.");

// The same part again, saying exactly the same thing, changes nothing.
var repeat = api.addPart(
  step.collection,
  api.parse(part(id, 2, 3, added), id));

assert(
  repeat.ok && !repeat.added && !repeat.complete,
  "An identical repeat must be accepted without adding anything.");
assert(
  repeat.collection.parts.length === 2,
  "An identical repeat must not grow the collection.");

step = api.addPart(step.collection, api.parse(part(id, 1, 3, helper), id));
assert(step.ok && step.complete, "The last part completes the answer.");
assert(
  step.missing.length === 0,
  "A complete answer has nothing missing.");

var merged = api.mergeParts(step.collection);

assert(merged.ok, "A complete collection must merge.");
assert(
  merged.modules.map(function (item) {
    return item.name;
  }).join(",") === "Main,Helper,CompatHelpers",
  "The merged package keeps the order the numbers gave.");
assert(
  merged.modules.map(function (item) {
    return item.kind;
  }).join(",") === "standard,class,standard",
  "Each module keeps the kind its own part gave.");
assert(
  merged.modules[0].code === main.code &&
    merged.modules[2].code === added.code,
  "The merged package carries every part's code unchanged.");
assert(
  merged.summary === "Main を直しました。",
  "The summary of the parts reaches the merged package.");
assert(
  merged.part === null,
  "The merged package is a whole answer, not a part.");

// An incomplete collection is not a package.
assert(
  !api.mergeParts(api.createPartCollection()).ok,
  "An empty collection must not merge.");
assert(
  !api.isPartCollectionComplete(
    api.addPart(
      api.createPartCollection(),
      api.parse(part(id, 0, 2, main), id)).collection),
  "A collection missing a number is not complete.");

// ---- what the collection refuses ----

var seeded = api.addPart(
  api.createPartCollection(),
  api.parse(part(id, 0, 3, main), id)).collection;

[
  {
    label: "an answer to another request",
    parsed: api.parse(part(other, 1, 3, helper), id),
    reason: "otherRequest"
  },
  {
    label: "an answer with no number",
    parsed: api.parse(part(id, 1, 3, helper, { skipPart: true }), id),
    reason: "partMissing"
  },
  {
    label: "several modules in one answer",
    parsed: api.parse(part(id, 1, 3, [helper, added]), id),
    reason: "partMultipleModules"
  },
  {
    label: "a different total",
    parsed: api.parse(part(id, 1, 4, helper), id),
    reason: "partTotalMismatch"
  },
  {
    label: "the same number with other content",
    parsed: api.parse(part(id, 0, 3, helper), id),
    reason: "partConflict"
  },
  {
    label: "the same module under another number",
    parsed: api.parse(part(id, 1, 3, main), id),
    reason: "partDuplicateModule"
  }
].forEach(function (item) {
  var result = api.addPart(seeded, item.parsed);

  assert(
    !result.ok,
    "This must be refused: " + item.label);
  assert(
    result.reason === item.reason,
    "Wrong reason for " + item.label + ": " + result.reason);
  assert(
    result.message.length > 0 &&
      result.message.indexOf("undefined") < 0,
    "A refusal must carry a readable message: " + item.label);
  assert(
    result.collection.parts.length === 1 &&
      result.collection.parts[0].name === "Main",
    "A refused part must leave the collection as it was: " + item.label);
});

// ---- the preset carries the rules for both ways of answering ----

var presetDir = path.join(root, "presets", "02_改修");
var presets = fs.readdirSync(presetDir).filter(function (name) {
  return path.extname(name).toLowerCase() === ".md";
}).map(function (name) {
  return {
    file: path.join("02_改修", name),
    content: readUtf8(path.join(presetDir, name))
  };
});
var entries = presetApi.describeAll(presets, "repair");
var splitEntries = entries.filter(function (entry) {
  return entry.valid && entry.splitOutput !== null;
});

assert(
  splitEntries.length >= 1,
  "At least one shipped preset must offer the module-by-module rules.");
splitEntries.forEach(function (entry) {
  var body = flatten(entry.splitOutput.body);

  assert(
    entry.stage === "repair",
    "Only a preset that changes the workbook can split its answer: " +
      entry.file);
  assert(
    entry.splitOutput.title === presetApi.splitOutputTitle,
    "The split section keeps its heading: " + entry.file);
  assert(
    body.indexOf("1 回の返答につき 1 つだけ") >= 0,
    "Preset " + entry.file + " must ask for one module per answer.");
  assert(
    body.indexOf("すべてのモジュールを 1 回の返答にまとめないでください") >= 0,
    "Preset " + entry.file +
      " must forbid answering with every module at once.");
  assert(
    body.indexOf("{{REQUEST_ID}} PART <番号> OF <合計>") >= 0,
    "Preset " + entry.file + " must carry the part sentinel.");
  assert(
    body.indexOf("{{REQUEST_ID}} BEGIN") >= 0 &&
      body.indexOf("{{REQUEST_ID}} END") >= 0 &&
      body.indexOf("{{REQUEST_ID}} COMPLETE 1") >= 0,
    "Preset " + entry.file +
      " must carry the begin, end and per-answer complete sentinels.");
  assert(
    body.indexOf("次のモジュール 01 を出してよいですか") >= 0,
    "Preset " + entry.file +
      " must have the AI ask before sending the next module.");
  assert(
    body.indexOf("00、01、02") >= 0,
    "Preset " + entry.file + " must number the modules from 00.");
  [
    "一字一句",
    "省略せず全文",
    "Attribute VB_",
    "standard / class / form / document",
    "新しく増やすモジュールは、必ず standard"
  ].forEach(function (phrase) {
    assert(
      body.indexOf(phrase) >= 0,
      "Preset " + entry.file +
        " loses this rule when the answer is split: " + phrase);
  });
  assert(
    /チャット(の)?本文/.test(body) &&
      body.indexOf("では返さないでください") >= 0,
    "Preset " + entry.file +
      " must still require the answer in the chat body.");
});

// The wording stays in the preset file. Nothing that builds the prompt
// may hold a copy of it to fall back on.
[
  {
    label: "request template",
    text: readUtf8(path.join(root, "templates", "request-template.txt"))
  },
  {
    label: "prompt-template.js",
    text: readUtf8(path.join(root, "assets", "js", "prompt-template.js"))
  },
  {
    label: "preset-document.js",
    text: readUtf8(path.join(root, "assets", "js", "preset-document.js"))
  },
  {
    label: "response-package.js",
    text: readUtf8(path.join(root, "assets", "js", "response-package.js"))
  },
  {
    label: "app.js",
    text: readUtf8(path.join(root, "assets", "js", "app.js"))
  }
].forEach(function (item) {
  [
    "1 回の返答につき",
    "PART <番号> OF <合計>",
    "次のモジュール 01 を出してよいですか"
  ].forEach(function (phrase) {
    assert(
      item.text.indexOf(phrase) < 0,
      "The split output rules must not be duplicated in " +
        item.label + ": " + phrase);
  });
});

// A preset without the section simply does not offer the option.
var plainPreset = presetApi.parse([
  "# 名前",
  "",
  "## 分類",
  "",
  "試験用の操作",
  "",
  "## 改修指示",
  "本文",
  "",
  "## 出力指示",
  "出力"
].join("\n"), "repair");

assert(
  plainPreset.valid && plainPreset.splitOutput === null,
  "A preset without the split section stays valid and offers nothing.");
assert(
  !presetApi.parse([
    "# 名前",
    "",
    "## 分類",
    "",
    "試験用の操作",
    "",
    "## 改修指示",
    "本文",
    "",
    "## 出力指示",
    "出力",
    "",
    "## " + presetApi.splitOutputTitle
  ].join("\n"), "repair").valid,
  "An empty split section is a mistake, not an option.");

// ---- which rules the prompt carries ----

var splitEntry = splitEntries[0];
var template = readUtf8(
  path.join(root, "templates", "request-template.txt"));

function buildPrompt(outputRules) {
  return promptApi.buildRequestPrompt({
    template: template,
    requestText: "整理してください。",
    outputRules: outputRules,
    requestId: id,
    codeFileName: "source-code.md",
    book: { name: "book.xlsm", totalLines: 12 },
    modules: [
      {
        name: "Main",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 12,
        code: "Option Explicit\n"
      }
    ]
  });
}

var wholePrompt = buildPrompt({
  title: splitEntry.output.title,
  body: splitEntry.output.body.split("{{REQUEST_ID}}").join(id)
});
var splitPrompt = buildPrompt({
  title: splitEntry.splitOutput.title,
  body: splitEntry.splitOutput.body.split("{{REQUEST_ID}}").join(id)
});

assert(
  wholePrompt.indexOf("PART") < 0,
  "The default request must not ask for numbered parts.");
assert(
  splitPrompt.indexOf(
    "'@MACROSTUDIO " + id + " PART <番号> OF <合計>") >= 0,
  "The split request must carry the part sentinel of this request.");
assert(
  splitPrompt.indexOf("【" + presetApi.splitOutputTitle + "】") >= 0,
  "The split request names the rules it is carrying.");
assert(
  splitPrompt.indexOf("{{") < 0,
  "No placeholder may survive into the generated prompt.");

// ---- the option, and the gate it puts on the intake ----

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
        type: "class",
        typeLabel: "クラスモジュール",
        ext: "cls",
        lineCount: 2,
        code: "Option Explicit\r\n",
        attributes: ""
      }
    ]);
  state.setTargetEnvironment({displayName: "test", revision: "1"}, "ENV");
  state.commitDiagnosisRequest({requestId: diagnosisId});
  state.commitDiagnosis(contracts.diagnosis(
    windowObject.MacroStudioDiagnosis,
    {requestId: diagnosisId, modules: state.getState().modules}),
  "diagnosis.md");
  state.setRepairPreset({
    file: "02_改修\\\\sample.md",
    name: "ひな形",
    content: "preset",
    parsed: {
      engine: "AI", questions: [], behaviorCandidates: [], preserveItems: [],
      output: {title: "出力指示", body: "まとめて返す。"},
      splitOutput: null
    }
  });
  state.setExtraRequest("整理してください。");
  state.commitRepairRequest({requestId: id});
}

attach();
assert(
  state.getState().splitOutput === false,
  "The one-paste route is what a run starts with.");
assert(
  !state.setSplitOutput(true),
  "Without a preset that carries the rules there is no option to set.");
assert(
  state.getState().splitOutput === false,
  "Turning on an option the preset does not offer must change nothing.");

state.setSplitOutputRules({
  title: presetApi.splitOutputTitle,
  body: "1つずつ返す。"
});
assert(
  state.setSplitOutput(true) && state.getState().splitOutput === true,
  "A preset that carries the rules makes the option available.");
assert(state.getState().repairRequestId === null,
  "Changing answer shape must invalidate the old repair request.");
state.commitRepairRequest({requestId: id});
assert(
  screens.isSplitOutput(state.getState()),
  "The screens must see the chosen way of answering.");

state.goTo(screens.repairIntakeScreen, false);
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "Nothing has arrived, so there is nothing to review.");

var partial = api.addPart(
  state.getState().repairIntakeParts || api.createPartCollection(),
  api.parse(part(id, 0, 2, main), id));

state.setRepairIntakeParts(partial.collection);
assert(
  screens.countIntakeParts(state.getState()) === 1 &&
    screens.getIntakePartTotal(state.getState()) === 2,
  "The screens must see how much of the answer is in.");
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "A missing module must hold the flow on the intake screen.");
assert(
  screens.countIntakeParts(state.getState()) === 1,
  "The intake screen must say how many parts are in.");

var complete = api.addPart(
  state.getState().repairIntakeParts,
  api.parse(part(id, 1, 2, added), id));

assert(complete.complete, "Both parts make the whole answer.");
state.setRepairIntakeParts(complete.collection);
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "Collecting the parts is not importing them.");

var mergedPackage = api.mergeParts(complete.collection);
var described = api.describe(
  mergedPackage,
  state.getBookModules());

state.importPackage(described);
assert(
  screens.countImported(state.getState()) === 2,
  "The merged answer must come in as one package.");
assert(
  screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "A complete answer lets the flow reach the review.");
assert(
  state.findModule("CompatHelpers").isNew === true &&
    state.findModule("CompatHelpers").type === "standard",
  "A module a part added joins as a standard module.");
assert(
  state.goNext() &&
    state.getState().screen === screens.reviewScreen,
  "The split answer joins the ordinary review screen.");

// Turning the option off again drops what was collected under it: the
// two ways of answering never mix.
state.setSplitOutput(false);
assert(
  state.getState().splitOutput === false &&
    state.getState().repairIntakeParts === null &&
    screens.countImported(state.getState()) === 0,
  "Changing the way of answering must empty the intake.");

// ---- taking the parts in, the way the button does ----

function startSplitRun() {
  attach();
  state.setSplitOutputRules({
    title: presetApi.splitOutputTitle,
    body: "1つずつ返す。"
  });
  state.setSplitOutput(true);
  state.commitRepairRequest({requestId: id});
  state.goTo(screens.repairIntakeScreen, false);
}

startSplitRun();
assert(
  workflow.applyRepairText(part(id, 0, 3, main, { summary: "要約" })),
  "The first part must be taken in.");
assert(
  screens.countImported(state.getState()) === 0,
  "One part of three is not a package yet.");
assert(
  screens.countIntakeParts(state.getState()) === 1,
  "The first part must be kept.");

assert(
  !workflow.applyRepairText(part(id, 1, 4, helper)),
  "A part that declares another total must be refused.");
assert(
  screens.countIntakeParts(state.getState()) === 1,
  "A refused part must leave the collection as it was.");
assert(
  !workflow.applyRepairText(part(other, 1, 3, helper)),
  "A part answering another request must be refused.");
assert(
  !workflow.applyRepairText(part(id, 1, 3, [helper, added])),
  "Two modules in one answer must be refused.");
assert(
  !workflow.applyRepairText(part(id, 0, 3, helper)),
  "The same number with other content must be refused.");
assert(
  screens.countIntakeParts(state.getState()) === 1 &&
    screens.countImported(state.getState()) === 0,
  "No refusal may change what has been collected.");

assert(
  workflow.applyRepairText(part(id, 1, 3, helper)),
  "The second part must be taken in.");
assert(
  screens.countImported(state.getState()) === 0,
  "Two parts of three are still not a package.");
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "An incomplete answer must not reach the review.");

assert(
  workflow.applyRepairText(part(id, 2, 3, added)),
  "The last part completes the answer.");
assert(
  screens.countImported(state.getState()) === 3,
  "A complete answer comes in as one package of three modules.");
assert(
  screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "A complete answer lets the flow continue.");
assert(
  state.getState().intakeResult.summary === "要約",
  "The summary the first part carried must reach the result.");
assert(
  state.findModule("Helper").type === "class",
  "The workbook still decides the kind of a module it already has.");
assert(
  app.createBuildModules(state.getState()).length === 3,
  "Every module of the merged answer reaches the build payload.");

// Starting over empties the collection, so module 00 can arrive again.
assert(workflow.restartRepairIntake(), "The intake must be able to start over.");
assert(
  screens.countImported(state.getState()) === 0 &&
    state.getState().repairIntakeParts === null,
  "Starting over must leave nothing of the previous parts.");
assert(
  workflow.applyRepairText(part(id, 0, 2, main)),
  "After starting over, module 00 is taken in again.");
assert(
  screens.getIntakePartTotal(state.getState()) === 2,
  "A fresh collection takes the total the new parts declare.");

// ---- the two ways of answering do not mix ----

// With the option off a numbered part is refused instead of being taken
// in as if it were the whole answer.
attach();
state.goTo(screens.repairIntakeScreen, false);
assert(
  !workflow.applyRepairText(part(id, 0, 3, main)),
  "A part must not pass as a whole answer.");
assert(
  screens.countImported(state.getState()) === 0,
  "A refused part must import nothing.");
assert(
  state.getState().lastError.code === "E-INTAKE-01",
  "A refused part is an intake refusal like any other.");

// The default route is unchanged: one paste, every module at once.
assert(
  workflow.applyRepairText([
    api.beginLine(id, "standard", "Main"),
    main.code,
    api.endLine(id, "standard", "Main"),
    api.beginLine(id, "class", "Helper"),
    helper.code,
    api.endLine(id, "class", "Helper"),
    api.completeLine(id, 2)
  ].join("\r\n")),
  "The one-paste route must still take a whole answer in one press.");
assert(
  screens.countImported(state.getState()) === 2 &&
    screens.canAdvance(state.getState(), screens.repairIntakeScreen),
  "One paste must still be enough to reach the review.");

console.log("test-module-split: PASS");
console.log(
  "the part sentinel, collecting and merging the parts, every refusal, " +
  "the preset that owns the wording and the gate on the intake behave " +
  "as specified");
