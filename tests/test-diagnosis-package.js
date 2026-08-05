"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  Array: Array,
  JSON: JSON,
  Math: Math,
  Number: Number,
  String: String,
  isFinite: isFinite
});
windowObject.window = windowObject;

["preset-document.js", "response-package.js",
  "diagnosis-package.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    { filename: name });
});

var api = windowObject.MacroStudioDiagnosis;
var presetApi = windowObject.MacroStudioPreset;
var id = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
var other = "84547cd0-d729-4cab-a9f9-5c7b772ae9d2";
var options = {
  requestId: id,
  modules: [
    { name: "CommonUtil", lineCount: 80 },
    { name: "MonthlyReport", lineCount: 80 },
    { name: "SalesRules", lineCount: 80 }
  ],
  environment: {
    constraints: [
      { key: "WIN32API_BLOCKED", effect: "blocked", basis: "declared" },
      { key: "FIXED_DRIVE_LETTER", effect: "changed", basis: "inferred" }
    ]
  }
};

function marker(text) {
  return "'@MACROSTUDIO " + id + " " + text;
}

function section(name, body) {
  return [
    marker("SECTION BEGIN " + name),
    body || (name + " の事実です。"),
    marker("SECTION END " + name)
  ];
}

function sections() {
  return []
    .concat(section("PURPOSE"))
    .concat(section("FLOW"))
    .concat(section("DEPENDENCY"))
    .concat(section("ENVIRONMENT"));
}

function finding(number, meta, overrides) {
  var values = overrides || {};
  var result = [
    marker("FINDING BEGIN " + number),
    marker("META " + meta)
  ];

  ["TITLE", "CONDITION", "IMPACT", "EVIDENCE"].forEach(function (name) {
    result.push(marker("TEXT BEGIN " + name));
    result.push(values[name] || (name + " の事実です。"));
    result.push(marker("TEXT END " + name));
  });
  result.push(marker("FINDING END " + number));
  return result;
}

var defaultMeta =
  "GRADE=B CONFIDENCE=CONFIRMED MODULE=CommonUtil " +
  "PROC=WaitSeconds LINES=8 ENVKEY=-";
var blockerMeta =
  "GRADE=B CONFIDENCE=CONFIRMED MODULE=CommonUtil " +
  "PROC=WaitSeconds LINES=8 ENVKEY=WIN32API_BLOCKED";
// "nothing can be done about this" cannot be said tentatively (D11).
var impossibleMeta =
  "GRADE=D CONFIDENCE=CONFIRMED MODULE=CommonUtil " +
  "PROC=WaitSeconds LINES=8 ENVKEY=WIN32API_BLOCKED";

function packageWith(findings, settings) {
  var config = settings || {};
  // The opener says how many findings this reply carries, the same value
  // COMPLETE ends with. `beginCount` overrides it so the mismatch has a
  // fixture of its own.
  var result = [marker("DIAG BEGIN " +
    (config.beginCount !== undefined
      ? config.beginCount
      : (findings || []).length))];

  result = result.concat(config.sections || sections());
  (findings || []).forEach(function (item) {
    result = result.concat(item);
  });
  if (config.noFinding !== undefined) {
    result.push(marker("DIAG NOFINDING " + config.noFinding));
  }
  if (!config.skipComplete) {
    result.push(marker(
      "DIAG COMPLETE " +
      (config.complete === undefined
        ? String((findings || []).length)
        : config.complete)));
  }
  result.push(marker("DIAG END"));
  return result.join("\n");
}

function replaceMeta(text, meta) {
  return text.replace(/META [^\r\n]+/, "META " + meta);
}

function expectPass(label, text) {
  var result = api.parse(text, options);

  assert(
    result.ok,
    label + " must pass, but got " + result.validationId +
      ": " + result.reason);
  return result;
}

