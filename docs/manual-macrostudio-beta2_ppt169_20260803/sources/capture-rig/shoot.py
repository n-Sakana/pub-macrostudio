"""MacroStudio βv2.00 screenshot rig for the manual.

Serves C:\\repos\\pub\\macrostudio\\assets read-only, injects a WebView2 host
mock before page scripts, then drives the REAL UI by clicking real controls.
Every capture is a normal operating state reached through the actual flow;
nothing is faked and no state is written directly.

The product is not modified. The mock stops at the host boundary that
src/03_MessageRouter.cs defines, and it also SAVES the artifacts the app
hands the host during the run (diagnose-request.md, source-code.md,
source-code-for-ai.md, diagnosis.md, repair-request.md, the diff HTML,
result.md, run-manifest.json), so the manual can quote the product's own
output rather than a retyped copy.

    python shoot.py [<out_dir>]

Requires Python + Playwright (Chromium):

    pip install playwright && python -m playwright install chromium
"""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(r"C:\repos\pub\macrostudio")
ASSETS = REPO / "assets"
HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "out")
PORT = 8913
VIEWPORT = {"width": 1366, "height": 768}

FIXTURES = json.loads((HERE / "fixture.json").read_text(encoding="utf-8"))
WIN32_PRESET = "02_改修\\01_Win32 API を使わない形へ直す.md"
PATH_PRESET = "02_改修\\02_固定パスを新環境へ置き換える.md"

OUT.mkdir(parents=True, exist_ok=True)
results = []


