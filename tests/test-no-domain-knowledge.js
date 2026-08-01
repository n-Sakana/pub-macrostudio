"use strict";

// The app holds the framework and nothing else.
//
// What a repair is about - a Win32 call, a fixed path, a reference
// setting - belongs to the template that describes it. The app supplies
// the generic parts: somewhere to write, and a table of "replace this
// with that". If a subject name ever appears in assets/js again, the app
// has started having opinions about the work, and the templates have
// stopped being the place that decides.
//
// This is a gate, not a style check. It fails on the words themselves.

var fs = require("fs");
var path = require("path");

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
var jsRoot = path.join(root, "assets", "js");

// Subjects a template may talk about and the app may not.
var FORBIDDEN = [
  "Win32",
  "固定パス",
  "参照設定",
  "Power Query",
  "ActiveX",
  "バーコード",
  "kernel32",
  "PtrSafe",
  "Declare"
];

// The app does name the kinds of work a finding falls into, and the
// classes a finding is reported in. Those are the app's own structure -
// the thing whose value is that it is built in - so the files that hold
// them are named here rather than exempted by accident.
var STRUCTURE_FILES = [
  path.join("handover.js"),
  path.join("screens", "workflow.js")
];

// Places that still hold a subject name, listed so they cannot be
// forgotten. Each one is text the app writes about the work rather than
// mechanism it performs, so each one belongs in a managed file the same
// way the replacement rules now do. They are counted, and the count may
// only go down.
//
//   AXIS_LABELS          the display name of each environment axis.
//                        The axis itself comes from
//                        environment/target-environment.json; only the
//                        Japanese name for it is still in the app.
//   humanTasks           what to check about a reference setting, a
//                        query, a control or a font. The inventory
//                        reader has to know these parts exist to count
//                        them, but the advice about them is authoring.
var KNOWN_DEBT = [
  "handover.js → Win32",
  "handover.js → 参照設定",
  "handover.js → Power Query",
  "handover.js → ActiveX",
  "handover.js → バーコード",
  "screens\\workflow.js → Win32"
];

function walk(directory) {
  var found = [];

  fs.readdirSync(directory).forEach(function (name) {
    var full = path.join(directory, name);

    if (fs.statSync(full).isDirectory()) {
      found = found.concat(walk(full));
      return;
    }
    if (/\.js$/.test(name)) {
      found.push(full);
    }
  });
  return found;
}

var files = walk(jsRoot);
var offences = [];

assert(files.length > 10,
  "The check found almost no product files, so it is checking nothing.");

files.forEach(function (file) {
  var relative = path.relative(jsRoot, file);
  var text = readUtf8(file);

  FORBIDDEN.forEach(function (word) {
    var index = text.indexOf(word);
    var before;

    if (index < 0) {
      return;
    }
    // The one thing the app is allowed to say about a subject is that it
    // is not the app's: a comment explaining the rule. Anything that can
    // reach a screen or a decision is an offence.
    before = text.slice(0, index);
    if (/(?:^|\n)\s*(?:\/\/|\*)[^\n]*$/.test(before)) {
      return;
    }
    offences.push(relative + " → " + word);
  });
});

var unexpected = offences.filter(function (item) {
  return KNOWN_DEBT.indexOf(item) < 0;
});
var fixed = KNOWN_DEBT.filter(function (item) {
  return offences.indexOf(item) < 0;
});

assert(unexpected.length === 0,
  "The app has taken on knowledge that belongs to a template:\n  " +
  unexpected.join("\n  "));
assert(fixed.length === 0,
  "These are no longer in the app, so remove them from KNOWN_DEBT " +
  "rather than leaving a list that says the debt is larger than it " +
  "is:\n  " + fixed.join("\n  "));

// The structural vocabulary the app does own must still be there, or
// this check would pass by the app having become an empty shell.
var structure = STRUCTURE_FILES.map(function (name) {
  return readUtf8(path.join(jsRoot, name));
}).join("\n");

["阻害", "不具合", "条件付き", "前提", "補助"].forEach(function (label) {
  assert(structure.indexOf(label) >= 0,
    "The app's own classification must stay in the app: " + label);
});

// And the replacement component must take its rules from outside.
var pathMap = readUtf8(path.join(jsRoot, "path-map.js"));

assert(/function detect\(modules, rules\)/.test(pathMap),
  "The replacement component must be handed the rules it applies.");
assert(pathMap.indexOf("compileRules") >= 0,
  "The rules must be compiled from what was handed in, not built in.");

// The shipped template that uses it must be the one carrying them.
var preset = readUtf8(path.join(
  root, "presets", "02_改修", "02_固定パスを新環境へ置き換える.md"));

assert(preset.indexOf("## 置換の候補") >= 0 &&
  preset.indexOf("^[A-Za-z]:[\\\\/]") >= 0,
"The template must carry the patterns the app no longer knows.");

console.log("test-no-domain-knowledge: PASS");
console.log("the replacement path names no subject and takes every rule " +
  "from the template; the app keeps its own finding classes; " +
  KNOWN_DEBT.length + " authored lines still name a subject and are " +
  "listed in KNOWN_DEBT");
