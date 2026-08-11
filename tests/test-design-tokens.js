"use strict";

// The design system, held to its own claim.
//
// The claim is that information and actions come in kinds, and that the
// same kind looks the same wherever it appears. Two things can be checked
// by machine, and both of them are things that went wrong:
//
//   1. the scale. Six text sizes, four weights and three corner radii is
//      not a hierarchy, it is a record of what each screen felt like on
//      the day. A reader cannot learn a scale that has a step for every
//      occasion, and the one place it mattered most - the diagnosis
//      verdict - ended up with its letter smaller than the sentence
//      explaining it.
//   2. the states. Grey means "you cannot use this". An optional field is
//      usable, so it may not be grey; a two-state switch has to say which
//      state it is in, in words, not by which side is lit.
//
// What cannot be checked here is whether it looks right. That is what the
// screenshots from the real GUI are for.

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
var cssRoot = path.join(root, "assets", "css");
var variables = readUtf8(path.join(cssRoot, "variables.css"));

// ---- the tokens ----

function declarations(text) {
  var found = {};
  var pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  var match;

  while ((match = pattern.exec(text)) !== null) {
    if (!Object.prototype.hasOwnProperty.call(found, match[1])) {
      found[match[1]] = match[2].trim();
    }
  }
  return found;
}

var light = declarations(
  /:root\s*\{([\s\S]*?)\n\}/.exec(variables)[1]);

function resolve(name) {
  var value = light[name];
  var attempt;
  var reference;

  for (attempt = 0; attempt < 10; attempt += 1) {
    reference = /^var\(--([a-z0-9-]+)\)$/.exec(value);
    if (!reference) {
      return value;
    }
    value = light[reference[1]];
  }
  throw new Error("Token reference loop: " + name);
}

function tokensMatching(pattern) {
  return Object.keys(light).filter(function (name) {
    return pattern.test(name);
  });
}

function distinct(names) {
  var seen = [];

  names.forEach(function (name) {
    var value = resolve(name);

    if (seen.indexOf(value) < 0) {
      seen.push(value);
    }
  });
  return seen;
}

// Three tiers of UI text: heading, body, supporting detail. The display
// step is one thing - the letter a whole-workbook verdict is - and code
// is a different family with a different x-height, so each is allowed its
// own step and neither may grow a second one.
var UI_SIZES = tokensMatching(/^type-.*-size$/).filter(function (name) {
  return name !== "type-display-size" && name !== "type-code-size";
});
var uiSizes = distinct(UI_SIZES);

assert(UI_SIZES.length >= 6,
  "The scan found almost no size tokens, so it is checking nothing: " +
    UI_SIZES.length);
assert(uiSizes.length === 3,
  "UI text must resolve to exactly three sizes: " +
    JSON.stringify(uiSizes) + " from " + JSON.stringify(UI_SIZES));
assert(resolve("type-title-size") !== resolve("type-body-size") &&
  resolve("type-body-size") !== resolve("type-meta-size"),
"The three tiers must be three different sizes.");
// The verdict letter has to beat the sentence next to it by enough that
// nobody reads the sentence first. This is the defect the owner reported:
// a big card with the answer set smaller than its own explanation.
assert(parseFloat(resolve("type-display-size")) >=
  parseFloat(resolve("type-title-size")) * 2,
"The display step must be unmistakably larger than a heading: " +
  resolve("type-display-size") + " vs " + resolve("type-title-size"));

var WEIGHTS = tokensMatching(/^(type-.*-weight|weight-.*)$/);
var weights = distinct(WEIGHTS);

assert(weights.length === 3,
  "Emphasis must be three steps of weight: " + JSON.stringify(weights));
weights.forEach(function (value) {
  assert(["400", "600", "700"].indexOf(value) >= 0,
    "An unexpected weight is in use: " + value);
});

var LINES = tokensMatching(/^type-.*-line$/).filter(function (name) {
  return name !== "type-code-line" && name !== "type-display-line";
});
var lines = distinct(LINES);

assert(lines.length <= 3,
  "Line height must be at most three steps: " + JSON.stringify(lines));
lines.forEach(function (value) {
  assert([resolve("line-tight"), resolve("line-normal"),
    resolve("line-relaxed")].indexOf(value) >= 0,
  "A line height outside the named steps is in use: " + value);
});

