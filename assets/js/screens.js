(function (global) {
  "use strict";

  // The β2 flow has one visible way in - the workbook - and four stable
  // major steps.
  // This table is the sole authority for screen order and readiness.
  // The four stages of the improvement guide: 2-A preservation,
  // 2-B judgement, 2-C repair, 2-E handover. 2-D testing happens outside
  // this tool, and the handover memo lists its viewpoints as not run.
  // The four stages, in the words a reader would use for them. They were
  // "決めて読む" and "作って引き渡す" - phrases that name two acts each and
  // read as instructions to the machine rather than as where you are.
  // One verb per stage, and the verb is what happens to the workbook.
  var MAJORS = [
    "読み込む",
    "診断する",
    "改修する",
    "書き出す"
  ];

  // Handing the request to the chat and taking the reply back is one
  // piece of work, not two: the reader copies, pastes, and comes back
  // with the answer without ever leaving the screen. Splitting it in two
  // bought nothing and cost a [次へ] each way, and it left a screen whose
  // only content was a single button.
  // Reading the diagnosis and choosing the work are two different
  // decisions, so they get one page each.
  // The one file the chat is handed. It lives here because both the screen
  // body and the status line under it name this file, and a second copy of
  // the name is how they came to disagree.
  var AI_CODE_FILE = "source-code-for-ai.md";

  // One road. Reading the workbook is the first thing that happens, and
  // the diagnosis after it is not optional: a run that could step over it
  // would be a branch at the top of the flow wearing a different name.
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

  // Whether the run may change the shape of the project. The answer is
  // the chosen change-scope template's own word, never a default this
  // file invented: with no scope chosen there is nothing to enforce and
  // nothing to promise, so the screen that chooses the work says so
  // rather than guessing "minimal".
  function getChangeScope(state) {
    return state && state.changeScope ? state.changeScope : null;
  }

  function isStructureForbidden(state) {
    var scope = getChangeScope(state);

    return Boolean(scope) && scope.structure === "forbidden";
  }

  function isChangeScopeChosen(state) {
    return getChangeScope(state) !== null;
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

  // An answer counts as current only while it still answers the input on
  // screen 4. The request it belongs to is not enough: the reader can
  // change the input after the answer came back, and that answer then
  // belongs to a question nobody is asking any more. Nothing is thrown
  // away here - the next written request does that (SPEC 2.6.1) - but
  // the flow stops treating it as an answer to the current work.
  function isRepairIntakeCurrent(state) {
    return Boolean(state && state.repairRequestId &&
      state.repairIntakeRequestId === state.repairRequestId &&
      state.repairResultSnapshot &&
      state.repairResultSnapshot === state.repairRequestSnapshot &&
      state.repairRequestSnapshot === state.repairInputSnapshot);
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

  // Why a repair answer refused, in the words the screen uses.
  var NO_CHANGE_META = {
    UNNECESSARY: "改修は不要",
    IMPOSSIBLE: "この方法では改修できません",
    UNCLEAR: "依頼の内容を決められません"
  };

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

  // Windows resolves these names to devices instead of files. A book built
  // under one of them is created and announced as a success, but the result
  // cannot be opened, renamed or deleted - not even by the rollback steps
  // result.md prints. The set is what
  // qa\run01-blackbox\lib\probe-reserved-names.ps1 measured, which is wider
  // than the usual documentation: COM0, LPT0 and CLOCK$ behave exactly like
  // COM1..COM9 and LPT1..LPT9.
  var RESERVED_DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[0-9]|LPT[0-9])$/i;

  function isReservedDeviceName(name) {
    // Windows looks at the component up to the first period and ignores any
    // trailing spaces and periods on it, so "CON.xlsm", "CON .xlsm" and
    // "CON.backup.xlsm" all reach the device. "backup.CON.xlsm" does not.
    return RESERVED_DEVICE_NAME.test(
      name.split(".")[0].replace(/[ .]+$/, "")
    );
  }

  // Control characters cannot appear in a Windows file name at all - the
  // write is refused outright - and they arrive by paste, not by typing.
  // Tested by code point rather than by a character class so that no control
  // character ever has to appear in this source file.
  function hasControlCharacter(name) {
    var i;

    for (i = 0; i < name.length; i += 1) {
      if (name.charCodeAt(i) < 32) {
        return true;
      }
    }
    return false;
  }

  function isOutputNameValid(state) {
    var name = state && state.outputName
      ? String(state.outputName).trim()
      : "";
    var extension = state && state.book && state.book.ext
      ? String(state.book.ext)
      : "";

    if (name.length === 0 || name.length > 120 ||
        /[\\/:*?"<>|]/.test(name) || name.indexOf(".") <= 0 ||
        hasControlCharacter(name) || isReservedDeviceName(name)) {
      return false;
    }
    return !extension || name.toLowerCase().slice(-extension.length) ===
      extension.toLowerCase();
  }

  // Why the name was refused, in one sentence, or "" when it is fine.
  //
  // Screen 7 used to turn the box red and leave the same line underneath
  // either way: "the extension will stay .xlsm". For a path separator that
  // was merely unhelpful; for a reserved device name it was wrong, because
  // the extension was never the problem. The reader was left to guess.
  // Order matters - report the first thing that actually stops the build.
  function getOutputNameProblem(state) {
    var name = state && state.outputName
      ? String(state.outputName).trim()
      : "";
    var extension = state && state.book && state.book.ext
      ? String(state.book.ext)
      : "";
    var stem = name.split(".")[0].replace(/[ .]+$/, "");

    if (name.length === 0) {
      return "作成するファイル名を入力してください。";
    }
    if (name.length > 120) {
      return "ファイル名が長すぎます。120文字までにしてください。";
    }
    if (/[\\/:*?"<>|]/.test(name)) {
      return "ファイル名だけを入れてください。" +
        "フォルダの区切りや \\ / : * ? \" < > | は使えません。";
    }
    if (hasControlCharacter(name)) {
      return "ファイル名に使えない文字が混ざっています。" +
        "貼り付けた場合は、もう一度入力し直してください。";
    }
    if (isReservedDeviceName(name)) {
      return "「" + stem + "」は Windows が装置の名前として扱うため、" +
        "この名前ではファイルを作っても開けません。別の名前にしてください。";
    }
    if (name.indexOf(".") <= 0) {
      return "拡張子 " + extension + " を付けた名前にしてください。";
    }
    if (extension && name.toLowerCase().slice(-extension.length) !==
        extension.toLowerCase()) {
      return "拡張子は " + extension + " のままにしてください。";
    }
    return "";
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

  // Three routes, one screen graph.
  //
  //   AI only        4 conditions -> 5 hand over -> 6 diff -> build
  //   table only     4 table+replace          -> 6 diff -> build
  //   both           4 table+replace, then 4 conditions -> 5 -> 6 -> build
  //
  // In the third, the machine replacement runs first and the chat is
  // then given the code it produced: asking a chat to repair lines the
  // table is about to rewrite would put the old paths back. Screen 4
  // holds both stages, so the order of screens never changes.
  function hasReplacementStage(state) {
    return Boolean(state && state.presetReplaceRules);
  }

  // Carried out once, and it stays carried out. A chat answer arriving
  // afterwards edits the replaced code; it does not undo the stage.
  function isReplacementDone(state) {
    return Boolean(state && state.appliedMapping);
  }

  function isReplacementPending(state) {
    return hasReplacementStage(state) && !isReplacementDone(state);
  }

  function isRepairInputReady(state) {
    if (getEngine(state) === "対応表による置換" ||
        isReplacementPending(state)) {
      return isPathMapReady(state);
    }
    return isAiRepairInputReady(state);
  }

  function bookName(state) {
    return state && state.book ? state.book.name : "";
  }

  function findingCount(state) {
    return state && state.diagnosis && Array.isArray(state.diagnosis.findings)
      ? state.diagnosis.findings.length
      : 0;
  }

  function isGradeDiagnosis(state) {
    return Boolean(state && state.diagnosis &&
      state.diagnosis.shape === "grade");
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
          return AI_CODE_FILE + " をAIへ添付します";
        }
        return "AIの返答をコピーして、この画面へ取り込みます";
      },
      ready: isDiagnosisCurrent
    },
    {
      major: 3,
      sub: "1/5",
      title: function () { return "診断結果を確認します"; },
      meta: function (state) {
        // Two kinds of diagnosis, two kinds of answer: a list of
        // problems, or one grade for the whole workbook.
        if (isGradeDiagnosis(state)) {
          return "判定 " + String(state.diagnosis.grade);
        }
        return findingCount(state) + "件の指摘";
      },
      context: function () {
        return "重い指摘から順に並んでいます。開くと根拠まで読めます";
      },
      ready: isDiagnosisCurrent
    },
    {
      major: 3,
      sub: "2/5",
      title: function () { return "どう改修するかを選びます"; },
      meta: function (state) {
        return state.presetName || "未選択";
      },
      context: function (state) {
        if (!isChangeScopeChosen(state)) {
          return "変更範囲を選んでください";
        }
        return "診断で見つかった問題に対する改修を選びます。複数選べます";
      },
      // Two answers are needed here, and neither has a silent default:
      // which operations to carry out, and how far the code may change.
      ready: function (state) {
        return isDiagnosisCurrent(state) &&
          (state.presetFiles || []).length > 0 &&
          isChangeScopeChosen(state);
      }
    },
    {
      major: 3,
      sub: "3/5",
      title: function () { return "直す指摘を選びます"; },
      meta: function (state) { return state.presetName || "未選択"; },
      context: function (state) {
        if (getEngine(state) === "対応表による置換" ||
            isReplacementPending(state)) {
          return "置き換える内容を確認します";
        }
        return "AIへ送る指摘にチェックを入れます";
      },
      ready: isRepairInputReady
    },
    {
      major: 3,
      sub: "4/5",
      title: function (state) {
        return isNoChange(state)
          ? "AIから「改修できません」が返ってきました"
          : "AIに改修してもらいます";
      },
      meta: function (state) {
        if (isNoChange(state)) {
          return NO_CHANGE_META[getNoChangeResult(state).verdict] ||
            "改修できません";
        }
        if (countImported(state) > 0) {
          return countImported(state) + "個のモジュールを取り込み済み";
        }
        return state.repairRequestId ? "改修依頼を用意しました" : "準備中";
      },
      context: function (state) {
        if (isNoChange(state)) {
          return "理由を確認し、依頼を書き直すか、別の返答を取り込み直します";
        }
        if (countImported(state) > 0) {
          return "右下の「次へ」で取り込んだ変更を確認します";
        }
        if (!state.repairPromptCopied) {
          return "依頼文をコピーして、AIへ貼り付けます";
        }
        if (!state.repairFolderOpened) {
          return AI_CODE_FILE + " をAIへ添付します";
        }
        return "AIの返答をコピーして、この画面へ取り込みます";
      },
      ready: function (state) {
        return countImported(state) > 0 &&
          isRepairIntakeCurrent(state) && !isNoChange(state);
      }
    },
    {
      major: 3,
      sub: "5/5",
      title: function () { return "AIの変更内容を確認します"; },
      meta: function (state) { return countChanged(state) + "モジュールに変更"; },
      context: function (state) {
        return state.pasteEditing
          ? "手動修正を反映するか、やめると次へ進めます"
          : "変更を確かめたら、右下の「次へ」で作成へ進みます";
      },
      ready: function (state) {
        return countChanged(state) > 0 &&
          isRepairResultCurrent(state) && state.pasteEditing !== true;
      }
    },
    {
      major: 4,
      sub: "1/3",
      title: function () { return "出力するファイル名を決めます"; },
      meta: function (state) { return "書き戻し " + countAccepted(state) + "個"; },
      context: function () {
        return "改修済みブックと関連ファイルを、この実行のフォルダへまとめます";
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

  // One branch is left, and it is not about what the reader wanted: when
  // everything chosen is carried out by the replacement table, there is
  // no chat stage to walk through, so the flow goes from the table
  // straight to the diff. Every screen before that is walked every time.
  function nextIndex(state, index) {
    var current = clampIndex(index);

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
    AI_CODE_FILE: AI_CODE_FILE,
    count: SCREENS.length,
    majors: MAJORS,
    getMajors: function () { return MAJORS.slice(); },
    isGradeDiagnosis: isGradeDiagnosis,
    getChangeScope: getChangeScope,
    isChangeScopeChosen: isChangeScopeChosen,
    isStructureForbidden: isStructureForbidden,
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
    getOutputNameProblem: getOutputNameProblem,
    isRepairInputReady: isRepairInputReady,
    hasReplacementStage: hasReplacementStage,
    isReplacementDone: isReplacementDone,
    isReplacementPending: isReplacementPending,
    getEngine: getEngine
  };
}(window));
