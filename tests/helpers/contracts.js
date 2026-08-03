"use strict";

function required(value, name) {
  if (!value) {
    throw new Error(name + " is required.");
  }
  return value;
}

function marker(requestId, directive) {
  return "'@MACROSTUDIO " + requestId + " " + directive;
}

function diagnosis(api, settings) {
  var config = settings || {};
  var requestId = required(config.requestId, "requestId");
  var findings = config.findings || [];
  var lines = [marker(requestId, "DIAG BEGIN " + findings.length)];
  var result;

  ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"].forEach(function (name) {
    lines.push(marker(requestId, "SECTION BEGIN " + name));
    lines.push(name + " の確認済み事実です。");
    lines.push(marker(requestId, "SECTION END " + name));
  });
  findings.forEach(function (finding, index) {
    var number = String(finding.number || index + 1);
    var moduleName = finding.module || "-";
    var procedure = finding.procedure || "-";
    var lineRange = finding.lines || "-";
    var environmentKey = finding.environmentKey || "-";

    lines.push(marker(requestId, "FINDING BEGIN " + number));
    lines.push(marker(
      requestId,
      "META GRADE=" + (finding.grade || "A") +
        " CONFIDENCE=" + (finding.confidence || "UNVERIFIED") +
        " MODULE=" + moduleName +
        " PROC=" + procedure +
        " LINES=" + lineRange +
        " ENVKEY=" + environmentKey));
    ["TITLE", "CONDITION", "IMPACT", "EVIDENCE"].forEach(function (name) {
      lines.push(marker(requestId, "TEXT BEGIN " + name));
      lines.push(finding[name.toLowerCase()] || name + " の確認済み事実です。");
      lines.push(marker(requestId, "TEXT END " + name));
    });
    lines.push(marker(requestId, "FINDING END " + number));
  });
  if (findings.length === 0) {
    lines.push(marker(
      requestId,
      "DIAG NOFINDING " + (config.noFinding || "SCOPE_CLEAR")));
  }
  lines.push(marker(requestId, "DIAG COMPLETE " + findings.length));
  lines.push(marker(requestId, "DIAG END"));
  result = api.parse(lines.join("\r\n"), {
    requestId: requestId,
    shape: config.shape || null,
    sections: config.sections || null,
    modules: config.modules || [],
    environment: config.environment || { constraints: [] }
  });
  if (!result.ok) {
    throw new Error(
      "Product diagnosis fixture failed " + result.validationId +
        ": " + result.reason);
  }
  return result.diagnosis;
}

function repair(api, settings) {
  var config = settings || {};
  var requestId = required(config.requestId, "requestId");
  var modules = config.modules || [];
  var lines = [];
  var parsed;
  var described;

  if (config.summary) {
    lines.push(api.summaryBeginLine(requestId));
    lines.push(config.summary);
    lines.push(api.summaryEndLine(requestId));
  }
  if (config.verdict) {
    lines.push(api.noChangeLine(requestId, config.verdict));
  }
  modules.forEach(function (module) {
    lines.push(api.beginLine(
      requestId,
      module.kind || "standard",
      module.name));
    lines.push(module.code || "Option Explicit\r\nPublic Sub Run(): End Sub");
    lines.push(api.endLine(
      requestId,
      module.kind || "standard",
      module.name));
  });
  lines.push(api.completeLine(requestId, modules.length));
  parsed = api.parse(lines.join("\r\n"), requestId);
  described = api.describe(
    parsed,
    config.existingModules || [],
    config.diagnosis || null);
  if (!described.ok) {
    throw new Error(
      "Product repair fixture failed " +
        (described.validationId || described.reason));
  }
  return described;
}

// One entrance, described the way the app describes it: read the real
// folder, hand it to the product parser. A test that walks the flow has
// to choose an entrance first, because what the flow does after the
// workbook is read off the entrance's folder (SPEC §2.2.0).
function entrance(presetApi, folder) {
  var fs = require("fs");
  var path = require("path");
  var root = path.resolve(__dirname, "..", "..");
  var dir = path.join(root, "presets", folder);
  var entranceFile = path.join(dir, "入口.md");

  function read(file) {
    var text = fs.readFileSync(file, "utf8");
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  }

  function group(stage) {
    var stageDir = path.join(dir, stage);

    if (!fs.existsSync(stageDir)) {
      return [];
    }
    return fs.readdirSync(stageDir).filter(function (name) {
      return /\.md$/.test(name);
    }).sort().map(function (name) {
      return {
        file: folder + "\\" + stage + "\\" + name,
        content: read(path.join(stageDir, name))
      };
    });
  }

  return presetApi.describeEntrance({
    folder: folder,
    entrance: fs.existsSync(entranceFile)
      ? {file: folder + "\\入口.md", content: read(entranceFile)}
      : null,
    hasDiagnoseFolder: fs.existsSync(path.join(dir, "01_診断")),
    diagnose: group("01_診断"),
    repair: group("02_改修")
  });
}

module.exports = {
  diagnosis: diagnosis,
  repair: repair,
  entrance: entrance
};
