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
vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets", "js", "diagnosis-package.js"),
    "utf8"),
  context,
  { filename: "diagnosis-package.js" });

var api = windowObject.MacroStudioDiagnosis;
var id = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
var options = {
  requestId: id,
  modules: [
    { name: "CommonUtil", lineCount: 80 },
    { name: "MonthlyReport", lineCount: 80 }
  ],
  environment: {
    constraints: [
      { key: "WIN32API_BLOCKED", effect: "blocked" },
      { key: "FIXED_DRIVE_LETTER", effect: "changed" }
    ]
  }
};

function marker(text) {
  return "'@MACROSTUDIO " + id + " " + text;
}

function sections() {
  var lines = [];

  ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"].forEach(
    function (name) {
      lines.push(marker("SECTION BEGIN " + name));
      lines.push(name + " の事実です。");
      lines.push(marker("SECTION END " + name));
    });
  return lines;
}

function finding(number, meta, title) {
  var lines = [
    marker("FINDING BEGIN " + number),
    marker("META " + meta)
  ];

  ["TITLE", "CONDITION", "IMPACT", "EVIDENCE"].forEach(function (name) {
    lines.push(marker("TEXT BEGIN " + name));
    lines.push(name === "TITLE" ? title : name + " の事実です。");
    lines.push(marker("TEXT END " + name));
  });
  lines.push(marker("FINDING END " + number));
  return lines;
}

var finding1 = finding(
  "1",
  "CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=CommonUtil " +
    "PROC=WaitSeconds LINES=8 ENVKEY=WIN32API_BLOCKED",
  "Windows の関数を呼ぶため実行できません。");
var finding2 = finding(
  "2",
  "CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=MonthlyReport " +
    "PROC=LoadSource LINES=42-47 ENVKEY=FIXED_DRIVE_LETTER",
  "ドライブ文字が変わると入力を開けません。");

function part(index, total, body, complete, extra) {
  return [
    marker("DIAG BEGIN " + String(complete)),
    marker("PART " + index + " OF " + total)
  ].concat(body || []).concat(extra || []).concat([
    marker("DIAG COMPLETE " + String(complete)),
    marker("DIAG END")
  ]).join("\n");
}

function whole() {
  return [marker("DIAG BEGIN 2")]
    .concat(sections())
    .concat(finding1)
    .concat(finding2)
    .concat([
      marker("DIAG COMPLETE 2"),
      marker("DIAG END")
    ]).join("\n");
}

function parsePart(text, label) {
  var result = api.parsePart(text, options);

  assert(
    result.ok,
    label + " failed: " + result.validationId + " " + result.reason);
  return result;
}

var parsed0 = parsePart(
  part("00", "02", sections().concat(finding1), 1),
  "part 00");
var parsed1 = parsePart(part("01", "02", finding2, 1), "part 01");
var collection = api.createPartCollection();
var step = api.addPart(collection, parsed1);

assert(step.ok && step.added && !step.complete, "Part 01 was not collected.");
assert(
  step.missing.length === 1 && step.missing[0] === 0,
  "The missing part number was not reported.");
collection = step.collection;
step = api.addPart(collection, parsed0);
assert(step.ok && step.added && step.complete, "The parts did not complete.");
assert(step.missing.length === 0, "A complete collection reports a gap.");

var oneShot = api.parse(whole(), options);
assert(oneShot.ok, "The equivalent one-shot diagnosis must pass.");
assert(
  JSON.stringify(step.diagnosis) === JSON.stringify(oneShot.diagnosis),
  "Split and one-shot diagnoses do not have the same internal form.");
assert(
  JSON.stringify(api.mergeParts(step.collection).diagnosis) ===
    JSON.stringify(oneShot.diagnosis),
  "An explicit merge changed the completed diagnosis.");

// The same normalized index and the same structured body are idempotent,
// including the beta 1.10-compatible 0 / 00 display forms.
var parsed0Unpadded = parsePart(
  part("0", "2", sections().concat(finding1), 1),
  "unpadded part 0");
var firstOnly = api.addPart(api.createPartCollection(), parsed0);
var repeated = api.addPart(firstOnly.collection, parsed0Unpadded);

assert(
  repeated.ok && !repeated.added &&
    repeated.collection === firstOnly.collection,
  "An identical repeated part must be idempotent.");

