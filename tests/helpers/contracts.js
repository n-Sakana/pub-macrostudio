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

var DIAGNOSE_FOLDER = "01_診断";
var REPAIR_FOLDER = "02_改修";
var SCOPE_FOLDER = "03_変更範囲";

function presetRoot() {
  var path = require("path");

  return path.join(path.resolve(__dirname, "..", ".."), "presets");
}

function readPreset(file) {
  var fs = require("fs");
  var text = fs.readFileSync(file, "utf8");

  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

// One preset folder, in the shape the host hands it over: the file name
// relative to presets/ and the text, nothing parsed.
function presetGroup(folder) {
  var fs = require("fs");
  var path = require("path");
  var dir = path.join(presetRoot(), folder);

  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter(function (name) {
    return /\.md$/.test(name);
  }).sort().map(function (name) {
    return {
      file: folder + "\\" + name,
      content: readPreset(path.join(dir, name))
    };
  });
}

// The whole presets folder, described the way the app describes it: read
// the real files, hand them to the product parser. Every run is offered
// the same catalog - there is nothing to choose before the workbook.
function catalog(presetApi, overrides) {
  var settings = overrides || {};

  return presetApi.describeCatalog({
    diagnose: settings.diagnose || presetGroup(DIAGNOSE_FOLDER),
    repair: settings.repair || presetGroup(REPAIR_FOLDER),
    scope: settings.scope || presetGroup(SCOPE_FOLDER)
  });
}

// The change scope a test runs under. Without an argument it is the
// shipped default, which is the first file in the folder.
function changeScope(presetApi, name) {
  var described = catalog(presetApi);
  var chosen = null;

  described.scope.forEach(function (entry) {
    if (!entry.valid || chosen) {
      return;
    }
    if (!name || entry.name === name) {
      chosen = entry;
    }
  });
  if (!chosen) {
    throw new Error("No usable change scope" + (name ? ": " + name : ""));
  }
  return chosen;
}

module.exports = {
  diagnosis: diagnosis,
  repair: repair,
  catalog: catalog,
  changeScope: changeScope,
  presetGroup: presetGroup,
  diagnoseFolder: DIAGNOSE_FOLDER,
  repairFolder: REPAIR_FOLDER,
  scopeFolder: SCOPE_FOLDER
};
