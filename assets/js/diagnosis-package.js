(function (global) {
  "use strict";

  var MARKER = "'@MACROSTUDIO";
  var CRLF = "\r\n";
  var VERSION = "1";
  // The sections a reply carries are the diagnosis template's business,
  // not this file's: a template that asks a different question needs a
  // different answer. These four are the default for a caller that does
  // not say, which is the shape the environment audit has always used.
  var DEFAULT_SECTION_NAMES = [
    "PURPOSE",
    "FLOW",
    "DEPENDENCY",
    "ENVIRONMENT"
  ];
  var TEXT_NAMES = ["TITLE", "CONDITION", "IMPACT", "EVIDENCE"];
  var META_NAMES = [
    "GRADE",
    "CONFIDENCE",
    "MODULE",
    "PROC",
    "LINES",
    "ENVKEY"
  ];
  // What the reader has to do about a finding, in one letter, A good and
  // D bad. It replaced BLOCKER / DEFECT / CONDITIONAL / EXTERNAL / INFO,
  // which said how bad a thing was without saying what followed from it -
  // and which could not express a defect that owes nothing to the target
  // environment, because BLOCKER required an environment key.
  var GRADES = ["A", "B", "C", "D"];
  var SECTION_NAME = /^[A-Z][A-Z0-9_]{0,31}$/;
  // A reply is either a list of findings or a single grade with its
  // reasoning. Which one is declared by the template that asked.
  var SHAPE_FINDINGS = "findings";
  var SHAPE_GRADE = "grade";
  var CONFIDENCES = ["CONFIRMED", "LIKELY", "UNVERIFIED"];
  var NO_FINDING_REASONS = ["SCOPE_CLEAR", "INSUFFICIENT"];
  var CANONICAL_NUMBER = /^(0|[1-9][0-9]*)$/;
  var DIGITS = /^\d+$/;
  // The four texts of a finding in the short form. They are plain lines,
  // not sentinels: the tag is the whole of the scaffolding.
  var COMPACT_TEXT_TAG =
    /(?:^|[\s　])(TITLE|CONDITION|IMPACT|EVIDENCE)[\s　]*[:：][\s　]*/g;
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

  // Why the reply was refused, in the reader's words.
  //
  // The check number was only ever written to the log, so the screen said
  // "取り込めませんでした" and nothing else - and the same paste failed
  // again, and again, because nobody could see which line was wrong. Each
  // entry names the thing that did not hold. It is a statement of fact
  // about the reply, never a quotation of it (SPEC 8.4).
  var DETAILS = {
    D01: "この返答は別の依頼に対するものです。" +
      "いま画面にある依頼番号と一致していません。",
    D02: "先頭の DIAG BEGIN と末尾の DIAG END が対になっていません。" +
      "返答が途中で切れているか、コードブロックの一部だけをコピーしています。",
    D03: "DIAG BEGIN のうしろが件数になっていません。",
    D04: "PURPOSE / FLOW / DEPENDENCY / ENVIRONMENT の4つの節が、" +
      "1つずつ本文付きで揃っていません。",
    D05: "知らない節の名前があります。" +
      "節は PURPOSE / FLOW / DEPENDENCY / ENVIRONMENT の4つだけです。",
    D06: "指摘の開始行と終了行が対になっていません。",
    D07: "同じ番号の指摘が2つ以上あります。",
    D08: "指摘に META の行がないか、2つ以上あります。",
    D09: "META には GRADE CONFIDENCE MODULE PROC LINES ENVKEY の" +
      "6つを、それぞれ1回ずつ書きます。並べる順番は問いません。",
    D10: "GRADE または CONFIDENCE に、決まっていない値が書かれています。" +
      "GRADE は A / B / C / D のどれかです。",
    D11: "GRADE=D は「直しようがないことが確定している」という判定なので、" +
      "CONFIDENCE=CONFIRMED でなければ名乗れません。",
    D12: "この診断は指摘を返す形ではありません。" +
      "DIAG GRADE を1行だけ書いてください。",
    D13: "このブックに無いモジュール名が書かれています。" +
      "依頼文の【対象モジュール】にある名前だけが使えます。",
    D14: "想定動作環境に無い環境キーが書かれています。",
    D15: "LINES の書き方が違います。" +
      "8 / 8,21 / 42-47 のような形にしてください。",
    D16: "TITLE / CONDITION / IMPACT / EVIDENCE の4つが、" +
      "1つずつ本文付きで揃っていません。",
    D17: "知らない TEXT の名前があります。",
    D18: "DIAG COMPLETE のうしろが件数になっていません。",
    D19: "DIAG COMPLETE の件数と、実際に書かれた指摘の数が違います。",
    D20: "指摘が0件のときは DIAG NOFINDING SCOPE_CLEAR または " +
      "DIAG NOFINDING INSUFFICIENT を1行だけ書く必要があります。",
    D21: "指摘があるのに DIAG NOFINDING が書かれています。",
    D22: "DIAG BEGIN より前、または DIAG END より後に区切り行があります。" +
      "コードブロックを2つに分けて返していないか確認してください。",
    D23: "MODULE を名乗らずに PROC だけを書くことはできません。",
    D24: "MODULE を名乗らずに LINES だけを書くことはできません。",
    D25: "LINES が、そのモジュールに実在しない行を指しています。" +
      "添付ファイル全体の通し行番号ではなく、" +
      "モジュールごとの行番号を使ってください。",
    D26: "この診断は採点を返す形なので、指摘は書けません。",
    D27: "TITLE が1行に収まっていないか、120文字を超えています。",
    D28: "指摘の番号が 1 2 3 … の形になっていません。",
    D29: "DIAG BEGIN の件数と、実際に書かれた指摘の数が違います。",
    DP01: "分割返答の PART 行がないか、2つ以上あります。",
    DP02: "PART 行の書き方が違います。",
    DP03: "まだ届いていない番号があります。",
    DP04: "前に取り込んだ返答と、全体の個数が違います。",
    DP05: "同じ番号の返答が、前に取り込んだものと内容が違います。"
  };

  // A refusal, and enough of the contract to ask again with.
  //
  // `evidence` is what the retry text is written from: what the contract
  // asked for, what this reply carried instead, and the one edit that
  // would settle it. It names keys, counts and tag names - the vocabulary
  // of the contract itself - and never the reply's prose, which is what
  // SPEC 8.4 keeps out of the log and out of every message this file
  // hands upward.
  function failure(validationId, reason, message, evidence) {
    return brand({
      ok: false,
      code: "E-DIAG-01",
      validationId: validationId,
      reason: reason || "malformed",
      message: message || MESSAGES.malformed,
      detail: DETAILS[validationId] || "",
      evidence: evidence || null,
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

  // ---- what a chat client does to a reply on the way out ----
  //
  // Some clients hand back exactly what the answer said. Others wrap the
  // block in a quotation, turn it into a bullet, HTML-escape it, or swap
  // the apostrophe for a typographic one. None of that is the answer
  // being wrong, and none of it can be fixed by asking again - which is
  // what made the same paste fail over and over.
  //
  // So the decoration is taken off mechanically, and only where it turns
  // a line that was not a sentinel into one. Body text is never touched:
  // if the repair does not produce a sentinel, the original line is kept
  // exactly as it arrived.
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
  var FENCE = /^[\s　]*(?:`{3,}|~{3,})[A-Za-z0-9_+#-]*[\s　]*$/;
  var QUOTED = /^[\s　]*>[\s　]?/;

  function unescapeEntities(value) {
    return String(value).replace(
      /&(?:lt|gt|quot|apos|nbsp|amp|#39|#x27);/gi,
      function (found) {
        var key = found.toLowerCase();

        return Object.prototype.hasOwnProperty.call(ENTITIES, key)
          ? ENTITIES[key]
          : found;
      });
  }

  function isSentinelLine(value) {
    return trimSpace(value).indexOf(MARKER) === 0;
  }

  function repairSentinelLine(line) {
    var value = trimSpace(line);

    value = value.replace(/^(?:>[\s　]*)+/, "");
    value = value.replace(/^(?:[-*+]|\d+[.)])[\s　]+/, "");
    value = value.replace(/<\/?(?:code|pre|span|p|div|strong|em|b|i)>/gi, "");
    value = value.replace(/^`+/, "").replace(/`+$/, "");
    value = unescapeEntities(value);
    value = trimSpace(value);
    // A typographic or full-width apostrophe, or none at all because the
    // renderer ate it. The marker is the one place this is safe: nothing
    // else in a reply begins with @MACROSTUDIO.
    value = value.replace(/^[‘’‛ʼ´＇`]/, "'");
    value = value.replace(/^'＠/, "'@");
    value = value.replace(/^＠/, "@");
    if (value.indexOf("@MACROSTUDIO") === 0) {
      value = "'" + value;
    }
    return value;
  }

  // A reply the client quoted in full: every line carries the marker, so
  // one level comes off the whole thing rather than line by line.
  function unquoteAll(lines) {
    var meaningful = lines.filter(function (line) {
      return trimSpace(line) !== "";
    });

    if (meaningful.length === 0 ||
        !meaningful.every(function (line) {
          return QUOTED.test(line);
        })) {
      return lines;
    }
    return lines.map(function (line) {
      return line.replace(QUOTED, "");
    });
  }

  // A fence is not part of the reply, so it goes first: leaving it in
  // would make an otherwise fully quoted reply look partly quoted.
  var QUOTED_TAG =
    /^[\s　]*>[\s　]?(?=(?:TITLE|CONDITION|IMPACT|EVIDENCE)[\s　]*[:：])/;

  function normalizeLines(lines) {
    return unquoteAll(lines.filter(function (line) {
      return !FENCE.test(line);
    })).map(function (line) {
      var repaired;

      if (isSentinelLine(line)) {
        return line;
      }
      repaired = repairSentinelLine(line);
      if (isSentinelLine(repaired)) {
        return repaired;
      }
      // Only some lines quoted: the tagged body lines of a short-form
      // finding still have to be readable as tags.
      return line.replace(QUOTED_TAG, "");
    });
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
  // How many key=value pairs a line carries from `start` onwards.
  //
  // How many there are supposed to be is the contract's business (D09),
  // not this function's. Counting what is actually there means a reply
  // with five pairs or seven is named by the checker rather than cut in
  // half here and refused for a shape it never had.
  var META_PAIR = /^[A-Z][A-Z0-9_]*=/;

  function metaPairCount(parts, start) {
    var index = start;

    while (index < parts.length && META_PAIR.test(parts[index])) {
      index += 1;
    }
    return index - start;
  }

  function sentinelArity(parts) {
    var directive = (parts[1] || "").toUpperCase();
    var second = (parts[2] || "").toUpperCase();

    if (directive === "META") {
      return 2 + metaPairCount(parts, 2);
    }
    if (directive === "PART") {
      return 5;
    }
    // The short forms carry their own payload on the sentinel: a SECTION
    // is followed by its body, a FINDING by the six META pairs.
    if (directive === "SECTION") {
      return second === "BEGIN" || second === "END" ? 4 : 3;
    }
    if (directive === "FINDING") {
      return second === "BEGIN" || second === "END"
        ? 4
        : 3 + metaPairCount(parts, 3);
    }
    if (directive === "TEXT") {
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

  // One plain line of a short-form finding, cut into the tagged parts it
  // carries. Normally that is one tag and its sentence. A chat client
  // that folded the line breaks away hands all four back run together,
  // and they are separated here rather than landing in TITLE as one blob.
  function splitCompactTexts(line) {
    var pattern = new RegExp(COMPACT_TEXT_TAG.source, "g");
    var parts = [];
    var current = null;
    var last = 0;
    var match;

    while ((match = pattern.exec(line)) !== null) {
      if (current === null) {
        if (trimSpace(line.slice(last, match.index)) !== "") {
          parts.push({ name: null, body: line.slice(last, match.index) });
        }
      } else {
        current.body = line.slice(last, match.index);
        parts.push(current);
      }
      current = { name: match[1].toUpperCase(), body: "" };
      last = pattern.lastIndex;
    }
    if (current !== null) {
      current.body = line.slice(last);
      parts.push(current);
    } else if (parts.length === 0) {
      parts.push({ name: null, body: line });
    }
    return parts;
  }

  // The raw text of a sentinel line after its first `count` words, with
  // the writer's own spacing inside it kept. A compact SECTION carries
  // its body here.
  function sentinelTail(token, count) {
    var rest = token.trimmed.slice(MARKER.length).replace(/^\s+/, "");
    var offset = 0;
    var index;

    for (index = 0; index < count && index < token.parts.length; index += 1) {
      offset = rest.indexOf(token.parts[index], offset) +
        token.parts[index].length;
    }
    return trimSpace(rest.slice(offset));
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

  // The section names a template declared, kept only if they are usable
  // as sentinel words. A template that declares nothing usable falls
  // back to the four the environment audit has always returned, rather
  // than accepting a reply with no sections at all.
  function readSectionNames(value) {
    var names = [];

    (Array.isArray(value) ? value : []).forEach(function (name) {
      var text = trimSpace(name).toUpperCase();

      if (SECTION_NAME.test(text) && names.indexOf(text) < 0) {
        names.push(text);
      }
    });
    return names.length > 0 ? names : DEFAULT_SECTION_NAMES.slice();
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

  var META_EXPECTED = "META に " + META_NAMES.join(" ") +
    " の6つを、それぞれ1回ずつ（並べる順番は問いません）";

  function joinKeys(names) {
    return names.join("、");
  }

  // What the META line carried, said in the contract's own words: which
  // of the six keys were missing, which names are not part of the
  // contract, which appeared twice, which were left empty. No value is
  // repeated back (SPEC 8.4) - naming the key is enough to fix the line.
  function metaEvidence(problem) {
    var actual = [];
    var fix = [];

    if (problem.missing.length > 0) {
      actual.push(joinKeys(problem.missing) + " が書かれていません");
      fix.push(joinKeys(problem.missing) + " を足す");
    }
    if (problem.unknown.length > 0) {
      actual.push("契約にない " + joinKeys(problem.unknown) + " が入っています");
      fix.push(joinKeys(problem.unknown) + " を外す");
    }
    if (problem.duplicate.length > 0) {
      actual.push(joinKeys(problem.duplicate) + " が2回以上あります");
      fix.push(joinKeys(problem.duplicate) + " を1つにする");
    }
    if (problem.empty.length > 0) {
      actual.push(joinKeys(problem.empty) + " の値が空です");
      fix.push(joinKeys(problem.empty) + " に値を書く（無いときは - ）");
    }
    if (problem.malformed > 0) {
      actual.push("key=value の形になっていない項目が " +
        String(problem.malformed) + " 個あります");
      fix.push("各項目を キー=値 の形にし、値に空白と = を入れない");
    }
    if (problem.procedure) {
      actual.push("PROC が VBA の手続き名として読めません");
      fix.push("PROC を手続き名か - にする");
    }
    if (actual.length === 0) {
      actual.push("6つの key=value になっていません");
      fix.push("META の行を書き直す");
    }
    return {
      expected: META_EXPECTED,
      actual: "この返答の META は " + actual.join("。") + "。",
      fix: "次の返答では、" + fix.join("、") + "。ほかの行は変えないでください。"
    };
  }

  // Which of the four texts a finding is short of, and which arrived with
  // nothing in them. Names only - the bodies stay where they are.
  function textEvidence(raw) {
    var absent = [];
    var blank = [];
    var trouble = [];

    TEXT_NAMES.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(raw.texts, name)) {
        absent.push(name);
      } else if (bodyText(raw.texts[name]) === "") {
        blank.push(name);
      }
    });
    if (absent.length > 0) {
      trouble.push(joinKeys(absent) + " がありません");
    }
    if (blank.length > 0) {
      trouble.push(joinKeys(blank) + " の本文が空です");
    }
    if (trouble.length === 0) {
      trouble.push("4 つが 1 回ずつになっていません");
    }
    return {
      expected: "指摘 1 件に " + TEXT_NAMES.join(" / ") +
        " を 1 つずつ、本文付きで",
      actual: "指摘 " + raw.number + " は " + trouble.join("。") + "。",
      fix: "次の返答では、指摘 " + raw.number +
        " に 4 つとも本文付きで書いてください。ほかの指摘は変えないでください。"
    };
  }

  // The six facts a finding carries, as key=value pairs.
  //
  // They used to be read by position - pair 1 had to be GRADE, pair 2
  // CONFIDENCE, and so on. Nothing downstream depends on that: every
  // value is looked up by name. The order was a rule the contract
  // enforced without needing it, and on 2026-08-05 it refused three
  // otherwise correct diagnoses in a row (D09 / metaShape in the product
  // log). Keys are now read wherever they stand.
  //
  // Nothing else is relaxed. Six keys, every one of them known, each
  // exactly once, none empty, and PROC still has to look like a VBA
  // identifier. A reply that drops a key or invents one is still refused,
  // and now it is told which.
  function parseMeta(token) {
    var values = {};
    var problem = {
      missing: [],
      unknown: [],
      duplicate: [],
      empty: [],
      malformed: 0,
      procedure: false
    };
    var pairs = token && Array.isArray(token.parts)
      ? token.parts.slice(2)
      : [];
    var index;
    var pair;
    var key;

    for (index = 0; index < pairs.length; index += 1) {
      pair = pairs[index].split("=");
      if (pair.length !== 2 || pair[0] === "") {
        problem.malformed += 1;
        continue;
      }
      key = pair[0];
      if (META_NAMES.indexOf(key) < 0) {
        if (problem.unknown.indexOf(key) < 0) {
          problem.unknown.push(key);
        }
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        if (problem.duplicate.indexOf(key) < 0) {
          problem.duplicate.push(key);
        }
        continue;
      }
      if (pair[1] === "") {
        problem.empty.push(key);
        continue;
      }
      values[key] = pair[1];
    }
    META_NAMES.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(values, name) &&
          problem.empty.indexOf(name) < 0 &&
          problem.duplicate.indexOf(name) < 0) {
        problem.missing.push(name);
      }
    });
    if (problem.missing.length > 0 || problem.unknown.length > 0 ||
        problem.duplicate.length > 0 || problem.empty.length > 0 ||
        problem.malformed > 0) {
      return { ok: false, evidence: metaEvidence(problem) };
    }
    if (values.PROC !== "-" && !VBA_IDENTIFIER.test(values.PROC)) {
      problem.procedure = true;
      return { ok: false, evidence: metaEvidence(problem) };
    }
    return { ok: true, values: values };
  }

  function validateFinding(raw, context) {
    var meta;
    var parsedMeta;
    var ranges;
    var module;
    var lineLimit;
    var textValues = {};
    var result;

    if (!CANONICAL_NUMBER.test(raw.number)) {
      return failure("D28", "findingNumber");
    }
    if (raw.meta.length !== 1) {
      return failure("D08", "metaCardinality", undefined, {
        expected: "指摘 1 件につき META の行はちょうど 1 行",
        actual: "この返答の指摘 " + raw.number + " には META の行が " +
          String(raw.meta.length) + " 行あります。",
        fix: "次の返答では、指摘 " + raw.number +
          " の META を 1 行だけにしてください。"
      });
    }
    parsedMeta = parseMeta(raw.meta[0]);
    if (!parsedMeta.ok) {
      return failure("D09", "metaShape", undefined, parsedMeta.evidence);
    }
    meta = parsedMeta.values;
    if (GRADES.indexOf(meta.GRADE) < 0 ||
        CONFIDENCES.indexOf(meta.CONFIDENCE) < 0) {
      return failure("D10", "metaEnum", undefined, {
        expected: "GRADE は " + GRADES.join(" / ") + "、CONFIDENCE は " +
          CONFIDENCES.join(" / "),
        actual: "指摘 " + raw.number + " の " +
          (GRADES.indexOf(meta.GRADE) < 0 ? "GRADE" : "CONFIDENCE") +
          " が、決まっている値のどれでもありません。",
        fix: "次の返答では、指摘 " + raw.number +
          " の GRADE と CONFIDENCE を上の値から選び直してください。"
      });
    }
    // "Nothing can be done about this" is the heaviest thing a diagnosis
    // can say, so it cannot be said tentatively. A guess is a C.
    if (meta.GRADE === "D" && meta.CONFIDENCE !== "CONFIRMED") {
      return failure("D11", "gradeConfidence", undefined, {
        expected: "GRADE=D の指摘は CONFIDENCE=CONFIRMED",
        actual: "指摘 " + raw.number +
          " は GRADE=D なのに CONFIDENCE が CONFIRMED ではありません。",
        fix: "置き換え先が無いと確認できているなら CONFIDENCE=CONFIRMED に、" +
          "確認できていないなら GRADE=C にしてください。"
      });
    }
    module = meta.MODULE === "-"
      ? null
      : context.moduleMap[meta.MODULE.toLowerCase()];
    if (meta.MODULE !== "-" && !module) {
      return failure(
        "D13",
        "unknownModule",
        MESSAGES.unknownReference,
        {
          expected: "MODULE は依頼文の【対象モジュール】にある名前か -",
          actual: "指摘 " + raw.number +
            " の MODULE が、そのどれとも一致しません。",
          fix: "次の返答では、指摘 " + raw.number +
            " の MODULE を依頼文にある名前へ直すか、-  にしてください。"
        });
    }
    if (meta.ENVKEY !== "-" && !context.environmentMap[meta.ENVKEY]) {
      return failure(
        "D14",
        "unknownEnvironmentKey",
        MESSAGES.unknownReference,
        {
          expected: "ENVKEY は依頼文の想定動作環境にあるキーか -",
          actual: "指摘 " + raw.number +
            " の ENVKEY が、そのどれとも一致しません。",
          fix: "次の返答では、指摘 " + raw.number +
            " の ENVKEY を依頼文にあるキーへ直すか、環境と関係ない故障なら - " +
            "にしてください。"
        });
    }
    ranges = parseLineRanges(meta.LINES);
    if (ranges === null) {
      return failure("D15", "lineShape", undefined, {
        expected: "LINES は 8 / 8,21 / 42-47 の形か -",
        actual: "指摘 " + raw.number + " の LINES がその形になっていません。",
        fix: "次の返答では、指摘 " + raw.number +
          " の LINES を半角数字・カンマ・ハイフンだけで書いてください。"
      });
    }
    if (raw.textOrder.length !== TEXT_NAMES.length ||
        TEXT_NAMES.some(function (name) {
          return !Object.prototype.hasOwnProperty.call(raw.texts, name) ||
            bodyText(raw.texts[name]) === "";
        })) {
      return failure("D16", "textCardinality", undefined, textEvidence(raw));
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
        return failure("D25", "lineBounds", undefined, {
          expected: "LINES は " + meta.MODULE + " に実在する行番号（1 以上 " +
            String(module ? module.lineCount : 0) + " 以下）",
          actual: "指摘 " + raw.number +
            " の LINES が、そのモジュールに無い行を指しています。",
          fix: "添付テキスト全体の通し行番号ではなく、" +
            meta.MODULE + " の中の行番号で書き直してください。"
        });
      }
    }
    if (textValues.TITLE.indexOf(CRLF) >= 0 ||
        Array.from(textValues.TITLE).length > 120) {
      return failure("D27", "titleShape", undefined, {
        expected: "TITLE は改行なしの 1 行で 120 文字以内",
        actual: "指摘 " + raw.number + " の TITLE は " +
          String(Array.from(textValues.TITLE).length) + " 文字" +
          (textValues.TITLE.indexOf(CRLF) >= 0 ? "で、改行を含みます" : "です") +
          "。",
        fix: "次の返答では、指摘 " + raw.number +
          " の TITLE を 1 行 120 文字以内に縮めてください。" +
          "続きは IMPACT へ書けます。"
      });
    }

    result = {
      number: raw.number,
      grade: meta.GRADE,
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
    var grades = [];
    var sectionValues;
    var openSection = null;
    var openFinding = null;
    var openText = null;
    // The short form of a finding: one sentinel carrying the whole META,
    // then four tagged lines. Eleven sentinel lines per finding, each
    // repeating a 36-character request id, was more scaffolding than
    // diagnosis - and every one of them was a line an AI could get wrong.
    // Both forms parse into the same shape and share every check below.
    var openCompact = null;
    // A short-form SECTION normally carries its body on the same line.
    // When a chat client folds the reply into one paragraph the body
    // lands on the next line instead, so it is collected either way and
    // the emptiness check below is what decides.
    var openCompactSection = null;
    var index;
    var line;
    var token;
    var action;
    var name;
    var body;
    var tag;
    var tags;
    var tagIndex;
    var normalizedNumber;
    var validated = [];
    var check;
    var complete;

    function closeCompact() {
      openCompactSection = null;
      if (openCompact === null) {
        return;
      }
      findings.push({
        number: openCompact.number,
        meta: openCompact.meta,
        texts: openCompact.texts,
        textOrder: openCompact.textOrder
      });
      openCompact = null;
    }

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
        } else if (openCompactSection !== null) {
          sectionBodies[openCompactSection].push(line);
        } else if (openCompact !== null) {
          tags = splitCompactTexts(line);
          for (tagIndex = 0; tagIndex < tags.length; tagIndex += 1) {
            tag = tags[tagIndex];
            if (tag.name === null) {
              if (openCompact.field !== null) {
                openCompact.texts[openCompact.field].push(tag.body);
              } else if (trimSpace(tag.body) !== "") {
                return failure("D16", "textShape");
              }
              continue;
            }
            if (Object.prototype.hasOwnProperty.call(
              openCompact.texts,
              tag.name)) {
              return failure("D16", "textCardinality");
            }
            openCompact.texts[tag.name] = [tag.body];
            openCompact.textOrder.push(tag.name);
            openCompact.field = tag.name;
          }
        }
        continue;
      }
      closeCompact();
      if (token.directive === "PART") {
        continue;
      }
      if (token.directive === "SECTION") {
        action = (token.parts[2] || "").toUpperCase();
        name = (token.parts[3] || "").toUpperCase();
        // The short form: SECTION <name> <body, on this line>.
        if (action !== "BEGIN" && action !== "END") {
          if (context.sections.indexOf(action) < 0) {
            return failure("D05", "unknownSection");
          }
          if (openSection !== null || openFinding !== null ||
              Object.prototype.hasOwnProperty.call(sectionBodies, action)) {
            return failure("D04", "sectionCardinality");
          }
          body = sentinelTail(token, 3);
          sectionBodies[action] = body === "" ? [] : [body];
          sectionOrder.push(action);
          openCompactSection = action;
          continue;
        }
        if (token.parts.length !== 4) {
          return failure("D04", "sectionShape");
        }
        if (context.sections.indexOf(name) < 0) {
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
        // The short form: FINDING <number> followed by the six META
        // pairs on the same line, then TITLE: / CONDITION: / IMPACT: /
        // EVIDENCE: on four plain lines.
        if (action !== "BEGIN" && action !== "END") {
          // Enough for a number and at least one pair. How many pairs
          // there should be, and which, is D09's answer to give - it can
          // name the key that is missing, where a bare arity check here
          // could only say "the shape is wrong".
          if (token.parts.length < 4) {
            return failure("D06", "findingShape");
          }
          name = token.parts[2];
          if (!DIGITS.test(name)) {
            return failure("D07", "findingDigits");
          }
          normalizedNumber = normalizeDecimal(name);
          if (Object.prototype.hasOwnProperty.call(
            findingNumbers,
            normalizedNumber)) {
            return failure("D07", "findingDuplicate");
          }
          if (openSection !== null) {
            return failure("D06", "findingNested");
          }
          findingNumbers[normalizedNumber] = true;
          openCompact = {
            number: name,
            // The same shape parseMeta reads from a META line - the
            // request id, the word META, then the key=value pairs - so
            // both forms are validated by one function.
            meta: [{
              parts: [token.parts[0], "META"].concat(token.parts.slice(3))
            }],
            texts: {},
            textOrder: [],
            field: null
          };
          continue;
        }
        if (token.parts.length !== 4) {
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
        // The scoring shape answers with one letter instead of a list.
        if (action === "GRADE") {
          grades.push(token.parts.length === 4
            ? token.parts[3]
            : null);
          continue;
        }
        return failure("D02", "unexpectedDiag");
      }
      return failure("D02", "unknownSentinel");
    }

    closeCompact();
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
        (sectionOrder.length !== context.sections.length ||
         context.sections.some(function (sectionName) {
           return !Object.prototype.hasOwnProperty.call(
             sectionBodies,
             sectionName) ||
             bodyText(sectionBodies[sectionName]) === "";
         }))) {
      return failure("D04", "sectionCardinality");
    }

    // The scoring shape carries one grade and no findings; the finding
    // shape carries findings and no grade. A template says which it
    // asked for, so a reply in the other shape is refused rather than
    // read as an empty one.
    if (context.shape === SHAPE_GRADE) {
      if (findings.length > 0) {
        return failure("D26", "findingsInGradeShape");
      }
      if (noFindings.length > 0) {
        return failure("D20", "noFindingInGradeShape");
      }
      if (grades.length !== 1 || grades[0] === null ||
          GRADES.indexOf(grades[0]) < 0) {
        return failure("D12", "gradeShape");
      }
    } else if (grades.length > 0) {
      return failure("D02", "gradeInFindingShape");
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
      return failure("D19", "completeCount", undefined, {
        expected: "DIAG COMPLETE の数字は、書いた FINDING の件数",
        actual: "この返答は FINDING を " + String(validated.length) +
          " 件書いて、DIAG COMPLETE " + complete + " で終えています。",
        fix: "次の返答では DIAG COMPLETE " + String(validated.length) +
          " にするか、足りない指摘を書き足して件数を合わせてください。"
      });
    }
    // The reply says how many findings it carries twice, at the top and
    // at the bottom. Both have to be the number actually written.
    if (envelope.declaredCount !== String(validated.length)) {
      return failure("D29", "beginCount", undefined, {
        expected: "DIAG BEGIN の数字は、書いた FINDING の件数",
        actual: "この返答は DIAG BEGIN " + envelope.declaredCount +
          " で始まり、FINDING は " + String(validated.length) +
          " 件書かれています。",
        fix: "次の返答では DIAG BEGIN " + String(validated.length) +
          " にするか、足りない指摘を書き足して件数を合わせてください。"
      });
    }
    if (part && part.total > 1 && noFindings.length > 0) {
      return failure("D20", "prematureNoFinding");
    }

    sectionValues = {};
    context.sections.forEach(function (sectionName) {
      sectionValues[sectionName] =
        Object.prototype.hasOwnProperty.call(sectionBodies, sectionName)
          ? bodyText(sectionBodies[sectionName])
          : null;
    });

    return {
      ok: true,
      fragment: {
        requestId: context.requestId,
        version: VERSION,
        shape: context.shape,
        sectionNames: context.sections.slice(),
        sections: sectionValues,
        grade: grades.length === 1 ? grades[0] : null,
        findings: validated,
        noFindings: noFindings
      }
    };
  }

  function validateConclusion(diagnosis) {
    var reasons = diagnosis.noFindings;

    // The scoring shape has settled everything it can already: one
    // grade, no findings, and nothing to conclude about their absence.
    if (diagnosis.shape === SHAPE_GRADE) {
      delete diagnosis.noFindings;
      diagnosis.noFinding = null;
      return success(diagnosis);
    }
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
    var lines = normalizeLines(
      splitLines(text === undefined || text === null ? "" : text));

    // Recovery works on the same text the checks saw, so a reply that
    // needed both the decoration taken off and its line breaks put back
    // still lands on one diagnosis.
    return parseLines(lines, lines.join("\n"), options, requirePart, false);
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
      // Which sections and which shape came from the template that asked
      // (§6.2). A caller that says nothing gets the environment audit's
      // shape, which is what every reply looked like before there was
      // more than one kind of question.
      sections: readSectionNames(options.sections),
      shape: options.shape === SHAPE_GRADE
        ? SHAPE_GRADE
        : SHAPE_FINDINGS,
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
    if (first.sectionNames.some(function (name) {
      return !first.sections[name];
    })) {
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
      shape: first.shape,
      sectionNames: first.sectionNames,
      sections: first.sections,
      grade: first.grade,
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
    var sectionNames;
    var shape;
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
    sectionNames = readSectionNames(source.sectionNames);
    shape = source.shape === SHAPE_GRADE ? SHAPE_GRADE : SHAPE_FINDINGS;
    if (sectionNames.some(function (name) {
      return !isText(source.sections[name]);
    })) {
      return null;
    }
    if (shape === SHAPE_GRADE &&
        (GRADES.indexOf(source.grade) < 0 || source.findings.length > 0)) {
      return null;
    }
    findings = source.findings.map(function (finding) {
      if (!finding || typeof finding !== "object" ||
          !CANONICAL_NUMBER.test(String(finding.number)) ||
          GRADES.indexOf(finding.grade) < 0 ||
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
        grade: finding.grade,
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
    if (shape === SHAPE_FINDINGS) {
      if (findings.length === 0) {
        if (NO_FINDING_REASONS.indexOf(source.noFinding) < 0) {
          return null;
        }
      } else if (source.noFinding !== null &&
          source.noFinding !== undefined) {
        return null;
      }
    }
    copy = {
      requestId: source.requestId,
      version: VERSION,
      shape: shape,
      sectionNames: sectionNames,
      sections: {},
      grade: shape === SHAPE_GRADE ? source.grade : null,
      findings: findings,
      noFinding: shape === SHAPE_FINDINGS && findings.length === 0
        ? source.noFinding
        : null
    };
    sectionNames.forEach(function (name) {
      copy.sections[name] = source.sections[name];
    });
    return brand(copy);
  }

  function formatForRecord(diagnosis) {
    var lines = ["# 診断結果", ""];

    if (!isProductResult(diagnosis)) {
      return "";
    }
    (diagnosis.sectionNames || DEFAULT_SECTION_NAMES).forEach(
      function (name) {
        lines.push("## " + name);
        lines.push("");
        lines.push(diagnosis.sections[name]);
        lines.push("");
      });
    if (diagnosis.shape === SHAPE_GRADE) {
      lines.push("## 判定");
      lines.push("");
      lines.push("- " + diagnosis.grade);
      lines.push("");
      return lines.join(CRLF).replace(/(?:\r\n)+$/, "") + CRLF;
    }
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
        "- META: GRADE=" + finding.grade +
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
    defaultSectionNames: DEFAULT_SECTION_NAMES.slice(),
    textNames: TEXT_NAMES.slice(),
    grades: GRADES.slice(),
    findingsShape: SHAPE_FINDINGS,
    gradeShape: SHAPE_GRADE,
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
