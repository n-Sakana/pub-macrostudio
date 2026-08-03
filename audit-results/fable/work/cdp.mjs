// Minimal CDP driver for auditing the real MacroStudio WebView2 GUI.
// Uses node >=22 built-in WebSocket. Each invocation opens a fresh
// connection, performs one command, prints JSON result, exits.
//
// Usage:
//   node cdp.mjs targets
//   node cdp.mjs shot <outfile.png>
//   node cdp.mjs eval "<expression>"
//   node cdp.mjs click "<css selector>" [nth]
//   node cdp.mjs clicktext "<substring>" [tag] [nth]
//   node cdp.mjs focus "<css selector>" [nth]
//   node cdp.mjs type "<text>"            (insertText into focused element)
//   node cdp.mjs key <Enter|Tab|Escape|ArrowDown|...>
//   node cdp.mjs text "<css selector>"    (innerText of first match)
//   node cdp.mjs html "<css selector>"    (outerHTML of first match)
//   node cdp.mjs list "<css selector>"    (tag/text/visible for all matches)
import fs from "node:fs";

const PORT = process.env.MS_CDP_PORT || "9333";

async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await res.json();
  const page = targets.find(
    (t) => t.type === "page" && (t.url || "").includes("macrostudio.local"));
  if (!page) throw new Error("no macrostudio page target: " +
    JSON.stringify(targets.map((t) => [t.type, t.url])));
  return page;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error("ws error"));
  });
}

let seq = 0;
const pending = new Map();
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function installRouter(ws) {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  };
}

async function evalJs(ws, expression, opts = {}) {
  const r = await send(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    ...opts,
  });
  if (r.exceptionDetails) {
    throw new Error("eval exception: " +
      JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  }
  return r.result.value;
}

// Returns viewport centre of the nth element matching selector, after
// scrolling it into view. Fails if not found or not visible.
async function locate(ws, selector, nth = 0) {
  const expr = `(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = els[${nth}];
    if (!el) return { error: "not found (" + els.length + " matches)" };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { error: "zero size" };
    return { x: r.x + r.width / 2, y: r.y + r.height / 2,
             w: r.width, h: r.height, tag: el.tagName,
             text: (el.innerText || el.value || "").slice(0, 80) };
  })()`;
  const loc = await evalJs(ws, expr);
  if (loc.error) throw new Error(`locate ${selector}[${nth}]: ${loc.error}`);
  return loc;
}

async function mouseClick(ws, x, y) {
  const base = { x, y, button: "left", clickCount: 1, pointerType: "mouse" };
  await send(ws, "Input.dispatchMouseEvent", { type: "mouseMoved", ...base, button: "none" });
  await send(ws, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
  await send(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
}

const KEYDEFS = {
  Enter: { keyCode: 13, key: "Enter", code: "Enter", text: "\r" },
  Tab: { keyCode: 9, key: "Tab", code: "Tab" },
  Escape: { keyCode: 27, key: "Escape", code: "Escape" },
  Backspace: { keyCode: 8, key: "Backspace", code: "Backspace" },
  ArrowDown: { keyCode: 40, key: "ArrowDown", code: "ArrowDown" },
  ArrowUp: { keyCode: 38, key: "ArrowUp", code: "ArrowUp" },
  Space: { keyCode: 32, key: " ", code: "Space", text: " " },
};

async function pressKey(ws, name) {
  const def = KEYDEFS[name];
  if (!def) throw new Error("unknown key " + name);
  await send(ws, "Input.dispatchKeyEvent", {
    type: "rawKeyDown", windowsVirtualKeyCode: def.keyCode,
    key: def.key, code: def.code });
  if (def.text) {
    await send(ws, "Input.dispatchKeyEvent", {
      type: "char", text: def.text, key: def.key });
  }
  await send(ws, "Input.dispatchKeyEvent", {
    type: "keyUp", windowsVirtualKeyCode: def.keyCode,
    key: def.key, code: def.code });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const page = await getPageTarget();
  if (cmd === "targets") {
    console.log(JSON.stringify(page, null, 2));
    return;
  }
  const ws = await connect(page.webSocketDebuggerUrl);
  installRouter(ws);
  try {
    if (cmd === "shot") {
      const out = args[0];
      const r = await send(ws, "Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(out, Buffer.from(r.data, "base64"));
      console.log(JSON.stringify({ saved: out }));
    } else if (cmd === "eval") {
      const v = await evalJs(ws, args[0]);
      console.log(JSON.stringify(v));
    } else if (cmd === "click") {
      const loc = await locate(ws, args[0], Number(args[1] || 0));
      await new Promise((r) => setTimeout(r, 60));
      await mouseClick(ws, loc.x, loc.y);
      console.log(JSON.stringify({ clicked: loc }));
    } else if (cmd === "clicktext") {
      const [needle, tag = "button, [role=button], a, label, summary", nth = "0"] = args;
      const expr = `(() => {
        const all = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
        const hits = all.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 &&
            (el.innerText || "").includes(${JSON.stringify(needle)});
        });
        const el = hits[${Number(nth)}];
        if (!el) return { error: "not found (" + hits.length + " visible hits)" };
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2,
                 tag: el.tagName, text: (el.innerText || "").slice(0, 80) };
      })()`;
      const loc = await evalJs(ws, expr);
      if (loc.error) throw new Error(`clicktext ${needle}: ${loc.error}`);
      await new Promise((r) => setTimeout(r, 60));
      await mouseClick(ws, loc.x, loc.y);
      console.log(JSON.stringify({ clicked: loc }));
    } else if (cmd === "focus") {
      const loc = await locate(ws, args[0], Number(args[1] || 0));
      await mouseClick(ws, loc.x, loc.y);
      console.log(JSON.stringify({ focused: loc }));
    } else if (cmd === "type") {
      await send(ws, "Input.insertText", { text: args[0] });
      console.log(JSON.stringify({ typed: args[0].length }));
    } else if (cmd === "key") {
      await pressKey(ws, args[0]);
      console.log(JSON.stringify({ key: args[0] }));
    } else if (cmd === "text") {
      const v = await evalJs(ws, `(() => {
        const el = document.querySelector(${JSON.stringify(args[0])});
        return el ? el.innerText : null; })()`);
      console.log(JSON.stringify(v));
    } else if (cmd === "html") {
      const v = await evalJs(ws, `(() => {
        const el = document.querySelector(${JSON.stringify(args[0])});
        return el ? el.outerHTML : null; })()`);
      console.log(JSON.stringify(v));
    } else if (cmd === "list") {
      const v = await evalJs(ws, `Array.from(
        document.querySelectorAll(${JSON.stringify(args[0])})).map((el) => {
          const r = el.getBoundingClientRect();
          return { tag: el.tagName, cls: el.className,
                   visible: r.width > 0 && r.height > 0,
                   disabled: el.disabled === true,
                   text: (el.innerText || el.value || "").slice(0, 120) };
        })`);
      console.log(JSON.stringify(v, null, 1));
    } else {
      throw new Error("unknown command " + cmd);
    }
  } finally {
    ws.close();
  }
}

main().catch((e) => { console.error("ERROR: " + e.message); process.exit(1); });
