"use strict";

// What the read warning is allowed to say.
//
// The host reports one boolean plus a breakdown of which findings fired.
// The screen has to keep those two apart: a source that may be cut short
// is the only case that asks the user to compare the code, and a workbook
// whose internal bookkeeping merely breaks the spec must not be dressed
// up as the same thing.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  document: {
    createElement: dom.createElement,
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
  "response-package.js",
  "screens.js",
  "state.js",
  "screens/workflow.js",
  "app.js"
].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", name),
      "utf8"),
    context,
    { filename: name });
});

var app = windowObject.MacroStudioApp;
var workflow = windowObject.MacroStudioWorkflow;

function attachData(warning, read) {
  return {
    book: { name: "book.xlsm", path: "C:\\work\\book.xlsm" },
    modules: [],
    warning: warning,
    read: read
  };
}

// ---- a clean read says nothing ----

assert(
  app.describeReadResult(attachData(false, { level: "clean" })) === null,
  "A workbook that read cleanly must produce no message.");
assert(
  app.getAttachWarningMessage(attachData(false, { level: "clean" })) === "",
  "A clean read must leave the toast alone.");
assert(
  app.describeReadResult(null) === null &&
    app.describeReadResult({}) === null,
  "Without an attach result there is nothing to report.");

// ---- source in doubt: say so plainly and name the modules ----

var doubt = app.describeReadResult(attachData(true, {
  level: "sourceDoubt",
  partialModules: ["TimerUtils"],
  unreadableModules: ["WindowUtils"],
  recoveredOffsetModules: [],
  containerFallback: false,
  salvaged: false,
  shortStream: true
}));

assert(doubt !== null, "A source in doubt must be reported.");
assert(
  doubt.level === "sourceDoubt" && doubt.tone === "warning",
  "A source in doubt is the case that warrants a caution.");
assert(
  doubt.headline.indexOf("バイナリレベルで読み取れませんでした") >= 0,
  "The wording must stay the careful one, without a claimed cause.");
assert(
  doubt.detail.indexOf("改修前後のコードを確認してください") >= 0,
  "A source in doubt must ask for the code to be compared.");
assert(
  doubt.detail.indexOf("TimerUtils") >= 0 &&
    doubt.detail.indexOf("WindowUtils") >= 0,
  "The modules that are in doubt must be named: " + doubt.detail);

// Every finding that touches the source reaches the same level.
[
  { partialModules: ["Main"] },
  { unreadableModules: ["Main"] },
  { salvaged: true },
  { shortStream: true }
].forEach(function (finding) {
  var read = {
    level: "sourceDoubt",
    partialModules: finding.partialModules || [],
    unreadableModules: finding.unreadableModules || [],
    recoveredOffsetModules: [],
    containerFallback: false,
    salvaged: finding.salvaged === true,
    shortStream: finding.shortStream === true
  };
  var described = app.describeReadResult(attachData(true, read));

  assert(
    described.level === "sourceDoubt" && described.tone === "warning",
    "This finding must reach the source level: " +
      JSON.stringify(finding));
});

// Without a breakdown from the host nothing can be separated, so the
// careful wording is what gets used.
var noBreakdown = app.describeReadResult(attachData(true, null));

assert(
  noBreakdown.level === "sourceDoubt" &&
    noBreakdown.headline.indexOf(
      "バイナリレベルで読み取れませんでした") >= 0,
  "With no breakdown the message must not claim the code is fine.");
assert(
  noBreakdown.detail.indexOf("改修前後のコードを確認してください") >= 0,
  "With no breakdown the user must still be told what to do.");

// ---- bookkeeping only: state that the code is complete ----

function structureOnly(extra) {
  var read = {
    level: "structureOnly",
    partialModules: [],
    unreadableModules: [],
    recoveredOffsetModules: extra && extra.recoveredOffsetModules
      ? extra.recoveredOffsetModules
      : [],
    containerFallback: Boolean(extra && extra.containerFallback),
    salvaged: false,
    shortStream: false
  };

  return app.describeReadResult(attachData(true, read));
}

var plain = structureOnly();

assert(
  plain.level === "structureOnly" && plain.tone === "info",
  "Bookkeeping alone must not be presented as a caution.");
assert(
  plain.headline.indexOf("全モジュール読み取れています") >= 0,
  "The user must be told the code was read in full.");
assert(
  plain.headline.indexOf("バイナリレベル") < 0 &&
    plain.detail.indexOf("改修前後のコードを確認") < 0,
  "A complete read must not carry the wording for an incomplete one.");
assert(
  plain.detail.indexOf("管理情報") >= 0,
  "The reason must name what was off: " + plain.detail);

var container = structureOnly({ containerFallback: true });

assert(
  container.level === "structureOnly" &&
    container.detail.indexOf("通常の場所になかった") >= 0,
  "A fallback route to the VBA part must be named as the cause.");

var recovered = structureOnly({
  recoveredOffsetModules: ["AppController"]
});

assert(
  recovered.level === "structureOnly" &&
    recovered.detail.indexOf("AppController") >= 0 &&
    recovered.detail.indexOf("位置情報") >= 0,
  "A recovered module position must be named, without alarm: " +
    recovered.detail);
assert(
  recovered.detail.indexOf("影響していません") >= 0,
  "A complete read must say the code was not affected.");

// The one-line form the rest of the app uses stays in step.
assert(
  app.getAttachWarningMessage(attachData(true, {
    level: "structureOnly",
    partialModules: [],
    unreadableModules: [],
    recoveredOffsetModules: [],
    containerFallback: false,
    salvaged: false,
    shortStream: false
  })).indexOf("全モジュール読み取れています") >= 0,
  "The single-line message must follow the same split.");

// The integrated screen 0 must consume the same two-level result. A helper
// that is correct but never reaches the visible screen would still be a bug.
function visibleReadText(data) {
  var described = app.describeReadResult(data);
  return dom.text(workflow.createBookScreen({
    book: {
      name: data.book.name,
      path: data.book.path,
      totalLines: 2,
      read: described
    },
    modules: [
      {name: "TimerUtils", lineCount: 1},
      {name: "WindowUtils", lineCount: 1}
    ],
    busyAction: null,
    lastError: null
  }));
}

var visibleDoubt = visibleReadText(attachData(true, {
  level: "sourceDoubt",
  partialModules: ["TimerUtils"],
  unreadableModules: ["WindowUtils"],
  recoveredOffsetModules: [],
  containerFallback: false,
  salvaged: false,
  shortStream: true
}));
assert(visibleDoubt.indexOf("バイナリレベルで読み取れませんでした") >= 0 &&
  visibleDoubt.indexOf("改修前後のコードを確認してください") >= 0 &&
  visibleDoubt.indexOf("TimerUtils") >= 0,
"Screen 0 must visibly carry the source-doubt warning and evidence.");

var visibleStructure = visibleReadText(attachData(true, {
  level: "structureOnly",
  partialModules: [],
  unreadableModules: [],
  recoveredOffsetModules: [],
  containerFallback: false,
  salvaged: false,
  shortStream: false
}));
assert(visibleStructure.indexOf("全モジュール読み取れています") >= 0 &&
  visibleStructure.indexOf("改修前後のコードを確認してください") < 0,
"Screen 0 must visibly keep bookkeeping-only recovery non-alarming.");

console.log("test-read-report: PASS");
console.log(
  "a clean read stays quiet, a source in doubt names its modules and " +
  "asks for a comparison, and bookkeeping alone reports a complete read");
