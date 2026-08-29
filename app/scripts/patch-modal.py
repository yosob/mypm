# -*- coding: utf-8 -*-
"""把项目资料管理整合进项目编辑弹窗（一次性别打补丁）"""
import io

p = "src/web/public/index.html"
s = io.open(p, encoding="utf-8").read()
orig = s

# 1) 项目弹窗加「项目资料」区块
old = '''      <div class="mops"><button onclick="closeProjModal()">取消</button><button class="primary" id="p-save">保存</button></div>
      <button id="p-del" class="dangerbtn" style="display:none">🗑 删除整个项目（含任务/资料/历史）</button>'''
new = '''      <div class="mops"><button onclick="closeProjModal()">取消</button><button class="primary" id="p-save">保存</button></div>
      <div id="modal-res-wrap" style="display:none">
        <h5 style="font-size:12px;color:#7f8c8d;margin:16px 0 6px">项目资料（微信群 / 链接 / 备注）</h5>
        <div id="modal-res-list"></div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <select id="mr-type" style="flex:0 0 92px"><option value="wechat_group">微信群</option><option value="link">链接</option><option value="note">备注</option></select>
          <input id="mr-label" placeholder="说明(可选)" style="flex:0 0 90px">
          <input id="mr-value" placeholder="群名或链接" style="flex:1">
          <button onclick="addProjResUI(editingProjId,'modal')" style="flex:0 0 46px">＋</button>
        </div>
      </div>
      <button id="p-del" class="dangerbtn" style="display:none">🗑 删除整个项目（含任务/资料/历史）</button>'''
assert old in s, "anchor1"
s = s.replace(old, new)

# 2) showRes 重构 + 共享渲染 + refreshProjRes
old = '''  document.getElementById("res-body").innerHTML=html;
}'''
# showRes 尾部：找到函数完整尾部（含 add-row 注入部分）
old_showres_tail = '''  let html="";
  if(!p.resources.length)html+=`<div class="res-item" style="color:#b0b6bc">（暂无资料，用下方添加）</div>`;
  p.resources.forEach(r=>{
    html+=`<div class="res-item" id="pres-${r.id}">${r.type==="wechat_group"?"💬 微信群":r.type==="link"?"🔗":"📄"} ${r.label?r.label+" ":""}${r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value}
      <span style="cursor:pointer;color:#7f8c8d" onclick="editResRow(${r.id},${p.id},'proj')">✎</span>
      <span style="cursor:pointer;color:#b0b6bc" onclick="delProjRes(${r.id},${p.id})">×</span></div>`;
  });
  html+=`<div class="tres-add" style="display:flex;gap:6px;margin-top:8px">
    <select id="pr-type" style="flex:0 0 92px"><option value="wechat_group">微信群</option><option value="link">链接</option><option value="note">备注</option></select>
    <input id="pr-label" placeholder="说明(可选)" style="flex:0 0 90px">
    <input id="pr-value" placeholder="群名或链接" style="flex:1">
    <button onclick="addProjResUI(${p.id})" style="flex:0 0 46px">＋</button>
  </div>`;
  if(p.history.length)html+=`<div class="hist">${p.history.map(h=>`· ${h.date} ${h.summary}`).join("<br>")}</div>`;
  document.getElementById("res-body").innerHTML=html;
}'''
new_showres_tail = '''  document.getElementById("res-body").innerHTML=projResHTML(p)+projResAddRow(p.id,"panel")+
    (p.history.length?`<div class="hist">${p.history.map(h=>`· ${h.date} ${h.summary}`).join("<br>")}</div>`:"");
}
function projResHTML(p){
  if(!p.resources.length)return `<div class="res-item" style="color:#b0b6bc">（暂无资料，用下方添加）</div>`;
  return p.resources.map(r=>`<div class="res-item">${r.type==="wechat_group"?"💬 微信群":r.type==="link"?"🔗":"📄"} ${r.label?r.label+" ":""}${r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value}
    <span style="cursor:pointer;color:#7f8c8d" onclick="editResRow(${r.id},${p.id},'proj',this)">✎</span>
    <span style="cursor:pointer;color:#b0b6bc" onclick="delProjRes(${r.id},${p.id})">×</span></div>`).join("");
}
function projResAddRow(pid,src){
  const pre=src==="modal"?"mr":"pr";
  return `<div style="display:flex;gap:6px;margin-top:8px">
    <select id="${pre}-type" style="flex:0 0 92px"><option value="wechat_group">微信群</option><option value="link">链接</option><option value="note">备注</option></select>
    <input id="${pre}-label" placeholder="说明(可选)" style="flex:0 0 90px">
    <input id="${pre}-value" placeholder="群名或链接" style="flex:1">
    <button onclick="addProjResUI(${pid},'${src}')" style="flex:0 0 46px">＋</button>
  </div>`;
}
/** 保存/删除后刷新所有项目资料区块（弹窗 + 右侧面板） */
function refreshProjRes(pid){
  const p=DATA.projects.find(x=>x.id===pid);
  if(!p)return;
  const wrap=document.getElementById("modal-res-wrap");
  if(wrap&&wrap.style.display!=="none"&&editingProjId===pid){
    document.getElementById("modal-res-list").innerHTML=projResHTML(p);
  }
  if(document.getElementById("proj-filter").value===String(pid))showRes(String(pid));
}'''
assert old_showres_tail in s, "anchor2"
s = s.replace(old_showres_tail, new_showres_tail)

