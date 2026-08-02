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
      "META CLASS=" + (finding.className || "INFO") +
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

module.exports = {
  diagnosis: diagnosis,
  repair: repair
};
