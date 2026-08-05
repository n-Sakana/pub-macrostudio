"use strict";

// An answer that changes nothing.
//
// Two things have to be true at once. An answer that says outright
// "there is nothing to change here, and this is why" is a result and
// must be taken: shown, explained, and open to being replaced. An
// answer that merely stops - empty, cut off, addressed to another
// request, missing its numbers - says nothing of the kind and must
// keep being refused. The gap between those two is the whole point,
// so most of what follows is the refusals.

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

// Enough of an element to build a screen out of and then read it back.
function createElementShim(tagName) {
  var element = {
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    id: "",
    rows: 0,
    checked: false,
    spellcheck: true,
    children: [],
    attributes: {},
    disabled: false,
    type: ""
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

function readText(element) {
  var text = element.textContent || "";

  element.children.forEach(function (child) {
    text += readText(child);
  });
  return text;
}

function findByAction(element, action, found) {
  var hits = found || [];

  if (element.getAttribute &&
      element.getAttribute("data-action") === action) {
    hits.push(element);
  }
  element.children.forEach(function (child) {
    findByAction(child, action, hits);
  });
  return hits;
}

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
windowObject.hostBridge = {
  request: function () {
    return Promise.resolve(null);
  },
  on: function () {
    return function () {
    };
  }
};

["icons.js", "components.js",
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

var api = windowObject.MacroStudioResponse;
var screens = windowObject.MacroStudioScreens;
var state = windowObject.MacroStudioState;
var app = windowObject.MacroStudioApp;
var workflow = windowObject.MacroStudioWorkflow;

var id = api.createRequestId();
var other = api.createRequestId();
var diagnosisId = "11111111-1111-4111-8111-111111111111";
var reason = [
  "対象の3モジュールを読みました。",
  "依頼にある保存先の切り替えは、すでに設定シートから読む形になっています。",
  "書き換える必要のある行はありませんでした。"
];

// ---- the answers this test sends ----

function lines(parts) {
  return parts.join("\r\n");
}

function summary(requestId, body) {
  return [api.summaryBeginLine(requestId)]
    .concat(body || reason)
    .concat([api.summaryEndLine(requestId)]);
}

function noChange(options) {
  var settings = options || {};
  var requestId = settings.requestId || id;
  var body = [];

  if (settings.summary !== false) {
    body = body.concat(summary(requestId, settings.reason));
  }
  if (settings.part) {
    body = body.concat([api.partLine(requestId, 0, 2)]);
  }
  if (settings.verdict !== false) {
    body = body.concat([
      api.noChangeLine(requestId, settings.verdict || "UNNECESSARY")
    ]);
  }
  if (settings.twice) {
    body = body.concat([api.noChangeLine(requestId, "IMPOSSIBLE")]);
  }
  if (settings.module) {
    body = body.concat([
      api.beginLine(requestId, "standard", "Main"),
      "Option Explicit",
      "Public Sub A(): End Sub",
      api.endLine(requestId, "standard", "Main")
    ]);
  }
  if (settings.complete !== false) {
    body = body.concat([
      api.completeLine(
        requestId,
        settings.complete === undefined ? 0 : settings.complete)
    ]);
  }
  return lines(body);
}

function wholeAnswer(requestId) {
  return lines(summary(requestId, ["まとめて直しました。"]).concat([
    api.beginLine(requestId, "standard", "Main"),
    "Option Explicit",
    "Public Sub A(): Beep: End Sub",
    api.endLine(requestId, "standard", "Main"),
    api.completeLine(requestId, 1)
  ]));
}

function partAnswer(requestId, index, total, name, withSummary) {
  var body = withSummary ? summary(requestId, ["直しました。"]) : [];

  return lines(body.concat([
    api.partLine(requestId, index, total),
    api.beginLine(requestId, "standard", name),
    "Option Explicit",
    "Public Sub P" + index + "(): Beep: End Sub",
    api.endLine(requestId, "standard", name),
    api.completeLine(requestId, 1)
  ]));
}

// ---- a run standing on the intake screen ----

function attach(requestId) {
  state.reset();
  state.setBook(
    {
      name: "受注管理.xlsm",
      path: "C:\\work\\受注管理.xlsm",
      ext: ".xlsm",
      totalLines: 4
    },
    [
      {
        name: "Main",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 2,
        code: "Option Explicit\r\nPublic Sub A(): End Sub\r\n",
        attributes: ""
      },
      {
        name: "Helper",
        type: "standard",
        typeLabel: "標準モジュール",
        ext: "bas",
        lineCount: 2,
        code: "Option Explicit\r\nPublic Sub B(): End Sub\r\n",
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
  state.setExtraRequest("保存先を切り替えられるようにしてください。");
  state.commitRepairRequest({requestId: requestId || id});
  state.goTo(screens.repairIntakeScreen, false);
}

function stuck() {
  return !screens.canAdvance(state.getState(), screens.repairIntakeScreen);
}

// ---- 1. the verdicts that are accepted ----

[
  ["UNNECESSARY", "改修は不要"],
  ["IMPOSSIBLE", "改修できない"]
].forEach(function (entry) {
  var screen;
  var text;

  attach();
  assert(
    workflow.applyRepairText(noChange({ verdict: entry[0] })),
    entry[0] + ": a declared result must be taken in.");
  assert(
    state.getState().noChangeResult !== null &&
      state.getState().noChangeResult.verdict === entry[0],
    entry[0] + ": the verdict must be kept as it was declared.");
  assert(
    screens.isNoChange(state.getState()),
    entry[0] + ": the screens must see the verdict.");
  assert(
    state.getState().noChangeResult.summary.indexOf(reason[1]) >= 0,
    entry[0] + ": the reason must be kept whole.");
  assert(
    state.getState().lastError === null,
    entry[0] + ": a declared result is not an error.");

  // Nothing was imported, so nothing can be built.
  assert(
    screens.countImported(state.getState()) === 0 &&
      screens.countChanged(state.getState()) === 0,
    entry[0] + ": a result with no modules must import none.");
  assert(
    stuck(),
    entry[0] + ": there is nothing to review, so [next] must not open.");
  assert(
    !screens.canAdvance(state.getState(), screens.reviewScreen) &&
      !screens.canAdvance(state.getState(), screens.outputScreen),
    entry[0] + ": neither the diff nor the build may become reachable.");

  // ...and the person is told which verdict it was, and why.
  screen = workflow.createRepairIntakeScreen(state.getState());
  text = readText(screen);
  assert(
    text.indexOf(entry[1]) >= 0,
    entry[0] + ": the screen must say which verdict it was: " + text);
  assert(
    text.indexOf(reason[1]) >= 0,
    entry[0] + ": the screen must show the reason the AI gave.");
  assert(
    findByAction(screen, "import-repair").length === 1,
    entry[0] + ": taking another answer instead must stay available.");
  assert(
    screens.get(screens.repairIntakeScreen).title(state.getState())
      .indexOf("改修できません") >= 0,
    entry[0] + ": the screen title must say what happened.");
});

// The two verdicts must not read the same, or the distinction the
// protocol makes would be lost on the way to the screen.
attach();
workflow.applyRepairText(noChange({ verdict: "UNNECESSARY" }));
var unnecessaryText = readText(workflow.createRepairIntakeScreen(state.getState()));
attach();
workflow.applyRepairText(noChange({ verdict: "IMPOSSIBLE" }));
var impossibleText = readText(workflow.createRepairIntakeScreen(state.getState()));
assert(
  unnecessaryText !== impossibleText,
  "The two verdicts must not be shown with the same words.");

// ---- 2. module-by-module runs take it too, without waiting ----

attach();
state.setSplitOutputRules({ title: "出力指示（モジュール単位）", body: "1つずつ。" });
assert(
  state.setSplitOutput(true) && screens.isSplitOutput(state.getState()),
  "The module-by-module option must be available for this check.");
state.commitRepairRequest({requestId: id});
assert(
  workflow.applyRepairText(noChange({})),
  "A declared result must be taken in the module-by-module run too.");
assert(
  screens.isNoChange(state.getState()),
  "The verdict must be seen the same way in either run.");
assert(
  state.getState().repairIntakeParts === null &&
    screens.getIntakePartTotal(state.getState()) === 0,
  "A declared result must not leave the run waiting for a module 00.");
assert(
  stuck(),
  "There is still nothing to build.");

// ---- 3. what is refused, and stays refused ----

[
  // The answer simply stopped: no verdict at all.
  ["truncated", noChange({ verdict: false }), "an unspoken zero"],
  // A verdict with nothing to close it.
  ["truncated", noChange({ complete: false }), "no COMPLETE line"],
  ["mismatch", noChange({ complete: "00" }), "a leading-zero count", "R1"],
  ["mismatch", noChange({ complete: "0.0" }), "a decimal count", "R1"],
  ["mismatch", noChange({ complete: "0x0" }), "a hexadecimal count", "R1"],
  ["mismatch", noChange({ complete: "0e0" }), "an exponent count", "R1"],
  // A verdict nobody can read.
  [
    "noChangeVerdict",
    noChange({ verdict: "MAYBE" }),
    "an unknown verdict"
  ],
  // A verdict with no reason behind it.
  [
    "noChangeReason",
    noChange({ summary: false }),
    "a verdict with no reason"
  ],
  [
    "noChangeReason",
    noChange({ reason: ["   ", ""] }),
    "a reason that is only blanks"
  ],
  // Saying both things at once.
  [
    "noChangeContradiction",
    noChange({ module: true, complete: 1 }),
    "a verdict sent with a module"
  ],
  // Someone else's answer.
  [
    "otherRequest",
    noChange({ requestId: other }),
    "another request's verdict"
  ],
  // A verdict that claims to be one of a numbered series.
  ["mismatch", noChange({ part: true }), "a verdict inside a part"],
  ["mismatch", noChange({ twice: true }), "two verdicts at once"],
  // Cut off in the middle of its own reason.
  [
    "truncated",
    lines([api.summaryBeginLine(id)].concat(reason)),
    "a reason that never ends"
  ],
  // Nothing at all.
  ["empty", "", "an empty clipboard"],
  ["noSentinel", "Sub A()\r\nEnd Sub", "code with no envelope"]
].forEach(function (entry) {
  var parsed = api.parse(entry[1], id);

  attach();
  assert(
    !parsed.ok && parsed.reason === entry[0],
    entry[2] + " must be refused as " + entry[0] +
      ", not " + (parsed.ok ? "accepted" : parsed.reason) + ".");
  if (entry[3]) {
    assert(
      parsed.validationId === entry[3],
      entry[2] + " must be identified as " + entry[3] + ".");
  }
  assert(
    !workflow.applyRepairText(entry[1]),
    entry[2] + " must not be taken in.");
  assert(
    state.getState().noChangeResult === null &&
      !screens.isNoChange(state.getState()),
    entry[2] + " must never become a declared result.");
  assert(
    screens.countImported(state.getState()) === 0 && stuck(),
    entry[2] + " must leave the run where it was.");
  assert(
    state.getState().lastError !== null,
    entry[2] + " must be reported as a refusal.");
});

// A gap in a module-by-module run is still a gap, not a zero.
attach();
state.setSplitOutputRules({ title: "出力指示（モジュール単位）", body: "1つずつ。" });
state.setSplitOutput(true);
state.commitRepairRequest({requestId: id});
assert(
  workflow.applyRepairText(partAnswer(id, 0, 2, "Main", true)),
  "The first module of a series must be accepted.");
assert(
  !screens.isNoChange(state.getState()) &&
    screens.countImported(state.getState()) === 0 &&
    stuck(),
  "One module of two is not a finished answer and not a zero either.");
assert(
  screens.countIntakeParts(state.getState()) === 1 &&
    api.listMissingParts(state.getState().repairIntakeParts).length === 1,
  "The missing module must still be reported as missing.");

// ---- 4. one result replaces the other, both ways round ----

attach();
assert(
  workflow.applyRepairText(wholeAnswer(id)) &&
    screens.countImported(state.getState()) > 0,
  "A normal answer must still be imported.");
assert(
  !screens.canAdvance(state.getState(), screens.repairIntakeScreen) === false,
  "A normal answer must open the way to the review screen.");
assert(
  workflow.applyRepairText(noChange({})),
  "A verdict arriving after a package must be taken.");
assert(
  screens.countImported(state.getState()) === 0 &&
    screens.countChanged(state.getState()) === 0 &&
    stuck(),
  "The package it replaced must not survive into the build.");

assert(
  workflow.applyRepairText(wholeAnswer(id)),
  "A package arriving after a verdict must be taken.");
assert(
  !screens.isNoChange(state.getState()) &&
    state.getState().noChangeResult === null,
  "The verdict it replaced must be gone.");
assert(
  screens.countImported(state.getState()) > 0 &&
    !stuck(),
  "The run must be able to go on again.");

// The two cannot both be in hand - taking one clears the other - but
// the gate must not be leaning on that. Even with a package still
// imported, a verdict closes the way forward on its own.
attach();
workflow.applyRepairText(wholeAnswer(id));
assert(
  !stuck() && screens.countChanged(state.getState()) > 0,
  "A package alone must open the way forward.");
state.getState().noChangeResult = {
  verdict: "UNNECESSARY",
  summary: reason.join("\r\n"),
  requestId: state.getState().repairRequestId
};
assert(
  stuck(),
  "A declared zero must close the way forward by itself, whatever " +
    "else happens to be in hand.");

// A verdict belongs to the request it answered. A new request leaves it.
attach();
workflow.applyRepairText(noChange({}));
assert(
  screens.isNoChange(state.getState()),
  "The verdict must be current while its request is.");
state.commitRepairRequest({requestId: other});
assert(
  !screens.isNoChange(state.getState()),
  "A new request must not inherit the previous verdict.");

// ---- 5. the ordinary answers are untouched ----

attach();
assert(
  workflow.applyRepairText(wholeAnswer(id)),
  "One paste with one module must still work.");
assert(
  screens.countImported(state.getState()) === 1 &&
    screens.countChanged(state.getState()) === 1 &&
    !screens.isNoChange(state.getState()) &&
    !stuck(),
  "One paste must still reach the review screen.");

attach();
state.setSplitOutputRules({ title: "出力指示（モジュール単位）", body: "1つずつ。" });
state.setSplitOutput(true);
state.commitRepairRequest({requestId: id});
assert(
  workflow.applyRepairText(partAnswer(id, 0, 2, "Main", true)) &&
    workflow.applyRepairText(partAnswer(id, 1, 2, "Helper", false)),
  "Module by module must still work.");
assert(
  screens.countImported(state.getState()) === 2 &&
    !screens.isNoChange(state.getState()) &&
    !stuck(),
  "A complete series must still reach the review screen.");

// The parser keeps saying so on the ordinary answers as well.
assert(
  api.parse(wholeAnswer(id), id).noChange === null &&
    api.parse(partAnswer(id, 0, 2, "Main", true), id).noChange === null,
  "An answer that carries modules is never a declared zero.");

// ---- 6. the templates carry the instruction, the app does not ----

var repairPresetDir = path.join(root, "presets", "02_改修");
var refactorPresets = fs.readdirSync(repairPresetDir)
  .filter(function (name) {
    return path.extname(name).toLowerCase() === ".md";
  })
  .map(function (name) {
    var text = fs.readFileSync(
      path.join(repairPresetDir, name),
      "utf8");

    return { name: name, text: text.charCodeAt(0) === 0xFEFF
      ? text.slice(1)
      : text };
  })
  .filter(function (entry) {
    return entry.text.indexOf("MACROSTUDIO") >= 0;
  });

assert(
  refactorPresets.length > 0,
  "At least one preset must carry the answer format.");
refactorPresets.forEach(function (entry) {
  var whole = entry.text.split("## 出力指示（モジュール単位）");

  assert(
    entry.text.indexOf("NOCHANGE") >= 0,
    entry.name + " must tell the AI how to report a zero.");
  api.verdicts.forEach(function (verdict) {
    assert(
      entry.text.indexOf(verdict) >= 0,
      entry.name + " must name the " + verdict + " verdict.");
  });
  assert(
    whole.length === 2 &&
      whole[0].indexOf("NOCHANGE") >= 0 &&
      whole[1].indexOf("NOCHANGE") >= 0,
    entry.name +
      " must carry the instruction in both ways of answering.");
});

// The wording that tells the AI how to answer belongs to the templates.
// The app must not carry a second copy of it to drift from.
var appSource = fs.readFileSync(
  path.join(root, "assets", "js", "app.js"),
  "utf8");
var responseSource = fs.readFileSync(
  path.join(root, "assets", "js", "response-package.js"),
  "utf8");
var workflowSource = fs.readFileSync(
  path.join(root, "assets", "js", "screens", "workflow.js"),
  "utf8");

assert(
  appSource.indexOf("NOCHANGE") < 0,
  "The instruction text must not be duplicated into app.js.");
assert(
  responseSource.indexOf("UNNECESSARY") >= 0 &&
    workflowSource.indexOf("UNNECESSARY") >= 0,
  "The verdict names are protocol, and are read where they are used.");
[
  "直すところが無いと判断したとき",
  "モジュールを 1 つも書かず"
].forEach(function (sentence) {
  assert(
    appSource.indexOf(sentence) < 0 &&
      workflowSource.indexOf(sentence) < 0 &&
      responseSource.indexOf(sentence) < 0,
    "The template's own sentences must not be copied into the app: " +
      sentence);
});

console.log("test-no-change: PASS");
console.log(
  "declared zero results are taken and explained; unspoken, cut off, " +
  "numbered and foreign ones are still refused");