var changed0 = parsePart(
  part(
    "00",
    "02",
    sections().concat(finding1).map(function (line) {
      return line === "Windows の関数を呼ぶため実行できません。"
        ? "同じ番号ですが内容が違います。"
        : line;
    }),
    1),
  "changed part 00");
var conflict = api.addPart(firstOnly.collection, changed0);
assert(
  !conflict.ok && conflict.validationId === "DP05" &&
    conflict.collection === firstOnly.collection,
  "A different body under the same part number must be refused unchanged.");

var totalThree = parsePart(
  part("01", "03", finding2, 1),
  "different total");
var totalMismatch = api.addPart(firstOnly.collection, totalThree);
assert(
  !totalMismatch.ok && totalMismatch.validationId === "DP04" &&
    totalMismatch.collection === firstOnly.collection,
  "A changed part total must be refused without changing the collection.");

var missingMerge = api.mergeParts(firstOnly.collection);
assert(
  !missingMerge.ok && missingMerge.validationId === "DP03" &&
    api.listMissingParts(firstOnly.collection).join(",") === "1",
  "A collection with a gap must not merge.");

var laterSection = api.parsePart(
  part("01", "02", sections().concat(finding2), 1),
  options);
assert(
  !laterSection.ok && laterSection.validationId === "D04",
  "Part 01 or later must reject every SECTION.");

var withoutPart = api.parsePart(whole(), options);
assert(
  !withoutPart.ok && withoutPart.validationId === "DP01",
  "Split intake must require exactly one PART line.");

var badPartShape = api.parsePart(
  part("02", "02", finding2, 1),
  options);
assert(
  !badPartShape.ok && badPartShape.validationId === "DP02",
  "A part index outside its total was accepted.");

// A number may be unique inside each part but still collide globally.
var duplicateAcrossParts = parsePart(
  part("01", "02", finding(
    "1",
    "CLASS=CONDITIONAL CONFIDENCE=LIKELY MODULE=MonthlyReport " +
      "PROC=LoadSource LINES=42 ENVKEY=FIXED_DRIVE_LETTER",
    "別の指摘です。"), 1),
  "locally unique duplicate number");
var globalDuplicate = api.addPart(firstOnly.collection, duplicateAcrossParts);
assert(
  !globalDuplicate.ok && globalDuplicate.validationId === "D07" &&
    globalDuplicate.collection === firstOnly.collection,
  "A finding number duplicated across parts must fail the merge unchanged.");

// NOFINDING is only meaningful for one complete part. Intermediate empty
// parts carry COMPLETE 0 without claiming that the whole diagnosis is empty.
var prematureNoFinding = api.parsePart(
  part(
    "00",
    "02",
    sections(),
    0,
    [marker("DIAG NOFINDING SCOPE_CLEAR")]),
  options);
assert(
  !prematureNoFinding.ok && prematureNoFinding.validationId === "D20",
  "A multi-part diagnosis claimed NOFINDING before all parts existed.");

var emptyIntermediate = parsePart(
  part("00", "02", sections(), 0),
  "empty intermediate part");
assert(
  api.addPart(api.createPartCollection(), emptyIntermediate).ok,
  "An empty intermediate part without NOFINDING must be accepted.");

var zeroSingle = parsePart(
  part(
    "0",
    "1",
    sections(),
    0,
    [marker("DIAG NOFINDING SCOPE_CLEAR")]),
  "single zero-finding part");
var zeroStep = api.addPart(api.createPartCollection(), zeroSingle);
assert(
  zeroStep.ok && zeroStep.complete &&
    zeroStep.diagnosis.noFinding === "SCOPE_CLEAR",
  "A one-part explicit zero-finding result must complete.");

var silentZero = parsePart(
  part("0", "1", sections(), 0),
  "silent zero part before merge");
var silentStep = api.addPart(api.createPartCollection(), silentZero);
assert(
  !silentStep.ok && silentStep.validationId === "D20" &&
    silentStep.collection.parts.length === 0,
  "A silent zero-finding merge must fail without storing the part.");

console.log("test-diagnosis-split: PASS");
console.log(
  "parts, gaps, totals, conflict/idempotence, section ownership, global " +
    "validation, zero findings and one-shot-equivalent merge: PASS");