# ------------------------------------------------------------------ server
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Quiet, directory=str(ASSETS))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# ------------------------------------------------------------------ driver
class App:
    def __init__(self, page):
        self.page = page

    def state(self):
        return self.page.evaluate(
            "() => { var s = window.MacroStudioState.getState();"
            " return {screen: s.screen, book: s.book && s.book.name,"
            "  busy: s.busyAction, presets: (s.presetFiles||[]).slice(),"
            "  engine: s.presetEngine, applied: !!s.appliedMapping,"
            "  diagRequestId: s.diagnosisRequestId,"
            "  repairRequestId: s.repairRequestId,"
            "  findings: s.diagnosis ?"
            "    s.diagnosis.findings.length : 0,"
            "  selected: (s.selectedFindings||[]).length,"
            "  extra: String(s.extraRequest||'').length,"
            "  runFolder: s.runFolder}; }")

    def title(self):
        return self.page.evaluate(
            "() => { var e = document.querySelector('.screen-title');"
            " return e ? e.textContent : ''; }")

    def settle(self, ms=420):
        self.page.wait_for_function(
            "() => window.MacroStudioState.getState().busyAction === null",
            timeout=20000)
        self.page.wait_for_timeout(ms)

    def actions(self):
        return self.page.evaluate(
            "() => Array.from(document.querySelectorAll('[data-action]'))"
            ".map(e => e.getAttribute('data-action')"
            "  + (e.disabled ? '(disabled)' : ''))")

    def click(self, selector, label=None, settle=True):
        loc = self.page.locator(selector).first
        try:
            loc.wait_for(state="visible", timeout=8000)
        except Exception:
            raise RuntimeError(
                "not found: %s (%s)\n  state=%s title=%r\n  actions=%s"
                % (label or selector, selector, self.state(), self.title(),
                   sorted(set(self.actions()))))
        if loc.is_disabled():
            raise RuntimeError(
                "disabled: %s\n  state=%s title=%r"
                % (label or selector, self.state(), self.title()))
        loc.click()
        if settle:
            self.settle()

    def next(self):
        before = self.state()["screen"]
        self.click('[data-action="go-next"]', "次へ")
        try:
            self.page.wait_for_function(
                "(prev) => window.MacroStudioState.getState().screen !== prev",
                arg=before, timeout=25000)
        except Exception:
            raise RuntimeError(
                "screen did not advance from %s (title=%r)"
                % (before, self.title()))
        self.settle()

    def back(self):
        self.click('[data-action="go-back"]', "戻る")

    def toggle(self, key):
        """A fold on a workflow screen (assets/js/screens/workflow.js)."""
        self.click('[data-action="toggle-workflow-disclosure"]'
                   '[data-disclosure-key="%s"]' % key, "開閉: " + key)
        self.page.wait_for_timeout(350)

    def toggle_app(self, key):
        """A fold owned by the shell (assets/js/app.js)."""
        self.click('[data-action="toggle-disclosure"]'
                   '[data-disclosure="%s"]' % key, "開閉: " + key)
        self.page.wait_for_timeout(350)

    def pick_preset(self, preset_file, label):
        # The cards are checkboxes and the app arrives at screen 3 with the
        # recommended one already ticked, so clicking is a toggle, not a
        # selection. Ticking what is already ticked would untick it.
        if preset_file in self.state()["presets"]:
            return
        index = self.page.evaluate(
            "(file) => Array.from(document.querySelectorAll("
            "'[data-action=\"select-repair-preset\"]'))"
            ".findIndex(e => e.getAttribute('data-preset-file') === file)",
            preset_file)
        if index < 0:
            raise RuntimeError(
                "preset card not found: %s (%s)\n  offered=%s"
                % (label, preset_file, self.page.evaluate(
                    "() => Array.from(document.querySelectorAll("
                    "'[data-action=\"select-repair-preset\"]'))"
                    ".map(e => e.getAttribute('data-preset-file'))")))
        # The card list re-renders after every tick, so the position is
        # resolved again immediately before the click and the result is
        # checked: ticking the wrong card would silently untick a chosen
        # one and the run would go down a different route.
        self.page.locator('[data-action="select-repair-preset"]').nth(
            index).click()
        self.settle()
        chosen = self.state()["presets"]
        if preset_file not in chosen:
            raise RuntimeError(
                "ticking %s did not select it\n  chosen=%s\n  offered=%s"
                % (label, chosen, self.page.evaluate(
                    "() => Array.from(document.querySelectorAll("
                    "'[data-action=\"select-repair-preset\"]'))"
                    ".map(e => e.getAttribute('data-preset-file'))")))

    def apply_replacement(self):
        """[次へ] on the table stage: stays on screen 4 and applies."""
        self.click('[data-action="go-next"]', "次へ（置き換える）")
        self.page.wait_for_function(
            "() => !!window.MacroStudioState.getState().appliedMapping",
            timeout=25000)
        self.settle()
        state = self.state()
        if state["screen"] != 4 or not state["applied"]:
            raise RuntimeError(
                "the replacement stage did not settle on screen 4: %s"
                % state)

    def path_row_index(self, group_key):
        return self.page.evaluate(
            "(key) => Array.from(document.querySelectorAll("
            "'input[data-workflow-input=\"path-map-to\"]'))"
            ".findIndex(e => e.getAttribute('data-group-key') === key)",
            group_key)

    def set_clipboard(self, text):
        self.page.evaluate("(t) => window.__msMock.setClipboard(t)", text)

    def captured(self):
        return self.page.evaluate("() => window.__msMock.captured()")

    def clear_toasts(self):
        self.page.evaluate(
            "() => { var t = document.getElementById('toast-region');"
            " if (t) { t.textContent = ''; } }")

    def shot(self, name, expect_screen=None):
        st = self.state()
        if expect_screen is not None and st["screen"] != expect_screen:
            results.append((name, "FAILED", "screen=%s expected=%s"
                            % (st["screen"], expect_screen)))
            return False
        title = self.title()
        self.clear_toasts()
        self.page.wait_for_timeout(150)
        bad = self.page.evaluate(
            "() => { var sel = '.toast, .inline-error-card,"
            " .headline-warning, [class*=failure]';"
            " var n = document.querySelectorAll(sel);"
            " return n.length ? n[0].textContent.trim().slice(0,120) : ''; }")
        self.page.screenshot(path=str(OUT / (name + ".png")))
        results.append((name, "ok", "s%-2s %-32s%s" % (
            st["screen"], title, "  ANOMALY: " + bad if bad else "")))
        return True


