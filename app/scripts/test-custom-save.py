# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1400, "height": 900})
    page.goto("http://127.0.0.1:8787")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    page.click("#tab-list")
    page.wait_for_timeout(400)
    page.locator("#task-table tbody tr").first.click()
    page.wait_for_timeout(700)
    t1 = page.locator(".dt-head h2").inner_text()
    v1 = page.locator("#cfs-box input[data-fid]").first.input_value()
    page.locator("#detail .close").click()
    page.wait_for_timeout(300)
    page.locator("#task-table tbody tr", has_text=t1).first.click()
    page.wait_for_timeout(700)
    t2 = page.locator(".dt-head h2").inner_text()
    v2 = page.locator("#cfs-box input[data-fid]").first.input_value()
    print("任务一致:", t1 == t2, "|", t1)
    print("值:", repr(v1), "->", repr(v2))
    print("持久:", v1 == v2 and v1 != "")
    b.close()
