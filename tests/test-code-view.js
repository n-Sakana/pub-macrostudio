"use strict";

// The shared code block (assets/js/code-view.js).
//
// Two screens draw code with places marked in it: the replacement table,
// where the marks are the exact spans a machine is about to rewrite, and
// the diagnosis result, where the marks are the lines a finding names.
// This pins what both of them get: the whole module in the page, only
// the marked places shown, a way to step between them, and controls that
// move rows around rather than rebuilding anything.

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
var documentObject = {
  createElement: dom.createElement,
  createTextNode: dom.createTextNode
};
var context = vm.createContext({
  window: windowObject,
  document: documentObject
});
windowObject.window = windowObject;
windowObject.document = documentObject;

["vba-highlight.js", "code-view.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
    {filename: name});
});

var view = windowObject.MacroStudioCodeView;
var lines = [];
var index;

for (index = 1; index <= 60; index += 1) {
  lines.push("    Line" + index + " = " + index);
}
lines[9] = "    p = \"C:\\data\\report.xlsx\"";
lines[39] = "    q = \"C:\\data\\report.xlsx\"";
var CODE = lines.join("\r\n");

var block = view.create({
  key: "probe",
  modules: [{
    name: "Sample",
    code: CODE,
    hits: [
      {line: 10, column: 8, endColumn: 31},
      {line: 40, column: 8, endColumn: 31}
    ]
  }]
});

function collectClass(node, name) {
  return dom.collect(node, function (item) {
    return item.classList && item.classList.contains(name);
  });
}

// ---- everything is in the page, and only the places are shown ----

var rows = collectClass(block, "path-evidence-line");

assert(rows.length === 60,
  "Every line of the module must be in the page: " + rows.length);
assert(collectClass(block, "is-folded").length > 0,
  "Lines away from a place must be folded rather than dropped.");
assert(dom.text(block).indexOf("Line60") >= 0,
  "A folded line is still readable text, so nothing was lost.");
assert(block.classList.contains("is-matches-only"),
  "The block opens showing only the places.");

// The two places are two blocks to step between, and the marked line
// carries the block it belongs to.
assert(block.getAttribute("data-code-hit-count") === "2",
  "Two separate places are two stops: " +
  block.getAttribute("data-code-hit-count"));
assert(collectClass(block, "is-match").length === 2,
  "Exactly the named lines are marked.");

// ---- the mark is the span the caller handed in ----

var marks = collectClass(block, "path-evidence-mark");

assert(marks.length === 2, "Each place is marked once: " + marks.length);
assert(dom.text(marks[0]) === "\"C:\\data\\report.xlsx\"",
  "The mark must be exactly the span, quotes included: " +
  JSON.stringify(dom.text(marks[0])));

// ---- context, so a place is read with the code around it ----

var shown = rows.filter(function (row) {
  return !row.classList.contains("is-folded");
});

assert(shown.length === (view.contextLines * 2 + 1) * 2,
  "A place is shown with the lines around it: " + shown.length);

// ---- the controls ----

["code-view-previous", "code-view-next", "code-view-matches"].forEach(
  function (action) {
    assert(dom.collect(block, function (node) {
      return node.getAttribute &&
        node.getAttribute("data-action") === action;
    }).length === 1, "The toolbar must carry " + action + ".");
  });
assert(dom.collect(block, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-action") === "code-view-expand";
}).length > 0,
"A folded run must offer to open itself.");
assert(dom.text(block.querySelector(".code-view-counter")) === "1/2",
  "The counter must say which place of how many.");

// A whole-line hit needs no columns, which is all a diagnosis can give.
var lineOnly = view.create({
  key: "probe-lines",
  highlight: true,
  modules: [{
    name: "Sample",
    code: CODE,
    hits: [{line: 10}, {line: 11}, {line: 12}]
  }]
});

assert(lineOnly.getAttribute("data-code-hit-count") === "1",
  "Adjacent lines are one place, not three: " +
  lineOnly.getAttribute("data-code-hit-count"));
assert(collectClass(lineOnly, "path-evidence-mark").length === 0,
  "A line hit marks the line, not a span inside it.");
assert(collectClass(lineOnly, "is-match").length === 3,
  "All three lines are marked as the place.");

// ---- colouring is opt-in ----
// Where the marks say what a machine will rewrite, no display-only
// tokenizer may have an opinion about where they are.

assert(collectClass(lineOnly, "vba-token").length > 0,
  "The diagnosis view asks for colour and must get it.");
assert(collectClass(block, "vba-token").length === 0,
  "The replacement view must be plain text.");

// ---- a module that could not be read says so ----

var missing = view.create({
  key: "probe-missing",
  modules: [{name: "Gone", code: null, hits: []}]
});

assert(dom.text(missing).indexOf("読み取れませんでした") >= 0,
  "A module with no code must say so rather than render empty.");

console.log("test-code-view: PASS");
console.log("whole module present, places folded to context, exact span " +
  "marks, adjacent lines as one stop, opt-in colouring and the step / " +
  "narrow controls behave as specified");