function expectFailure(validationId, text) {
  var result = api.parse(text, options);

  assert(!result.ok, validationId + " invalid fixture was accepted.");
  assert(
    result.code === "E-DIAG-01",
    validationId + " returned the wrong public code: " + result.code);
  assert(
    result.validationId === validationId,
    validationId + " returned " + result.validationId +
      " (" + result.reason + ").");
  assert(
    result.message.indexOf(validationId) < 0 &&
      result.message.indexOf("undefined") < 0 &&
      /。$/.test(result.message),
    validationId + " leaked internals or returned no one-sentence action.");
}

var validOne = packageWith([finding("1", defaultMeta)]);
var validBlocker = packageWith([finding("1", blockerMeta)]);
var validUnverified = packageWith([finding(
  "1",
  "GRADE=B CONFIDENCE=UNVERIFIED MODULE=CommonUtil " +
    "PROC=WaitSeconds LINES=8 ENVKEY=FIXED_DRIVE_LETTER")]);
var validLocationless = packageWith([finding(
  "1",
  "GRADE=A CONFIDENCE=UNVERIFIED MODULE=- PROC=- LINES=- ENVKEY=-")]);
var validModuleOnly = packageWith([finding(
  "1",
  "GRADE=A CONFIDENCE=UNVERIFIED MODULE=CommonUtil " +
    "PROC=- LINES=- ENVKEY=-")]);
var validImpossible = packageWith([finding("1", impossibleMeta)]);
var validZero = packageWith([], { noFinding: "SCOPE_CLEAR" });

expectPass("ordinary finding", validOne);
expectPass("a finding that names an environment key", validBlocker);
expectPass("a confirmed impossible finding", validImpossible);
expectPass("unverified conditional finding", validUnverified);
expectPass("locationless information", validLocationless);
expectPass("module-only location", validModuleOnly);
expectPass("zero findings with SCOPE_CLEAR", validZero);
expectPass(
  "zero findings with INSUFFICIENT",
  packageWith([], { noFinding: "INSUFFICIENT" }));

// The canonical example lives in the shipped preset and nowhere in this
// test. Read it, replace only its request id, and prove that it is a real
// package rather than decorative documentation.
var presetText = fs.readFileSync(
  path.join(root, "presets", "01_診断", "01_動くかどうかの監査.md"),
  "utf8");
var parsedPreset = presetApi.parse(presetText, "diagnose");
var exampleMatch = /```\s*\r?\n([\s\S]*?)\r?\n```/.exec(
  parsedPreset.output.body);

assert(parsedPreset.valid, "The shipped diagnosis preset must parse.");
assert(exampleMatch, "The shipped diagnosis preset has no complete example.");
expectPass(
  "the shipped diagnosis example",
  exampleMatch[1].replace(/\{\{REQUEST_ID\}\}/g, id));

var findingBlock = finding("1", defaultMeta).join("\n");
var duplicateFinding = validOne.replace(
  marker("DIAG COMPLETE 1"),
  findingBlock + "\n" + marker("DIAG COMPLETE 2"));
var missingEvidence = validOne.replace(
  new RegExp(
    marker("TEXT BEGIN EVIDENCE").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\nEVIDENCE の事実です。\\n" +
      marker("TEXT END EVIDENCE").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "\\n"),
  "");
var outsideSentinel = marker("DIAG COMPLETE 1") + "\n" + validOne;

