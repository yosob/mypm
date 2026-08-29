# -*- coding: utf-8 -*-
"""任务详情侧栏视觉重构：结构化分区 + 吸底操作栏"""
import io

p = "src/web/public/index.html"
s = io.open(p, encoding="utf-8").read()

# ---------- 1) CSS：侧栏设计系统 ----------
old_css = """  /* 任务详情侧栏 */
  #detail { position:fixed; top:0; right:-420px; width:400px; height:100vh; background:#fff; box-shadow:-4px 0 24px rgba(0,0,0,.15); z-index:50; transition:right .25s; padding:20px; overflow-y:auto; }
  #detail.open { right:0; }
  #detail h2 { font-size:16px; margin:6px 0 4px; line-height:1.4; }
  #detail .close { position:absolute; top:14px; right:16px; border:0; background:none; font-size:20px; cursor:pointer; color:#95a5a6; }
  #detail .drow { font-size:13px; margin:8px 0; color:#5f6b76; }
  #detail .desc { background:#f7f8fa; border-radius:8px; padding:10px; font-size:13px; margin:12px 0; white-space:pre-wrap; }
  #detail .ops { display:flex; gap:8px; margin:14px 0; }
  #detail .ops button { flex:1; padding:7px 0; border-radius:6px; border:1px solid #d0d4d8; background:#fff; cursor:pointer; font-size:13px; }
  #detail .ops button.cur { background:var(--c1); color:#fff; border-color:var(--c1); }
  #detail .ops button.donebtn.cur { background:var(--ok); border-color:var(--ok); }
  #detail h5 { font-size:12px; color:#7f8c8d; margin:16px 0 6px; }
  #detail .timeline-item { font-size:12px; color:#5f6b76; padding:3px 0; border-bottom:1px dashed #eef0f2; line-height:1.5; }"""
new_css = """  /* 任务详情侧栏（重构版） */
  #detail { position:fixed; top:0; right:-440px; width:420px; height:100vh; background:#fff; box-shadow:-6px 0 28px rgba(0,0,0,.16); z-index:50; transition:right .25s; display:flex; flex-direction:column; }
  #detail.open { right:0; }
  .dt-scroll { flex:1; overflow-y:auto; padding:0 18px 12px; }
  .dt-head { position:sticky; top:0; background:linear-gradient(#fff 82%,rgba(255,255,255,0)); padding:16px 44px 10px 0; z-index:2; }
  .dt-head .dt-proj { font-size:12px; margin-bottom:6px; }
  .dt-head h2 { font-size:16px; line-height:1.45; margin:0; padding-right:4px; }
  .dt-badges { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
  #detail .close { position:absolute; top:12px; right:12px; width:28px; height:28px; border-radius:50%; border:0; background:#f0f2f5; font-size:15px; cursor:pointer; color:#5f6b76; z-index:3; }
  #detail .close:hover { background:#e4e8ee; }
  .dt-metas { margin:12px 0 4px; border:1px solid #eef0f3; border-radius:10px; overflow:hidden; }
  .dt-metas .row { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; font-size:13px; border-bottom:1px solid #f3f5f7; }
  .dt-metas .row:last-child { border-bottom:0; }
  .dt-metas .k { color:#8a95a1; font-size:12px; }
  .dt-metas .v { color:#2c3e50; font-weight:500; text-align:right; }
  .dt-seg { display:flex; background:#eef1f5; border-radius:9px; padding:3px; margin:12px 0; }
  .dt-seg button { flex:1; border:0; background:transparent; padding:7px 0; border-radius:7px; cursor:pointer; font-size:13px; color:#5f6b76; }
  .dt-seg button.cur { background:#fff; color:var(--c1); font-weight:600; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .dt-seg button.cur.donebtn { color:var(--ok); }
  .dt-sec { background:#fafbfc; border:1px solid #eef0f3; border-radius:10px; padding:10px 12px; margin:10px 0; }
  .dt-sec > .sec-title { font-size:12px; font-weight:600; color:#7f8c8d; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
  .dt-sec .res-item { padding:5px 0; font-size:13px; }
  .dt-sec .desc { background:#fff; border:1px solid #eef0f3; border-radius:8px; padding:9px 11px; font-size:13px; white-space:pre-wrap; line-height:1.6; }
  .dt-sec .timeline-item { font-size:12px; color:#5f6b76; padding:5px 0; border-bottom:1px dashed #e8ebee; line-height:1.55; }
  .dt-sec .timeline-item:last-child { border-bottom:0; }
  .dt-foot { position:sticky; bottom:0; background:linear-gradient(rgba(255,255,255,0),#fff 30%); padding:12px 18px 16px; display:flex; gap:10px; }
  .dt-foot button { flex:1; padding:9px 0; border-radius:8px; border:1px solid #d0d4d8; background:#fff; cursor:pointer; font-size:13px; }
  .dt-foot button.primary { background:var(--c1); color:#fff; border-color:var(--c1); }
  .dt-foot button.danger { color:var(--danger); border-color:#eecfcb; background:#fff; }
  #detail .editrow { margin:8px 0 12px; }
  #detail .editrow label { display:block; font-size:12px; color:#7f8c8d; margin-bottom:4px; }
  #detail .editrow input, #detail .editrow textarea, #detail .editrow select { width:100%; padding:7px 9px; border:1px solid #d0d4d8; border-radius:7px; font-size:13px; font-family:inherit; background:#fff; }
  #detail h5 { font-size:12px; color:#7f8c8d; margin:0 0 6px; }"""
