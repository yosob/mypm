from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    page.goto("http://127.0.0.1:8787")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.screenshot(path="logs/web-debug.png", full_page=True)
    # 检查关键元素状态
    checks = {
        "gantt svg": page.locator("#gantt svg").count(),
        "gantt empty 提示": page.locator("#gantt .empty").count(),
        "任务行数": page.locator("#task-table tbody tr").count(),
        "状态条分段": page.locator("#statbar div").count(),
        "看板卡片": page.locator(".kcard").count(),
        "n-projects 文本": page.locator("#n-projects").inner_text(),
    }
    for k, v in checks.items():
        print(f"{k}: {v}")
    print("--- console errors ---")
    for e in errors[:20]:
        print(e)
    if not errors:
        print("(无)")
    browser.close()
