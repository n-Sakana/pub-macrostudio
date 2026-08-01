(function (global) {
  "use strict";

  var CRLF = "\r\n";
  var INSTRUCTION_TITLE = "改修指示";
  var OUTPUT_TITLE = "出力指示";
  var SPLIT_OUTPUT_TITLE = "出力指示（モジュール単位）";
  var SPLIT_DIAGNOSIS_OUTPUT_TITLE = "出力指示（分割）";
  // A template that needs the app's replacement table declares what to
  // look for and what to call it. The app supplies the table; it does
  // not know what a path, a URL or a Win32 call is - that belongs to
  // whoever wrote the template.
  var REPLACE_TITLE = "置換の候補";
  var BEHAVIOR_CANDIDATES_TITLE = "希望動作の候補";
  var PRESERVE_TITLE = "維持すること";
  var RECOMMEND_TITLE = "推奨条件";
  var MODE_TITLE = "用途";
  var QUESTION_TITLE = "質問";
  var DESCRIPTION_TITLE = "説明";
  var SECTION_TITLES = [INSTRUCTION_TITLE, OUTPUT_TITLE];
  var OPTIONAL_SECTION_TITLES = [
    QUESTION_TITLE,
    DESCRIPTION_TITLE,
    SPLIT_OUTPUT_TITLE,
    SPLIT_DIAGNOSIS_OUTPUT_TITLE,
    REPLACE_TITLE,
    BEHAVIOR_CANDIDATES_TITLE,
    PRESERVE_TITLE,
    RECOMMEND_TITLE
  ];
  var STAGES = {
    diagnose: "diagnose",
    repair: "repair"
  };

  var MESSAGES = {
    empty: "ファイルが空です。",
    unterminatedComment:
      "コメントが閉じられていません。<!-- は --> で閉じてください。",
    missingName:
      "プリセット名の見出し（# ではじまる行）がありません。",
    emptyName:
      "プリセット名の見出し（#）に名前がありません。",
    multipleNames:
      "プリセット名の見出し（#）が 2 つ以上あります。" +
      "1 ファイルにつき 1 つにしてください。",
    textBeforeName:
      "プリセット名の見出し（#）より前に本文があります。" +
      "説明は <!-- --> のコメントにしてください。",
    textOutsideSection:
      "見出しの外に本文があります。本文は「## " +
      INSTRUCTION_TITLE + "」か「## " + OUTPUT_TITLE +
      "」の下に書いてください。",
    unknownSection:
      "知らない見出しがあります: ## {title}。使えるのは「## " +
      INSTRUCTION_TITLE + "」「## " + OUTPUT_TITLE + "」「## " +
      QUESTION_TITLE + "」「## " + DESCRIPTION_TITLE + "」「## " +
      REPLACE_TITLE + "」「## " + BEHAVIOR_CANDIDATES_TITLE + "」「## " +
      PRESERVE_TITLE + "」「## " + RECOMMEND_TITLE + "」「## " +
      SPLIT_OUTPUT_TITLE + "」「## " +
      SPLIT_DIAGNOSIS_OUTPUT_TITLE + "」です。",
    manyDescriptions:
      "「## " + DESCRIPTION_TITLE +
      "」は 1 つの段落で書いてください。カードには 1 行で出ます。",
    obsoleteMode:
      "「## " + MODE_TITLE + "」は使わなくなりました。" +
      "診断・改修の段階は配置フォルダで決まります。",
    unknownStage:
      "ひな形の段階が分かりません。診断または改修のフォルダから読み込んでください。",
    invalidReplaceRule:
      "「## " + REPLACE_TITLE +
      "」は「- 呼び方 | 正規表現 | 既定で選ぶ | 場所を選ぶ」の形で" +
      "書いてください。3 つ目と 4 つ目は省けます。",
    invalidReplacePattern:
      "「## " + REPLACE_TITLE + "」の正規表現が読み取れません: {title}",
    repairOnlySection:
      "「## {title}」は改修ひな形だけで使えます。",
    diagnoseOnlySection:
      "「## {title}」は診断ひな形だけで使えます。",
    wrongRepairSplit:
      "改修ひな形では「## " + SPLIT_OUTPUT_TITLE +
      "」を使ってください。「## " + SPLIT_DIAGNOSIS_OUTPUT_TITLE +
      "」は診断専用です。",
    wrongDiagnosisSplit:
      "診断ひな形では「## " + SPLIT_DIAGNOSIS_OUTPUT_TITLE +
      "」を使ってください。「## " + SPLIT_OUTPUT_TITLE +
      "」は改修専用です。",
    invalidList:
      "「## {title}」は「- 文」の箇条書きで書いてください。",
    emptyQuestions:
      "「## " + QUESTION_TITLE +
      "」に質問がありません。「- 質問文」の形で書いてください。",
    duplicateSection: "「## {title}」が 2 つ以上あります。",
    missingSection: "「## {title}」がありません。",
    emptySection: "「## {title}」の本文が空です。",
    unreadable:
      "ファイルを読み取れませんでした。" +
      "UTF-8 で保存されているか確認してください。"
  };

  function format(message, title) {
    return message.replace("{title}", title);
  }

  function trimSpace(value) {
    return String(value).replace(
      /^[\s　]+|[\s　]+$/g,
      "");
  }

  // Editor notes never reach the chat request. The whole comment is
  // removed before anything else is read, so a commented-out heading
  // cannot become the preset name.
  function stripComments(text) {
    var stripped = String(text).replace(/<!--[\s\S]*?-->/g, "");

    return {
      text: stripped,
      unterminated: stripped.indexOf("<!--") >= 0
    };
  }

  function splitLines(text) {
    return String(text)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
  }

  function hasText(lines) {
    return lines.some(function (line) {
      return trimSpace(line) !== "";
    });
  }

  function joinBody(lines) {
    var start = 0;
    var end = lines.length;

    while (start < end && trimSpace(lines[start]) === "") {
      start++;
    }
    while (end > start && trimSpace(lines[end - 1]) === "") {
      end--;
    }
    return lines.slice(start, end).join(CRLF);
  }

  // Blank-line separated groups of lines, with the blank lines and the
  // surrounding space dropped.
  function readParagraphs(lines) {
    var paragraphs = [];
    var current = [];
    var index;
    var line;

    for (index = 0; index < lines.length; index += 1) {
      line = trimSpace(lines[index]);
      if (line === "") {
        if (current.length > 0) {
          paragraphs.push(current);
          current = [];
        }
        continue;
      }
      current.push(line);
    }
    if (current.length > 0) {
      paragraphs.push(current);
    }
    return paragraphs;
  }

  // A preset wraps its prose at a comfortable width for whoever edits the
  // file, so its line breaks fall wherever the column ran out. Joining
  // them back is what turns a wrapped paragraph into one line again:
  // inside Japanese prose a wrap is not a space, between two Latin words
  // it is.
  function joinWrappedLines(lines) {
    var text = "";
    var previous;
    var next;
    var index;

    for (index = 0; index < lines.length; index += 1) {
      if (index === 0) {
        text = lines[index];
        continue;
      }
      previous = text.charAt(text.length - 1);
      next = lines[index].charAt(0);
      if (/[0-9A-Za-z]/.test(previous) && /[0-9A-Za-z]/.test(next)) {
        text += " ";
      }
      text += lines[index];
    }
    return text;
  }

  function failure(message, stage) {
    return {
      valid: false,
      name: "",
      stage: stage || "",
      replaceRules: null,
      description: "",
      questions: [],
      behaviorCandidates: [],
      preserveItems: [],
      recommendKeys: [],
      instruction: null,
      output: null,
      splitOutput: null,
      splitDiagnosisOutput: null,
      message: message
    };
  }

  // "- 呼び方 | 正規表現 | 既定で選ぶ". The pattern decides what counts
  // as a candidate and the name decides what it is called; neither is
  // the app's business, so both come from here.
  function readReplaceRules(lines) {
    var items = [];
    var invalid = false;
    var message = "";

    lines.forEach(function (line) {
      var match;
      var parts;
      var label;
      var pattern;

      if (trimSpace(line) === "" || invalid) {
        return;
      }
      match = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (!match) {
        invalid = true;
        message = MESSAGES.invalidReplaceRule;
        return;
      }
      // A pattern may itself contain "|", so the column separator is an
      // unescaped one. "\|" inside a column is a literal pipe.
      parts = match[1].split(/(?<!\\)\|/).map(function (part) {
        return trimSpace(part).replace(/\\\|/g, "|");
      });
      if (parts.length < 2 || parts[0] === "" || parts[1] === "") {
        invalid = true;
        message = MESSAGES.invalidReplaceRule;
        return;
      }
      label = parts[0];
      pattern = parts[1];
      try {
        pattern = new RegExp(parts[1]);
      } catch (error) {
        invalid = true;
        message = format(MESSAGES.invalidReplacePattern, label);
        return;
      }
      items.push({
        label: label,
        pattern: parts[1],
        selectedByDefault: parts.length > 2 && parts[2] !== "",
        // A candidate whose replacement is somewhere on disk. The app
        // can offer a picker for it without knowing why it is one.
        picksLocation: parts.length > 3 && parts[3] !== ""
      });
    });
    return {items: items, invalid: invalid, message: message};
  }

  function readSimpleList(lines) {
    var items = [];
    var invalid = false;

    lines.forEach(function (line) {
      var match;

      if (trimSpace(line) === "") {
        return;
      }
      match = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (!match || trimSpace(match[1]) === "") {
        invalid = true;
        return;
      }
      items.push(trimSpace(match[1]));
    });
    return invalid || items.length === 0 ? null : items;
  }

  // A question is one top-level "- " item. Items indented under it are
  // the choices offered for that question; without them the answer is
  // free text.
  function readQuestions(lines) {
    var questions = [];
    var index;
    var line;
    var match;

    for (index = 0; index < lines.length; index += 1) {
      line = lines[index];
      match = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      if (match[1].length === 0) {
        questions.push({
          text: trimSpace(match[2]),
          choices: []
        });
      } else if (questions.length > 0) {
        questions[questions.length - 1].choices.push(
          trimSpace(match[2]));
      }
    }
    return questions.filter(function (question) {
      return question.text !== "";
    });
  }

  function parse(content, stage) {
    var stripped;
    var lines;
    var inFence = false;
    var name = null;
    var current = null;
    var sections = {};
    var beforeName = [];
    var outside = [];
    var index;
    var line;
    var match;
    var level;
    var title;
    var body;
    var paragraphs;
    var rules;
    var result;

    if (stage !== STAGES.diagnose && stage !== STAGES.repair) {
      return failure(MESSAGES.unknownStage, stage);
    }
    if (typeof content !== "string" || trimSpace(content) === "") {
      return failure(MESSAGES.empty, stage);
    }

    stripped = stripComments(content);
    if (stripped.unterminated) {
      return failure(MESSAGES.unterminatedComment, stage);
    }
    lines = splitLines(stripped.text);

    for (index = 0; index < lines.length; index++) {
      line = lines[index];
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
      }
      match = inFence
        ? null
        : /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);

      if (match) {
        level = match[1].length;
        title = trimSpace(match[2] === undefined ? "" : match[2]);

        if (level === 1) {
          if (name !== null) {
            return failure(MESSAGES.multipleNames, stage);
          }
          if (title === "") {
            return failure(MESSAGES.emptyName, stage);
          }
          name = title;
          current = null;
          continue;
        }
        if (level === 2) {
          if (name === null) {
            return failure(MESSAGES.missingName, stage);
          }
          if (title === MODE_TITLE) {
            return failure(MESSAGES.obsoleteMode, stage);
          }
          if (SECTION_TITLES.indexOf(title) < 0 &&
              OPTIONAL_SECTION_TITLES.indexOf(title) < 0) {
            return failure(format(
              MESSAGES.unknownSection,
              title === "" ? "（名前なし）" : title), stage);
          }
          if (Object.prototype.hasOwnProperty.call(
            sections,
            title)) {
            return failure(format(
              MESSAGES.duplicateSection,
              title), stage);
          }
          sections[title] = [];
          current = title;
          continue;
        }
        // Deeper headings (### and below) belong to the section body.
      }

      if (current !== null) {
        sections[current].push(line);
      } else if (name === null) {
        beforeName.push(line);
      } else {
        outside.push(line);
      }
    }

    if (name === null) {
      return failure(MESSAGES.missingName, stage);
    }

    result = {
      valid: true,
      name: name,
      stage: stage,
      replaceRules: null,
      description: "",
      questions: [],
      behaviorCandidates: [],
      preserveItems: [],
      recommendKeys: [],
      instruction: null,
      output: null,
      splitOutput: null,
      splitDiagnosisOutput: null,
      message: ""
    };

    // What the card says under the name. This is the only text in the
    // file written for the person choosing; every other section speaks to
    // the chat AI, so nothing else may be shown here.
    if (Object.prototype.hasOwnProperty.call(
      sections,
      DESCRIPTION_TITLE)) {
      paragraphs = readParagraphs(sections[DESCRIPTION_TITLE]);
      if (paragraphs.length === 0) {
        return failure(format(
          MESSAGES.emptySection,
          DESCRIPTION_TITLE), stage);
      }
      if (paragraphs.length > 1) {
        return failure(MESSAGES.manyDescriptions, stage);
      }
      result.description = joinWrappedLines(paragraphs[0]);
    }
    if (Object.prototype.hasOwnProperty.call(sections, QUESTION_TITLE)) {
      result.questions = readQuestions(sections[QUESTION_TITLE]);
      if (result.questions.length === 0) {
        return failure(MESSAGES.emptyQuestions, stage);
      }
    }
    if (Object.prototype.hasOwnProperty.call(sections, REPLACE_TITLE)) {
      if (stage !== STAGES.repair) {
        return failure(format(
          MESSAGES.repairOnlySection,
          REPLACE_TITLE), stage);
      }
      rules = readReplaceRules(sections[REPLACE_TITLE]);
      if (rules.invalid) {
        return failure(rules.message, stage);
      }
      if (rules.items.length === 0) {
        return failure(format(MESSAGES.emptySection, REPLACE_TITLE), stage);
      }
      result.replaceRules = rules.items;
    }
    if (Object.prototype.hasOwnProperty.call(
      sections,
      BEHAVIOR_CANDIDATES_TITLE)) {
      if (stage !== STAGES.repair) {
        return failure(format(
          MESSAGES.repairOnlySection,
          BEHAVIOR_CANDIDATES_TITLE), stage);
      }
      result.behaviorCandidates = readSimpleList(
        sections[BEHAVIOR_CANDIDATES_TITLE]);
      if (result.behaviorCandidates === null) {
        return failure(format(
          MESSAGES.invalidList,
          BEHAVIOR_CANDIDATES_TITLE), stage);
      }
    }
    // Which environment constraints make this template the obvious next
    // step. A template that names none is never recommended: a star with
    // nothing behind it is worse than no star.
    if (Object.prototype.hasOwnProperty.call(sections, RECOMMEND_TITLE)) {
      if (stage !== STAGES.repair) {
        return failure(format(
          MESSAGES.repairOnlySection,
          RECOMMEND_TITLE), stage);
      }
      result.recommendKeys = readSimpleList(sections[RECOMMEND_TITLE]);
      if (result.recommendKeys === null) {
        return failure(format(
          MESSAGES.invalidList,
          RECOMMEND_TITLE), stage);
      }
    }
    if (Object.prototype.hasOwnProperty.call(sections, PRESERVE_TITLE)) {
      if (stage !== STAGES.repair) {
        return failure(format(
          MESSAGES.repairOnlySection,
          PRESERVE_TITLE), stage);
      }
      result.preserveItems = readSimpleList(sections[PRESERVE_TITLE]);
      if (result.preserveItems === null) {
        return failure(format(
          MESSAGES.invalidList,
          PRESERVE_TITLE), stage);
      }
    }
    // A second way of answering the same request: one module per reply,
    // for macros whose code is too long to come back at once. Only a
    // preset that writes this section can offer that option.
    if (Object.prototype.hasOwnProperty.call(
      sections,
      SPLIT_OUTPUT_TITLE)) {
      if (stage !== STAGES.repair) {
        return failure(MESSAGES.wrongDiagnosisSplit, stage);
      }
      body = joinBody(sections[SPLIT_OUTPUT_TITLE]);
      if (body === "") {
        return failure(format(
          MESSAGES.emptySection,
          SPLIT_OUTPUT_TITLE), stage);
      }
      result.splitOutput = { title: SPLIT_OUTPUT_TITLE, body: body };
    }
    if (Object.prototype.hasOwnProperty.call(
      sections,
      SPLIT_DIAGNOSIS_OUTPUT_TITLE)) {
      if (stage !== STAGES.diagnose) {
        return failure(MESSAGES.wrongRepairSplit, stage);
      }
      body = joinBody(sections[SPLIT_DIAGNOSIS_OUTPUT_TITLE]);
      if (body === "") {
        return failure(format(
          MESSAGES.emptySection,
          SPLIT_DIAGNOSIS_OUTPUT_TITLE), stage);
      }
      result.splitDiagnosisOutput = {
        title: SPLIT_DIAGNOSIS_OUTPUT_TITLE,
        body: body
      };
    }

    // A template that only asks for the replacement table has nothing to
    // send anywhere, so it needs no instruction and no output rules. Any
    // other template speaks to a chat and needs both.
    if (result.replaceRules === null) {
      for (index = 0; index < SECTION_TITLES.length; index++) {
        title = SECTION_TITLES[index];
        if (!Object.prototype.hasOwnProperty.call(sections, title)) {
          return failure(format(MESSAGES.missingSection, title), stage);
        }
      }
    } else if (result.description === "") {
      return failure(format(
        MESSAGES.missingSection,
        DESCRIPTION_TITLE), stage);
    }
    if (hasText(beforeName)) {
      return failure(MESSAGES.textBeforeName, stage);
    }
    if (hasText(outside)) {
      return failure(MESSAGES.textOutsideSection, stage);
    }

    for (index = 0; index < SECTION_TITLES.length; index++) {
      title = SECTION_TITLES[index];
      if (!Object.prototype.hasOwnProperty.call(sections, title)) {
        continue;
      }
      body = joinBody(sections[title]);
      if (body === "") {
        return failure(format(MESSAGES.emptySection, title), stage);
      }
      if (title === INSTRUCTION_TITLE) {
        result.instruction = { title: title, body: body };
      } else {
        result.output = { title: title, body: body };
      }
    }

    return result;
  }

  // One list entry per file found in presets/. Invalid files stay in
  // the list with their reason so the mistake is visible, but they
  // never become a usable preset.
  function describe(preset, stage) {
    var file = preset && preset.file ? String(preset.file) : "";
    var parsed;

    if (!preset || preset.error) {
      return {
        file: file,
        name: "",
        stage: stage || "",
        replaceRules: null,
        description: "",
        questions: [],
        behaviorCandidates: [],
        preserveItems: [],
        recommendKeys: [],
        valid: false,
        message: MESSAGES.unreadable,
        instruction: null,
        output: null,
        splitOutput: null,
        splitDiagnosisOutput: null
      };
    }

    parsed = parse(preset.content, stage);
    return {
      file: file,
      name: parsed.name,
      stage: parsed.stage,
      replaceRules: parsed.replaceRules,
      description: parsed.description,
      questions: parsed.questions,
      behaviorCandidates: parsed.behaviorCandidates,
      preserveItems: parsed.preserveItems,
      recommendKeys: parsed.recommendKeys,
      valid: parsed.valid,
      message: parsed.message,
      instruction: parsed.instruction,
      output: parsed.output,
      splitOutput: parsed.splitOutput,
      splitDiagnosisOutput: parsed.splitDiagnosisOutput
    };
  }

  function describeAll(presets, stage) {
    if (!presets || !presets.length) {
      return [];
    }
    return Array.prototype.map.call(presets, function (preset) {
      return describe(preset, stage);
    });
  }

  function countValid(presets, stage) {
    var valid = 0;

    describeAll(presets, stage).forEach(function (entry) {
      if (entry.valid) {
        valid++;
      }
    });
    return valid;
  }

  global.MacroStudioPreset = {
    instructionTitle: INSTRUCTION_TITLE,
    outputTitle: OUTPUT_TITLE,
    splitOutputTitle: SPLIT_OUTPUT_TITLE,
    splitDiagnosisOutputTitle: SPLIT_DIAGNOSIS_OUTPUT_TITLE,
    replaceTitle: REPLACE_TITLE,
    behaviorCandidatesTitle: BEHAVIOR_CANDIDATES_TITLE,
    preserveTitle: PRESERVE_TITLE,
    recommendTitle: RECOMMEND_TITLE,
    modeTitle: MODE_TITLE,
    questionTitle: QUESTION_TITLE,
    descriptionTitle: DESCRIPTION_TITLE,
    stages: STAGES,
    messages: MESSAGES,
    stripComments: stripComments,
    parse: parse,
    describe: describe,
    describeAll: describeAll,
    countValid: countValid
  };
}(window));