# 3) editResRow 改传元素
s = s.replace("async function editResRow(rid,ownerId,kind){", "async function editResRow(rid,ownerId,kind,el){")
s = s.replace('''  const key=kind+":"+rid;
  if(editingResKey===key)return; // 已在编辑
  editingResKey=key;
  // 找到数据
  let r=null;''', '''  const key=kind+":"+rid;
  if(editingResKey===key)return;
  editingResKey=key;
  let r=null;''')
s = s.replace('''  const el=document.getElementById((kind==="proj"?"pres-":"tres-")+rid);
  if(!r||!el)return;''', '''  if(!r||!el)return;''')
s = s.replace('''onclick="editResRow(${r.id},${t.id},'task')"''', '''onclick="editResRow(${r.id},${t.id},'task',this)"''')

# 4) save/cancel 走 refreshProjRes；cancel 不再 async
s = s.replace('''async function saveResRow(rid,ownerId,kind){''', '''async function saveResRow(rid,ownerId,kind){''')
s = s.replace('''  editingResKey=null;
  await load();
  if(kind==="proj")showRes(String(ownerId));else fillDetail(ownerId);
}
async function cancelResRow(rid,ownerId,kind){
  editingResKey=null;
  if(kind==="proj")showRes(String(ownerId));else fillDetail(ownerId);
}''', '''  editingResKey=null;
  await load();
  if(kind==="proj")refreshProjRes(ownerId);else fillDetail(ownerId);
}
function cancelResRow(rid,ownerId,kind){
  editingResKey=null;
  if(kind==="proj")refreshProjRes(ownerId);else fillDetail(ownerId);
}''')

# 5) addProjResUI 双来源 + delProjRes 双刷新
s = s.replace('''async function addProjResUI(pid){
  const type=(document.getElementById("pr-type")||{}).value||"wechat_group";
  const value=(document.getElementById("pr-value")||{}).value?.trim();
  const label=(document.getElementById("pr-label")||{}).value?.trim()||"";
  if(!value)return alert("请填内容");
  const r=await fetch(`/api/projects/${pid}/resources`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,value,label})});
  if(!r.ok)return alert("添加失败");
  await load();showRes(String(pid));
}
async function delProjRes(rid,pid){
  await fetch(`/api/resources/${rid}`,{method:"DELETE"});
  await load();showRes(String(pid));
}''', '''async function addProjResUI(pid,src){
  const pre=src==="modal"?"mr":"pr";
  const type=(document.getElementById(pre+"-type")||{}).value||"wechat_group";
  const value=(document.getElementById(pre+"-value")||{}).value?.trim();
  const label=(document.getElementById(pre+"-label")||{}).value?.trim()||"";
  if(!value)return alert("请填内容");
  const r=await fetch(`/api/projects/${pid}/resources`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,value,label})});
  if(!r.ok)return alert("添加失败");
  await load();refreshProjRes(pid);
}
async function delProjRes(rid,pid){
  await fetch(`/api/resources/${rid}`,{method:"DELETE"});
  await load();refreshProjRes(pid);
}''')

# 6) openProjModal 填充弹窗资料区
s = s.replace('''  const delBtn=document.getElementById("p-del");
  delBtn.style.display=p?"":"none";
  delBtn.onclick=deleteProjectUI;
  document.getElementById("p-name").focus();''', '''  const delBtn=document.getElementById("p-del");
  delBtn.style.display=p?"":"none";
  delBtn.onclick=deleteProjectUI;
  const resWrap=document.getElementById("modal-res-wrap");
  resWrap.style.display=p?"":"none";
  if(p)document.getElementById("modal-res-list").innerHTML=projResHTML(p);
  document.getElementById("p-name").focus();''')

assert s != orig
io.open(p, "w", encoding="utf-8").write(s)
print("patched ok")