def make_page(ctx):
    page = ctx.new_page()
    page.goto("http://127.0.0.1:%d/index.html" % PORT)
    page.wait_for_selector(".screen", timeout=15000)
    app = App(page)
    app.settle()
    return page, app


def with_id(template, request_id):
    return template.replace("{{REQUEST_ID}}", request_id)


def save(name, text):
    if text:
        (OUT / name).write_text(text, encoding="utf-8", newline="\n")


# ------------------------------------------------------------------ the run
def both_route_pass(ctx):
    """The manual's end-to-end example: fixed paths AND Win32, one run."""
    page, app = make_page(ctx)

    # --- 手順1: ブックを読み込む ---------------------------------------
    app.shot("01-book-empty", expect_screen=0)
    app.click('[data-action="pick-book"]', "ファイルを選ぶ")
    app.shot("02-book-loaded", expect_screen=0)
    app.toggle("book-read-result")
    app.shot("03-book-modules", expect_screen=0)
    app.toggle("book-read-result")
    app.next()

    # --- 手順2: 診断する ------------------------------------------------
    app.shot("04-diagnose-request", expect_screen=1)
    app.toggle("diagnose-environment")
    app.shot("05-diagnose-environment", expect_screen=1)
    app.toggle("diagnose-environment")
    app.click('[data-action="copy-diagnosis-prompt"]', "依頼文をコピー")
    app.click('[data-action="open-diagnosis-folder"]', "ファイルの場所を開く")
    app.shot("06-diagnose-handed-over", expect_screen=1)

    request_id = app.state()["diagRequestId"]
    app.set_clipboard(with_id(FIXTURES["diagnosisPackage"], request_id))
    app.click('[data-action="import-diagnosis"]', "取り込む")
    app.shot("07-diagnose-imported", expect_screen=1)
    app.next()

    # --- 手順3: 診断結果を読む ------------------------------------------
    app.shot("08-findings", expect_screen=2)
    app.click('[data-action="toggle-finding"]', "指摘を開く")
    app.shot("09-findings-open", expect_screen=2)
    app.next()

    # --- 手順3: 次にすることを選ぶ（両方） ------------------------------
    app.shot("10-nextstep", expect_screen=3)
    # The cards are in the templates' own order (SPEC 5.1: the leading
    # number in presets\02_改修 decides it), so position is stable. A CSS
    # attribute selector is not usable here - the file names contain
    # backslashes.
    app.pick_preset(WIN32_PRESET, "Win32 のひな形")
    app.pick_preset(PATH_PRESET, "固定パスのひな形")
    app.shot("11-nextstep-both", expect_screen=3)
    app.next()

    # --- 手順3: 画面4 上段 = 対応表 -------------------------------------
    app.shot("12-repairinput-table", expect_screen=4)
    # Group keys are the literals themselves, so they carry backslashes and
    # cannot go into a CSS attribute selector. Resolve the position first.
    for source, target in FIXTURES["replacements"].items():
        index = app.path_row_index(source)
        if index < 0:
            results.append(("path-row:" + source, "FAILED",
                            "no replacement row for this literal"))
            continue
        page.locator('input[data-workflow-input="path-map-to"]').nth(
            index).fill(target)
        page.wait_for_timeout(140)
    app.settle()
    app.shot("13-repairinput-filled", expect_screen=4)

    # Applying the table does NOT leave screen 4: the both route holds both
    # stages on one screen (SPEC 2.3), so [次へ] here runs the replacement
    # and the same screen comes back asking what the chat should repair.
    # Waiting for the screen index to change would wait forever.
    app.apply_replacement()

    # --- 手順3: 同じ画面4 の下段 = AI へ頼む内容 -------------------------
    # The findings the target environment blocks arrive already ticked
    # (state.selectedFindings), which is what [次へ] needs (SPEC 2.4). The
    # screen asks the reader to confirm them, not to enter them.
    after = app.state()
    if not after["selected"]:
        raise RuntimeError(
            "no finding is ticked after the replacement, so [次へ] "
            "stays closed\n  state=%s" % after)
    app.shot("14-repairinput-ai", expect_screen=4)
    app.next()

    # --- 手順3: 改修の受け渡しと取り込み --------------------------------
    app.shot("15-repair-request", expect_screen=5)
    app.click('[data-action="copy-repair-prompt"]', "依頼文をコピー")
    app.click('[data-action="open-repair-folder"]', "ファイルの場所を開く")
    repair_id = app.state()["repairRequestId"]
    app.set_clipboard(with_id(FIXTURES["repairPackage"], repair_id))
    app.click('[data-action="import-repair"]', "取り込む")
    app.shot("16-repair-imported", expect_screen=5)
    app.next()

    # --- 手順3: 差分の確認 -----------------------------------------------
    app.shot("17-review", expect_screen=6)
    app.next()

    # --- 手順4: 出力名・ビルド・完了 -------------------------------------
    app.shot("18-output", expect_screen=7)
    name_field = page.locator('#output-name').first
    original = name_field.input_value()
    name_field.fill("CON.xlsm")
    page.wait_for_timeout(250)
    app.shot("19-output-reserved-name", expect_screen=7)
    name_field.fill(original)
    page.wait_for_timeout(250)
    app.settle()

    page.evaluate("() => window.__msMock.setBuildDelay(2600)")
    app.click('[data-action="go-next"]', "次へ", settle=False)
    page.wait_for_timeout(900)
    app.shot("20-build")
    page.wait_for_function(
        "() => window.MacroStudioState.getState().screen === 9",
        timeout=30000)
    app.settle()
    app.shot("21-done", expect_screen=9)
    app.toggle_app("remaining-work")
    app.shot("22-done-followup", expect_screen=9)

    # --- 完了画面から戻っても実行は完了したまま（SPEC 2.5.1） ------------
    app.back()
    app.shot("23-back-after-done")

    # --- the product's own artifacts ------------------------------------
    cap = app.captured()
    save("diagnose-request.md", cap.get("diagnoseRequest"))
    save("repair-request.md", cap.get("repairRequest"))
    save("source-code.md", cap.get("sourceCode"))
    save("source-code-for-ai.md", cap.get("aiCode"))
    save("diagnosis.md", cap.get("diagnosisMarkdown"))
    save("run-manifest.json", cap.get("runManifest"))
    build = cap.get("build") or {}
    save("diff-report.html", build.get("diffHtml"))
    save("result.md", build.get("resultMarkdown"))
    page.close()


