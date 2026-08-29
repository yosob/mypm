# -*- coding: utf-8 -*-
import sys, io, json, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={"width": 1400, "height": 900})
    posts = []
    page.on("request", lambda r: posts.append((r.method, r.url[-40:], (r.post_data or "")[:80])) if "/api/" in r.url else None)
    page.on("response", lambda r: print("RESP", r.status, r.url[-40:]) if "/custom" in r.url else None)
    page.goto("http://127.0.0.1:8787")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    page.click("#tab-list")
    page.wait_for_timeout(400)
    row = page.locator("#task-table tbody tr", has_text="INPUT的MIRO完善").first
    row.click()
    page.wait_for_timeout(700)
    inp = page.locator("#cfs-box input[data-fid]").first
    inp.click()
    inp.fill("https://miro.app/boardX")
    for i in range(8):
        if page.evaluate('document.getElementById("detail").classList.contains("open")'):
            break
        page.wait_for_timeout(400)
    page.locator('button[onclick^="saveCustom"]').click()
    page.wait_for_timeout(2000)
    print("输入回显:", inp.input_value())
    # 立即用 API 核对
    d = json.loads(urllib.request.urlopen("http://127.0.0.1:8787/api/dashboard").read())
    t = next(x for pr in d["projects"] for x in pr["tasks"] if x["title"] == "INPUT的MIRO完善")
    print("API custom:", t.get("custom"))
    print("--- POSTs ---")
    for x in posts:
        print(x)
    b.close()
