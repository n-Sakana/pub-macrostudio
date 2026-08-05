(function (global) {
  "use strict";

  // One answer, one code block. Every module inside it is wrapped in
  // sentinel lines that carry the request id this app issued, so a
  // stale or foreign answer can never be applied by accident.
  //
  //   '@MACROSTUDIO <request id> SUMMARY BEGIN
  //   ...what was changed, in plain words...
  //   '@MACROSTUDIO <request id> SUMMARY END
  //   '@MACROSTUDIO <request id> BEGIN <kind> <name>
  //   ...module code...
  //   '@MACROSTUDIO <request id> END <kind> <name>
  //   '@MACROSTUDIO <request id> COMPLETE <module count>
  //
  // The marker starts with an apostrophe so each sentinel is also a
  // valid VBA comment, and carries the random id so it cannot collide
  // with anything already in the workbook.
  //
  // When the code is too long for one answer, the same block carries one
  // module per answer and says which one it is:
  //
  //   '@MACROSTUDIO <request id> PART 00 OF 03
  //
  // The parts are collected here and merged back into one package, so
  // everything after the intake sees a single answer either way.
  //
  // There are exactly two answers. The other one is a refusal, which is
  // a result rather than a failure, so it has to say which refusal it is
  // and why. It never asks anything back: a request that cannot be
  // settled from what was given comes back as UNCLEAR with the reason.
  //
  //   '@MACROSTUDIO <request id> SUMMARY BEGIN
  //   ...why, and what was looked at...
  //   '@MACROSTUDIO <request id> SUMMARY END
  //   '@MACROSTUDIO <request id> NOCHANGE UNNECESSARY
  //   '@MACROSTUDIO <request id> COMPLETE 0
  //
  // All four things are required. An answer that merely stops, or comes
  // back empty, or is cut off, says none of this and must keep being
  // refused: silence is not a verdict.
  var MARKER = "'@MACROSTUDIO";
  var KINDS = ["standard", "class", "form", "document"];
  // UNNECESSARY: the macro already does what was asked.
  // IMPOSSIBLE: it could be done, but not by rewriting these modules.
  // A repair answer has exactly two shapes: the changed code, or a
  // refusal with a reason. These are the reasons a refusal may give.
  // None of them starts a conversation - "I would need to ask you
  // something" is UNCLEAR, written as a reason, not as a question.
  var VERDICTS = ["UNNECESSARY", "IMPOSSIBLE", "UNCLEAR"];
  var NAME_PATTERN = /^[A-Za-zÀ-￿][\wÀ-￿]{0,30}$/;
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
    empty:
      "クリップボードが空でした。AIの返答のコードブロックをコピーして、" +
      "もう一度お試しください。",
    noSentinel:
      "取り込める形のコードが見つかりませんでした。AIの返答の" +
      "コードブロック全体をコピーして、もう一度お試しください。",
    otherRequest:
      "別の依頼への返答のようです。いまの依頼文をコピーし直して、" +
      "AIへもう一度送ってください。",
    truncated:
      "返答が途中で切れているようです。コードブロック全体を" +
      "コピーし直して、もう一度お試しください。",
    mismatch:
      "モジュールの区切りが揃っていません。コードブロック全体を" +
      "コピーし直して、もう一度お試しください。",
    duplicate:
      "同じモジュールが2回入っていました。AIへ、モジュールごとに" +
      "1つだけ返すよう伝えてください。",
    unknownKind:
      "知らない種類のモジュールが含まれていました。コードブロック全体を" +
      "コピーし直して、もう一度お試しください。",
    badName:
      "モジュール名として使えない名前が含まれていました。" +
      "AIの返答をコピーし直して、もう一度お試しください。",
    emptyModule:
      "中身のないモジュールが含まれていました。AIへ、変更したモジュールの" +
      "全文を返すよう伝えてください。",
    partShape:
      "何番目のモジュールかを示す行が読み取れませんでした。" +
      "コードブロック全体をコピーし直して、もう一度お試しください。",
    partMissing:
      "何番目のモジュールかを示す行がありません。AIへ、モジュール番号の" +
      "行を付けて返すよう伝えてください。",
    partUnexpected:
      "モジュールを1つずつ返す形の返答でした。依頼文の画面で" +
      "「モジュール単位出力」を選んでから、取り込み直してください。",
    partMultipleModules:
      "1回の返答に複数のモジュールが入っていました。AIへ、1回につき" +
      "1つのモジュールだけ返すよう伝えてください。",
    partTotalMismatch:
      "返答に書かれているモジュールの合計数が、前の返答と違っています。" +
      "いまの依頼文をコピーし直して、AIへもう一度送ってください。",
    partConflict:
      "同じ番号のモジュールが、前と違う内容で届きました。" +
      "［最初から取り込み直す］を押してから、もう一度取り込んでください。",
    partDuplicateModule:
      "同じモジュールが別の番号でも届きました。AIへ、モジュールごとに" +
      "1回だけ返すよう伝えてください。",
    noChangeVerdict:
      "「変更なし」の返答に、改修が不要なのか、できないのかが" +
      "書かれていませんでした。コードブロック全体をコピーし直して、" +
      "もう一度お試しください。",
    noChangeReason:
      "「変更なし」の返答に理由が書かれていませんでした。AIへ、" +
      "そう判断した理由を要約に書いて返すよう伝えてください。",
    noChangeContradiction:
      "「変更なし」と書かれているのに、モジュールも入っていました。" +
      "コードブロック全体をコピーし直して、もう一度お試しください。",
    newModuleKind:
      "新しく増やせるのは標準モジュールだけです。" +
      "AIへ、追加する補助モジュールは標準モジュールにするよう" +
      "伝えて、もう一度お試しください。",
    questionNotAllowed:
      "AIが質問や選択肢を返してきました。改修の返答は、直したコードを" +
      "返すか、直せない理由を返すかのどちらかです。" +
      "AIへ、決められないなら NOCHANGE UNCLEAR と理由で返すよう" +
      "伝えてください。",
    // Four refusals for the four things the guard can actually see. Each
    // names what it found and where, because "構造が変わっています" alone
    // leaves the reader nothing to check.
    structureNewModule:
      "変更範囲を「{scope}」にしているあいだ、新しいモジュールは" +
      "取り込めません。返答に {name} が入っていました。" +
      "処理の分割やクラス化が必要なら、変更範囲の詳細オプションで" +
      "構造変更を許可してから、もう一度依頼してください。",
    structureRemovedProcedure:
      "変更範囲を「{scope}」にしているあいだ、手続きを消す変更は" +
      "取り込めません。{name} から {proc} が無くなっていました。" +
      "呼び出し元が壊れる変更なので、必要なら変更範囲の詳細オプションで" +
      "構造変更を許可してから、もう一度依頼してください。",
    structureMovedProcedure:
      "変更範囲を「{scope}」にしているあいだ、手続きを別のモジュールへ" +
      "移す変更は取り込めません。{proc} は元は {from} にありましたが、" +
      "{name} に入っていました。必要なら変更範囲の詳細オプションで" +
      "構造変更を許可してから、もう一度依頼してください。",
    structureRewritten:
      "変更範囲を「{scope}」にしているあいだ、モジュールをほぼ全面的に" +
      "書き換える変更は取り込めません。{name} は {lines} 行のうち " +
      "{changed} 行が変わっていました。作り直しが必要なら、変更範囲の" +
      "詳細オプションで構造変更を許可してから、もう一度依頼してください。"
  };

  function createRequestIdentity() {
    var bytes;
    var index;
    var text = "";
    var crypto = global.crypto || global.msCrypto;
    var secure = false;

    if (crypto && typeof crypto.getRandomValues === "function") {
      try {
        bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        secure = true;
      } catch (ignore) {
        bytes = null;
      }
    }
    if (!bytes) {
      bytes = [];
      for (index = 0; index < 16; index += 1) {
        bytes.push(Math.floor(Math.random() * 256));
      }
    }
    // RFC 4122 version 4 shape, so the id reads as an ordinary UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    for (index = 0; index < 16; index += 1) {
      text += (bytes[index] + 0x100).toString(16).slice(1);
      if (index === 3 || index === 5 || index === 7 || index === 9) {
        text += "-";
      }
    }
    return { id: text, secure: secure };
  }

  function createRequestId() {
    return createRequestIdentity().id;
  }

  function isRequestId(value) {
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        .test(value);
  }

  function beginLine(requestId, kind, name) {
    return MARKER + " " + requestId + " BEGIN " + kind + " " + name;
  }

  function endLine(requestId, kind, name) {
    return MARKER + " " + requestId + " END " + kind + " " + name;
  }

  function summaryBeginLine(requestId) {
    return MARKER + " " + requestId + " SUMMARY BEGIN";
  }

  function summaryEndLine(requestId) {
    return MARKER + " " + requestId + " SUMMARY END";
  }

  function completeLine(requestId, count) {
    return MARKER + " " + requestId + " COMPLETE " + String(count);
  }

  // Module numbers are written 00, 01, 02 ... so the reader can tell at
  // a glance which one is missing.
  function formatPartNumber(value) {
    var text = String(Math.max(0, Number(value) || 0));

    return text.length >= 2 ? text : "0" + text;
  }

  function partLine(requestId, index, total) {
    return MARKER + " " + requestId + " PART " +
      formatPartNumber(index) + " OF " + formatPartNumber(total);
  }

  function failure(reason, validationId) {
    var result = brand({
      ok: false,
      reason: reason,
      message: MESSAGES[reason] || MESSAGES.noSentinel,
      modules: []
    });

    if (validationId) {
      result.validationId = validationId;
    }
    return result;
  }

  function readCount(text) {
    var value = String(text === undefined ? "" : text);

    if (!/^\d{1,4}$/.test(value)) {
      return -1;
    }
    return Number(value);
  }

  function splitLines(text) {
    return String(text)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
  }

  // ---- decoration a chat client added on the way out ----
  //
  // Quoting the block, turning it into a bullet, HTML-escaping it or
  // swapping the apostrophe for a typographic one are all things the
  // client does, not things the answer got wrong, and asking again does
  // not fix any of them.
  //
  // Only a line that was not a sentinel and becomes one is replaced.
  // Module bodies are code and are taken verbatim; nothing here can turn
  // a line of VBA into a sentinel, because it only removes and never
  // invents the marker. The diagnosis contract keeps its own copy of
  // this: the two wire formats are owned separately on purpose.
  var ENTITIES = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&apos;": "'",
    "&#39;": "'",
    "&#x27;": "'",
    "&nbsp;": " ",
    "&amp;": "&"
  };

  function undecorate(line) {
    var value = String(line).replace(/^[\s　]+|[\s　]+$/g, "");

    value = value.replace(/^(?:>[\s　]*)+/, "");
    value = value.replace(/^(?:[-*+]|\d+[.)])[\s　]+/, "");
    value = value.replace(/<\/?(?:code|pre|span|p|div|strong|em|b|i)>/gi, "");
    value = value.replace(/^`+/, "").replace(/`+$/, "");
    value = value.replace(
      /&(?:lt|gt|quot|apos|nbsp|amp|#39|#x27);/gi,
      function (found) {
        var key = found.toLowerCase();

        return Object.prototype.hasOwnProperty.call(ENTITIES, key)
          ? ENTITIES[key]
          : found;
      });
    value = value.replace(/^[\s　]+/, "");
    value = value.replace(/^[‘’‛ʼ´＇`]/, "'");
    value = value.replace(/^'＠/, "'@");
    value = value.replace(/^＠/, "@");
    if (value.indexOf("@MACROSTUDIO") === 0) {
      value = "'" + value;
    }
    return value;
  }

  function isSentinelLine(line) {
    return String(line).replace(/^[\s　]+|[\s　]+$/g, "")
      .indexOf(MARKER) === 0;
  }

  function normalizeLines(lines) {
    return lines.map(function (line) {
      var repaired;

      if (isSentinelLine(line)) {
        return line;
      }
      repaired = undecorate(line);
      return isSentinelLine(repaired) ? repaired : line;
    });
  }

  // A sentinel is recognised on its own line only, so a marker-looking
  // string inside real code cannot end a module.
  function readSentinel(line) {
    var trimmed = String(line).replace(/^[\s　]+|[\s　]+$/g, "");
    var rest;
    var parts;

    if (trimmed.indexOf(MARKER) !== 0) {
      return null;
    }
    rest = trimmed.slice(MARKER.length).replace(/^\s+/, "");
    parts = rest.split(/\s+/);
    if (parts.length < 2) {
      return { requestId: parts[0] || "", directive: "", parts: parts };
    }
    return {
      requestId: parts[0],
      directive: parts[1].toUpperCase(),
      parts: parts
    };
  }

  function trimBlankEdges(lines) {
    var start = 0;
    var end = lines.length;

    while (start < end &&
        String(lines[start]).replace(/[\s\u3000]/g, "") === "") {
      start += 1;
    }
    while (end > start &&
        String(lines[end - 1]).replace(/[\s\u3000]/g, "") === "") {
      end -= 1;
    }
    return lines.slice(start, end);
  }

  function parse(text, requestId) {
    var lines;
    var modules = [];
    var seen = {};
    var open = null;
    var body = [];
    var completed = null;
    var sawMarker = false;
    var summary = [];
    var inSummary = false;
    var part = null;
    var noChange = null;
    var index;
    var sentinel;
    var kind;
    var name;
    var partIndex;
    var partTotal;
    var verdict;

    if (!isRequestId(requestId)) {
      return failure("otherRequest");
    }
    if (typeof text !== "string" ||
        text.replace(/[\s　]/g, "").length === 0) {
      return failure("empty");
    }

    lines = normalizeLines(splitLines(text));
    for (index = 0; index < lines.length; index += 1) {
      sentinel = readSentinel(lines[index]);
      if (sentinel === null) {
        // Fence lines outside a module are chrome; inside a module the
        // code is taken verbatim.
        if (open !== null) {
          body.push(lines[index]);
        } else if (inSummary) {
          summary.push(lines[index]);
        }
        continue;
      }
      sawMarker = true;
      if (sentinel.requestId !== requestId) {
        return failure("otherRequest");
      }
      // The reply may not ask the reader anything. A request that
      // cannot be answered comes back as a refusal with a reason,
      // not as a question, so any decision sentinel is refused
      // here rather than turned into a dialogue.
      if (sentinel.directive === "DECISION" ||
          (sentinel.directive === "TEXT" &&
           (String(sentinel.parts[3] || "").toUpperCase() ===
              "QUESTION" ||
            String(sentinel.parts[3] || "").toUpperCase() ===
              "OPTIONS"))) {
        return failure("questionNotAllowed", "R3");
      }
      if (sentinel.directive === "SUMMARY") {
        if (open !== null) {
          return failure("mismatch");
        }
        if (sentinel.parts.length !== 3) {
          return failure("mismatch");
        }
        if (sentinel.parts[2].toUpperCase() === "BEGIN") {
          if (inSummary) {
            return failure("mismatch");
          }
          inSummary = true;
          continue;
        }
        if (sentinel.parts[2].toUpperCase() === "END") {
          if (!inSummary) {
            return failure("mismatch");
          }
          inSummary = false;
          continue;
        }
        return failure("mismatch");
      }
      if (inSummary) {
        return failure("mismatch");
      }
      // Which module of the whole change this answer carries. It says
      // so itself; nothing here guesses the order.
      if (sentinel.directive === "PART") {
        if (open !== null || part !== null) {
          return failure("mismatch");
        }
        if (sentinel.parts.length !== 5 ||
            sentinel.parts[3].toUpperCase() !== "OF") {
          return failure("partShape");
        }
        partIndex = readCount(sentinel.parts[2]);
        partTotal = readCount(sentinel.parts[4]);
        if (partIndex < 0 ||
            partTotal < 1 ||
            partIndex >= partTotal) {
          return failure("partShape");
        }
        part = { index: partIndex, total: partTotal };
        continue;
      }
      // The answer concluding that nothing should change. It has to
      // name which conclusion it reached; anything else is unreadable
      // rather than empty.
      if (sentinel.directive === "NOCHANGE") {
        if (noChange !== null) {
          return failure("mismatch");
        }
        if (sentinel.parts.length !== 3) {
          return failure("noChangeVerdict");
        }
        verdict = sentinel.parts[2].toUpperCase();
        if (VERDICTS.indexOf(verdict) < 0) {
          return failure("noChangeVerdict");
        }
        noChange = verdict;
        continue;
      }
      if (sentinel.directive === "BEGIN") {
        if (open !== null) {
          return failure("mismatch");
        }
        if (sentinel.parts.length !== 4) {
          return failure("mismatch");
        }
        kind = sentinel.parts[2].toLowerCase();
        name = sentinel.parts[3];
        if (KINDS.indexOf(kind) < 0) {
          return failure("unknownKind");
        }
        if (!NAME_PATTERN.test(name)) {
          return failure("badName");
        }
        if (Object.prototype.hasOwnProperty.call(
          seen,
          name.toLowerCase())) {
          return failure("duplicate");
        }
        open = { name: name, kind: kind };
        body = [];
        continue;
      }
      if (sentinel.directive === "END") {
        if (open === null || sentinel.parts.length !== 4) {
          return failure("mismatch");
        }
        if (sentinel.parts[2].toLowerCase() !== open.kind ||
            sentinel.parts[3] !== open.name) {
          return failure("mismatch");
        }
        if (body.join("").replace(/[\s　]/g, "").length === 0) {
          return failure("emptyModule");
        }
        seen[open.name.toLowerCase()] = true;
        modules.push({
          name: open.name,
          kind: open.kind,
          code: body.join("\r\n")
        });
        open = null;
        body = [];
        continue;
      }
      if (sentinel.directive === "COMPLETE") {
        if (open !== null) {
          return failure("truncated");
        }
        if (completed !== null ||
            sentinel.parts.length !== 3 ||
            !/^(0|[1-9][0-9]*)$/.test(sentinel.parts[2])) {
          return failure("mismatch", "R1");
        }
        completed = sentinel.parts[2];
        continue;
      }
      return failure("mismatch");
    }

    if (open !== null || inSummary) {
      return failure("truncated");
    }
    if (!sawMarker) {
      return failure("noSentinel");
    }
    summary = trimBlankEdges(summary);
    if (noChange !== null) {
      // Saying "nothing to change" and then sending modules is a
      // contradiction, and a verdict with no reason behind it is not
      // something to show anyone. Neither is a near miss to be waved
      // through.
      if (modules.length > 0) {
        return failure("noChangeContradiction");
      }
      if (part !== null) {
        return failure("mismatch");
      }
      if (summary.join("").replace(/[\s　]/g, "").length === 0) {
        return failure("noChangeReason");
      }
    } else if (modules.length === 0) {
      // No modules and no verdict: the answer simply stopped.
      return failure("truncated");
    }
    if (completed === null) {
      return failure("truncated");
    }
    if (completed !== String(modules.length)) {
      return failure("mismatch", "R1");
    }

    return brand({
      ok: true,
      reason: "",
      message: "",
      requestId: requestId,
      summary: summary.join("\r\n"),
      part: part,
      noChange: noChange,
      modules: modules
    });
  }

  // ---- one module per answer ----
  //
  // The parts are only collected and checked here. Nothing is read out
  // of the code itself: each answer says which module it is and how many
  // there will be, and those two statements have to keep agreeing.

  function createPartCollection() {
    return brand({ total: 0, parts: [] });
  }

  function listMissingParts(collection) {
    var missing = [];
    var seen = {};
    var index;

    if (!collection || !collection.total) {
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

  function partResult(collection, added) {
    return brand({
      ok: true,
      reason: "",
      message: "",
      modules: [],
      collection: collection,
      added: added === true,
      complete: isPartCollectionComplete(collection),
      missing: listMissingParts(collection)
    });
  }

  function partFailure(reason, collection) {
    var result = failure(reason);

    result.collection = collection || createPartCollection();
    result.added = false;
    result.complete = isPartCollectionComplete(result.collection);
    result.missing = listMissingParts(result.collection);
    return result;
  }

  function addPart(collection, parsed) {
    var current = collection || createPartCollection();
    var module;
    var existing = null;
    var clash = false;
    var next;

    if (!isProductResult(current) || !isProductResult(parsed) || !parsed.ok) {
      return partFailure(
        parsed && parsed.reason ? parsed.reason : "noSentinel",
        current);
    }
    if (!parsed.part) {
      return partFailure("partMissing", current);
    }
    if (parsed.modules.length !== 1) {
      return partFailure("partMultipleModules", current);
    }
    if (current.total > 0 && parsed.part.total !== current.total) {
      return partFailure("partTotalMismatch", current);
    }

    module = parsed.modules[0];
    current.parts.forEach(function (entry) {
      if (entry.index === parsed.part.index) {
        existing = entry;
        return;
      }
      if (entry.name.toLowerCase() === module.name.toLowerCase()) {
        clash = true;
      }
    });
    if (existing !== null) {
      // The same number arriving again is only accepted when it says
      // exactly the same thing. A different content under a number that
      // is already in is a contradiction, not a correction.
      if (existing.name.toLowerCase() === module.name.toLowerCase() &&
          existing.kind === module.kind &&
          existing.code === module.code) {
        return partResult(current, false);
      }
      return partFailure("partConflict", current);
    }
    if (clash) {
      return partFailure("partDuplicateModule", current);
    }

    next = brand({
      total: parsed.part.total,
      parts: current.parts.concat([{
        index: parsed.part.index,
        name: module.name,
        kind: module.kind,
        code: module.code,
        requestId: parsed.requestId,
        summary: parsed.summary || ""
      }])
    });
    next.parts.sort(function (left, right) {
      return left.index - right.index;
    });
    return partResult(next, true);
  }

  // The collected parts, read back as the one package the rest of the
  // flow already knows how to handle.
  function mergeParts(collection) {
    var summaries = [];

    if (!isProductResult(collection) || !isPartCollectionComplete(collection)) {
      return failure("truncated");
    }
    collection.parts.forEach(function (entry) {
      if (entry.summary) {
        summaries.push(entry.summary);
      }
    });
    return brand({
      ok: true,
      reason: "",
      message: "",
      requestId: collection.parts[0].requestId,
      summary: summaries.join("\r\n\r\n"),
      part: null,
      noChange: null,
      modules: collection.parts.map(function (entry) {
        return {
          name: entry.name,
          kind: entry.kind,
          code: entry.code
        };
      })
    });
  }

  // What is still outstanding, in the words the intake screen uses.
  function describeMissingParts(collection) {
    var missing = listMissingParts(collection);

    if (!collection || !collection.total || missing.length === 0) {
      return "";
    }
    return "あと" + missing.length + "個です（" +
      missing.map(formatPartNumber).join("、") +
      " が届いていません）。";
  }

  // What the parsed package means for this workbook: which modules it
  // replaces, and which ones it would add.
  //
  // For a module the workbook already has, the workbook decides the
  // kind. A kind the answer got wrong is corrected here and reported in
  // warnings, so the user is told instead of the type changing
  // quietly underneath them.
  function describe(parsed, existingModules, diagnosis) {
    var known = {};
    var knownFindings = {};
    var summary = {
      ok: true,
      reason: "",
      message: "",
      total: 0,
      existing: 0,
      added: 0,
      summary: "",
      noChange: null,
      modules: [],
      warnings: []
    };

    if (!isProductResult(parsed)) {
      return failure("noSentinel");
    }
    if (!parsed.ok) {
      return parsed;
    }
    summary.summary = parsed.summary || "";
    summary.requestId = parsed.requestId;
    summary.noChange = parsed.noChange || null;
    (existingModules || []).forEach(function (module) {
      known[module.name.toLowerCase()] = module;
    });
    if (diagnosis && Array.isArray(diagnosis.findings)) {
      diagnosis.findings.forEach(function (finding) {
        knownFindings[String(finding.number)] = true;
      });
    }

    parsed.modules.some(function (item) {
      var match = known[item.name.toLowerCase()];
      var bookKind = match ? String(match.type || "") : "";
      var mismatch = Boolean(match) &&
        bookKind.length > 0 &&
        bookKind !== item.kind;

      if (!match && item.kind !== "standard") {
        summary = failure("newModuleKind", "R2");
        return true;
      }

      summary.modules.push({
        name: match ? match.name : item.name,
        kind: match && bookKind.length > 0 ? bookKind : item.kind,
        answeredKind: item.kind,
        kindCorrected: mismatch,
        code: item.code,
        isNew: !match
      });
      if (mismatch) {
        summary.warnings.push({
          name: match.name,
          answered: item.kind,
          actual: bookKind
        });
      }
      if (match) {
        summary.existing += 1;
      } else {
        summary.added += 1;
      }
      return false;
    });
    if (!summary.ok) {
      return summary;
    }
    summary.total = summary.modules.length;
    // The sentence travels with the result, so every screen that shows
    // the intake shows the same correction. Computing it here and never
    // reading it is how it went missing.
    summary.kindWarning = describeKindWarning(summary.warnings);
    return brand(summary);
  }

  // The one sentence the user sees when a kind was corrected.
  function describeKindWarning(warnings) {
    var names;

    if (!warnings || warnings.length === 0) {
      return "";
    }
    names = warnings.map(function (warning) {
      return warning.name;
    }).join("、");
    return names +
      " の種類はAIの返答と違っていたため、ブック側の種類のまま取り込みました。" +
      "変更内容を見て、意図どおりか確かめてください。";
  }

  // A module is one whole rewrite when this much of it changed. The
  // floor keeps a short module - where a two-line fix is most of the
  // file - from reading as a rewrite; the ratio is what makes it one.
  var REWRITE_MIN_LINES = 40;
  var REWRITE_RATIO = 0.8;

  // What counts as a procedure for the guard. Declare statements are
  // deliberately excluded: `Declare PtrSafe Function Sleep Lib "kernel32"`
  // is a Function to the VBA grammar, but removing it is the whole point
  // of the Win32 repair, and a guard that called that a deleted procedure
  // would refuse the most ordinary repair this tool does.
  var PROCEDURE_LINE =
    /^[ \t]*(?:(?:Public|Private|Friend|Global)[ \t]+)?(?:Static[ \t]+)?(?:(Sub|Function)|Property[ \t]+(?:Get|Let|Set))[ \t]+([A-Za-zÀ-￿][\wÀ-￿]*)/;
  var DECLARE_LINE = /^[ \t]*(?:(?:Public|Private)[ \t]+)?Declare\b/i;

  function listProcedures(code) {
    var names = [];

    splitLines(String(code === undefined || code === null ? "" : code))
      .forEach(function (line) {
        var match;

        if (DECLARE_LINE.test(line)) {
          return;
        }
        match = PROCEDURE_LINE.exec(line);
        if (match && names.indexOf(match[2]) < 0) {
          names.push(match[2]);
        }
      });
    return names;
  }

  function countChangedLines(before, after) {
    var left = splitLines(String(before === undefined ? "" : before));
    var right = splitLines(String(after === undefined ? "" : after));
    var seen = {};
    var changed = 0;

    left.forEach(function (line) {
      var key = "|" + line;

      seen[key] = (seen[key] || 0) + 1;
    });
    right.forEach(function (line) {
      var key = "|" + line;

      if (seen[key] > 0) {
        seen[key] -= 1;
        return;
      }
      changed += 1;
    });
    Object.keys(seen).forEach(function (key) {
      changed += seen[key];
    });
    return changed;
  }

  function structureFailure(reason, fields) {
    var text = MESSAGES[reason];

    Object.keys(fields).forEach(function (key) {
      text = text.split("{" + key + "}").join(String(fields[key]));
    });
    return brand({
      ok: false,
      reason: reason,
      message: text,
      validationId: "R3",
      modules: []
    });
  }

  // The four things the guard can see, checked in the order a reader
  // would read them: something new arrived, something known left,
  // something known moved, something known was replaced wholesale.
  //
  // Nothing here looks inside a procedure. A body rewritten line for line
  // under the same name passes every one of these checks, and the screen
  // that offers the setting says so rather than letting the tick imply a
  // guarantee it cannot keep.
  function checkStructure(summary, existingModules, options) {
    var settings = options || {};
    var scopeName = String(settings.scopeName || "");
    var allowNewModules = settings.allowNewModules === true;
    var owner = {};
    var byName = {};
    var refusal = null;

    if (!isProductResult(summary) || !summary.ok || summary.noChange) {
      return summary;
    }
    (existingModules || []).forEach(function (module) {
      byName[module.name.toLowerCase()] = module;
      listProcedures(module.code).forEach(function (name) {
        owner[name.toLowerCase()] = module.name;
      });
    });

    summary.modules.some(function (item) {
      var original = byName[item.name.toLowerCase()];
      var before;
      var after;
      var changed;

      if (item.isNew) {
        // A module the run itself asked for is not an unannounced change
        // of shape. Only a template that declares 認める構造変更 buys this,
        // and only for the run it was chosen in.
        if (allowNewModules) {
          return false;
        }
        refusal = structureFailure("structureNewModule", {
          scope: scopeName,
          name: item.name
        });
        return true;
      }
      if (!original) {
        return false;
      }
      before = listProcedures(original.code);
      after = listProcedures(item.code);
      before.some(function (name) {
        if (after.indexOf(name) >= 0) {
          return false;
        }
        refusal = structureFailure("structureRemovedProcedure", {
          scope: scopeName,
          name: item.name,
          proc: name
        });
        return true;
      });
      if (refusal) {
        return true;
      }
      after.some(function (name) {
        var from = owner[name.toLowerCase()];

        // A procedure this module already had is not one that moved in,
        // whatever else carries the same name. VBA lets `Test` or `Main`
        // sit privately in half the modules of a workbook, so matching on
        // the name alone called every one of them a move.
        if (before.indexOf(name) >= 0) {
          return false;
        }
        if (!from || from === original.name) {
          return false;
        }
        refusal = structureFailure("structureMovedProcedure", {
          scope: scopeName,
          name: item.name,
          proc: name,
          from: from
        });
        return true;
      });
      if (refusal) {
        return true;
      }
      changed = countChangedLines(original.code, item.code);
      if (original.lineCount >= REWRITE_MIN_LINES &&
          changed >= original.lineCount * REWRITE_RATIO) {
        refusal = structureFailure("structureRewritten", {
          scope: scopeName,
          name: item.name,
          lines: original.lineCount,
          changed: changed
        });
        return true;
      }
      return false;
    });
    return refusal || summary;
  }

  // The sentinel an answer uses to say there is nothing to change.
  function noChangeLine(requestId, verdict) {
    return MARKER + " " + requestId + " NOCHANGE " +
      String(verdict).toUpperCase();
  }

  global.MacroStudioResponse = {
    marker: MARKER,
    kinds: KINDS,
    verdicts: VERDICTS,
    messages: MESSAGES,
    isProductResult: isProductResult,
    noChangeLine: noChangeLine,
    createRequestIdentity: createRequestIdentity,
    createRequestId: createRequestId,
    isRequestId: isRequestId,
    beginLine: beginLine,
    endLine: endLine,
    completeLine: completeLine,
    partLine: partLine,
    formatPartNumber: formatPartNumber,
    summaryBeginLine: summaryBeginLine,
    summaryEndLine: summaryEndLine,
    parse: parse,
    createPartCollection: createPartCollection,
    addPart: addPart,
    mergeParts: mergeParts,
    listMissingParts: listMissingParts,
    isPartCollectionComplete: isPartCollectionComplete,
    describeMissingParts: describeMissingParts,
    describe: describe,
    describeKindWarning: describeKindWarning,
    listProcedures: listProcedures,
    countChangedLines: countChangedLines,
    rewriteMinLines: REWRITE_MIN_LINES,
    rewriteRatio: REWRITE_RATIO,
    checkStructure: checkStructure
  };
}(window));
