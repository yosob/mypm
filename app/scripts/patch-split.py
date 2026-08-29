# -*- coding: utf-8 -*-
"""三页签拆分（甘特/任务列表/看板）+ 侧栏所属项目资料可编辑"""
import io

p = "src/web/public/index.html"
s = io.open(p, encoding="utf-8").read()

# ---------- 1) 页签 ----------
old = '''    <button id="tab-overview" class="active">总览</button>
    <button id="tab-kanban">看板</button>'''
new = '''    <button id="tab-overview" class="active">📈 甘特图</button>
    <button id="tab-list">📋 任务列表</button>
    <button id="tab-kanban">🗂 看板</button>'''
assert old in s; s = s.replace(old, new)

# ---------- 2) 视图拆分 ----------
old = '''<div id="view-overview">
  <div class="layout">
    <div class="gantt-wrap"><div id="gantt"></div></div>
    <div class="side">
      <table id="task-table"><thead><tr><th></th><th>任务</th><th>状态</th><th>截止</th></tr></thead><tbody></tbody></table>
      <div class="res-panel" id="res-panel" style="display:none"><h3 id="res-title"></h3><div id="res-body"></div></div>
    </div>
  </div>
</div>'''
new = '''<div id="view-overview">
  <div class="gantt-wrap"><div id="gantt"></div></div>
</div>

<div id="view-list" style="display:none">
  <div class="layout">
    <div style="flex:1;min-width:0">
      <table id="task-table"><thead><tr><th style="width:34px"></th><th>任务</th><th>项目</th><th>状态</th><th>优先级</th><th>开始</th><th>截止</th></tr></thead><tbody></tbody></table>
    </div>
    <div class="side" style="width:340px;flex-shrink:0">
      <div class="res-panel" id="res-panel" style="display:none"><h3 id="res-title"></h3><div id="res-body"></div></div>
    </div>
  </div>
</div>'''
assert old in s; s = s.replace(old, new)

# ---------- 3) 页签逻辑 ----------
old = '''  document.getElementById("tab-overview").onclick=()=>switchTab("overview");
  document.getElementById("tab-kanban").onclick=()=>switchTab("kanban");'''
new = '''  document.getElementById("tab-overview").onclick=()=>switchTab("overview");
  document.getElementById("tab-list").onclick=()=>switchTab("list");
  document.getElementById("tab-kanban").onclick=()=>switchTab("kanban");'''
assert old in s; s = s.replace(old, new)

old = '''function switchTab(t){
  curTab=t;
  document.getElementById("tab-overview").classList.toggle("active",t==="overview");
  document.getElementById("tab-kanban").classList.toggle("active",t==="kanban");
  document.getElementById("view-overview").style.display=t==="overview"?"":"none";
  document.getElementById("view-kanban").style.display=t==="kanban"?"":"none";
}'''
new = '''function switchTab(t){
  curTab=t;
  document.getElementById("tab-overview").classList.toggle("active",t==="overview");
  document.getElementById("tab-list").classList.toggle("active",t==="list");
  document.getElementById("tab-kanban").classList.toggle("active",t==="kanban");
  document.getElementById("view-overview").style.display=t==="overview"?"":"none";
  document.getElementById("view-list").style.display=t==="list"?"":"none";
  document.getElementById("view-kanban").style.display=t==="kanban"?"":"none";
  showRes(document.getElementById("proj-filter").value);
}'''
assert old in s; s = s.replace(old, new)

# ---------- 4) 任务表新列 ----------
old = '''  ts.forEach(t=>{
    const tr=document.createElement("tr");
    if(t.done)tr.className="done";
    const di=dueInfo(t), p=findProj(t.project_id);
    tr.innerHTML=`<td><input type="checkbox" ${t.done?"checked":""} data-id="${t.id}"></td>
      <td><span class="pflag" style="background:${projColor(t.project_id)}">${p?p.name:""}</span>${t.is_milestone?"◆ ":""}${t.title}</td>
      <td><span class="badge ${statusOf(t)}">${STATUS_TXT[statusOf(t)]}</span></td>
      <td>${t.due_date?`<span class="due-cell ${di.cls}">${di.txt}</span>`:""}</td>`;'''
new = '''  ts.forEach(t=>{
    const tr=document.createElement("tr");
    if(t.done)tr.className="done";
    const di=dueInfo(t), p=findProj(t.project_id);
    tr.innerHTML=`<td><input type="checkbox" ${t.done?"checked":""} data-id="${t.id}"></td>
      <td>${t.is_milestone?"◆ ":""}${t.title}</td>
      <td><span class="pflag" style="background:${projColor(t.project_id)}">${p?p.name:""}</span></td>
      <td><span class="badge ${statusOf(t)}">${STATUS_TXT[statusOf(t)]}</span></td>
      <td>${t.priority&&t.priority!=="P3"?`<b style="color:${t.priority==="P0"?"var(--danger)":t.priority==="P1"?"#d35400":"#7f8c8d"}">${t.priority}</b>`:"-"}</td>
      <td style="color:#8a95a1">${t.start_date||"-"}</td>
      <td>${t.due_date?`<span class="due-cell ${di.cls}">${di.txt}</span>`:"-"}</td>`;'''
assert old in s; s = s.replace(old, new)

# ---------- 5) 侧栏「所属项目」资料可编辑 ----------
old = '''    if(p.resources.length)rel+=p.resources.map(r=>
      `<div class="res-item">${r.type==="wechat_group"?"💬":r.type==="link"?"🔗":"📄"} ${r.label?r.label+" ":""}${r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value}</div>`).join("");'''
new = '''    if(p.resources.length)rel+=p.resources.map(r=>
      `<div class="res-item">${r.type==="wechat_group"?"💬":r.type==="link"?"🔗":"📄"} ${r.label?r.label+" ":""}${r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value}
        <span style="cursor:pointer;color:#7f8c8d" onclick="editResRow(${r.id},${p.id},'proj',this)">✎</span>
        <span style="cursor:pointer;color:#b0b6bc" onclick="delProjRes(${r.id},${p.id})">×</span></div>`).join("");'''
assert old in s; s = s.replace(old, new)

# ---------- 6) 项目资料保存/取消后：若侧栏开着也刷新 ----------
old = '''  editingResKey=null;
  await load();
  if(kind==="proj")refreshProjRes(ownerId);else fillDetail(ownerId);
}
function cancelResRow(rid,ownerId,kind){
  editingResKey=null;
  if(kind==="proj")refreshProjRes(ownerId);else fillDetail(ownerId);
}'''
new = '''  editingResKey=null;
  await load();
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId&&!editing)fillDetail(curTaskId);}else fillDetail(ownerId);
}
function cancelResRow(rid,ownerId,kind){
  editingResKey=null;
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId&&!editing)fillDetail(curTaskId);}else fillDetail(ownerId);
}'''
assert old in s; s = s.replace(old, new)

io.open(p, "w", encoding="utf-8").write(s)
print("split & sidebar-edit ok")
