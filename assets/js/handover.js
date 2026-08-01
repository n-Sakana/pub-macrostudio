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

  function inventoryOf(state) {
    return state && state.bookInventory ? state.bookInventory : null;
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  // Work this tool cannot do, and only the work that is actually there.
  // A thing the workbook does not carry is not a task, so it is not
  // listed: an absence tells the reader nothing to do. Each line names
  // what was found and what the person has to settle about it.
  function humanTasks(state) {
    var inventory = inventoryOf(state);
    var tasks = [];

    function add(key, title, found, detail) {
      if (!found) {
        return;
      }
      tasks.push({
        key: key,
        title: title,
        found: true,
        detail: text(detail)
      });
    }

    if (!inventory) {
      return tasks;
    }
    add("references", "参照設定が対象の端末にあるか確かめる",
      list(inventory.references).length > 0,
      "このブックが参照しているライブラリ: " +
        list(inventory.references).join("、"));
    add("powerQuery", "クエリの接続先と資格情報を設定し直す",
      inventory.hasPowerQuery === true ||
        list(inventory.connections).length > 0,
      list(inventory.connections).length > 0
        ? "接続: " + list(inventory.connections).join("、")
        : "Power Query の定義があります。");
    add("activeX", "ActiveX コントロールが対象の端末で動くか確かめる",
      Number(inventory.activeXCount || 0) > 0,
      "シート上のコントロール " + inventory.activeXCount + " 件。" +
        "無効化された端末では読み込まれません。");
    add("barcode", "バーコードを実機のスキャナで読めるか確かめる",
      list(inventory.barcodeFonts).length > 0,
      "使っているフォント: " + list(inventory.barcodeFonts).join("、") +
        "。対象の端末に無ければ別の字形で表示され、読み取れません。");
    add("externalLinks", "外部ブックへのリンク先を新しい場所へ向け直す",
      Number(inventory.externalLinkCount || 0) > 0,
      "リンク " + inventory.externalLinkCount + " 件。" +
        "リンク先はブックの設定で、コードではありません。");
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
    if (state.repairResultEngine === "対応表による置換") {
      done.push("置き換えた文字列が、確認した対応表のとおりであることを確認した");
    }
    return done;
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
      "次はコードの外にあるため、改修していません。");
    lines.push("");
    humanTasks(state).forEach(function (task) {
      lines.push("- [ ] " + task.title + " … " + task.detail);
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
    testViewpoints: testViewpoints,
    verifiedByTool: verifiedByTool,
    humanTasks: humanTasks,
    sections: sections
  };
}(window));
