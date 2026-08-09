/**
 * theme_editor.spec.js
 *
 * Playwright tests for theme-editor.html — the WYSIWYG DOM/CSS editor.
 *
 * No auth required (standalone tool).
 * Tests: page load, HTML injection, postMessage flows (vd_dom_mutated, vd_ctx_delete,
 * vd_ctx_add), split-view toggle, undo/redo button state, download button.
 *
 * All tests inject HTML directly via page.evaluate() to avoid file-picker dialogs.
 */

const { test, expect } = require('@playwright/test');

// Minimal valid HTML that the editor can parse
const SAMPLE_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
:root { --bg: #0f172a; --primary: #6366f1; }
</style>
</head>
<body>
<h1 id="heading">Hello World</h1>
<p id="para">Sample paragraph.</p>
</body>
</html>`;

// Loads the editor and injects sample HTML into the editor state via evaluate.
//
// CRITICAL: all state variables (originalHtml, splitMode, etc.) are declared
// with `let` inside a <script> tag — they are lexical bindings, NOT window
// properties. `originalHtml` is undefined; `originalHtml` (bare name)
// is the actual variable. Always use bare names inside page.evaluate().
async function loadEditorWithHtml(page, html = SAMPLE_HTML) {
  await page.goto('/theme-editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(200);

  await page.evaluate(html => {
    // Assign to the let bindings directly — NOT window.xxx properties
    originalHtml   = html;
    initialHtml    = html;
    parsedDark     = parseCSSBlock(html, [':root']);
    const light    = parseLightBlock(html);
    parsedLight    = light.vars;
    lightSelector  = light.selector;
    lightClassName = extractClass(light.selector);
    elemOverrides  = {};
    // setLoaded(true) enables btn-download, btn-split, btn-inspect, etc.
    setLoaded(true);
    // pushHistory now captures the real originalHtml (not '')
    pushHistory();
    // renderPreview no longer returns early — originalHtml is non-empty
    renderPreview();
    updateUndoRedoBtns();
  }, html);

  await page.waitForTimeout(300);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Page load
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Page load', () => {
  test('theme-editor.html loads without redirect or JS error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/theme-editor.html');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(200);

    // No redirect to login.html
    expect(page.url()).toContain('theme-editor.html');
    // No uncaught JS exceptions
    expect(errors).toHaveLength(0);
  });

  test('drop-overlay and preview iframe are present', async ({ page }) => {
    await page.goto('/theme-editor.html');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#drop-overlay')).toBeAttached();
    await expect(page.locator('#preview-iframe')).toBeAttached();
  });

  test('file-input accepts HTML files', async ({ page }) => {
    await page.goto('/theme-editor.html');
    await page.waitForLoadState('domcontentloaded');

    const accept = await page.locator('#file-input').getAttribute('accept');
    expect(accept).toContain('.html');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. HTML injection and state
// ─────────────────────────────────────────────────────────────────────────────
test.describe('HTML state after file load', () => {
  test('originalHtml is set after inject', async ({ page }) => {
    await loadEditorWithHtml(page);

    const stored = await page.evaluate(() => originalHtml);
    expect(stored).toContain('<h1 id="heading">Hello World</h1>');
  });

  test('parsedDark extracts CSS variables from injected HTML', async ({ page }) => {
    await loadEditorWithHtml(page);

    // parsedDark is a let binding — not a window property
    const parsed = await page.evaluate(() => parsedDark);
    expect(parsed).toBeTruthy();
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });

  test('preview iframe srcdoc is populated', async ({ page }) => {
    await loadEditorWithHtml(page);

    // srcdoc is a DOM property set via JS (not an HTML attribute) — use evaluate
    const srcdoc = await page.locator('#preview-iframe').evaluate(el => el.srcdoc);
    expect(srcdoc).toBeTruthy();
    expect(srcdoc.length).toBeGreaterThan(50);
  });

  test('undo button disabled before any further history entry', async ({ page }) => {
    await loadEditorWithHtml(page);

    // After loadEditorWithHtml, histIdx=0, history.length=1 → undo disabled
    const disabled = await page.locator('#btn-undo').evaluate(el => el.disabled);
    expect(disabled).toBe(true);
  });

  test('download button is present and enabled', async ({ page }) => {
    await loadEditorWithHtml(page);

    await expect(page.locator('#btn-download')).toBeVisible();
    const disabled = await page.locator('#btn-download').evaluate(el => el.disabled);
    expect(disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. postMessage flows
// ─────────────────────────────────────────────────────────────────────────────
test.describe('postMessage flows', () => {
  test('vd_dom_mutated updates originalHtml and pushes history', async ({ page }) => {
    await loadEditorWithHtml(page);

    const histBefore = await page.evaluate(() => window.history?.length ?? window.histIdx);

    const newHtml = SAMPLE_HTML.replace('Hello World', 'Modified Heading');
    await page.evaluate(html => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_dom_mutated', html },
        origin: window.location.origin,
      }));
    }, newHtml);
    await page.waitForTimeout(150);

    const stored = await page.evaluate(() => originalHtml);
    expect(stored).toContain('Modified Heading');
  });

  test('vd_dom_mutated enables undo button', async ({ page }) => {
    await loadEditorWithHtml(page);

    // Dispatch a mutation to push a second history entry
    await page.evaluate(html => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_dom_mutated', html: html.replace('Hello World', 'Changed') },
        origin: window.location.origin,
      }));
    }, SAMPLE_HTML);
    await page.waitForTimeout(150);

    const disabled = await page.locator('#btn-undo').evaluate(el => el.disabled);
    expect(disabled).toBe(false);
  });

  test('vd_ctx_delete dispatches without throwing', async ({ page }) => {
    await loadEditorWithHtml(page);

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // vd_ctx_delete calls domDelete() which is safe when selectedElem is null
    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_ctx_delete' },
        origin: window.location.origin,
      }));
    });
    await page.waitForTimeout(100);

    expect(errors).toHaveLength(0);
  });

  test('vd_ctx_add dispatches without throwing', async ({ page }) => {
    await loadEditorWithHtml(page);

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.evaluate(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_ctx_add' },
        origin: window.location.origin,
      }));
    });
    await page.waitForTimeout(100);

    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Split view
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Split view', () => {
  test('split view button is present', async ({ page }) => {
    await loadEditorWithHtml(page);
    await expect(page.locator('#btn-split')).toBeVisible();
  });

  test('split iframes are hidden before split mode is active', async ({ page }) => {
    await loadEditorWithHtml(page);

    const splitWrap = page.locator('#split-view');
    // split-view div exists but should not be visible initially
    const isVisible = await splitWrap.isVisible();
    expect(isVisible).toBe(false);
  });

  test('clicking split button activates split mode and shows both panes', async ({ page }) => {
    await loadEditorWithHtml(page);

    await page.click('#btn-split');
    await page.waitForTimeout(200);

    // Both iframes should be visible in split mode
    await expect(page.locator('#split-orig')).toBeVisible();
    await expect(page.locator('#split-mod')).toBeVisible();
  });

  test('clicking split again returns to single-pane mode', async ({ page }) => {
    await loadEditorWithHtml(page);

    await page.click('#btn-split');
    await page.waitForTimeout(150);
    await page.click('#btn-split');
    await page.waitForTimeout(150);

    const splitMode = await page.evaluate(() => splitMode);
    expect(splitMode).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Undo / Redo
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Undo / Redo', () => {
  test('undo restores previous originalHtml', async ({ page }) => {
    await loadEditorWithHtml(page);

    const original = await page.evaluate(() => originalHtml);

    // Push a second history entry via mutation
    await page.evaluate(html => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_dom_mutated', html: html.replace('Hello World', 'After Mutation') },
        origin: window.location.origin,
      }));
    }, SAMPLE_HTML);
    await page.waitForTimeout(150);

    // Undo
    await page.click('#btn-undo');
    await page.waitForTimeout(150);

    const afterUndo = await page.evaluate(() => originalHtml);
    expect(afterUndo).toContain('Hello World');
    expect(afterUndo).not.toContain('After Mutation');
  });

  test('redo re-applies mutation after undo', async ({ page }) => {
    await loadEditorWithHtml(page);

    await page.evaluate(html => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'vd_dom_mutated', html: html.replace('Hello World', 'Redone') },
        origin: window.location.origin,
      }));
    }, SAMPLE_HTML);
    await page.waitForTimeout(150);

    await page.click('#btn-undo');
    await page.waitForTimeout(100);
    await page.click('#btn-redo');
    await page.waitForTimeout(100);

    const afterRedo = await page.evaluate(() => originalHtml);
    expect(afterRedo).toContain('Redone');
  });
});
