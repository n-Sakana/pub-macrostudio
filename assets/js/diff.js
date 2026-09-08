(function (global) {
  "use strict";

  var LOOKAHEAD = 100;

  function toLines(value) {
    var text = String(value === undefined || value === null ? "" : value);
    var lines;

    if (text.length === 0) {
      return [];
    }

    lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }

  function getGreedyDiff(leftLines, rightLines) {
    var left = leftLines || [];
    var right = rightLines || [];
    var leftCount = left.length;
    var rightCount = right.length;
    var result = [];
    var leftIndex = 0;
    var rightIndex = 0;
    var bestLeft;
    var bestRight;
    var bestDistance;
    var searchLeft;
    var searchRight;
    var candidateLeft;
    var candidateRight;
    var distance;
    var removedCount;
    var addedCount;
    var pairCount;
    var pairIndex;

    while (leftIndex < leftCount || rightIndex < rightCount) {
      if (leftIndex < leftCount &&
          rightIndex < rightCount &&
          left[leftIndex] === right[rightIndex]) {
        result.push({
          type: "equal",
          lineA: leftIndex,
          lineB: rightIndex,
          textA: left[leftIndex],
          textB: right[rightIndex]
        });
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      bestLeft = -1;
      bestRight = -1;
      bestDistance = (leftCount + rightCount) * 2;
      searchLeft = Math.min(leftIndex + LOOKAHEAD, leftCount);
      searchRight = Math.min(rightIndex + LOOKAHEAD, rightCount);

      for (candidateLeft = leftIndex;
          candidateLeft < searchLeft;
          candidateLeft += 1) {
        for (candidateRight = rightIndex;
            candidateRight < searchRight;
            candidateRight += 1) {
          if (left[candidateLeft] === right[candidateRight]) {
            distance =
              (candidateLeft - leftIndex) +
              (candidateRight - rightIndex);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestLeft = candidateLeft;
              bestRight = candidateRight;
            }
            break;
          }
        }
      }

      if (bestLeft === -1) {
        // A large insertion must not hide the identical tail simply
        // because its first line falls outside the local lookahead.
        var rightPositions = new Map();
        for (candidateRight = rightIndex;
            candidateRight < rightCount; candidateRight += 1) {
          if (!rightPositions.has(right[candidateRight])) {
            rightPositions.set(right[candidateRight], candidateRight);
          }
        }
        for (candidateLeft = leftIndex;
            candidateLeft < leftCount; candidateLeft += 1) {
          if (!rightPositions.has(left[candidateLeft])) {
            continue;
          }
          candidateRight = rightPositions.get(left[candidateLeft]);
          distance = candidateLeft - leftIndex + candidateRight - rightIndex;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestLeft = candidateLeft;
            bestRight = candidateRight;
          }
        }
        if (bestLeft === -1) {
          bestLeft = leftCount;
          bestRight = rightCount;
        }
      }

      removedCount = bestLeft - leftIndex;
      addedCount = bestRight - rightIndex;
      pairCount = Math.min(removedCount, addedCount);

      for (pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
        result.push({
          type: "changed",
          lineA: leftIndex,
          lineB: rightIndex,
          textA: left[leftIndex],
          textB: right[rightIndex]
        });
        leftIndex += 1;
        rightIndex += 1;
      }

      while (leftIndex < bestLeft) {
        result.push({
          type: "removed",
          lineA: leftIndex,
          lineB: -1,
          textA: left[leftIndex],
          textB: ""
        });
        leftIndex += 1;
      }

      while (rightIndex < bestRight) {
        result.push({
          type: "added",
          lineA: -1,
          lineB: rightIndex,
          textA: "",
          textB: right[rightIndex]
        });
        rightIndex += 1;
      }

      leftIndex = bestLeft;
      rightIndex = bestRight;
    }

    return result;
  }

  function compare(leftText, rightText) {
    return getGreedyDiff(toLines(leftText), toLines(rightText));
  }

  function countChangedLines(rows) {
    var count = 0;

    (rows || []).forEach(function (row) {
      if (row.type !== "equal") {
        count += 1;
      }
    });
    return count;
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error("MacroStudio diff self-test failed: " + message);
    }
  }

  function runSelfTest() {
    var rows;

    rows = getGreedyDiff(["A", "B"], ["A", "X", "B"]);
    assert(
      rows.map(function (row) { return row.type; }).join(",") ===
        "equal,added,equal",
      "insertion");

    rows = getGreedyDiff(["A", "X", "B"], ["A", "B"]);
    assert(
      rows.map(function (row) { return row.type; }).join(",") ===
        "equal,removed,equal",
      "deletion");

    rows = getGreedyDiff(["A", "old", "B"], ["A", "new", "B"]);
    assert(
      rows.map(function (row) { return row.type; }).join(",") ===
        "equal,changed,equal",
      "replacement");
    assert(countChangedLines(rows) === 1, "replacement count");

    rows = getGreedyDiff(["A", "B"], ["X", "Y", "Z"]);
    assert(
      rows.map(function (row) { return row.type; }).join(",") ===
        "changed,changed,added",
      "all changed");
    assert(countChangedLines(rows) === 3, "all changed count");

    return true;
  }

  global.MacroStudioDiff = {
    lookahead: LOOKAHEAD,
    toLines: toLines,
    getGreedyDiff: getGreedyDiff,
    compare: compare,
    countChangedLines: countChangedLines,
    runSelfTest: runSelfTest
  };

  if (global.location &&
      /(?:^\?|&)selftest=1(?:&|$)/.test(global.location.search || "")) {
    runSelfTest();
  }
}(window));
