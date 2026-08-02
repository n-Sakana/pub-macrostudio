(function (global) {
  "use strict";

  var MARKER = "'@MACROSTUDIO";
  var CRLF = "\r\n";
  var VERSION = "1";
  var SECTION_NAMES = [
    "PURPOSE",
    "FLOW",
    "DEPENDENCY",
    "ENVIRONMENT"
  ];
  var TEXT_NAMES = ["TITLE", "CONDITION", "IMPACT", "EVIDENCE"];
  var META_NAMES = [
    "CLASS",
    "CONFIDENCE",
    "MODULE",
    "PROC",
    "LINES",
    "ENVKEY"
  ];
  var CLASSES = [
    "BLOCKER",
    "DEFECT",
    "CONDITIONAL",
    "EXTERNAL",
    "INFO"
  ];
  var CONFIDENCES = ["CONFIRMED", "LIKELY", "UNVERIFIED"];
  var NO_FINDING_REASONS = ["SCOPE_CLEAR", "INSUFFICIENT"];
  var CANONICAL_NUMBER = /^(0|[1-9][0-9]*)$/;
  var DIGITS = /^\d+$/;
  var VBA_IDENTIFIER = /^[A-Za-z\u00c0-\uffff][A-Za-z0-9_\u00c0-\uffff]{0,254}$/;
  var PRODUCT_RESULTS = new WeakSet();

  function brand(result) {
    if (result && (typeof result === "object" || typeof result === "function")) {
      PRODUCT_RESULTS.add(result);
    }
    return result;
  }

  function isProductResult(result) {
    return Boolean(result) && PRODUCT_RESULTS.has(result);
  }

  var MESSAGES = {
    otherRequest:
      "いまの診断依頼文をコピーし直して、AIへもう一度送ってください。",
    malformed:
      "AIの返答全体をコピーし直して、もう一度取り込んでください。",
    incomplete:
      "AIの返答が最後まで揃っていることを確認して、もう一度取り込んでください。",
    unknownReference:
      "現在のブックへの診断返答をAIから受け取り直して、もう一度取り込んでください。",
    partMissing:
      "不足している番号の返答をAIから受け取り、もう一度取り込んでください。",
    partConflict:
      "同じ番号の返答が前と異なるため、診断結果を最初から取り込み直してください。"
  };

  function failure(validationId, reason, message) {
    return brand({
      ok: false,
      code: "E-DIAG-01",
      validationId: validationId,
      reason: reason || "malformed",
      message: message || MESSAGES.malformed,
      diagnosis: null
    });
  }

  function success(diagnosis) {
    brand(diagnosis);
    return brand({
      ok: true,
      code: "",
      validationId: "",
      reason: "",
      message: "",
      diagnosis: diagnosis
    });
  }

  function trimSpace(value) {
    return String(value).replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
  }

  function splitLines(value) {
    return String(value)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
  }

  // A chat client that renders the reply as Markdown body text folds the
  // single line breaks away, and every sentinel ends up run together in
  // one paragraph. The sentinel is only ever legitimate at the start of a
  // line, so the line structure can be put back by breaking before each
  // marker. This is a recovery path, not the normal one: it is tried only
  // after the text has already failed to parse, and what it produces is
  // reported as recovered rather than passed off as a clean reply.
  function countMarkers(value) {
    return String(value).split(MARKER).length - 1;
  }

  function countMarkerLines(lines) {
    return lines.filter(function (line) {
      return trimSpace(line).indexOf(MARKER) === 0;
    }).length;
  }

  function looksCollapsed(lines, value) {
    var markers = countMarkers(value);

    return markers > 1 && countMarkerLines(lines) < markers;
  }

  // How many whitespace-separated tokens a sentinel occupies after the
  // marker, including the request id. Everything past that on a collapsed
  // line is body text that belongs on its own line.
  function sentinelArity(parts) {
    var directive = (parts[1] || "").toUpperCase();
    var second = (parts[2] || "").toUpperCase();

    if (directive === "META") {
      return 8;
    }
    if (directive === "PART") {
      return 5;
    }
    if (directive === "SECTION" || directive === "FINDING" ||
        directive === "TEXT") {
      return 4;
    }
    if (directive === "DIAG") {
      return second === "END" ? 3 : 4;
    }
    return parts.length;
  }

  function recoverLines(value) {
    var chunks = String(value).split(MARKER);
    var lines = [];

    function push(part) {
      var trimmed = trimSpace(part);

      if (trimmed !== "") {
        lines.push(trimmed);
      }
    }

    push(chunks[0]);
    chunks.slice(1).forEach(function (chunk) {
      var body = String(chunk).replace(/^\s+/, "");
      var parts = body === "" ? [] : body.split(/\s+/);
      var arity = sentinelArity(parts);
      var head = parts.slice(0, arity).join(" ");
      var rest;
      var offset;

      if (arity >= parts.length) {
        lines.push(MARKER + " " + body);
        return;
      }
      // Cut the body off at the character the sentinel actually ends on,
      // so the prose keeps its own spacing.
      offset = 0;
      parts.slice(0, arity).forEach(function (token) {
        offset = body.indexOf(token, offset) + token.length;
      });
      rest = trimSpace(body.slice(offset));
      lines.push(MARKER + " " + head);
      push(rest);
    });
    return lines;
  }

  function trimBlankEdges(lines) {
    var start = 0;
    var end = lines.length;

    while (start < end && trimSpace(lines[start]) === "") {
      start += 1;
    }
    while (end > start && trimSpace(lines[end - 1]) === "") {
      end -= 1;
    }
    return lines.slice(start, end);
  }

  function bodyText(lines) {
    return trimBlankEdges(lines).join(CRLF);
  }

  function readSentinel(line, index) {
    var trimmed = trimSpace(line);
    var rest;
    var parts;

    if (trimmed.indexOf(MARKER) !== 0) {
      return null;
    }
    rest = trimmed.slice(MARKER.length).replace(/^\s+/, "");
    parts = rest === "" ? [] : rest.split(/\s+/);
    return {
      index: index,
      trimmed: trimmed,
      requestId: parts[0] || "",
      directive: (parts[1] || "").toUpperCase(),
      parts: parts
    };
  }

  function readTokens(lines) {
    var tokens = [];

    lines.forEach(function (line, index) {
      var token = readSentinel(line, index);

      if (token !== null) {
        tokens.push(token);
      }
    });
    return tokens;
  }

  function normalizeDecimal(value) {
    var normalized = String(value).replace(/^0+(?=\d)/, "");

    return normalized === "" ? "0" : normalized;
  }

  function compareDecimals(left, right) {
    var a = normalizeDecimal(left);
    var b = normalizeDecimal(right);

    if (a.length !== b.length) {
      return a.length < b.length ? -1 : 1;
    }
    if (a === b) {
      return 0;
    }
    return a < b ? -1 : 1;
  }

  // PART deliberately retains the beta 1.10 four-digit ceiling and
  // accepts display forms such as 00. COMPLETE and FINDING do not.
  function readPartNumber(value) {
    var text = String(value);

    if (!/^\d{1,4}$/.test(text)) {
      return -1;
    }
    return Number(text);
  }

  function makeModuleMap(modules) {
    var map = {};

    (modules || []).forEach(function (module) {
      if (module && typeof module.name === "string") {
        map[module.name.toLowerCase()] = module;
      }
    });
    return map;
  }

  function makeEnvironmentMap(environment) {
    var map = {};

    if (environment && Array.isArray(environment.constraints)) {
      environment.constraints.forEach(function (constraint) {
        if (constraint && typeof constraint.key === "string") {
          map[constraint.key] = constraint;
        }
      });
    }
    return map;
  }

  function parseLineRanges(value) {
    var ranges = [];
    var items;
    var invalid = false;

    if (value === "-") {
      return ranges;
    }
    if (value === "" || /\s/.test(value)) {
      return null;
    }
    items = value.split(",");
    items.forEach(function (item) {
      var parts = item.split("-");

      if ((parts.length !== 1 && parts.length !== 2) ||
          !CANONICAL_NUMBER.test(parts[0]) ||
          (parts.length === 2 && !CANONICAL_NUMBER.test(parts[1]))) {
        invalid = true;
        return;
      }
      if (parts.length === 2 &&
          compareDecimals(parts[0], parts[1]) > 0) {
        invalid = true;
        return;
      }
      ranges.push({
        start: parts[0],
        end: parts.length === 2 ? parts[1] : parts[0]
      });
    });
    return invalid || ranges.length === 0 ? null : ranges;
  }

  function parseMeta(token) {
    var values = {};
    var index;
    var pair;

    if (!token || token.parts.length !== 8) {
      return null;
    }
    for (index = 0; index < META_NAMES.length; index += 1) {
      pair = token.parts[index + 2].split("=");
      if (pair.length !== 2 || pair[0] !== META_NAMES[index] ||
          pair[1] === "") {
        return null;
      }
      values[pair[0]] = pair[1];
    }
    if (values.PROC !== "-" && !VBA_IDENTIFIER.test(values.PROC)) {
      return null;
    }
    return values;
  }

  function validateFinding(raw, context) {
    var meta;
    var ranges;
    var module;
    var lineLimit;
    var textValues = {};
    var result;

    if (!CANONICAL_NUMBER.test(raw.number)) {
      return failure("D28", "findingNumber");
    }
    if (raw.meta.length !== 1) {
      return failure("D08", "metaCardinality");
    }
    meta = parseMeta(raw.meta[0]);
    if (meta === null) {
      return failure("D09", "metaShape");
    }
    if (CLASSES.indexOf(meta.CLASS) < 0 ||
        CONFIDENCES.indexOf(meta.CONFIDENCE) < 0) {
      return failure("D10", "metaEnum");
    }
    if (meta.CONFIDENCE === "UNVERIFIED" &&
        ["CONDITIONAL", "EXTERNAL", "INFO"].indexOf(meta.CLASS) < 0) {
      return failure("D11", "confidenceClass");
    }
    if (meta.CLASS === "BLOCKER" && meta.ENVKEY === "-") {
      return failure("D12", "blockerEnvironment");
    }
    module = meta.MODULE === "-"
      ? null
      : context.moduleMap[meta.MODULE.toLowerCase()];
    if (meta.MODULE !== "-" && !module) {
      return failure(
        "D13",
        "unknownModule",
        MESSAGES.unknownReference);
    }
    if (meta.ENVKEY !== "-" && !context.environmentMap[meta.ENVKEY]) {
      return failure(
        "D14",
        "unknownEnvironmentKey",
        MESSAGES.unknownReference);
    }
    ranges = parseLineRanges(meta.LINES);
    if (ranges === null) {
      return failure("D15", "lineShape");
    }
    if (raw.textOrder.length !== TEXT_NAMES.length ||
        TEXT_NAMES.some(function (name) {
          return !Object.prototype.hasOwnProperty.call(raw.texts, name) ||
            bodyText(raw.texts[name]) === "";
        })) {
      return failure("D16", "textCardinality");
    }
    TEXT_NAMES.forEach(function (name) {
      textValues[name] = bodyText(raw.texts[name]);
    });
    if (meta.MODULE === "-" && meta.PROC !== "-") {
      return failure("D23", "procedureWithoutModule");
    }
    if (meta.MODULE === "-" && meta.LINES !== "-") {
      return failure("D24", "linesWithoutModule");
    }
    if (ranges.length > 0) {
      lineLimit = module && Number(module.lineCount);
      if (!isFinite(lineLimit) || lineLimit < 0 ||
          ranges.some(function (range) {
            return range.start === "0" ||
              compareDecimals(range.end, String(lineLimit)) > 0;
          })) {
        return failure("D25", "lineBounds");
      }
    }
    if (meta.CLASS === "BLOCKER" &&
        context.environmentMap[meta.ENVKEY].effect !== "blocked") {
      return failure("D26", "blockerEffect");
    }
    if (textValues.TITLE.indexOf(CRLF) >= 0 ||
        Array.from(textValues.TITLE).length > 120) {
      return failure("D27", "titleShape");
    }

    result = {
      number: raw.number,
      class: meta.CLASS,
      confidence: meta.CONFIDENCE,
      module: meta.MODULE,
      procedure: meta.PROC,
      lines: meta.LINES,
      environmentKey: meta.ENVKEY,
      texts: {
        title: textValues.TITLE,
        condition: textValues.CONDITION,
        impact: textValues.IMPACT,
        evidence: textValues.EVIDENCE
      }
    };
    return { ok: true, finding: result };
  }

  function readEnvelope(lines, requestId) {
    var tokens = readTokens(lines);
    var beginTokens;
    var endTokens;
    var begin;
    var end;

    if (typeof requestId !== "string" || requestId === "") {
      return failure("D01", "otherRequest", MESSAGES.otherRequest);
    }
    if (tokens.some(function (token) {
      return token.requestId !== requestId;
    })) {
      return failure("D01", "otherRequest", MESSAGES.otherRequest);
    }
    beginTokens = tokens.filter(function (token) {
      return token.directive === "DIAG" &&
        (token.parts[2] || "").toUpperCase() === "BEGIN";
    });
    endTokens = tokens.filter(function (token) {
      return token.directive === "DIAG" &&
        (token.parts[2] || "").toUpperCase() === "END";
    });
    if (beginTokens.length !== 1 || endTokens.length !== 1 ||
        beginTokens[0].parts.length !== 4 ||
        endTokens[0].parts.length !== 3 ||
        beginTokens[0].index >= endTokens[0].index) {
      return failure("D02", "envelope", MESSAGES.incomplete);
    }
    begin = beginTokens[0];
    end = endTokens[0];
    if (tokens.some(function (token) {
      return token.index < begin.index || token.index > end.index;
    })) {
      return failure("D22", "sentinelOutside");
    }
    // The number on the opening line is the count of findings in this
    // reply, the same value COMPLETE carries. It used to be a format
    // version that nothing told the answerer about, next to three other
    // trailing numbers that are all counts - so a correct diagnosis of
    // four findings opened with "DIAG BEGIN 4" and the whole reply was
    // refused. The version is not on the wire at all now: a reply is
    // bound to the request id MacroStudio issued, so it cannot be a
    // reply to another format.
    if (!CANONICAL_NUMBER.test(begin.parts[3])) {
      return failure("D03", "beginShape");
    }
    return {
      ok: true,
      tokens: tokens,
      begin: begin,
      end: end,
      declaredCount: begin.parts[3]
    };
  }

  function readPart(envelope, requirePart) {
    var tokens = envelope.tokens.filter(function (token) {
      return token.directive === "PART";
    });
    var token;
    var index;
    var total;

    if (!requirePart && tokens.length > 0) {
      return failure("DP01", "partUnexpected");
    }
    if (!requirePart) {
      return { ok: true, part: null };
    }
    if (tokens.length !== 1) {
      return failure("DP01", "partCardinality");
    }
    token = tokens[0];
    if (token.index !== envelope.begin.index + 1 ||
        token.parts.length !== 5 ||
        (token.parts[3] || "").toUpperCase() !== "OF") {
      return failure("DP02", "partShape");
    }
    index = readPartNumber(token.parts[2]);
    total = readPartNumber(token.parts[4]);
    if (index < 0 || total < 1 || index >= total) {
      return failure("DP02", "partShape");
    }
    return {
      ok: true,
      part: { index: index, total: total }
    };
  }

  function parseStructure(lines, envelope, part, context) {
    var sectionBodies = {};
    var sectionOrder = [];
    var findings = [];
    var findingNumbers = {};
    var completes = [];
    var noFindings = [];
    var openSection = null;
    var openFinding = null;
    var openText = null;
    var index;
    var line;
    var token;
    var action;
    var name;
    var normalizedNumber;
    var validated = [];
    var check;
    var complete;

    for (index = envelope.begin.index + 1;
        index < envelope.end.index;
        index += 1) {
      line = lines[index];
      token = readSentinel(line, index);
      if (token === null) {
        if (openText !== null) {
          openFinding.texts[openText].push(line);
        } else if (openSection !== null) {
          sectionBodies[openSection].push(line);
        }
        continue;
      }
      if (token.directive === "PART") {
        continue;
      }
      if (token.directive === "SECTION") {
        action = (token.parts[2] || "").toUpperCase();
        name = (token.parts[3] || "").toUpperCase();
        if (token.parts.length !== 4 ||
            (action !== "BEGIN" && action !== "END")) {
          return failure("D04", "sectionShape");
        }
        if (SECTION_NAMES.indexOf(name) < 0) {
          return failure("D05", "unknownSection");
        }
        if (action === "BEGIN") {
          if (openSection !== null || openFinding !== null ||
              Object.prototype.hasOwnProperty.call(sectionBodies, name)) {
            return failure("D04", "sectionCardinality");
          }
          openSection = name;
          sectionBodies[name] = [];
          sectionOrder.push(name);
        } else {
          if (openSection !== name || openFinding !== null) {
            return failure("D04", "sectionPair");
          }
          openSection = null;
        }
        continue;
      }
      if (token.directive === "FINDING") {
        action = (token.parts[2] || "").toUpperCase();
        name = token.parts[3] || "";
        if (token.parts.length !== 4 ||
            (action !== "BEGIN" && action !== "END")) {
          return failure("D06", "findingShape");
        }
        if (action === "BEGIN") {
          if (!DIGITS.test(name)) {
            return failure("D07", "findingDigits");
          }
          normalizedNumber = normalizeDecimal(name);
          if (Object.prototype.hasOwnProperty.call(
            findingNumbers,
            normalizedNumber)) {
            return failure("D07", "findingDuplicate");
          }
          if (openFinding !== null || openSection !== null) {
            return failure("D06", "findingNested");
          }
          findingNumbers[normalizedNumber] = true;
          openFinding = {
            number: name,
            meta: [],
            texts: {},
            textOrder: []
          };
        } else {
          if (openFinding === null || openText !== null ||
              openFinding.number !== name) {
            return failure("D06", "findingPair");
          }
          findings.push(openFinding);
          openFinding = null;
        }
        continue;
      }
      if (token.directive === "META") {
        if (openFinding === null || openText !== null) {
          return failure("D08", "metaPosition");
        }
        openFinding.meta.push(token);
        continue;
      }
      if (token.directive === "TEXT") {
        action = (token.parts[2] || "").toUpperCase();
        name = (token.parts[3] || "").toUpperCase();
        if (token.parts.length !== 4 ||
            (action !== "BEGIN" && action !== "END")) {
          return failure("D16", "textShape");
        }
        if (TEXT_NAMES.indexOf(name) < 0) {
          return failure("D17", "unknownText");
        }
        if (action === "BEGIN") {
          if (openFinding === null || openText !== null ||
              Object.prototype.hasOwnProperty.call(
                openFinding.texts,
                name)) {
            return failure("D16", "textCardinality");
          }
          openText = name;
          openFinding.texts[name] = [];
          openFinding.textOrder.push(name);
        } else {
          if (openFinding === null || openText !== name) {
            return failure("D16", "textPair");
          }
          openText = null;
        }
        continue;
      }
      if (token.directive === "DIAG") {
        action = (token.parts[2] || "").toUpperCase();
        if (action === "COMPLETE") {
          completes.push(token.parts.length === 4
            ? token.parts[3]
            : null);
          continue;
        }
        if (action === "NOFINDING") {
          noFindings.push(token.parts.length === 4
            ? token.parts[3]
            : null);
          continue;
        }
        return failure("D02", "unexpectedDiag");
      }
      return failure("D02", "unknownSentinel");
    }

    if (openSection !== null) {
      return failure("D04", "sectionPair");
    }
    if (openText !== null) {
      return failure("D16", "textPair");
    }
    if (openFinding !== null) {
      return failure("D06", "findingPair");
    }
    if (part && part.index > 0 && sectionOrder.length > 0) {
      return failure("D04", "laterPartSection");
    }
    if ((!part || part.index === 0) &&
        (sectionOrder.length !== SECTION_NAMES.length ||
         SECTION_NAMES.some(function (sectionName) {
           return !Object.prototype.hasOwnProperty.call(
             sectionBodies,
             sectionName) ||
             bodyText(sectionBodies[sectionName]) === "";
         }))) {
      return failure("D04", "sectionCardinality");
    }

    for (index = 0; index < findings.length; index += 1) {
      check = validateFinding(findings[index], context);
      if (!check.ok) {
        return check;
      }
      validated.push(check.finding);
    }
    validated.sort(function (left, right) {
      return compareDecimals(left.number, right.number);
    });

    if (completes.length !== 1 ||
        completes[0] === null ||
        !CANONICAL_NUMBER.test(completes[0])) {
      return failure("D18", "completeShape", MESSAGES.incomplete);
    }
    complete = completes[0];
    if (complete !== String(validated.length)) {
      return failure("D19", "completeCount");
    }
    // The reply says how many findings it carries twice, at the top and
    // at the bottom. Both have to be the number actually written.
    if (envelope.declaredCount !== String(validated.length)) {
      return failure("D29", "beginCount");
    }
    if (part && part.total > 1 && noFindings.length > 0) {
      return failure("D20", "prematureNoFinding");
    }

    return {
      ok: true,
      fragment: {
        requestId: context.requestId,
        version: VERSION,
        sections: {
          PURPOSE: sectionBodies.PURPOSE
            ? bodyText(sectionBodies.PURPOSE)
            : null,
          FLOW: sectionBodies.FLOW ? bodyText(sectionBodies.FLOW) : null,
          DEPENDENCY: sectionBodies.DEPENDENCY
            ? bodyText(sectionBodies.DEPENDENCY)
            : null,
          ENVIRONMENT: sectionBodies.ENVIRONMENT
            ? bodyText(sectionBodies.ENVIRONMENT)
            : null
        },
        findings: validated,
        noFindings: noFindings
      }
    };
  }

  function validateConclusion(diagnosis) {
    var reasons = diagnosis.noFindings;

    if (diagnosis.findings.length === 0) {
      if (reasons.length !== 1 ||
          NO_FINDING_REASONS.indexOf(reasons[0]) < 0) {
        return failure("D20", "noFinding");
      }
      diagnosis.noFinding = reasons[0];
    } else {
      if (reasons.length !== 0) {
        return failure("D21", "noFindingContradiction");
      }
      diagnosis.noFinding = null;
    }
    delete diagnosis.noFindings;
    return success(diagnosis);
  }

  function parseCore(text, options, requirePart) {
    return parseLines(
      splitLines(text === undefined || text === null ? "" : text),
      text,
      options,
      requirePart,
      false);
  }

  function parseLines(lines, text, options, requirePart, recovered) {
    var context;
    var envelope;
    var partResult;
    var structure;
    var diagnosis;
    var retry;

    function withRecovery(result) {
      if (!result.ok || !recovered) {
        return result;
      }
      result.recovered = true;
      return result;
    }

    function fallback(result) {
      if (recovered || !looksCollapsed(lines, text)) {
        return result;
      }
      retry = parseLines(
        recoverLines(text), text, options, requirePart, true);
      return retry.ok ? retry : result;
    }

    options = options || {};
    context = {
      requestId: options.requestId,
      moduleMap: makeModuleMap(options.modules),
      environmentMap: makeEnvironmentMap(options.environment)
    };
    envelope = readEnvelope(lines, context.requestId);
    if (!envelope.ok) {
      return fallback(envelope);
    }
    partResult = readPart(envelope, requirePart);
    if (!partResult.ok) {
      return fallback(partResult);
    }
    structure = parseStructure(
      lines,
      envelope,
      partResult.part,
      context);
    if (!structure.ok) {
      return fallback(structure);
    }
    if (requirePart) {
      return withRecovery(brand({
        ok: true,
        code: "",
        validationId: "",
        reason: "",
        message: "",
        part: partResult.part,
        fragment: structure.fragment,
        fingerprint: JSON.stringify({
          total: partResult.part.total,
          fragment: structure.fragment
        })
      }));
    }
    diagnosis = structure.fragment;
    return withRecovery(fallback(validateConclusion(diagnosis)));
  }

  function parse(text, options) {
    return parseCore(text, options, false);
  }

  function parsePart(text, options) {
    return parseCore(text, options, true);
  }

  function createPartCollection() {
    return brand({ total: 0, parts: [] });
  }

  function listMissingParts(collection) {
    var missing = [];
    var seen = {};
    var index;

    if (!collection || collection.total < 1) {
      return missing;
    }
    collection.parts.forEach(function (entry) {
      seen[entry.index] = true;
    });
    for (index = 0; index < collection.total; index += 1) {
      if (!seen[index]) {
        missing.push(index);
      }
    }
    return missing;
  }

  function isPartCollectionComplete(collection) {
    return Boolean(collection) &&
      collection.total > 0 &&
      collection.parts.length === collection.total &&
      listMissingParts(collection).length === 0;
  }

  function partFailure(result, collection) {
    var failed = result && result.ok === false
      ? result
      : failure("DP03", "partMissing", MESSAGES.partMissing);

    failed.collection = collection || createPartCollection();
    failed.added = false;
    failed.complete = isPartCollectionComplete(failed.collection);
    failed.missing = listMissingParts(failed.collection);
    return failed;
  }

  function mergeParts(collection) {
    var ordered;
    var first;
    var findings = [];
    var seen = {};
    var reasons = [];
    var diagnosis;
    var result;

    if (!isProductResult(collection) || !isPartCollectionComplete(collection)) {
      return failure("DP03", "partMissing", MESSAGES.partMissing);
    }
    ordered = collection.parts.slice().sort(function (left, right) {
      return left.index - right.index;
    });
    first = ordered[0].parsed.fragment;
    if (!first.sections.PURPOSE || !first.sections.FLOW ||
        !first.sections.DEPENDENCY || !first.sections.ENVIRONMENT) {
      return failure("D04", "sectionCardinality");
    }
    ordered.forEach(function (entry) {
      entry.parsed.fragment.findings.forEach(function (finding) {
        var key = normalizeDecimal(finding.number);

        if (Object.prototype.hasOwnProperty.call(seen, key)) {
          result = failure("D07", "findingDuplicate");
          return;
        }
        seen[key] = true;
        findings.push(finding);
      });
      entry.parsed.fragment.noFindings.forEach(function (reason) {
        reasons.push(reason);
      });
    });
    if (result) {
      return result;
    }
    findings.sort(function (left, right) {
      return compareDecimals(left.number, right.number);
    });
    diagnosis = {
      requestId: first.requestId,
      version: VERSION,
      sections: first.sections,
      findings: findings,
      noFindings: reasons
    };
    return validateConclusion(diagnosis);
  }

  function addPart(collection, parsed) {
    var current = collection || createPartCollection();
    var existing = null;
    var next;
    var merged;
    var result;

    if (!isProductResult(current) || !isProductResult(parsed) ||
        !parsed.ok || !parsed.part) {
      return partFailure(parsed, current);
    }
    if (current.total > 0 && current.total !== parsed.part.total) {
      return partFailure(
        failure("DP04", "partTotalMismatch"),
        current);
    }
    current.parts.forEach(function (entry) {
      if (entry.index === parsed.part.index) {
        existing = entry;
      }
    });
    if (existing) {
      if (existing.parsed.fingerprint === parsed.fingerprint) {
        return brand({
          ok: true,
          code: "",
          validationId: "",
          reason: "",
          message: "",
          collection: current,
          added: false,
          complete: isPartCollectionComplete(current),
          missing: listMissingParts(current),
          diagnosis: isPartCollectionComplete(current)
            ? mergeParts(current).diagnosis
            : null
        });
      }
      return partFailure(
        failure("DP05", "partConflict", MESSAGES.partConflict),
        current);
    }
    next = brand({
      total: parsed.part.total,
      parts: current.parts.concat([{
        index: parsed.part.index,
        parsed: parsed
      }])
    });
    next.parts.sort(function (left, right) {
      return left.index - right.index;
    });
    if (isPartCollectionComplete(next)) {
      merged = mergeParts(next);
      if (!merged.ok) {
        return partFailure(merged, current);
      }
    }
    result = brand({
      ok: true,
      code: "",
      validationId: "",
      reason: "",
      message: "",
      collection: next,
      added: true,
      complete: isPartCollectionComplete(next),
      missing: listMissingParts(next),
      diagnosis: merged ? merged.diagnosis : null
    });
    return result;
  }

  // A diagnosis read back from the run folder. JSON cannot carry the
  // brand, so the shape is checked again before it is trusted: anything
  // that is not exactly what parse() produces is refused rather than
  // adopted. This is a re-check of our own record, not a second parser.
  function restore(value) {
    var source = value;
    var findings;
    var copy;

    function isText(candidate) {
      return typeof candidate === "string";
    }

    if (!source || typeof source !== "object" ||
        !global.MacroStudioResponse.isRequestId(source.requestId) ||
        String(source.version) !== VERSION ||
        !source.sections || typeof source.sections !== "object" ||
        !Array.isArray(source.findings)) {
      return null;
    }
    if (SECTION_NAMES.some(function (name) {
      return !isText(source.sections[name]);
    })) {
      return null;
    }
    findings = source.findings.map(function (finding) {
      if (!finding || typeof finding !== "object" ||
          !CANONICAL_NUMBER.test(String(finding.number)) ||
          CLASSES.indexOf(finding["class"]) < 0 ||
          CONFIDENCES.indexOf(finding.confidence) < 0 ||
          !isText(finding.module) || !isText(finding.procedure) ||
          !isText(finding.lines) || !isText(finding.environmentKey) ||
          !finding.texts || typeof finding.texts !== "object" ||
          !isText(finding.texts.title) ||
          !isText(finding.texts.condition) ||
          !isText(finding.texts.impact) ||
          !isText(finding.texts.evidence)) {
        return null;
      }
      return {
        number: String(finding.number),
        "class": finding["class"],
        confidence: finding.confidence,
        module: finding.module,
        procedure: finding.procedure,
        lines: finding.lines,
        environmentKey: finding.environmentKey,
        texts: {
          title: finding.texts.title,
          condition: finding.texts.condition,
          impact: finding.texts.impact,
          evidence: finding.texts.evidence
        }
      };
    });
    if (findings.some(function (finding) { return finding === null; })) {
      return null;
    }
    if (findings.length === 0) {
      if (NO_FINDING_REASONS.indexOf(source.noFinding) < 0) {
        return null;
      }
    } else if (source.noFinding !== null && source.noFinding !== undefined) {
      return null;
    }
    copy = {
      requestId: source.requestId,
      version: VERSION,
      sections: {},
      findings: findings,
      noFinding: findings.length === 0 ? source.noFinding : null
    };
    SECTION_NAMES.forEach(function (name) {
      copy.sections[name] = source.sections[name];
    });
    return brand(copy);
  }

  function formatForRecord(diagnosis) {
    var lines = ["# 診断結果", ""];

    if (!isProductResult(diagnosis)) {
      return "";
    }
    SECTION_NAMES.forEach(function (name) {
      lines.push("## " + name);
      lines.push("");
      lines.push(diagnosis.sections[name]);
      lines.push("");
    });
    if (diagnosis.findings.length === 0) {
      lines.push("## 指摘");
      lines.push("");
      lines.push("- 0 件（" + diagnosis.noFinding + "）");
      lines.push("");
    }
    diagnosis.findings.forEach(function (finding) {
      lines.push("## #" + finding.number + " " + finding.texts.title);
      lines.push("");
      lines.push(
        "- META: CLASS=" + finding.class +
        " CONFIDENCE=" + finding.confidence +
        " MODULE=" + finding.module +
        " PROC=" + finding.procedure +
        " LINES=" + finding.lines +
        " ENVKEY=" + finding.environmentKey);
      lines.push("- CONDITION: " + finding.texts.condition);
      lines.push("- IMPACT: " + finding.texts.impact);
      lines.push("- EVIDENCE: " + finding.texts.evidence);
      lines.push("");
    });
    return lines.join(CRLF).replace(/(?:\r\n)+$/, "") + CRLF;
  }

  global.MacroStudioDiagnosis = {
    marker: MARKER,
    version: VERSION,
    sectionNames: SECTION_NAMES.slice(),
    textNames: TEXT_NAMES.slice(),
    classes: CLASSES.slice(),
    confidences: CONFIDENCES.slice(),
    noFindingReasons: NO_FINDING_REASONS.slice(),
    isProductResult: isProductResult,
    parse: parse,
    parsePart: parsePart,
    createPartCollection: createPartCollection,
    listMissingParts: listMissingParts,
    isPartCollectionComplete: isPartCollectionComplete,
    addPart: addPart,
    mergeParts: mergeParts,
    formatForRecord: formatForRecord,
    restore: restore
  };
}(window));
