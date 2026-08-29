# -*- coding: utf-8 -*-
"""修复：行内编辑被 60s 自动刷新冲掉 + 支持回车保存"""
import io

p = "src/web/public/index.html"
s = io.open(p, encoding="utf-8").read()

# 1) editResRow 进入编辑时置 editing（load 的侧栏刷新会被挡住）
old = '''let editingResKey=null;
async function editResRow(rid,ownerId,kind,el){
  const key=kind+":"+rid;
  if(editingResKey===key)return;
  editingResKey=key;'''
new = '''let editingResKey=null;
async function editResRow(rid,ownerId,kind,el){
  const key=kind+":"+rid;
  if(editingResKey===key)return;
  editingResKey=key;
  editing=true; // 阻止 60s 自动刷新重渲染侧栏/面板'''
assert old in s; s = s.replace(old, new)

# 2) 编辑行输入框支持回车保存/取消
old = '''    <input id="er-label" value="${(r.label||"").replace(/"/g,"&quot;")}" placeholder="说明" style="flex:0 0 80px">
    <input id="er-value" value="${r.value.replace(/"/g,"&quot;")}" style="flex:1">'''
new = '''    <input id="er-label" value="${(r.label||"").replace(/"/g,"&quot;")}" placeholder="说明" style="flex:0 0 80px"
      onkeydown="if(event.key==='Enter')saveResRow(${rid},${ownerId},'${kind}')">
    <input id="er-value" value="${r.value.replace(/"/g,"&quot;")}" style="flex:1"
      onkeydown="if(event.key==='Enter')saveResRow(${rid},${ownerId},'${kind}');if(event.key==='Escape')cancelResRow(${rid},${ownerId},'${kind}')">'''
assert old in s; s = s.replace(old, new)

# 3) save/cancel 复位 editing
old = '''  editingResKey=null;
  await load();
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId&&!editing)fillDetail(curTaskId);}else fillDetail(ownerId);
}
function cancelResRow(rid,ownerId,kind){
  editingResKey=null;
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId&&!editing)fillDetail(curTaskId);}else fillDetail(ownerId);
}'''
new = '''  editingResKey=null;editing=false;
  await load();
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId)fillDetail(curTaskId);}else fillDetail(ownerId);
}
function cancelResRow(rid,ownerId,kind){
  editingResKey=null;editing=false;
  if(kind==="proj"){refreshProjRes(ownerId);if(curTaskId)fillDetail(curTaskId);}else fillDetail(ownerId);
}'''
assert old in s; s = s.replace(old, new)

# 4) 任务/项目资料「添加行」同理：有输入焦点时 load 不重渲染（用 editing 标志不合适，
#    改为 load 时若 detail 打开且 editingResKey 存在则跳过 fillDetail；res-panel 由 refreshProjRes 管）
old = '''  renderStats();render();showRes(document.getElementById("proj-filter").value);
  if(curTaskId&&!editing)fillDetail(curTaskId);'''
new = '''  renderStats();render();
  if(!editingResKey&&!editing)showRes(document.getElementById("proj-filter").value);
  if(curTaskId&&!editing&&!editingResKey)fillDetail(curTaskId);'''
assert old in s; s = s.replace(old, new)

io.open(p, "w", encoding="utf-8").write(s)
print("edit-keep fix ok")
