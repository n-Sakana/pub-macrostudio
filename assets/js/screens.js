(function (global) {
  "use strict";

  // The whole flow is one screen per decision. This table is the only
  // place that knows the order, the wording and what has to be true
  // before the fixed [次へ] can be used.
  // A refactoring run goes all the way to a rebuilt workbook; a
  // diagnosis run stops once the files for the chat exist.
  // The work is chosen first, then the workbook: the first step covers
  // both, so it is named for both.
  var MAJORS = [
    "作業とブックを選ぶ",
    "AIへ依頼する",
    "返答を取り込む",
    "ブックを作る"
  ];
  var DIAGNOSE_MAJORS = [
    "作業とブックを選ぶ",
    "AIへ渡す"
  ];

  // The short way through. It is the same run as the detailed one -
  // same request id, same answer checks, same rebuild - with the screens
  // that ask the user to decide things left out: no preset to pick, no
  // module list, no diff, no output name. Only the wording and which
  // screens are visited differ, so nothing below is a second flow.
  var SIMPLE_MAJORS = [
    "ブックを選ぶ",
    "AIへ依頼する",
    "返答を取り込む",
    "ブックを作る"
  ];

  function isSimple(state) {
    return Boolean(state) && state.simple === true;
  }

  function isDiagnose(state) {
    return Boolean(state) && state.mode === "diagnose";
  }

  // A diagnosis run stops once the files for the chat exist.
  function isChatOnly(state) {
    return isDiagnose(state);
  }

  function getQuestions(state) {
    return state && Array.isArray(state.questions) ? state.questions : [];
  }

  // The second step is one screen longer when the preset asks
  // questions, so the "n / m" label has to follow the path taken.
  function stepTwoCount(state) {
    return getQuestions(state).length > 0 ? 4 : 3;
  }

  function stepTwoLabel(state, position) {
    return position + "/" + stepTwoCount(state);
  }

  function countAnswers(state) {
    var answers = state && state.answers ? state.answers : {};

    return Object.keys(answers).filter(function (key) {
      return String(answers[key] || "").trim().length > 0;
    }).length;
  }

  // Reading the workbook comes before the fork, so until the user has
  // said what the run is for, only that first step is known. The rest
  // appears once the answer exists - the bar grows, never shrinks.
  var OPENING_MAJORS = [MAJORS[0]];

  function getMajors(state) {
    if (isSimple(state)) {
      return SIMPLE_MAJORS;
    }
    if (!state || !state.mode) {
      return OPENING_MAJORS;
    }
    return isChatOnly(state) ? DIAGNOSE_MAJORS : MAJORS;
  }

  function getModules(state) {
    return state && state.modules ? state.modules : [];
  }

  function isImported(module) {
    return Boolean(module) &&
      typeof module.pastedCode === "string" &&
      (module.status === "changed" || module.status === "unchanged");
  }

  function countImported(state) {
    var count = 0;

    getModules(state).forEach(function (module) {
      if (isImported(module)) {
        count += 1;
      }
    });
    return count;
  }

  // An imported package belongs to the request it answered. Once a new
  // request id has been minted, the old answer is no longer an answer
  // to anything, so it must not carry the flow forward.
  function isIntakeCurrent(state) {
    return Boolean(state) &&
      Boolean(state.requestId) &&
      state.intakeRequestId === state.requestId;
  }

  // The verdict that nothing should change, while it still answers the
  // request on screen. Like an imported package it belongs to one
  // request only, so a new request leaves it behind.
  function getNoChangeResult(state) {
    var result = state && state.noChangeResult
      ? state.noChangeResult
      : null;

    if (!result || !state.requestId) {
      return null;
    }
    return result.requestId === state.requestId ? result : null;
  }

  function isNoChange(state) {
    return getNoChangeResult(state) !== null;
  }

  // The answer arrives one module at a time. Until every declared
  // module has come in there is nothing to review.
  function isSplitOutput(state) {
    return Boolean(state) && state.splitOutput === true;
  }

  function getIntakeParts(state) {
    return state && state.intakeParts ? state.intakeParts : null;
  }

  function countIntakeParts(state) {
    var parts = getIntakeParts(state);

    return parts && parts.parts ? parts.parts.length : 0;
  }

  function getIntakePartTotal(state) {
    var parts = getIntakeParts(state);

    return parts && parts.total ? parts.total : 0;
  }

  function countChanged(state) {
    var count = 0;

    getModules(state).forEach(function (module) {
      if (module.status === "changed") {
        count += 1;
      }
    });
    return count;
  }

  function countAccepted(state) {
    var count = 0;

    getModules(state).forEach(function (module) {
      if (module.accepted === true && module.status === "changed") {
        count += 1;
      }
    });
    return count;
  }

  function countAcceptedLines(state) {
    var count = 0;

    getModules(state).forEach(function (module) {
      if (module.accepted === true && module.status === "changed") {
        count += module.changedLineCount || 0;
      }
    });
    return count;
  }

  function countUnchangedImports(state) {
    var count = 0;

    getModules(state).forEach(function (module) {
      if (module.status === "unchanged") {
        count += 1;
      }
    });
    return count;
  }

  function getBookName(state) {
    return state && state.book ? state.book.name : "";
  }

  function getTotalLines(state) {
    return state && state.book && state.book.totalLines
      ? state.book.totalLines
      : 0;
  }

  function isOutputNameValid(state) {
    var name = state && state.outputName
      ? String(state.outputName).trim()
      : "";
    var extension = state && state.book && state.book.ext
      ? String(state.book.ext)
      : "";

    if (name.length === 0 || name.length > 120) {
      return false;
    }
    if (/[\\/:*?"<>|\u0000-\u001f]/.test(name) ||
        /[. ]$/.test(name) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) {
      return false;
    }
    if (name.indexOf(".") <= 0) {
      return false;
    }
    if (extension) {
      return name.toLowerCase().slice(-extension.length) ===
        extension.toLowerCase();
    }
    return true;
  }

  var SCREENS = [
    {
      major: 1,
      sub: "1/3",
      title: function () {
        return "作業を選んでください";
      },
      meta: function () {
        return "作業";
      },
      context: function () {
        return "ひとつ選ぶと、右下の「次へ」が使えるようになります";
      },
      ready: function (state) {
        return state.mode === "refactor" || state.mode === "diagnose";
      }
    },
    {
      major: 1,
      sub: function (state) {
        return isSimple(state) ? "1/4" : "2/3";
      },
      title: function () {
        return "Excelブックを読み込みます";
      },
      meta: function () {
        return "対応形式 .xlsm / .xlam / .xlsb / .xls";
      },
      context: function (state) {
        if (state.book && state.book.read &&
            state.book.read.level === "sourceDoubt" && !isChatOnly(state)) {
          return "読み取りに不明箇所があります。戻って「AIで相談する」を選ぶか、正常なブックを読み直してください";
        }
        return state.book
          ? "選んだブックでよければ、右下の「次へ」へ進みます"
          : "対象のブックをドラッグするか、選んでください";
      },
      ready: function (state) {
        return state.book !== null && state.modules.length > 0 &&
          (isChatOnly(state) || !state.book.read ||
            state.book.read.level !== "sourceDoubt");
      }
    },
    {
      major: 1,
      sub: "3/3",
      title: function () {
        return "読み込んだマクロを確認します";
      },
      meta: function (state) {
        return getBookName(state);
      },
      context: function (state) {
        return state.modules.length + "モジュール・" +
          getTotalLines(state) + "行を読み込みました";
      },
      ready: function (state) {
        return state.book !== null;
      }
    },
    {
      major: 2,
      sub: function (state) {
        return stepTwoLabel(state, 1);
      },
      title: function (state) {
        return isDiagnose(state)
          ? "AIに何を聞くか選びます"
          : "目的を選んでください";
      },
      meta: function () {
        return "依頼の内容";
      },
      context: function () {
        return "ひとつ選ぶと、右下の「次へ」が使えるようになります";
      },
      ready: function (state) {
        return Boolean(state.presetFile);
      }
    },
    {
      major: 2,
      sub: function (state) {
        return stepTwoLabel(state, 2);
      },
      title: function () {
        return "いくつか教えてください";
      },
      meta: function (state) {
        return countAnswers(state) + " / " +
          getQuestions(state).length + " 問";
      },
      context: function (state) {
        return countAnswers(state) > 0
          ? "答えた内容が依頼文に入ります。右下の「次へ」へ進みます"
          : "分かるところだけで大丈夫です。1 つ以上答えてください";
      },
      ready: function (state) {
        return countAnswers(state) > 0;
      }
    },
    {
      major: 2,
      sub: function (state) {
        if (isSimple(state)) {
          return "2/4";
        }
        return stepTwoLabel(
          state,
          getQuestions(state).length > 0 ? 3 : 2);
      },
      title: function (state) {
        return isSimple(state)
          ? "どのように直しますか"
          : "AIへ送る依頼文を用意しました";
      },
      meta: function (state) {
        if (isSimple(state)) {
          return getBookName(state);
        }
        return state.presetName || "依頼文";
      },
      context: function (state) {
        return isSimple(state)
          ? "直したいことを、ふだんの言葉で書いてください"
          : "内容を変えたいときは「依頼文を確認・編集」を開きます";
      },
      ready: function (state) {
        return state.requestText.trim().length > 0;
      }
    },
    {
      major: 2,
      sub: function (state) {
        if (isSimple(state)) {
          return "3/4";
        }
        return stepTwoLabel(state, stepTwoCount(state));
      },
      title: function (state) {
        return isDiagnose(state)
          ? "AIチャットへ質問します"
          : "AIチャットへ改修を依頼します";
      },
      meta: function (state) {
        return state.runFolder ? "AIへ渡す準備ができました" : "準備中";
      },
      context: function (state) {
        if (state.promptCopied && state.codeFolderOpened) {
          return isChatOnly(state)
            ? "AIチャットへ渡したら、右下の「完了」で終わります"
            : "依頼文を貼り付け、source-code.md を添付します";
        }
        if (state.promptCopied) {
          return "続けて、コード全文ファイルの場所を開きます";
        }
        return "依頼文をコピーして、コード全文ファイルと一緒にAIへ渡します";
      },
      ready: function (state) {
        return state.promptCopied === true &&
          state.codeFolderOpened === true;
      }
    },
    {
      major: 3,
      sub: "1/2",
      title: function (state) {
        if (isNoChange(state)) {
          return "AIは変更なしと判断しました";
        }
        return isSplitOutput(state)
          ? "AIの返答をモジュールごとに取り込みます"
          : "AIの返答をまとめて取り込みます";
      },
      meta: function (state) {
        if (isNoChange(state)) {
          return "変更するモジュールなし";
        }
        if (countImported(state) > 0) {
          return countImported(state) + "個のモジュールを取り込み済み";
        }
        if (isSplitOutput(state) && getIntakePartTotal(state) > 0) {
          return countIntakeParts(state) + " / " +
            getIntakePartTotal(state) + "個を受け取り済み";
        }
        return "コードブロックをコピー";
      },
      context: function (state) {
        if (isNoChange(state)) {
          return "作るブックはありません。別の返答を取り込み直せます";
        }
        if (countImported(state) > 0) {
          return "右下の「次へ」で、取り込んだ変更を確認します";
        }
        if (isSplitOutput(state) && getIntakePartTotal(state) > 0) {
          return "次のモジュールのコードブロックをコピーして、" +
            "ボタンを押します";
        }
        return "AIの返答のコードブロックをコピーして、ボタンを押します";
      },
      // A verdict of "nothing to change" is an answer, not a package:
      // there is no diff to review and no workbook to build, so the
      // flow stops here even though the intake succeeded.
      ready: function (state) {
        return countImported(state) > 0 &&
          isIntakeCurrent(state) &&
          !isNoChange(state);
      }
    },
    {
      major: 3,
      sub: "2/2",
      title: function (state) {
        return isSimple(state)
          ? "AIが直した内容を確認します"
          : "取り込んだ変更を確認します";
      },
      meta: function (state) {
        return countChanged(state) + "モジュールに変更";
      },
      context: function (state) {
        if (isSimple(state)) {
          return "内容でよければ、右下の「マクロを改修」を押します";
        }
        return state.pasteEditing
          ? "手動修正を反映するか、やめると次へ進めます"
          : "内容を確かめたら、右下の「次へ」で作成へ進みます";
      },
      ready: function (state) {
        return countChanged(state) > 0 &&
          isIntakeCurrent(state) &&
          state.pasteEditing !== true;
      }
    },
    {
      major: 4,
      sub: "1/3",
      title: function () {
        return "作成する改修済みブックを確認します";
      },
      meta: function (state) {
        return "書き戻し " + countAccepted(state) + "個";
      },
      context: function () {
        return "作成するファイルを、今回の改修用フォルダへまとめます";
      },
      ready: function (state) {
        return countChanged(state) > 0 &&
          isIntakeCurrent(state) &&
          isOutputNameValid(state);
      }
    },
    {
      major: 4,
      sub: "2/3",
      title: function () {
        return "改修済みブックをビルドしています";
      },
      meta: function (state) {
        return state && state.buildSlow === true ? "処理中" : "検証中";
      },
      context: function (state) {
        return state && state.buildSlow === true
          ? "時間がかかっています。終わるまでこのままお待ちください"
          : "書き戻し後にブックを読み直して確認しています";
      },
      ready: function () {
        return false;
      }
    },
    {
      major: 4,
      sub: "3/3",
      title: function (state) {
        return state.buildResult && state.buildResult.success === false
          ? "ビルドできませんでした"
          : "改修済みブックを作成しました";
      },
      meta: function (state) {
        return state.buildResult && state.buildResult.success === false
          ? "出力なし"
          : "ビルド完了";
      },
      context: function (state) {
        return state.buildResult && state.buildResult.success === false
          ? "元のブックは変更していません。もう一度ビルドできます"
          : "改修済みブックと関連ファイルを、ひとつのフォルダへまとめました";
      },
      ready: function () {
        return false;
      }
    }
  ];

  // The work comes first, so the mode screen is the opening screen and
  // the workbook screens follow it. Everything from the purpose screen
  // on keeps the position it had.
  var MODE_SCREEN = 0;
  var BOOK_SCREEN = 1;
  var READ_SCREEN = 2;
  var PURPOSE_SCREEN = 3;
  var QUESTION_SCREEN = 4;
  var REQUEST_SCREEN = 5;
  var HANDOFF_SCREEN = 6;
  var INTAKE_SCREEN = 7;
  var REVIEW_SCREEN = 8;
  var OUTPUT_SCREEN = 9;
  var BUILD_SCREEN = 10;
  var DONE_SCREEN = 11;

  function clampIndex(index) {
    return Math.max(0, Math.min(SCREENS.length - 1, Number(index) || 0));
  }

  function get(index) {
    return SCREENS[clampIndex(index)];
  }

  function describe(state, index) {
    var screen = get(index);
    var major = typeof screen.major === "function"
      ? screen.major(state)
      : screen.major;
    var sub = typeof screen.sub === "function"
      ? screen.sub(state)
      : screen.sub;

    return {
      index: clampIndex(index),
      major: major,
      sub: sub,
      title: screen.title(state),
      meta: screen.meta(state),
      context: screen.context(state)
    };
  }

  function canAdvance(state, index) {
    if (!state || state.busyAction !== null) {
      return false;
    }
    if (isTerminal(state, index)) {
      return false;
    }
    return get(index).ready(state) === true;
  }

  // The terminal screen shows [完了] instead of [次へ]; it becomes
  // usable under the same condition [次へ] would have.
  function canFinish(state, index) {
    if (!state || state.busyAction !== null) {
      return false;
    }
    if (!isTerminal(state, index)) {
      return false;
    }
    if (clampIndex(index) === DONE_SCREEN) {
      return true;
    }
    return get(index).ready(state) === true;
  }

  // Presets without questions skip the form. The short way skips the
  // screens that exist only to be decided on: what was read, which
  // preset, the questions, and the name of the file to write.
  function nextIndex(state, index) {
    var current = clampIndex(index);

    if (isSimple(state)) {
      if (current === BOOK_SCREEN) {
        return REQUEST_SCREEN;
      }
      if (current === REVIEW_SCREEN) {
        return BUILD_SCREEN;
      }
      return clampIndex(current + 1);
    }
    if (current === PURPOSE_SCREEN && getQuestions(state).length === 0) {
      return REQUEST_SCREEN;
    }
    return clampIndex(current + 1);
  }

  // Where a run ends. A refactoring run ends after the build. A run
  // that only talks to the chat ends on the hand-off screen: handing
  // the files over IS the job, so there is nothing after it.
  function isTerminal(state, index) {
    var current = clampIndex(index);

    return current === DONE_SCREEN ||
      (current === HANDOFF_SCREEN && isChatOnly(state));
  }

  function canGoBack(state, index) {
    return clampIndex(index) > 0 &&
      clampIndex(index) !== BUILD_SCREEN &&
      (!state || state.busyAction === null);
  }

  global.MacroStudioScreens = {
    count: SCREENS.length,
    majors: MAJORS,
    getMajors: getMajors,
    isSimple: isSimple,
    isDiagnose: isDiagnose,
    isChatOnly: isChatOnly,
    isNoChange: isNoChange,
    getNoChangeResult: getNoChangeResult,
    isTerminal: isTerminal,
    canFinish: canFinish,
    countAnswers: countAnswers,
    modeScreen: MODE_SCREEN,
    bookScreen: BOOK_SCREEN,
    readScreen: READ_SCREEN,
    purposeScreen: PURPOSE_SCREEN,
    questionScreen: QUESTION_SCREEN,
    requestScreen: REQUEST_SCREEN,
    handoffScreen: HANDOFF_SCREEN,
    buildScreen: BUILD_SCREEN,
    intakeScreen: INTAKE_SCREEN,
    reviewScreen: REVIEW_SCREEN,
    outputScreen: OUTPUT_SCREEN,
    doneScreen: DONE_SCREEN,
    get: get,
    describe: describe,
    canAdvance: canAdvance,
    canGoBack: canGoBack,
    nextIndex: nextIndex,
    isImported: isImported,
    isIntakeCurrent: isIntakeCurrent,
    isSplitOutput: isSplitOutput,
    countIntakeParts: countIntakeParts,
    getIntakePartTotal: getIntakePartTotal,
    countImported: countImported,
    countChanged: countChanged,
    countAccepted: countAccepted,
    countAcceptedLines: countAcceptedLines,
    countUnchangedImports: countUnchangedImports,
    isOutputNameValid: isOutputNameValid
  };
}(window));
