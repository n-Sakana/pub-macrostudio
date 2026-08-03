(function (global) {
  "use strict";

  // A table of "replace this with that", built from the string literals
  // a workbook's code actually contains.
  //
  // What counts as a candidate, and what each kind is called, is not
  // decided here. The template says so, and this file is handed those
  // rules. It knows how to lex VBA, how to group identical literals, and
  // how to refuse to apply anything it cannot re-verify - the mechanism.
  // It does not know what a path, a URL or a drive letter is.
  var productResults = new WeakSet();
  var UNSAFE_CLASS = "unsafe";
  var UNSAFE_LABEL = "確認が必要な候補";
  var UNMATCHED_CLASS = "other";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.keys(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  function brand(value) {
    productResults.add(value);
    return deepFreeze(value);
  }

  function isProductResult(value) {
    return Boolean(value) && typeof value === "object" &&
      productResults.has(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Asking for match positions is how a capture group's span is read
  // back exactly. Where the flag is not available the span is found by
  // searching the match text, which is the same answer whenever the
  // captured text appears once - and a rule whose group could land in
  // two places has not said which one it meant anyway.
  function compilePattern(source) {
    try {
      return new RegExp(source, "d");
    } catch (error) {
      return new RegExp(source);
    }
  }

  // The rules a template declared, compiled once. An entry the template
  // could not express is dropped rather than guessed at.
  function compileRules(rules) {
    var compiled = [];

    (Array.isArray(rules) ? rules : []).forEach(function (rule, index) {
      var pattern;
      var contextExclude = null;
      var contextInclude = null;

      if (!rule || !rule.label || !rule.pattern) {
        return;
      }
      try {
        pattern = compilePattern(String(rule.pattern));
      } catch (error) {
        return;
      }
      if (rule.contextExclude) {
        try {
          contextExclude = new RegExp(String(rule.contextExclude));
        } catch (error) {
          return;
        }
      }
      if (rule.contextInclude) {
        try {
          contextInclude = new RegExp(String(rule.contextInclude));
        } catch (error) {
          return;
        }
      }
      compiled.push({
        index: index,
        className: "rule-" + index,
        label: String(rule.label),
        pattern: pattern,
        contextExclude: contextExclude,
        contextInclude: contextInclude,
        selectedByDefault: rule.selectedByDefault === true,
        picksLocation: rule.picksLocation === true
      });
    });
    return compiled;
  }

  // Which part of the literal the rule pointed at. No capture group
  // means the whole literal, which is what every rule meant before one
  // could be written.
  function editableSpan(match, value) {
    var offset;

    if (match.length < 2 || match[1] === undefined || match[1] === null) {
      return {start: 0, end: value.length};
    }
    if (match.indices && match.indices[1]) {
      return {
        start: match.indices[1][0],
        end: match.indices[1][1]
      };
    }
    offset = match[0].indexOf(match[1]);
    if (offset < 0) {
      return {start: 0, end: value.length};
    }
    return {
      start: match.index + offset,
      end: match.index + offset + match[1].length
    };
  }

  // The first rule that matches wins, so a template orders its rules
  // from the most specific to the least. A literal the code could not be
  // read safely around is never classified at all.
  //
  // before: the code standing in front of the literal on its line. A
  // rule that named a context it does not want simply does not match
  // there, and the rules after it still get their turn. A rule that
  // named the only context it does want matches nowhere else.
  function classifyOccurrence(value, compiled, unsafe, before) {
    var index;
    var rule;
    var match;
    var span;

    if (unsafe) {
      return {
        className: UNSAFE_CLASS,
        label: UNSAFE_LABEL,
        rank: -1,
        selectedByDefault: false,
        picksLocation: false,
        start: 0,
        end: value.length
      };
    }
    for (index = 0; index < compiled.length; index += 1) {
      rule = compiled[index];
      if (rule.contextExclude &&
          rule.contextExclude.test(String(before || ""))) {
        continue;
      }
      if (rule.contextInclude &&
          !rule.contextInclude.test(String(before || ""))) {
        continue;
      }
      rule.pattern.lastIndex = 0;
      match = rule.pattern.exec(value);
      if (!match) {
        continue;
      }
      span = editableSpan(match, value);
      // A group that captured nothing points at nothing to edit.
      if (span.end <= span.start) {
        continue;
      }
      return {
        className: rule.className,
        label: rule.label,
        rank: rule.index,
        selectedByDefault: rule.selectedByDefault,
        picksLocation: rule.picksLocation,
        start: span.start,
        end: span.end
      };
    }
    return null;
  }

  function lineCount(value) {
    var text = String(value || "");
    var lines;

    if (!text) {
      return 0;
    }
    lines = text.split(/\r\n|\n|\r/);
    if (lines.length && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.length;
  }

  function decorateRow(row) {
    var result = validateRow(row);

    row.valid = result.ok;
    row.validationId = result.validationId || null;
    row.validationMessage = result.message || "";
    row.status = row.applied ? "applied" : "pending";
    return row;
  }

  function createContract(rows) {
    return brand({
      kind: "mapping",
      schemaVersion: 1,
      rows: rows.map(decorateRow)
    });
  }

  function detect(modules, rules) {
    var lexer = global.MacroStudioVbaLexer;
    var compiled = compileRules(rules);
    var groups = Object.create(null);
    var order = [];

    if (!lexer || typeof lexer.lex !== "function") {
      return brand({
        kind: "failure",
        ok: false,
        code: "E-MAP-02",
        message: "置換の候補を安全に確認できませんでした。"
      });
    }
    if (compiled.length === 0) {
      return createContract([]);
    }
    (Array.isArray(modules) ? modules : []).forEach(function (module) {
      var moduleName = String(module && module.name || "");
      var parsed = lexer.lex(String(module && module.code || ""));

      parsed.lines.forEach(function (line) {
        var logical = parsed.logicalLines[line.logicalIndex];

        line.tokens.forEach(function (token) {
          var value;
          var classification;
          var occurrence;
          var row;
          var unsafe;
          var segment;

          if (token.kind !== "string") {
            return;
          }
          value = lexer.decodeStringToken(token);
          unsafe = line.unterminatedString ||
            line.unterminatedBracket ||
            !parsed.conditionalBalanced;
          classification = classifyOccurrence(
            value,
            compiled,
            unsafe,
            String(line.text || "").slice(0, token.column));
          // A literal no rule claims is not a candidate. Deciding it
          // might be one anyway would be the app having an opinion.
          if (!classification) {
            return;
          }
          // What the reader edits, and the parts of the literal that
          // stay put around it. For a rule with no capture group the
          // segment IS the literal and both sides are empty, which is
          // the shape every row had before.
          segment = value.slice(classification.start, classification.end);
          occurrence = {
            module: moduleName,
            procedure: token.procedure || "-",
            line: line.number,
            column: token.column,
            endColumn: token.endColumn,
            class: classification.className,
            label: classification.label,
            // The whole literal, so the re-check before replacing has
            // something to compare against even when only a part of it
            // is being replaced.
            literal: value,
            prefix: value.slice(0, classification.start),
            suffix: value.slice(classification.end),
            inConditional: line.inConditional === true,
            conditionalUnbalanced: !parsed.conditionalBalanced,
            logicalLine: logical ? logical.text : line.text,
            logicalLines: logical ? clone(logical.lines) : [{
              line: line.number,
              text: line.text
            }]
          };
          // Grouping on the segment is what lets one folder be typed
          // once even when it sits inside five different connection
          // strings; each occurrence carries its own surroundings.
          row = groups[segment];
          if (!row) {
            row = {
              groupKey: segment,
              "class": classification.className,
              label: classification.label,
              rank: classification.rank,
              from: segment,
              to: "",
              included: classification.selectedByDefault,
              picksLocation: classification.picksLocation,
              applied: false,
              occurrences: []
            };
            groups[segment] = row;
            order.push(segment);
          } else if (classification.rank < row.rank) {
            row["class"] = classification.className;
            row.label = classification.label;
            row.rank = classification.rank;
            row.included = classification.selectedByDefault;
            row.picksLocation = classification.picksLocation;
          }
          row.occurrences.push(occurrence);
        });
      });
    });
    return createContract(order.map(function (key) {
      return groups[key];
    }));
  }

  // The app checks that a replacement can be carried out safely. What a
  // good replacement looks like is the reader's judgement, not this
  // file's, so nothing here inspects the shape of the new value.
  function validateRow(row) {
    var target;

    if (!row || row.applied !== true) {
      return {ok: true};
    }
    target = String(row.to === undefined || row.to === null ? "" : row.to);
    if (target.length === 0) {
      return {
        ok: false,
        validationId: "M01",
        message: "置き換え後の値を入力してください。"
      };
    }
    if (/[\u0000-\u001F\u007F]/.test(target)) {
      return {
        ok: false,
        validationId: "M02",
        message: "改行・タブなどの制御文字は入力できません。"
      };
    }
    if (target.length > 1024) {
      return {
        ok: false,
        validationId: "M03",
        message: "置き換え後の値は1024文字以内で入力してください。"
      };
    }
    return {ok: true};
  }

  function validateInternal(mapping) {
    var applied;
    var results;

    if (!isProductResult(mapping) || mapping.kind !== "mapping" ||
        mapping.schemaVersion !== 1 ||
        !Array.isArray(mapping.rows)) {
      return {
        ok: false,
        appliedCount: 0,
        rows: [],
        code: "E-MAP-01"
      };
    }
    applied = mapping.rows.filter(function (row) {
      return row && row.applied === true;
    });
    results = mapping.rows.map(function (row) {
      var validation = validateRow(row);
      return {
        groupKey: row.groupKey,
        ok: validation.ok,
        validationId: validation.validationId || null,
        message: validation.message || "",
        requiresConfirmation: validation.requiresConfirmation === true
      };
    });
    return {
      ok: applied.length > 0 && results.every(function (result) {
        return result.ok;
      }),
      appliedCount: applied.length,
      rows: results,
      code: "E-MAP-01"
    };
  }

  function validate(mapping) {
    var result = validateInternal(mapping);

    result.kind = "validation";
    return brand(result);
  }

  function canApply(mapping) {
    return validateInternal(mapping).ok;
  }

  function updateRow(mapping, groupKey, patch) {
    var rows;
    var found = false;

    if (!isProductResult(mapping) || mapping.kind !== "mapping") {
      return null;
    }
    rows = clone(mapping.rows);
    rows.forEach(function (row) {
      var next = patch || {};

      if (row.groupKey !== groupKey) {
        return;
      }
      found = true;
      if (Object.prototype.hasOwnProperty.call(next, "included")) {
        row.included = next.included === true;
      }
      if (Object.prototype.hasOwnProperty.call(next, "to")) {
        row.to = String(next.to === undefined || next.to === null
          ? ""
          : next.to);
      }
      row.applied = row.included === true && row.to.length > 0;
    });
    return found ? createContract(rows) : mapping;
  }

  function findStringToken(parsed, occurrence) {
    var line = parsed.lines[Number(occurrence.line) - 1];
    var found = null;

    if (!line) {
      return null;
    }
    line.tokens.some(function (token) {
      if (token.kind === "string" &&
          token.column === Number(occurrence.column)) {
        found = token;
        return true;
      }
      return false;
    });
    return found;
  }

  function escapeLiteral(value) {
    return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
  }

  // E-MAP-02 means the recorded positions did not line up with the code
  // being replaced in. It is not evidence that the workbook changed, so
  // the sentence points at the route that rebuilds the candidates
  // instead of sending the reader back to Excel.
  var POSITION_LOST_MESSAGE =
    "置き換える場所を、記録した位置で確認できませんでした。" +
    "何も置き換えていません。ひな形を選び直すと、候補を作り直せます。";

  function failure(code, message, validationId) {
    return brand({
      kind: "failure",
      ok: false,
      code: code,
      validationId: validationId || null,
      message: message
    });
  }

  function apply(mapping, modules) {
    var lexer = global.MacroStudioVbaLexer;
    var validation = validateInternal(mapping);
    var moduleList = Array.isArray(modules) ? modules : [];
    var moduleByName = Object.create(null);
    var parsedByName = Object.create(null);
    var replacements = Object.create(null);
    var output = [];
    var appliedRows;
    var preflightFailed = false;

    if (!validation.ok) {
      return failure(
        "E-MAP-01",
        "置き換える行の入力内容を確認してください。",
        validation.rows.filter(function (row) {
          return !row.ok;
        }).map(function (row) {
          return row.validationId;
        })[0] || null);
    }
    if (!lexer || typeof lexer.lex !== "function") {
      return failure(
        "E-MAP-02",
        POSITION_LOST_MESSAGE);
    }
    moduleList.forEach(function (module) {
      var name = String(module && module.name || "");

      if (!name || moduleByName[name]) {
        preflightFailed = true;
        return;
      }
      moduleByName[name] = module;
      parsedByName[name] = lexer.lex(String(module.code || ""));
      replacements[name] = Object.create(null);
    });
    appliedRows = mapping.rows.filter(function (row) {
      return row.applied === true;
    });

    appliedRows.forEach(function (row) {
      row.occurrences.forEach(function (occurrence) {
        var parsed = parsedByName[occurrence.module];
        var prefix = occurrence.prefix === undefined
          ? ""
          : String(occurrence.prefix);
        var suffix = occurrence.suffix === undefined
          ? ""
          : String(occurrence.suffix);
        // Rows recorded before the rules could point inside a literal
        // named the whole literal and nothing else.
        var expected = occurrence.literal === undefined
          ? row.from
          : String(occurrence.literal);
        var token;
        var key;

        if (!parsed) {
          preflightFailed = true;
          return;
        }
        token = findStringToken(parsed, occurrence);
        // The literal has to be the one that was read, all of it, even
        // when only the middle of it is being replaced.
        if (!token || lexer.decodeStringToken(token) !== expected ||
            prefix + row.from + suffix !== expected) {
          preflightFailed = true;
          return;
        }
        key = String(occurrence.line) + ":" + String(occurrence.column);
        if (replacements[occurrence.module][key]) {
          preflightFailed = true;
          return;
        }
        replacements[occurrence.module][key] = {
          token: token,
          literal: escapeLiteral(prefix + row.to + suffix)
        };
      });
    });
    if (preflightFailed) {
      return failure(
        "E-MAP-02",
        POSITION_LOST_MESSAGE);
    }

    moduleList.forEach(function (module) {
      var name = String(module.name || "");
      var parsed = parsedByName[name];
      var moduleReplacements = replacements[name];
      var keys = Object.keys(moduleReplacements);
      var code;

      if (keys.length === 0) {
        return;
      }
      code = parsed.lines.map(function (line) {
        return line.tokens.map(function (token) {
          var key = String(line.number) + ":" + String(token.column);
          return moduleReplacements[key]
            ? moduleReplacements[key].literal
            : token.text;
        }).join("") + line.eol;
      }).join("");
      output.push({
        name: name,
        code: code,
        lineCount: lineCount(code)
      });
    });

    return brand({
      kind: "apply",
      ok: true,
      schemaVersion: 1,
      modules: output,
      mapping: {
        rows: appliedRows.map(function (row) {
          return {
            groupKey: row.groupKey,
            "class": row["class"],
            // The name the template gave this kind, so the memo says
            // what the screen said rather than the internal rule id.
            label: row.label || row["class"],
            from: row.from,
            to: row.to,
            count: row.occurrences.length,
            occurrences: clone(row.occurrences)
          };
        })
      },
      logSummary: appliedRows.map(function (row) {
        var moduleCounts = Object.create(null);

        row.occurrences.forEach(function (occurrence) {
          moduleCounts[occurrence.module] =
            (moduleCounts[occurrence.module] || 0) + 1;
        });
        return {
          "class": row["class"],
          count: row.occurrences.length,
          modules: Object.keys(moduleCounts).map(function (name) {
            return {name: name, count: moduleCounts[name]};
          })
        };
      })
    });
  }

  function countOccurrences(mapping) {
    if (!isProductResult(mapping) || mapping.kind !== "mapping") {
      return 0;
    }
    return mapping.rows.reduce(function (count, row) {
      return count + row.occurrences.length;
    }, 0);
  }

  global.MacroStudioPathMap = {
    detect: detect,
    updateRow: updateRow,
    validate: validate,
    validateRow: validateRow,
    canApply: canApply,
    apply: apply,
    isProductResult: isProductResult,
    countOccurrences: countOccurrences,
    unsafeClass: UNSAFE_CLASS,
    unmatchedClass: UNMATCHED_CLASS
  };
}(window));