var failures = {
  D01: validOne.replace(id, other),
  D02: validOne.replace("\n" + marker("DIAG END"), ""),
  // The opener's number has to be a canonical decimal count, and it has
  // to be the count that is actually there.
  D03: packageWith([finding("1", defaultMeta)], { beginCount: "01" }),
  D29: packageWith([finding("1", defaultMeta)], { beginCount: "2" }),
  D04: validOne.replace(
    section("ENVIRONMENT").join("\n") + "\n",
    ""),
  D05: validOne
    .replace("SECTION BEGIN FLOW", "SECTION BEGIN UNKNOWN")
    .replace("SECTION END FLOW", "SECTION END UNKNOWN"),
  D06: validOne.replace("FINDING END 1", "FINDING END 2"),
  D07: duplicateFinding,
  D08: validOne.replace(marker("META " + defaultMeta) + "\n", ""),
  D09: replaceMeta(
    validOne,
    "CONFIDENCE=CONFIRMED CLASS=DEFECT MODULE=CommonUtil " +
      "PROC=WaitSeconds LINES=8 ENVKEY=-"),
  D10: replaceMeta(validOne, defaultMeta.replace("GRADE=B", "GRADE=E")),
  D11: replaceMeta(
    validOne,
    impossibleMeta.replace("CONFIRMED", "LIKELY")),
  D13: replaceMeta(
    validOne,
    defaultMeta.replace("MODULE=CommonUtil", "MODULE=Missing")),
  D14: replaceMeta(
    validOne,
    defaultMeta.replace("ENVKEY=-", "ENVKEY=UNKNOWN_KEY")),
  D15: replaceMeta(
    validOne,
    defaultMeta.replace("LINES=8", "LINES=20-10")),
  D16: missingEvidence,
  D17: validOne
    .replace("TEXT BEGIN EVIDENCE", "TEXT BEGIN UNKNOWN")
    .replace("TEXT END EVIDENCE", "TEXT END UNKNOWN"),
  D18: validOne.replace("DIAG COMPLETE 1", "DIAG COMPLETE 1.0"),
  D19: validOne.replace("DIAG COMPLETE 1", "DIAG COMPLETE 0"),
  D20: packageWith([]),
  D21: validOne.replace(
    marker("DIAG COMPLETE 1"),
    marker("DIAG NOFINDING SCOPE_CLEAR") + "\n" +
      marker("DIAG COMPLETE 1")),
  D22: outsideSentinel,
  D23: replaceMeta(
    validOne,
    "GRADE=A CONFIDENCE=UNVERIFIED MODULE=- " +
      "PROC=WaitSeconds LINES=- ENVKEY=-"),
  D24: replaceMeta(
    validOne,
    "GRADE=A CONFIDENCE=UNVERIFIED MODULE=- " +
      "PROC=- LINES=1 ENVKEY=-"),
  D25: replaceMeta(
    validOne,
    defaultMeta.replace("LINES=8", "LINES=81")),
  D27: validOne.replace(
    "TITLE の事実です。",
    "1 行目です。\n2 行目です。"),
  D28: validOne
    .replace("FINDING BEGIN 1", "FINDING BEGIN 01")
    .replace("FINDING END 1", "FINDING END 01")
};

Object.keys(failures).forEach(function (validationId) {
  var passFixture = validOne;

  if (validationId === "D11") {
    passFixture = validImpossible;
  } else if (validationId === "D20") {
    passFixture = validZero;
  } else if (validationId === "D23" || validationId === "D24") {
    passFixture = validLocationless;
  }
  expectPass(validationId + " valid fixture", passFixture);
  expectFailure(validationId, failures[validationId]);
});

// ---- the graded shape ----
//
// The refactor entrance asks one question and gets back one letter, so a
// reply carries a grade and no findings. Each shape refuses the other's
// reply rather than reading it as an empty one of its own kind (SPEC
// section 4.4.4).

var gradeOptions = {
  requestId: id,
  shape: "grade",
  sections: ["PURPOSE", "FLOW", "DEPENDENCY", "REASON"],
  modules: options.modules,
  environment: options.environment
};

function gradePackage(settings) {
  var config = settings || {};
  var lines = [marker("DIAG BEGIN " + (config.beginCount || "0"))];

  lines = lines.concat(section("PURPOSE"))
    .concat(section("FLOW"))
    .concat(section("DEPENDENCY"));
  if (config.grade !== null) {
    lines.push(marker("DIAG GRADE " + (config.grade || "C")));
  }
  lines = lines.concat(section("REASON"));
  (config.findings || []).forEach(function (item) {
    lines = lines.concat(item);
  });
  if (config.noFinding) {
    lines.push(marker("DIAG NOFINDING " + config.noFinding));
  }
  lines.push(marker("DIAG COMPLETE " + (config.beginCount || "0")));
  lines.push(marker("DIAG END"));
  return lines.join("\n");
}