var radii = distinct(["radius-sm", "radius-md", "radius-lg"]);

assert(radii.length === 2,
  "Corners must be two steps and a pill: " + JSON.stringify(radii));
assert(resolve("radius-pill") === "999px",
  "The pill must stay a pill.");

// ---- one implementation per look ----

var cssFiles = fs.readdirSync(cssRoot).filter(function (name) {
  return /\.css$/.test(name);
});
var allCss = cssFiles.map(function (name) {
  return readUtf8(path.join(cssRoot, name));
}).join("\n");

// The looks that existed on exactly one element, and the screens that
// drew them. They are named here so that removing them cannot be undone
// without this line being deleted on purpose.
[".attachment-hint", ".disclosure--writein", ".grade-tile", ".scope-card"]
  .forEach(function (selector) {
    assert(allCss.indexOf(selector + " ") < 0 &&
      allCss.indexOf(selector + ",") < 0 &&
      allCss.indexOf(selector + "{") < 0 &&
      allCss.indexOf(selector + ":") < 0,
    "A one-off look came back: " + selector);
  });

// A note is quieter than the body text and nothing else. The moment it
// grows a rail or a panel it stops being the same thing on every screen.
var noteRule = /\.note\s*\{([^}]*)\}/.exec(allCss);

assert(noteRule, "The standard note must be defined.");
assert(!/border|background|box-shadow/.test(noteRule[1]),
  "A note carries no border, fill or shadow - only a quieter voice: " +
    noteRule[1]);

// ---- the components, and the states they claim ----

var windowObject = {};
var documentObject = {
  createElement: dom.createElement,
  createTextNode: dom.createTextNode
};
var context = vm.createContext({window: windowObject, document: documentObject});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
    {filename: name});
});

var ui = windowObject.MacroStudioComponents;

// The kinds the owner listed. Every one of them has to have exactly one
// answer to "what does this look like", and that answer lives here.
[
  "primaryAction", "secondaryAction", "singleChoice", "multiChoice",
  "toggleSwitch", "listChoice", "input", "optionalInput", "note",
  "status", "alert"
].forEach(function (kind) {
  assert(typeof ui.kinds[kind] === "string" && ui.kinds[kind] !== "",
    "The design system has no entry for: " + kind);
});
assert(Object.keys(ui.kinds).length === 11,
  "A twelfth kind appeared without being named: " +
    JSON.stringify(Object.keys(ui.kinds)));

// Every built component says which kind it is, so "this screen only uses
// standard components" is a claim a machine can check.
[
  ["note", ui.note("補足です。")],
  ["status", ui.status("進行中", "active")],
  ["alert", ui.alert({title: "だめでした", body: "理由です。"})],
  ["input", ui.field({label: "書く", id: "a", name: "a"})],
  ["optionalInput", ui.field({label: "書く", id: "b", name: "b",
    optional: true})],
  ["toggleSwitch", ui.toggleSwitch({label: "広く変えてよい",
    onWord: "許可する", offWord: "許可しない"})],
  ["verdict", ui.verdict({grade: "B", answer: "改修が必要",
    headline: "理由"})]
].forEach(function (entry) {
  assert(entry[1].getAttribute("data-component") === entry[0],
    "A component must name its kind: " + entry[0]);
});

// ---- grey means "you cannot use this", and nothing else ----

var optional = ui.field({
  label: "追加の要望",
  id: "opt",
  name: "opt",
  optional: true
});
var optionalBox = optional.querySelector("textarea");

assert(optionalBox.disabled === false,
  "An optional field is usable, so it is not disabled.");
assert(dom.text(optional.querySelector(".field-optional-tag")) === "任意",
  "Optional is said in words, on the heading, not by shading the box.");
assert(optional.className.indexOf("field--optional") >= 0,
  "The optional variant must be a variant of the field, not its own thing.");

var busy = ui.field({label: "x", id: "c", name: "c", disabled: true});

assert(busy.querySelector("textarea").disabled === true,
  "disabled is still available, for when the app really is busy.");

var fieldRule = /\.field-input:disabled\s*\{([^}]*)\}/.exec(allCss);

assert(fieldRule && /surface-sunken|text-disabled/.test(fieldRule[1]),
  "The sunken look belongs to :disabled and to nothing else.");