assert old_css in s, "css anchor"
s = s.replace(old_css, new_css)

# ---------- 2) HTML 骨架 ----------
old_skel = """<!-- 任务详情侧栏 -->
<div id="detail"><button class="close" onclick="closeDetail()">×</button><div id="detail-body"></div></div>"""
new_skel = """<!-- 任务详情侧栏 -->
<div id="detail">
  <button class="close" onclick="closeDetail()">×</button>
  <div id="detail-body"></div>
</div>"""
assert old_skel in s, "skel anchor"
s = s.replace(old_skel, new_skel)

# ---------- 3) fillDetail 重写 ----------
old_fill = s[s.index("function fillDetail(id){"):s.index("function closeDetail(){")]
new_fill = '''function fillDetail(id){
  const t=findTask(id);if(!t)return;
  curTaskId=id;editing=false;
  const p=findProj(t.project_id),di=dueInfo(t),st=statusOf(t);

  const badges=[
    t.is_milestone?`<span class="badge todo">◆ 里程碑</span>`:"",
    t.priority&&t.priority!=="P3"?`<span class="badge doing">${t.priority}</span>`:"",
    di.overdue?`<span class="badge" style="background:#fdeceb;color:var(--danger)">已逾期</span>`:
      di.soon?`<span class="badge" style="background:#fdf6e3;color:#9c7a10">${di.txt}</span>`:""
  ].join("");

  let html=`<div class="dt-scroll">
    <div class="dt-head">
      <div class="dt-proj"><span class="pflag" style="background:${projColor(t.project_id)}">${p?p.name:""}</span></div>
      <h2>${t.title}</h2>
      ${badges?`<div class="dt-badges">${badges}</div>`:""}
    </div>
    <div class="dt-seg">
      <button data-st="todo" class="${st==="todo"?"cur":""}">○ 待办</button>
      <button data-st="doing" class="${st==="doing"?"cur":""}">◐ 进行中</button>
      <button data-st="done" class="donebtn ${st==="done"?"cur":""}">● 已完成</button>
    </div>
    <div class="dt-metas">
      <div class="row"><span class="k">排期</span><span class="v">${t.start_date||"…"} ~ ${t.due_date||"…"}</span></div>
      <div class="row"><span class="k">优先级</span><span class="v">${t.priority||"P3"}</span></div>
      <div class="row"><span class="k">创建于</span><span class="v">${t.created_at}</span></div>
    </div>`;

  if(t.description)html+=`<div class="dt-sec"><div class="sec-title">📝 内容</div><div class="desc">${t.description}</div></div>`;

  const trs=t.resources||[];
  html+=`<div class="dt-sec"><div class="sec-title">📎 任务资料</div>
    ${trs.length?trs.map(r=>`<div class="res-item">${tresIcon(r.type)} ${r.label?r.label+" ":""}${
      r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value
    } <span style="cursor:pointer;color:#7f8c8d" onclick="editResRow(${r.id},${t.id},'task',this)">✎</span>
      <span class="del-res" style="cursor:pointer;color:#b0b6bc" onclick="delTaskRes(${r.id},${t.id})">×</span></div>`).join(""):`<div class="res-item" style="color:#b0b6bc">（无）</div>`}
    <div class="tres-add" style="display:flex;gap:6px;margin-top:8px">
      <select id="tr-type" style="flex:0 0 84px"><option value="wechat_group">微信群</option><option value="link">链接</option><option value="note">备注</option></select>
      <input id="tr-label" placeholder="说明(可选)" style="flex:0 0 84px">
      <input id="tr-value" placeholder="群名或链接" style="flex:1">
      <button onclick="addTaskResUI(${t.id})" style="flex:0 0 42px">＋</button>
    </div></div>`;

  const cfs=DATA.fields||[];
  if(cfs.length){
    const cv=t.custom||{};
    html+=`<div class="dt-sec"><div class="sec-title">⚙ 自定义字段</div>${
      cfs.map(f=>{
        const v=cv[String(f.id)]??"";
        if(f.type==="select")return `<div class="res-item" style="display:flex;align-items:center;gap:8px">${f.name}<select data-fid="${f.id}" style="flex:1;padding:4px 6px;border:1px solid #d0d4d8;border-radius:5px;font-size:12px"><option value=""></option>${(f.options||"").split(",").filter(Boolean).map(o=>`<option ${v===o?"selected":""}>${o}</option>`).join("")}</select></div>`;
        return `<div class="res-item" style="display:flex;align-items:center;gap:8px">${f.name}<input data-fid="${f.id}" type="${f.type==="date"?"date":f.type==="number"?"number":"text"}" value="${v}" style="flex:1;padding:4px 6px;border:1px solid #d0d4d8;border-radius:5px;font-size:12px"></div>`;
      }).join("")
    }<button class="viewbtn" style="width:100%;margin-top:8px" onclick="saveCustom(${t.id})">保存</button></div>`;
  }

  const subs=DATA.projects.flatMap(x=>x.tasks).filter(x=>x.parent_id===t.id);
  if(t.parent_id||subs.length){
    let rel="";
    if(t.parent_id){const pt=findTask(t.parent_id);if(pt)rel+=`<div class="timeline-item" style="cursor:pointer" onclick="fillDetail(${pt.id})">↖ 父任务：${pt.title}</div>`;}
    rel+=subs.map(x=>`<div class="timeline-item" style="cursor:pointer" onclick="fillDetail(${x.id})">↳ 子任务：${x.title}${x.done?" ✅":""}</div>`).join("");
    html+=`<div class="dt-sec"><div class="sec-title">🔗 关联任务</div>${rel}</div>`;
  }
  if(p&&(p.resources.length||p.history.length)){
    let rel="";
    if(p.resources.length)rel+=p.resources.map(r=>
      `<div class="res-item">${r.type==="wechat_group"?"💬":r.type==="link"?"🔗":"📄"} ${r.label?r.label+" ":""}${r.type==="link"?`<a href="${r.value}" target="_blank">${r.value}</a>`:r.value}</div>`).join("");
    if(p.history.length)rel+=p.history.map(h=>`<div class="timeline-item"><b>${h.date}</b> ${h.summary}</div>`).join("");
    html+=`<div class="dt-sec"><div class="sec-title">📁 所属项目 · ${p.name}</div>${rel}</div>`;
  }

  html+=`</div>
  <div class="dt-foot">
    <button class="primary" onclick="editDetail(${id})">✏️ 编辑</button>
    <button class="danger" onclick="deleteTaskUI(${id})">🗑 删除</button>
  </div>`;

  const body=document.getElementById("detail-body");
  body.innerHTML=html;
  body.querySelectorAll(".dt-seg button[data-st]").forEach(b=>b.onclick=async()=>{
    await fetch(`/api/tasks/${id}/status`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:b.dataset.st})});
    load();
  });
  document.getElementById("detail").classList.add("open");
}
'''
s = s.replace(old_fill, new_fill)