function expectGrade(label, text, letter) {
  var result = api.parse(text, gradeOptions);

  assert(result.ok, label + " must pass, but got " +
    result.validationId + ": " + result.reason);
  assert(result.diagnosis.grade === letter,
    label + " must come back as " + letter + ", got " + result.diagnosis.grade);
  assert(result.diagnosis.findings.length === 0,
    label + " must carry no findings.");
  assert(String(result.diagnosis.sections.REASON || "").length > 0,
    label + " must carry the reason the template asked for.");
  return result;
}

function expectGradeFailure(validationId, text) {
  var result = api.parse(text, gradeOptions);

  assert(!result.ok, validationId + " invalid graded fixture was accepted.");
  assert(result.validationId === validationId,
    validationId + " returned " + result.validationId +
      " (" + result.reason + ").");
}

["A", "B", "C", "D"].forEach(function (letter) {
  expectGrade("grade " + letter, gradePackage({grade: letter}), letter);
});
expectGradeFailure("D12", gradePackage({grade: null}));
expectGradeFailure("D12", gradePackage({grade: "E"}));
expectGradeFailure("D26", gradePackage({
  grade: "D",
  beginCount: "1",
  findings: [finding("1", defaultMeta)]
}));
expectGradeFailure("D20", gradePackage({
  grade: "A",
  noFinding: "SCOPE_CLEAR"
}));
// The section list is the template's, so the audit's ENVIRONMENT is not
// one of the words this shape knows.
expectGradeFailure("D05", gradePackage({grade: "A"}).replace(
  "SECTION BEGIN REASON", "SECTION BEGIN ENVIRONMENT")
  .replace("SECTION END REASON", "SECTION END ENVIRONMENT"));
// And the findings shape refuses a graded reply too: its section words
// are not the audit's, and a stray grade is not read as a shape switch.
assert(api.parse(gradePackage({grade: "A"}), options).validationId === "D05",
  "A graded reply must be refused by the findings shape.");
assert(api.parse(
  validOne.replace(marker("DIAG COMPLETE 1"),
    marker("DIAG GRADE A") + "\n" + marker("DIAG COMPLETE 1")),
  options
).validationId === "D02",
"A grade written into a findings reply must be refused.");

var gradeRecord = api.formatForRecord(
  expectGrade("record source", gradePackage({grade: "D"}), "D").diagnosis);
assert(gradeRecord.indexOf("## 判定\r\n\r\n- D") >= 0 &&
    gradeRecord.indexOf("## REASON") >= 0 &&
    gradeRecord.indexOf("## 指摘") < 0,
"The graded record lost the grade or the reason.");

var restoredGrade = api.restore(JSON.parse(JSON.stringify(
  expectGrade("restore source", gradePackage({grade: "B"}), "B").diagnosis)));
assert(restoredGrade && restoredGrade.grade === "B" &&
    restoredGrade.shape === "grade",
"A graded diagnosis must survive being written down and read back.");

// Canonical decimal counts and line syntax are intentionally stricter
// than JavaScript Number conversion.
["01", "0x1", "1e0", "+1", "１"].forEach(function (count) {
  expectFailure(
    "D18",
    validOne.replace("DIAG COMPLETE 1", "DIAG COMPLETE " + count));
});
["12", "12,13", "12-20"].forEach(function (lines) {
  expectPass(
    "valid LINES=" + lines,
    replaceMeta(validOne, defaultMeta.replace("LINES=8", "LINES=" + lines)));
});

var accepted = expectPass("record formatting source", validBlocker);
var record = api.formatForRecord(accepted.diagnosis);
assert(
  record.indexOf("# 診断結果\r\n") === 0 &&
    record.indexOf("GRADE=B") >= 0 &&
    record.indexOf("ENVKEY=WIN32API_BLOCKED") >= 0 &&
    record.indexOf("EVIDENCE の事実です。") >= 0,
  "The accepted diagnosis record lost META or TEXT facts.");

console.log("test-diagnosis-package: PASS");
console.log(
  "shipped example, D01-D29 pass/fail ids, both return shapes, zero " +
    "findings, canonical counts, line forms and record formatting: PASS");