assert(!/\.field--optional[^{]*\{[^}]*opacity/.test(allCss),
  "An optional field must not be faded: fading is what unavailable " +
  "looks like.");

// ---- a two-state switch says which state it is in ----
//
// The ordinary track-and-thumb switch. The state must be legible three
// ways at once - the thumb's position (aria-checked drives it), the
// switch role, and a word beside the label written in the setting's own
// vocabulary - so no single signal has to be seen.

var toggleOff = ui.toggleSwitch({
  label: "大きく変えてよい",
  action: "select-change-scope",
  data: {"scope-file": "b.md"},
  onWord: "許可する",
  offWord: "許可しない",
  description: "作り替えを許します"
});
var toggleOn = ui.toggleSwitch({
  label: "大きく変えてよい",
  checked: true,
  onWord: "許可する",
  offWord: "許可しない"
});
var offControl = toggleOff.querySelector(".toggle-control");
var onControl = toggleOn.querySelector(".toggle-control");

assert(offControl.tagName === "BUTTON" &&
  offControl.getAttribute("role") === "switch",
"The toggle is a real button wearing the switch role, so Space and " +
  "Enter flip it and the shared focus ring applies.");
assert(offControl.getAttribute("aria-checked") === "false" &&
  onControl.getAttribute("aria-checked") === "true",
"aria-checked carries the state.");
assert(offControl.querySelector(".toggle-track") !== null &&
  offControl.querySelector(".toggle-thumb") !== null,
"The track and thumb are there for the position signal.");
assert(dom.text(offControl.querySelector(".toggle-state")) === "許可しない" &&
  dom.text(onControl.querySelector(".toggle-state")) === "許可する",
"The state is written in the setting's own words, not only drawn.");
assert(dom.text(offControl.querySelector(".toggle-label")) ===
  "大きく変えてよい",
"The label names the thing being permitted, so ON is never a guess.");
assert(offControl.getAttribute("data-action") === "select-change-scope" &&
  offControl.getAttribute("data-scope-file") === "b.md",
"The control carries its action and data like every other control.");
assert(offControl.getAttribute("aria-label").indexOf("許可しない") >= 0,
  "The accessible name carries the current state too.");
assert(dom.text(toggleOff).indexOf("作り替えを許します") >= 0,
  "The description under the switch says what turning it on permits.");

// ---- an alert is not a colour ----

var alertBox = ui.alert({
  title: "取り込めませんでした",
  body: "理由です。",
  facts: [{name: "求めている形", value: "これ"}],
  footer: "検査番号 D09"
});

assert(alertBox.getAttribute("role") === "alert",
  "An alert announces itself.");
assert(alertBox.querySelector(".alert-title").querySelector("svg") !== null ||
  dom.collect(alertBox.querySelector(".alert-title"), function (node) {
    return node.classList && node.classList.contains("flow-icon");
  }).length > 0,
"An alert carries an icon as well as its colour.");
assert(dom.text(alertBox).indexOf("取り込めませんでした") >= 0,
  "An alert says what happened in words.");
assert(alertBox.querySelector(".alert-fact-name") !== null,
  "The three facts are labelled, not run together into one paragraph.");

// ---- the verdict is one answer in words, at the display step ----

var verdict = ui.verdict({
  grade: "B",
  answer: "改修が必要",
  headline: "このままでは対象の環境で動きません。",
  reason: "まず問題になる箇所: CommonUtil の WaitSeconds"
});

assert(dom.text(verdict.querySelector(".verdict-answer")) === "改修が必要",
  "The verdict is the answer in words.");
assert(verdict.querySelector(".verdict-letter") === null,
  "No bare letter: a letter was an answer only after reading a legend.");
assert(verdict.className.indexOf("verdict--b") >= 0 &&
  verdict.getAttribute("data-grade") === "B",
"The tone and data still follow the grade reached.");
assert(verdict.getAttribute("aria-live") === "polite",
  "A verdict that changes must be announced.");

var answerRule = /\.verdict-answer\s*\{([^}]*)\}/.exec(allCss);

assert(answerRule &&
  answerRule[1].indexOf("var(--type-display-size)") >= 0,
"The verdict answer must use the display step, not a size of its own.");

console.log("test-design-tokens: PASS");
console.log("three text tiers, three weights, three line heights, two " +
  "corners, eleven named component kinds, grey reserved for disabled, a " +
  "track-and-thumb switch that says its state in words, and an alert " +
  "that does not rely on colour");
