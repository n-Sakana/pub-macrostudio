(function (global) {
  "use strict";

  // What has to be handed over with a repaired workbook, and what still
  // has to be done by a person. The改修ガイド asks for six things at
  // handover and four kinds of test; both are derived here from what this
  // run actually did, so nothing is claimed that was not observed.

  var CRLF = "\r\n";

  // The kinds of work the guide sorts problems into, keyed by the axis
  // the canonical environment already carries.
  var AXIS_LABELS = {
    execution: "Win32 API・外部プログラム・スクリプト",
    storage: "パス・ファイル・フォルダー操作",
    components: "参照ライブラリ・古い部品",
    host: "接続先・機器",
    "": "対象環境の指定がない指摘"
  };

  // Work this tool cannot do. It only ever reads and rewrites VBA code,
  // so anything living outside the modules is found, named, and handed to
  // a person. Each entry says what was looked for and what was found, so
  // "見つかりませんでした" is a reported observation rather than silence.
  function inventoryOf(state) {
    return state && state.bookInventory ? state.bookInventory : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function humanTasks(state) {
    var inventory = inventoryOf(state);
    var tasks = [];

    function add(key, title, reason, found, detail) {
      tasks.push({
        key: key,
        title: title,
        reason: reason,
        found: found === true,
        detail: text(detail)
      });
    }

    if (!inventory) {
      add("inventory", "ブックの棚卸し",
        "参照設定・接続・ActiveX・フォントを読み取れていません。" +
          "ブックを読み込み直してください。",
        true, "");
      return tasks;
    }
    add("references", "参照設定の棚卸しと整理",
      "参照設定はコードの外にあり、このツールは読み書きしません。",
      list(inventory.references).length > 0,
      list(inventory.references).length > 0
        ? list(inventory.references).join("、")
        : "参照は見つかりませんでした。");
    add("powerQuery", "Power Query の接続先と資格情報の再設定",
      "クエリ定義はモジュールの外にあり、このツールは読み書きしません。",
      inventory.hasPowerQuery === true ||
        list(inventory.connections).length > 0,
      list(inventory.connections).length > 0
        ? "接続: " + list(inventory.connections).join("、")
        : (inventory.hasPowerQuery === true
          ? "Power Query の定義があります。"
          : "クエリと接続は見つかりませんでした。"));
    add("activeX", "ActiveX コントロールと信頼設定の確認",
      "コントロールと信頼設定はブックと端末の設定で、コードではありません。",
      Number(inventory.activeXCount || 0) > 0,
      Number(inventory.activeXCount || 0) > 0
        ? "ActiveX の部品が " + inventory.activeXCount + " 件あります。"
        : "ActiveX の部品は見つかりませんでした。");
    add("barcode", "バーコードの生成方式と実機読取の確認",
      "フォントとコントロールの有無は端末側の状態で、コードでは決まりません。",
      list(inventory.barcodeFonts).length > 0,
      list(inventory.barcodeFonts).length > 0
        ? "バーコード用らしいフォント: " +
          list(inventory.barcodeFonts).join("、")
        : "バーコード用らしいフォントは見つかりませんでした。");
    add("externalLinks", "外部ブックへのリンクの確認",
      "リンク先はブックの設定で、コードではありません。",
      Number(inventory.externalLinkCount || 0) > 0,
      Number(inventory.externalLinkCount || 0) > 0
        ? "外部リンクが " + inventory.externalLinkCount + " 件あります。"
        : "外部リンクは見つかりませんでした。");
    return tasks;
  }

  function text(value) {
    return String(value === undefined || value === null ? "" : value);
  }

  function cell(value) {
    return text(value).replace(/`/g, "\\`").replace(/\|/g, "\\|");
  }

  function findings(state) {
    return state && state.diagnosis && Array.isArray(state.diagnosis.findings)
      ? state.diagnosis.findings
      : [];
  }

  function constraintOf(state, key) {
    var list = state && state.targetEnvironment &&
      Array.isArray(state.targetEnvironment.constraints)
      ? state.targetEnvironment.constraints
      : [];
    var found = null;

    list.some(function (constraint) {
      if (constraint.key === key) {
        found = constraint;
        return true;
      }
      return false;
    });
    return found;
  }

  // One row per problem, however many places it was found in, matching
  // what the screen showed the reader.
  function problems(state) {
    var byKey = {};
    var order = [];

    findings(state).forEach(function (finding) {
      var key = finding.environmentKey === "-" ? "" : finding.environmentKey;

      if (!Object.prototype.hasOwnProperty.call(byKey, key)) {
        byKey[key] = [];
        order.push(key);
      }
      byKey[key].push(finding);
    });
    return order.map(function (key) {
      var constraint = key ? constraintOf(state, key) : null;
      var group = byKey[key];
      var selected = group.filter(function (finding) {
        return (state.selectedFindings || [])
          .indexOf(String(finding.number)) >= 0;
      });

      return {
        key: key,
        axis: constraint && constraint.axis ? constraint.axis : "",
        category: AXIS_LABELS[constraint && constraint.axis
          ? constraint.axis
          : ""],
        title: constraint && constraint.title
          ? constraint.title
          : text(group[0].texts.title).split("\n")[0],
        "class": group[0]["class"],
        places: group.length,
        selected: selected.length,
        modules: group.map(function (finding) {
          return finding.module;
        }).filter(function (name, index, all) {
          return all.indexOf(name) === index;
        })
      };
    });
  }

  // The four kinds of test the guide asks for, narrowed to what this run
  // actually touched. A viewpoint nobody has run is listed as not run.
  function testViewpoints(state) {
    var list = problems(state);
    var axes = {};
    var groups = [];
    var changed = (state.modules || []).filter(function (module) {
      return module.status === "changed";
    });

    list.forEach(function (problem) {
      axes[problem.axis] = true;
    });

    groups.push({
      title: "機能テスト",
      items: changed.map(function (module) {
        return "改修した " + module.name +
          " の入口プロシージャを、修正行だけでなく全体まで通す";
      }).concat([
        "改修したプロシージャの呼出元から通しで実行する",
        "ブックの新規作成・読込・更新・保存・出力を確認する"
      ])
    });
    groups.push({
      title: "異常系テスト",
      items: [
        "対象のファイルまたはフォルダーが存在しない",
        "権限がない、またはファイルがロックされている",
        "ネットワークが切断される",
        "データが空・不正・上限超過"
      ].concat(axes.storage
        ? ["保存先が URL になった状態で、パスを前提にした処理を通す"]
        : []).concat(axes.execution
        ? ["外部プログラムやスクリプトが止められた状態で通す"]
        : [])
    });
    groups.push({
      title: "非機能テスト",
      items: [
        "処理時間が現行から悪化していない",
        "同時実行と再実行が成立する",
        "32 bit / 64 bit の対象環境差を確認する",
        "ログに資格情報や個人情報が出ていない"
      ]
    });
    groups.push({
      title: "回帰テスト",
      items: [
        "改修前後の出力を比較し、差分が意図した範囲に収まっている",
        "数式・書式・名前定義・ピボット・グラフへの副作用がない",
        "既存の利用手順がそのまま通る"
      ]
    });
    return groups;
  }

  // What this run verified by itself. Everything else is someone's job.
  function verifiedByTool(state) {
    var done = [];
    var result = state.buildResult;

    if (result && result.success !== false) {
      done.push("改修済みブックを書き出し、書き戻したモジュールを読み直して" +
        "一致することを確認した");
      done.push("元のブックを変更していないことを確認した");
    }
    if (state.repairResultEngine === "固定パス置換") {
      done.push("置換した固定パスが、確認した対応表のとおりであることを確認した");
    }
    return done;
  }

  // What this terminal reports about itself, and - only when the target
  // environment says what it expects - whether the two agree. A silence
  // in the target file is not a match; it is nothing to compare against.
  function runtimeComparison(state) {
    var runtime = state && state.hostRuntime ? state.hostRuntime : null;
    var expected = state && state.targetEnvironment &&
      state.targetEnvironment.expectedRuntime
      ? state.targetEnvironment.expectedRuntime
      : null;
    var rows = [];

    function compare(label, measured, want) {
      var known = measured && measured !== "unknown";

      rows.push({
        label: label,
        measured: known ? measured : "unknown",
        expected: want ? String(want) : "",
        verdict: !want
          ? "期待値の指定なし"
          : (!known
            ? "この端末では読み取れませんでした"
            : (String(want) === String(measured) ? "一致" : "不一致"))
      });
    }

    if (!runtime) {
      return {available: false, rows: rows, notes: []};
    }
    compare("OS のアーキテクチャ", runtime.osArchitecture,
      expected ? expected.osArchitecture : null);
    compare("MacroStudio のプロセス", runtime.processArchitecture,
      expected ? expected.processArchitecture : null);
    compare("Excel / Office の版", runtime.officeVersion,
      expected ? expected.officeVersion : null);
    compare("Excel / Office のビット数", runtime.officeBitness,
      expected ? expected.officeBitness : null);
    return {
      available: true,
      rows: rows,
      notes: list(runtime.notes)
    };
  }

  function environmentRows(state) {
    var seen = {};
    var rows = [];

    problems(state).forEach(function (problem) {
      var constraint = problem.key ? constraintOf(state, problem.key) : null;

      if (!problem.key || seen[problem.key]) {
        return;
      }
      seen[problem.key] = true;
      rows.push({
        key: problem.key,
        title: constraint ? constraint.title : problem.title,
        axis: problem.category,
        effect: constraint && constraint.effect ? constraint.effect : "",
        modules: problem.modules
      });
    });
    return rows;
  }

  function sections(state) {
    var lines = [];
    var list = problems(state);
    var rows = environmentRows(state);
    var runtime = runtimeComparison(state);
    var verified = verifiedByTool(state);

    lines.push("## 改修対象一覧");
    lines.push("");
    if (list.length === 0) {
      lines.push("（診断で対処が必要な問題は挙がっていません）");
    } else {
      lines.push("| 区分 | 問題 | 該当 | 今回の扱い |");
      lines.push("|---|---|---:|---|");
      list.forEach(function (problem) {
        lines.push(
          "| " + cell(problem.category) +
          " | " + cell(problem.title) +
          " | " + problem.places + " か所" +
          " | " + (problem.selected > 0
            ? "AIへ依頼した（" + problem.selected + " か所）"
            : "今回は依頼していない") + " |");
      });
    }
    lines.push("");

    lines.push("## 環境依存設定一覧");
    lines.push("");
    lines.push("- 想定した動作環境: " +
      (state.targetEnvironment
        ? state.targetEnvironment.displayName + "（" +
          state.targetEnvironment.revision + " 版）"
        : "（読み込めていません）"));
    lines.push("- 実値（保存先・接続先・機器名）はこのメモに書きません。" +
      "環境ごとの設定として別に管理してください。");
    lines.push("");
    lines.push("### この端末で確認できた実行環境（参考）");
    lines.push("");
    lines.push("次はこのメモを作った端末を読み取った値で、**ブックの属性では" +
      "ありません**。配布先の端末では別の値になります。");
    lines.push("");
    if (!runtime.available) {
      lines.push("（読み取れていません。人が確認してください）");
    } else {
      lines.push("| 項目 | この端末 | 期待値 | 判定 |");
      lines.push("|---|---|---|---|");
      runtime.rows.forEach(function (row) {
        lines.push(
          "| " + cell(row.label) +
          " | " + cell(row.measured) +
          " | " + cell(row.expected || "—") +
          " | " + cell(row.verdict) + " |");
      });
      runtime.notes.forEach(function (note) {
        lines.push("");
        lines.push("- " + note);
      });
    }
    lines.push("");
    if (rows.length === 0) {
      lines.push("（この診断が名指しした環境の制約はありません）");
    } else {
      lines.push("| 環境キー | 制約 | 区分 | 触れているモジュール |");
      lines.push("|---|---|---|---|");
      rows.forEach(function (row) {
        lines.push(
          "| `" + cell(row.key) +
          "` | " + cell(row.title) +
          " | " + cell(row.axis) +
          " | " + cell(row.modules.join("、")) + " |");
      });
    }
    lines.push("");

    lines.push("## テスト仕様・結果");
    lines.push("");
    lines.push("### このツールが確認したこと");
    lines.push("");
    if (verified.length === 0) {
      lines.push("- （ありません）");
    } else {
      verified.forEach(function (item) {
        lines.push("- " + item);
      });
    }
    lines.push("");
    lines.push("### 人が確認すること（未実施）");
    lines.push("");
    lines.push("このツールはマクロを実行しません。次の観点は未実施です。");
    lines.push("");
    testViewpoints(state).forEach(function (group) {
      lines.push("**" + group.title + "**");
      lines.push("");
      group.items.forEach(function (item) {
        lines.push("- [ ] " + item);
      });
      lines.push("");
    });

    lines.push("## 既知の制約");
    lines.push("");
    lines.push("このツールが読み書きするのは VBA のコードだけです。" +
      "次はコードの外にあるため、探して名前を出すだけで、改修はしていません。");
    lines.push("");
    humanTasks(state).forEach(function (task) {
      lines.push("- [ ] " + task.title +
        (task.found ? "（該当あり）" : "（該当なし）") +
        " … " + task.detail + " " + task.reason);
    });
    lines.push("");
    list.filter(function (problem) {
      return problem.selected === 0;
    }).forEach(function (problem) {
      lines.push("- [ ] " + problem.title + "（" + problem.places +
        " か所）… 今回は改修を依頼していません。");
    });
    lines.push("");

    lines.push("## ロールバック手順");
    lines.push("");
    lines.push("1. 元のブック `" + text(state.book && state.book.name) +
      "` は変更していません。そのまま使えば改修前に戻ります。");
    lines.push("2. 改修済みブック `" + text(state.outputName) +
      "` とこのフォルダのファイルを削除すれば、今回の実行はなかったことに" +
      "なります。");
    lines.push("3. 元のブックを開き直し、改修前の結果が再現することを" +
      "確認してください。");
    lines.push("");
    return lines.join(CRLF);
  }

  global.MacroStudioHandover = {
    axisLabels: AXIS_LABELS,
    problems: problems,
    environmentRows: environmentRows,
    runtimeComparison: runtimeComparison,
    testViewpoints: testViewpoints,
    verifiedByTool: verifiedByTool,
    humanTasks: humanTasks,
    sections: sections
  };
}(window));