# ---------- 4) editDetail 外壳统一 ----------
old_edit = s[s.index("function editDetail(id){"):s.index("async function saveEdit(id){")]
new_edit = '''function editDetail(id){
  const t=findTask(id);if(!t)return;
  curTaskId=id;editing=true;
  document.getElementById("detail-body").innerHTML=`<div class="dt-scroll">
    <div class="dt-head"><div class="dt-proj"><span class="pflag" style="background:${projColor(t.project_id)}">${findProj(t.project_id)?.name||""}</span></div>
    <h2>编辑任务</h2></div>
    <div class="editrow"><label>标题</label><input id="e-title" value="${t.title.replace(/"/g,"&quot;")}"></div>
    <div style="display:flex;gap:10px">
      <div class="editrow" style="flex:1"><label>开始日</label><input id="e-start" type="date" value="${t.start_date||""}"></div>
      <div class="editrow" style="flex:1"><label>截止日</label><input id="e-due" type="date" value="${t.due_date||""}"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="editrow" style="flex:1"><label>优先级</label><select id="e-priority">${["P3","P2","P1","P0"].map(x=>`<option value="${x}" ${t.priority===x?"selected":""}>${x}</option>`).join("")}</select></div>
    </div>
    <div class="editrow"><label>内容 / 备注</label><textarea id="e-desc" rows="4">${t.description||""}</textarea></div>
  </div>
  <div class="dt-foot">
    <button onclick="fillDetail(${id})">取消</button>
    <button class="primary" onclick="saveEdit(${id})">保存</button>
  </div>`;
}
'''
s = s.replace(old_edit, new_edit)

io.open(p, "w", encoding="utf-8").write(s)
print("sidebar redesign ok")
