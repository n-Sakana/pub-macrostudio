(function (global) {
  "use strict";

  var CRLF = "\r\n";
  var CODE_BANNER = new Array(81).join("=");
  var INDEX_LINE = new Array(41).join("-");
  var PLACEHOLDER_NAMES = [
    "REQUEST_TEXT",
    "OUTPUT_RULES",
    "REQUEST_ID",
    "BOOK_NAME",
    "MODULE_COUNT",
    "TOTAL_LINE_COUNT",
    "MODULE_LIST",
    "CODE_FILE_NAME",
    "SOURCE_READ_STATUS"
  ];
  var REQUIRED_PLACEHOLDER_NAMES = [
    "REQUEST_TEXT"
  ];
  var CODE_FILE_GROUPS = [
    { type: "standard", heading: "Standard Modules:" },
    { type: "class", heading: "Class Modules:" },
    { type: "form", heading: "UserForms:" },
    { type: "document", heading: "Document Modules:" }
  ];
  var KNOWN_PLACEHOLDERS = {};

  PLACEHOLDER_NAMES.forEach(function (name) {
    KNOWN_PLACEHOLDERS[name] = true;
  });

  function normalizeCrLf(value) {
    return value
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, CRLF);
  }

  function countLineBreaks(value, fromStart) {
    var expression = fromStart
      ? /^(?:(?:\r\n|\r|\n))+/
      : /(?:(?:\r\n|\r|\n))+$/;
    var match = value.match(expression);
    var breaks;

    if (!match) {
      return 0;
    }

    breaks = match[0].match(/\r\n|\r|\n/g);
    return breaks ? breaks.length : 0;
  }

  function appendPreset(existingText, presetText) {
    var existing = existingText === null ||
      existingText === undefined
      ? ""
      : String(existingText);
    var preset = presetText === null ||
      presetText === undefined
      ? ""
      : String(presetText);
    var boundaryBreaks;
    var needed;

    if (!existing) {
      return preset;
    }
    if (!preset) {
      return existing;
    }

    boundaryBreaks =
      countLineBreaks(existing, false) +
      countLineBreaks(preset, true);
    needed = Math.max(0, 2 - boundaryBreaks);
    return existing +
      new Array(needed + 1).join(CRLF) +
      preset;
  }

  // The output rules come from the applied preset file, heading and
  // all. Nothing about their content is defined here.
  function formatOutputRules(outputRules) {
    var title;
    var body;

    if (!outputRules) {
      return "";
    }
    title = outputRules.title === null ||
      outputRules.title === undefined
      ? ""
      : String(outputRules.title);
    body = outputRules.body === null ||
      outputRules.body === undefined
      ? ""
      : normalizeCrLf(String(outputRules.body));
    if (body === "") {
      return "";
    }
    if (title === "") {
      return body;
    }
    return "【" + title + "】" + CRLF + body;
  }

  function requireString(value, label) {
    if (typeof value !== "string") {
      throw new Error(label + " is missing.");
    }
    return value;
  }

  function buildModuleList(modules) {
    var lines = [];

    modules.forEach(function (module) {
      lines.push(
        "  - " +
        requireString(module.name, "Module name") +
        " （" +
        requireString(module.typeLabel, "Module type label") +
        ", " +
        module.lineCount +
        " 行）");
    });

    return lines.join(CRLF);
  }

  function getModuleFileName(module) {
    return requireString(module.name, "Module name") +
      "." +
      requireString(module.ext, "Module extension");
  }

  function sourceReadStatus(book) {
    var read = book && book.read;
    if (read && read.level === "sourceDoubt") {
      return "【読み取り上の注意】コードが欠落・途中までの可能性があります。" +
        String(read.headline || "") + String(read.detail || "") +
        "読み取れた範囲だけで判断し、不明な点を推測で補わず明示してください。";
    }
    return "読み取り処理が取得したコードを省略せず添付しています。" +
      "外部ファイル・参照設定・実行環境など、この資料だけでは判断できない点は明示してください。";
  }

  function buildCodeFile(options) {
    var lines = [];
    var ordered = [];
    var totalLines = 0;

    if (!options || !options.book ||
        !Array.isArray(options.modules)) {
      throw new Error("Code file source data is missing.");
    }

    var bookName = requireString(options.book.name, "Book name");
    var generatedAt = requireString(
      options.generatedAt,
      "Code file timestamp");

    lines.push(CODE_BANNER);
    lines.push(" " + bookName + " - VBA Source Code");
    lines.push(" Generated: " + generatedAt);
    lines.push(CODE_BANNER);
    lines.push("");
    lines.push(sourceReadStatus(options.book));
    lines.push("");
    lines.push("MODULE INDEX");
    lines.push(INDEX_LINE);
    lines.push("");

    CODE_FILE_GROUPS.forEach(function (group) {
      var members = options.modules.filter(function (module) {
        return module.type === group.type;
      });

      if (members.length === 0) {
        return;
      }
      lines.push("  " + group.heading);
      members.forEach(function (module) {
        var lineCount = module.lineCount || 0;

        totalLines += lineCount;
        lines.push(
          "    " + getModuleFileName(module) +
          " (" + lineCount + " lines)");
        ordered.push(module);
      });
      lines.push("");
    });

    if (ordered.length !== options.modules.length) {
      throw new Error("A module has an unknown type.");
    }

    lines.push(
      "  Total: " + totalLines + " lines across " +
      ordered.length + " modules");
    lines.push("");

    ordered.forEach(function (module) {
      var code = normalizeCrLf(
        requireString(module.code, "Module code"))
        .replace(/(?:\r\n)+$/, "");

      lines.push(CODE_BANNER);
      lines.push(" " + getModuleFileName(module));
      lines.push(CODE_BANNER);
      lines.push("");
      if (code.length > 0) {
        code.split(CRLF).forEach(function (codeLine) {
          lines.push(codeLine);
        });
        lines.push("");
      }
    });

    return lines.join(CRLF).replace(/(?:\r\n)+$/, "") + CRLF;
  }

  function validateTemplate(template) {
    var placeholderPattern = /\{\{([^{}\r\n]*)\}\}/g;
    var seen = {};
    var match;
    var withoutPlaceholders;

    while ((match = placeholderPattern.exec(template)) !== null) {
      if (match[1] === "MODULE_SOURCE_BLOCKS") {
        throw new Error(
          "{{MODULE_SOURCE_BLOCKS}} is no longer supported: " +
          "the source code now goes into the attached code file.");
      }
      if (!Object.prototype.hasOwnProperty.call(
        KNOWN_PLACEHOLDERS,
        match[1])) {
        throw new Error(
          "Unknown request template placeholder: " + match[0]);
      }
      seen[match[1]] = true;
    }

    withoutPlaceholders = template.replace(
      /\{\{([^{}\r\n]*)\}\}/g,
      "");
    if (withoutPlaceholders.indexOf("{{") >= 0 ||
        withoutPlaceholders.indexOf("}}") >= 0) {
      throw new Error("The request template has a malformed placeholder.");
    }

    REQUIRED_PLACEHOLDER_NAMES.forEach(function (name) {
      if (!seen[name]) {
        throw new Error(
          "The request template is missing {{" + name + "}}.");
      }
    });
  }

  function renderTemplate(template, variables) {
    var text = normalizeCrLf(template);
    var placeholderPattern = /\{\{([^{}\r\n]*)\}\}/g;
    var result = "";
    var searchIndex = 0;
    var match;
    var value;
    var afterToken;
    var followingBreaks;
    var trailingBreaks;
    var overlap;

    while ((match = placeholderPattern.exec(text)) !== null) {
      value = normalizeCrLf(variables[match[1]]);
      trailingBreaks = countLineBreaks(value, false);
      afterToken = match.index + match[0].length;
      followingBreaks = 0;
      while (text.substr(
        afterToken + (followingBreaks * CRLF.length),
        CRLF.length) === CRLF) {
        followingBreaks++;
      }
      overlap = Math.min(trailingBreaks, followingBreaks);
      result += text.slice(searchIndex, match.index) +
        value +
        new Array(followingBreaks - overlap + 1).join(CRLF);
      searchIndex =
        afterToken + (followingBreaks * CRLF.length);
      placeholderPattern.lastIndex = searchIndex;
    }
    result += text.slice(searchIndex);
    return result.replace(/(?:(?:\r\n))+$/, "") + CRLF;
  }

  function buildRequestPrompt(options) {
    var template;
    var requestText;
    var book;
    var modules;
    var variables;

    if (!options || !options.book ||
        !Array.isArray(options.modules)) {
      throw new Error("Prompt source data is missing.");
    }

    template = requireString(
      options.template,
      "Request template");
    validateTemplate(template);
    requestText = normalizeCrLf(
      requireString(options.requestText, "Request text"));
    book = options.book;
    modules = options.modules;
    variables = {
      REQUEST_TEXT: requestText,
      OUTPUT_RULES: formatOutputRules(options.outputRules),
      SOURCE_READ_STATUS: sourceReadStatus(book),
      REQUEST_ID: options.requestId === undefined ||
        options.requestId === null
        ? ""
        : String(options.requestId),
      BOOK_NAME: requireString(book.name, "Book name"),
      MODULE_COUNT: String(modules.length),
      TOTAL_LINE_COUNT: String(book.totalLines),
      MODULE_LIST: buildModuleList(modules),
      CODE_FILE_NAME: requireString(
        options.codeFileName,
        "Code file name")
    };

    return renderTemplate(template, variables);
  }

  global.MacroStudioPrompt = {
    appendPreset: appendPreset,
    formatOutputRules: formatOutputRules,
    buildCodeFile: buildCodeFile,
    buildRequestPrompt: buildRequestPrompt
  };
}(window));
