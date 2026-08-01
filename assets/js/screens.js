(function (global) {
  "use strict";

  // The β2 flow has one visible entrance and four stable major steps.
  // This table is the sole authority for screen order and readiness.
  var MAJORS = [
    "ブックを読み込む",
    "診断する",
    "改修を決めて実行する",
    "ブックを作る"
  ];

  // Handing the request to the chat and taking the reply back is one
  // piece of work, not two: the reader copies, pastes, and comes back
  // with the answer without ever leaving the screen. Splitting it in two
  // bought nothing and cost a [次へ] each way, and it left a screen whose
  // only content was a single button.
  // Reading the diagnosis and choosing the work are two different
  // decisions, so they get one page each.
  var BOOK_SCREEN = 0;
  var DIAGNOSE_SCREEN = 1;
  var FINDINGS_SCREEN = 2;
  var NEXT_STEP_SCREEN = 3;
  var REPAIR_INPUT_SCREEN = 4;
  var REPAIR_SCREEN = 5;
  var REVIEW_SCREEN = 6;
  var OUTPUT_SCREEN = 7;
  var BUILD_SCREEN = 8;
  var DONE_SCREEN = 9;

  function getModules(state) {
    return state && Array.isArray(state.modules) ? state.modules : [];
  }

  function getQuestions(state) {
    return state && Array.isArray(state.questions) ? state.questions : [];
  }

  function getSelectedFindings(state) {
    return state && Array.isArray(state.selectedFindings)
      ? state.selectedFindings
      : [];
  }

  function countAnswers(state) {
    var answers = state && state.answers ? state.answers : {};

    return Object.keys(answers).filter(function (key) {
      return String(answers[key] || "").trim().length > 0;
    }).length;
  }

  function areAllQuestionsAnswered(state) {
    var questions = getQuestions(state);
    var answers = state && state.answers ? state.answers : {};

    return questions.every(function (_question, index) {
      return String(answers[String(index)] || "").trim().length > 0;
    });
  }

  function getDesiredBehaviour(state, findingId) {
    var values = state && state.desiredBehaviour
      ? state.desiredBehaviour
      : {};
    var value = values[String(findingId)];

    if (value && typeof value === "object") {
      return String(value.behaviour || "");
    }
    return String(value || "");
  }

  function areAllSelectedFindingsSpecified(state) {
    return getSelectedFindings(state).every(function (findingId) {
      return getDesiredBehaviour(state, findingId).trim().length > 0;
    });
  }

  function getEngine(state) {
    return state && state.presetEngine === "対応表による置換"
      ? "対応表による置換"
      : "AI";
  }

  function isImported(module) {
    return Boolean(module) &&
      typeof module.pastedCode === "string" &&
      (module.status === "changed" || module.status === "unchanged");
  }

  function countImported(state) {
    return getModules(state).filter(isImported).length;
  }

  function countChanged(state) {
    return getModules(state).filter(function (module) {
      return module.status === "changed";
    }).length;
  }

  function countAccepted(state) {
    return getModules(state).filter(function (module) {
      return module.status === "changed" && module.accepted === true;
    }).length;
  }

  function countAcceptedLines(state) {
    return getModules(state).reduce(function (count, module) {
      return count + (module.status === "changed" &&
        module.accepted === true ? module.changedLineCount || 0 : 0);
    }, 0);
  }

  function countUnchangedImports(state) {
    return getModules(state).filter(function (module) {
      return module.status === "unchanged";
    }).length;
  }

  // A run may declare that it wants no diagnosis. The findings page has
  // nothing to show then, so the flow steps over it.
  function isDiagnosisSkipped(state) {
    return Boolean(state) && state.diagnosisSkipped === true &&
      !state.diagnosis;
  }

  function isDiagnosisCurrent(state) {
    var attribution = state && state.diagnosisAttribution;

    return Boolean(state && state.diagnosis && attribution &&
      state.diagnosisRequestId &&
      attribution.requestId === state.diagnosisRequestId &&
      attribution.bookSnapshot === state.bookSnapshot &&
      attribution.environmentSnapshot === state.targetEnvironmentSnapshot);
  }

  function isDiagnosisRequestCurrent(state) {
    var snapshot = state && state.diagnosisRequestSnapshot;

    return Boolean(state && state.diagnosisRequestId && snapshot &&
      snapshot.requestId === state.diagnosisRequestId &&
      snapshot.bookSnapshot === state.bookSnapshot &&
      snapshot.environmentSnapshot === state.targetEnvironmentSnapshot &&
      snapshot.concern === state.diagnosisConcern &&
      snapshot.split === state.diagnosisSplit);
  }

  function isRepairIntakeCurrent(state) {
    return Boolean(state && state.repairRequestId &&
      state.repairIntakeRequestId === state.repairRequestId &&
      state.repairResultSnapshot &&
      state.repairResultSnapshot === state.repairRequestSnapshot);
  }

  function isDeterministicResultCurrent(state) {
    return Boolean(state && state.repairResultEngine === "対応表による置換" &&
      state.repairResultSnapshot && state.repairInputSnapshot &&
      state.repairResultSnapshot === state.repairInputSnapshot);
  }

  function isRepairResultCurrent(state) {
    return isRepairIntakeCurrent(state) || isDeterministicResultCurrent(state);
  }

  function getNoChangeResult(state) {
    var result = state && state.noChangeResult
      ? state.noChangeResult
      : null;

    if (!result || !state.repairRequestId) {
      return null;
    }
    return result.requestId === state.repairRequestId ? result : null;
  }

  function isNoChange(state) {
    return getNoChangeResult(state) !== null;
  }

  function isSplitOutput(state) {
    return Boolean(state) && state.splitOutput === true;
  }

  function countIntakeParts(state) {
    var parts = state && state.repairIntakeParts;

    return parts && Array.isArray(parts.parts) ? parts.parts.length : 0;
  }

  function getIntakePartTotal(state) {
    var parts = state && state.repairIntakeParts;

    return parts && parts.total ? parts.total : 0;
  }

  function isOutputNameValid(state) {
    var name = state && state.outputName
      ? String(state.outputName).trim()
      : "";
    var extension = state && state.book && state.book.ext
      ? String(state.book.ext)
      : "";

    if (name.length === 0 || name.length > 120 ||
        /[\\/:*?"<>|]/.test(name) || name.indexOf(".") <= 0) {
      return false;
    }
    return !extension || name.toLowerCase().slice(-extension.length) ===
      extension.toLowerCase();
  }

  // A selected finding is the whole instruction: it already says what is
  // wrong, where, and what breaks. Nothing further is asked per finding.
  function isAiRepairInputReady(state) {
    var selected = getSelectedFindings(state);
    var hasWork = selected.length > 0 ||
      String(state && state.extraRequest || "").trim().length > 0;

    return areAllQuestionsAnswered(state) && hasWork;
  }

  function isPathMapReady(state) {
    return Boolean(state && global.MacroStudioPathMap &&
      global.MacroStudioPathMap.isProductResult(state.pathMap) &&
      global.MacroStudioPathMap.canApply(state.pathMap));
  }

  function isRepairInputReady(state) {
    return getEngine(state) === "対応表による置換"
      ? isPathMapReady(state)
      : isAiRepairInputReady(state);
  }

  function bookName(state) {
    return state && state.book ? state.book.name : "";
  }

  function findingCount(state) {
    return state && state.diagnosis && Array.isArray(state.diagnosis.findings)
      ? state.diagnosis.findings.length
      : 0;
  }

  var SCREENS = [
    {
      major: 1,
      sub: "1/1",
      title: function () { return "Excelブックを読み込みます"; },
      meta: function () { return "対応形式 .xlsm / .xlam / .xlsb / .xls"; },
      context: function (state) {
        return state.book
          ? "読み取った内容を確認し、診断へ進みます"
          : "対象のブックをドラッグするか、選んでください";
      },
      ready: function (state) {
        return Boolean(state.book) && getModules(state).length > 0;
      }
    },
    {
      major: 2,
      sub: "1/1",
      title: function () { return "AIに診断してもらいます"; },
      meta: function (state) {
        if (isDiagnosisCurrent(state)) {
          return findingCount(state) + "件の指摘を取り込み済み";
        }
        return state.diagnosisRequestId
          ? "診断依頼を用意しました"
          : "診断依頼を準備中";
      },
      context: function (state) {
        if (isDiagnosisCurrent(state)) {
          return "右下の「次へ」で診断結果を確認します";
        }
        if (!state.diagnosisPromptCopied) {
          return "依頼文をコピーして、AIへ貼り付けます";
        }
        if (!state.diagnosisFolderOpened) {
          return "source-code.md をAIへ添付します";
        }
        return "AIの返答をコピーして、この画面へ取り込みます";
      },
      ready: function (state) {
        return isDiagnosisCurrent(state) || isDiagnosisSkipped(state);
      }
    },
    {
      major: 3,
      sub: "1/5",
      title: function () { return "診断結果を確認します"; },
      meta: function (state) {
        return findingCount(state) + "件の指摘";
      },
      context: function () {
        return "診断の内容を確かめます";
      },
      ready: isDiagnosisCurrent
    },
    {
      major: 3,
      sub: "2/5",
      title: function () { return "次にすることを選びます"; },
      meta: function (state) {
        return state.presetName || "ひな形を選ぶ";
      },
      context: function () {
        return "したい作業に近いひな形を選びます";
      },
      ready: function (state) {
        return (isDiagnosisCurrent(state) || isDiagnosisSkipped(state)) &&
          (state.presetFiles || []).length > 0;
      }
    },
    {
      major: 3,
      sub: "3/5",
      title: function () { return "改修する内容を決めます"; },
      meta: function (state) { return state.presetName || "改修の入力"; },
      context: function (state) {
        return getEngine(state) === "対応表による置換"
          ? "置き換える内容を確認します"
          : "改修する指摘にチェックが入っていることを確かめます";
      },
      ready: isRepairInputReady
    },
    {
      major: 3,
      sub: "4/5",
      title: function (state) {
        if (state && state.needDecision) {
          return "決める必要があることが返ってきました";
        }
        return isNoChange(state)
          ? "AIから変更なしの判断が返ってきました"
          : "AIに改修してもらいます";
      },
      meta: function (state) {
        if (state && state.needDecision) {
          return "改修の入力へ戻ります";
        }
        if (isNoChange(state)) {
          return getNoChangeResult(state).verdict === "UNNECESSARY"
            ? "改修は不要"
            : "この方法では改修できません";
        }
        if (countImported(state) > 0) {
          return countImported(state) + "個のモジュールを取り込み済み";
        }
        return state.repairRequestId ? "改修依頼を用意しました" : "準備中";
      },
      context: function (state) {
        if (state && state.needDecision) {
          return "質問を確認して、希望動作や追加の要望へ答えを入力します";
        }
        if (isNoChange(state)) {
          return "理由を確認し、別の返答があれば取り込み直せます";
        }
        if (countImported(state) > 0) {
          return "右下の「次へ」で取り込んだ変更を確認します";
        }
        if (!state.repairPromptCopied) {
          return "依頼文をコピーして、AIへ貼り付けます";
        }
        if (!state.repairFolderOpened) {
          return "source-code.md をAIへ添付します";
        }
        return "AIの返答をコピーして、この画面へ取り込みます";
      },
      ready: function (state) {
        return countImported(state) > 0 &&
          isRepairIntakeCurrent(state) && !isNoChange(state) &&
          !state.needDecision;
      }
    },
    {
      major: 3,
      sub: "5/5",
      title: function () { return "取り込んだ変更を確認します"; },
      meta: function (state) { return countChanged(state) + "モジュールに変更"; },
      context: function (state) {
        return state.pasteEditing
          ? "手動修正を反映するか、やめると次へ進めます"
          : "内容を確かめたら、右下の「次へ」で作成へ進みます";
      },
      ready: function (state) {
        return countChanged(state) > 0 &&
          isRepairResultCurrent(state) && state.pasteEditing !== true;
      }
    },
    {
      major: 4,
      sub: "1/3",
      title: function () { return "作成する改修済みブックを確認します"; },
      meta: function (state) { return "書き戻し " + countAccepted(state) + "個"; },
      context: function () {
        return "作成するファイルを、今回の改修用フォルダへまとめます";
      },
      ready: function (state) {
        return countChanged(state) > 0 &&
          isRepairResultCurrent(state) && isOutputNameValid(state);
      }
    },
    {
      major: 4,
      sub: "2/3",
      title: function () { return "改修済みブックをビルドしています"; },
      meta: function (state) { return state.buildSlow ? "処理中" : "検証中"; },
      context: function (state) {
        return state.buildSlow
          ? "時間がかかっています。終わるまでこのままお待ちください"
          : "書き戻し後にブックを読み直して確認しています";
      },
      ready: function () { return false; }
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
      ready: function () { return false; }
    }
  ];

  function clampIndex(index) {
    return Math.max(0, Math.min(SCREENS.length - 1, Number(index) || 0));
  }

  function get(index) {
    return SCREENS[clampIndex(index)];
  }

  function describe(state, index) {
    var screen = get(index);

    return {
      index: clampIndex(index),
      major: screen.major,
      sub: typeof screen.sub === "function" ? screen.sub(state) : screen.sub,
      title: screen.title(state),
      meta: screen.meta(state),
      context: screen.context(state)
    };
  }

  function isTerminal(_state, index) {
    return clampIndex(index) === DONE_SCREEN;
  }

  function canAdvance(state, index) {
    return Boolean(state) && state.busyAction === null &&
      !isTerminal(state, index) && get(index).ready(state) === true;
  }

  function canFinish(state, index) {
    return Boolean(state) && state.busyAction === null &&
      clampIndex(index) === DONE_SCREEN;
  }

  // The only path-changing branch is the repair engine. Questions alter
  // screen 4's contents, never the screen graph.
  function nextIndex(state, index) {
    var current = clampIndex(index);

    if (current === DIAGNOSE_SCREEN && isDiagnosisSkipped(state)) {
      return NEXT_STEP_SCREEN;
    }
    if (current === REPAIR_INPUT_SCREEN &&
        getEngine(state) === "対応表による置換") {
      return REVIEW_SCREEN;
    }
    return clampIndex(current + 1);
  }

  function canGoBack(state, index) {
    return clampIndex(index) > BOOK_SCREEN &&
      clampIndex(index) !== BUILD_SCREEN &&
      (!state || state.busyAction === null);
  }

  global.MacroStudioScreens = {
    count: SCREENS.length,
    majors: MAJORS,
    getMajors: function () { return MAJORS.slice(); },
    bookScreen: BOOK_SCREEN,
    diagnoseScreen: DIAGNOSE_SCREEN,
    nextStepScreen: NEXT_STEP_SCREEN,
    repairScreen: REPAIR_SCREEN,
    // Handing over and taking back now share one screen. The two old
    // names stay so every caller that asks "are we on the diagnose step"
    // keeps meaning the same thing.
    diagnoseRequestScreen: DIAGNOSE_SCREEN,
    diagnoseIntakeScreen: DIAGNOSE_SCREEN,
    repairRequestScreen: REPAIR_SCREEN,
    repairIntakeScreen: REPAIR_SCREEN,
    findingsScreen: FINDINGS_SCREEN,
    repairInputScreen: REPAIR_INPUT_SCREEN,
    reviewScreen: REVIEW_SCREEN,
    outputScreen: OUTPUT_SCREEN,
    buildScreen: BUILD_SCREEN,
    doneScreen: DONE_SCREEN,
    get: get,
    describe: describe,
    canAdvance: canAdvance,
    canFinish: canFinish,
    canGoBack: canGoBack,
    nextIndex: nextIndex,
    isTerminal: isTerminal,
    isDiagnosisCurrent: isDiagnosisCurrent,
    isDiagnosisSkipped: isDiagnosisSkipped,
    isDiagnosisRequestCurrent: isDiagnosisRequestCurrent,
    isRepairIntakeCurrent: isRepairIntakeCurrent,
    isRepairResultCurrent: isRepairResultCurrent,
    isNoChange: isNoChange,
    getNoChangeResult: getNoChangeResult,
    isImported: isImported,
    isSplitOutput: isSplitOutput,
    countIntakeParts: countIntakeParts,
    getIntakePartTotal: getIntakePartTotal,
    countAnswers: countAnswers,
    countImported: countImported,
    countChanged: countChanged,
    countAccepted: countAccepted,
    countAcceptedLines: countAcceptedLines,
    countUnchangedImports: countUnchangedImports,
    isOutputNameValid: isOutputNameValid,
    isRepairInputReady: isRepairInputReady,
    getEngine: getEngine
  };
}(window));
