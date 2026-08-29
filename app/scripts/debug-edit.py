# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", e))
    page.on("response", lambda r: print("RESP", r.status, r.url) if r.status >= 400 else None)
    page.on("request", lambda r: print("REQ", r.method, r.url, (r.post_data or "")[:120]) if "/api/" in r.url else None)
    page.goto("http://127.0.0.1:8787")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1000)

    page.click("#btn-add")
    page.fill("#m-title", "调试任务XYZ")
    page.click("#m-save")
    page.wait_for_timeout(1500)

    row = page.locator("#task-table tbody tr", has_text="调试任务XYZ").first
    row.click()
    page.wait_for_timeout(500)
    print("buttons:", page.locator("#detail-body button").all_inner_texts())
    page.locator("#detail-body button", has_text="编辑").first.click()
    page.wait_for_timeout(500)
    print("e-title count:", page.locator("#e-title").count())
    page.fill("#e-title", "调试任务XYZ-改")
    page.fill("#e-due", "2026-09-12")
    page.locator("#detail-body button", has_text="保存").first.click()
    page.wait_for_timeout(1500)
    found = page.locator("#task-table tbody tr", has_text="调试任务XYZ-改").count()
    print("改后行数:", found, "PASS" if found == 1 else "FAIL")
    browser.close()
