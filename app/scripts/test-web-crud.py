# -*- coding: utf-8 -*-
# 看板 CRUD 交互验收：新建任务 → 详情编辑 → 删除
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", e))
    page.on("console", lambda m: print("CONSOLE-ERR:", m.text) if m.type == "error" else None)
    page.goto("http://127.0.0.1:8787")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)

    # 1. 新建
    before = page.locator("#task-table tbody tr").count()
    page.click("#btn-add")
    page.fill("#m-title", "自动化测试任务")
    page.select_option("#m-status", "doing")
    page.fill("#m-due", "2026-09-10")
    page.click("#m-save")
    page.wait_for_timeout(1500)
    after_create = page.locator("#task-table tbody tr").count()
    print(f"新建: {before} -> {after_create} 行（应为 +1）:", "PASS" if after_create == before + 1 else "FAIL")

    # 2. 详情 + 编辑
    row = page.locator("#task-table tbody tr", has_text="自动化测试任务").first
    row.click()
    page.wait_for_timeout(500)
    assert page.locator("#detail").evaluate("el=>el.classList.contains('open')"), "详情侧栏未打开"
    print("详情侧栏打开: PASS")
    page.locator("#detail-body button", has_text="编辑").first.click()
    page.wait_for_timeout(400)
    page.fill("#e-title", "自动化测试任务-改")
    page.fill("#e-due", "2026-09-12")
    page.locator("#detail-body button", has_text="保存").first.click()
    page.wait_for_timeout(1500)
    ok = page.locator("#task-table tbody tr", has_text="自动化测试任务-改").count() == 1
    print("编辑标题/日期:", "PASS" if ok else "FAIL")

    # 3. 看板拖拽（通过接口等效验证已做过；此处验证看板列渲染）
    page.click("#tab-kanban")
    page.wait_for_timeout(500)
    doing_cnt = page.locator(".kcol[data-status=doing] .kcard").count()
    print(f"看板 doing 列卡片数: {doing_cnt}（应含新任务）:", "PASS" if doing_cnt >= 1 else "FAIL")

    # 4. 删除
    page.locator("#detail .close").click()
    page.click("#tab-overview")
    page.wait_for_timeout(600)
    row = page.locator("#task-table tbody tr", has_text="自动化测试任务-改").first
    row.wait_for(state="visible", timeout=5000)
    row.click()
    page.wait_for_timeout(600)
    page.on("dialog", lambda d: d.accept())
    page.locator("#detail-body button", has_text="删除").first.click()
    page.wait_for_timeout(1500)
    gone = page.locator("#task-table tbody tr", has_text="自动化测试任务").count() == 0
    print("删除:", "PASS" if gone else "FAIL")

    page.screenshot(path="logs/web-crud.png", full_page=True)
    print("截图: logs/web-crud.png")
    browser.close()