def skip_diagnosis_pass(ctx):
    """The reader who already knows what to change (SPEC 2.2)."""
    page, app = make_page(ctx)
    app.click('[data-action="pick-book"]', "ファイルを選ぶ")
    app.next()
    page.locator("#diagnosis-skip").first.check(); app.settle()
    app.shot("30-diagnose-skip", expect_screen=1)
    page.close()


def run(pw):
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=2,
                              locale="ja-JP")
    ctx.add_init_script("window.__MS_FIXTURES__ = %s;"
                        % json.dumps(FIXTURES, ensure_ascii=False))
    ctx.add_init_script(path=str(HERE / "mock.js"))
    try:
        both_route_pass(ctx)
        skip_diagnosis_pass(ctx)
    finally:
        ctx.close()
        browser.close()


def report():
    width = max(len(name) for name, _, _ in results) if results else 10
    failed = 0
    for name, status, detail in results:
        if status != "ok":
            failed += 1
        sys.stdout.write("  %-*s %-7s %s\n" % (width, name, status, detail))
    sys.stdout.write("shoot: %d captured, %d failed -> %s\n"
                     % (len(results) - failed, failed, OUT))
    return failed


def main():
    httpd = serve()
    try:
        with sync_playwright() as pw:
            run(pw)
    finally:
        httpd.shutdown()
    sys.exit(1 if report() else 0)


if __name__ == "__main__":
    main()

