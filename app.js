
const cfg = window.MASUSI_CONFIG || {};
const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("PASTE_") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

const state = {
  session:null, profile:null, settings:{resort_name:cfg.DEFAULT_RESORT_NAME || "Masusi Farm Resort"},
  currentView:"dashboard", realtimeChannel:null,
  cache:{rooms:[],cottages:[],bookings:[],guests:[],payments:[],expenses:[],damages:[],repairs:[],inventory:[],categories:[]}
};

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const money = n => new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(Number(n||0));
const isoDate = d => new Date(d).toISOString().slice(0,10);
const today = () => isoDate(new Date());
const currentMonth = () => new Date().toISOString().slice(0,7);

const naturalCompare = (a,b) => String(a??"").localeCompare(String(b??""),undefined,{numeric:true,sensitivity:"base"});
const dateValue = v => v ? new Date(v).getTime() || 0 : 0;

function autoSortRows(key,rows=[]){
  const arr=[...rows];
  const newest=(field="created_at")=>(a,b)=>dateValue(b[field])-dateValue(a[field]) || naturalCompare(b.id,a.id);
  switch(key){
    case "rooms":
    case "cottages":
      return arr.sort((a,b)=>naturalCompare(a.unit_number||a.name,b.unit_number||b.name));
    case "bookings":
      return arr.sort((a,b)=>dateValue(b.check_in_date||b.booking_date)-dateValue(a.check_in_date||a.booking_date) || naturalCompare(b.booking_number,a.booking_number));
    case "pax":
      return arr.sort((a,b)=>Number(a.pax_no||999999)-Number(b.pax_no||999999) || naturalCompare(a.display_name,a.display_name));
    case "guests":
      return arr.sort((a,b)=>naturalCompare(a.full_name,b.full_name) || naturalCompare(a.id,b.id));
    case "payments":
      return arr.sort((a,b)=>dateValue(b.payment_date||b.created_at)-dateValue(a.payment_date||a.created_at) || naturalCompare(b.id,a.id));
    case "expenses":
      return arr.sort((a,b)=>dateValue(b.expense_date||b.created_at)-dateValue(a.expense_date||a.created_at) || naturalCompare(b.id,a.id));
    case "damages":
      return arr.sort((a,b)=>dateValue(b.damage_date||b.created_at)-dateValue(a.damage_date||a.created_at) || naturalCompare(b.damage_number,a.damage_number));
    case "repairs":
      return arr.sort((a,b)=>dateValue(b.repair_date||b.created_at)-dateValue(a.repair_date||a.created_at) || naturalCompare(b.id,a.id));
    case "inventory":
      return arr.sort((a,b)=>naturalCompare(a.name||a.item_code,b.name||b.item_code));
    case "categories":
    case "services":
      return arr.sort((a,b)=>naturalCompare(a.name,b.name));
    case "tourRates":
      return arr.sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0) || naturalCompare(a.name,b.name));
    case "charges":
      return arr.sort((a,b)=>dateValue(b.charge_date||b.created_at)-dateValue(a.charge_date||a.created_at) || naturalCompare(b.id,a.id));
    case "stockMovements":
      return arr.sort(newest("created_at"));
    case "audit":
      return arr.sort(newest("created_at"));
    default:
      return arr.sort(newest("created_at"));
  }
}

const esc = v => String(v ?? "").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const fmtDate = v => v ? new Date(v+"T00:00:00").toLocaleDateString("en-PH",{year:"numeric",month:"short",day:"numeric"}) : "—";

function toast(message,type="success"){
  const el=document.createElement("div"); el.className=`toast ${type==="error"?"error":""}`; el.textContent=message; $("#toastStack").append(el); setTimeout(()=>el.remove(),3800);
}

function openModal({title,eyebrow="",body="",footer="",wide=false}){
  $("#modalTitle").textContent=title; $("#modalEyebrow").textContent=eyebrow; $("#modalBody").innerHTML=body; $("#modalFooter").innerHTML=footer;
  $("#modalBox").style.width=wide?"min(980px,100%)":"min(760px,100%)"; $("#modalBackdrop").classList.remove("hidden");
}
function closeModal(){ $("#modalBackdrop").classList.add("hidden"); $("#modalBody").innerHTML=""; $("#modalFooter").innerHTML=""; }
$("#modalCloseBtn").addEventListener("click",closeModal);
$("#modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal()});

function confirmModal(title,message,onConfirm,danger=false){
  openModal({
    title,eyebrow:danger?"CONFIRM ACTION":"CONFIRMATION",
    body:`<p>${esc(message)}</p>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn ${danger?"btn-danger":"btn-primary"}" data-modal-confirm>Confirm</button>`
  });
  $("[data-modal-cancel]").onclick=closeModal;
  $("[data-modal-confirm]").onclick=async()=>{ await onConfirm(); };
}

function setLoading(done=false){ $("#appLoader").classList.toggle("hidden",done); }
function showLogin(){ $("#appShell").classList.add("hidden"); $("#loginScreen").classList.remove("hidden"); setLoading(true); }
function showApp(){ $("#loginScreen").classList.add("hidden"); $("#appShell").classList.remove("hidden"); setLoading(true); }

async function boot(){
  $("#dashboardMonth").value=currentMonth(); $("#reportsMonth").value=currentMonth(); $("#liveDate").value=today();
  if(!configured){ showLogin(); $("#loginMessage").textContent="Configure config.js with your Supabase URL and anon key first."; return; }
  const {data:{session}}=await sb.auth.getSession(); state.session=session;
  if(!session){ showLogin(); return; }
  await afterLogin();
}
async function afterLogin(){
  state.session=(await sb.auth.getSession()).data.session;
  if(!state.session){showLogin();return}
  await loadProfile(); await loadSettings(); await preload(); setupRealtime(); showApp(); navigate("dashboard");
}
async function loadProfile(){
  const uid=state.session.user.id;
  const {data,error}=await sb.from("profiles").select("*").eq("id",uid).single();
  if(error){ state.profile={id:uid,full_name:state.session.user.email,role:"staff",is_active:true}; }
  else state.profile=data;
  if(state.profile && state.profile.is_active===false){ await sb.auth.signOut(); showLogin(); $("#loginMessage").textContent="Your account is inactive. Contact an administrator."; return; }
  $("#sidebarUserName").textContent=state.profile?.full_name || state.session.user.email;
  $("#sidebarUserRole").textContent=state.profile?.role || "staff";
  $$(".admin-only").forEach(el=>el.classList.toggle("hidden",!["admin","manager"].includes(state.profile?.role)));
}
async function loadSettings(){
  const {data}=await sb.from("system_settings").select("*").eq("id",1).maybeSingle();
  if(data)state.settings={...state.settings,...data};
  applyBrand();
}
function applyBrand(){
  const name=state.settings.resort_name||"Masusi Farm Resort";
  document.title=`${name} Management System`;
  ["#sidebarResortName","#loginResortName"].forEach(s=>$(s).textContent=name);
  const logo=state.settings.logo_url||"assets/logo-placeholder.svg";
  ["#sidebarLogo","#loginLogo","#logoPreview"].forEach(s=>$(s).src=logo);
}
async function preload(){
  await Promise.all([
    getTable("rooms"),getTable("cottages"),getTable("bookings"),getTable("guests"),
    getTable("payments"),getTable("expenses"),getTable("damage_reports","damages"),
    getTable("repair_records","repairs"),getTable("inventory_items","inventory"),
    getTable("booking_categories","categories")
  ]);
}
async function getTable(table,key=table){
  const {data,error}=await sb.from(table).select("*").order("created_at",{ascending:false});
  if(!error)state.cache[key]=autoSortRows(key,data||[]);
  return state.cache[key];
}

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); $("#loginMessage").textContent="Signing in...";
  const email=$("#loginEmail").value.trim(), password=$("#loginPassword").value;
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error){$("#loginMessage").textContent=error.message;return}
  $("#loginMessage").textContent=""; await afterLogin();
});
$("#logoutBtn").onclick=()=>confirmModal("Sign out","Do you want to sign out of Masusi Farm Resort?",async()=>{closeModal(); await sb.auth.signOut(); location.reload()});
$("#mobileMenuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
$("#refreshBtn").onclick=async()=>{await preload(); await renderCurrent(); toast("Data refreshed.");};

$$(".nav-link").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.view)));
$$("[data-view-jump]").forEach(btn=>btn.onclick=()=>navigate(btn.dataset.viewJump));

function navigate(view){
  state.currentView=view;
  $$(".view").forEach(v=>v.classList.remove("active"));
  $(`#view-${view}`)?.classList.add("active");
  $$(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  $("#sidebar").classList.remove("open");
  const titles={dashboard:"Dashboard",live:"Live Rooms & Cottages",bookings:"Bookings",availability:"Availability Calendar",rooms:"Rooms",cottages:"Cottages",guests:"Guests",barcode:"Barcode Scanner",billing:"Billing",payments:"Payments",invoices:"Invoices",expenses:"Expenses",damages:"Damages",repairs:"Repairs",inventory:"Inventory",reports:"Reports",users:"Users",audit:"Audit Logs",settings:"Settings"};
  $("#pageTitle").textContent=titles[view]||"Masusi Farm Resort";
  renderCurrent();
}
async function renderCurrent(){
  if(state.currentView==="dashboard") return renderDashboard();
  if(state.currentView==="live") return renderLive();
  if(state.currentView==="availability") return renderAvailability();
  if(["bookings","rooms","cottages","guests","billing","payments","invoices","expenses","damages","repairs","inventory","users","audit"].includes(state.currentView)) return renderModule(state.currentView);
  if(state.currentView==="reports") return runReport();
}

function bookingForUnit(type,id,date=today()){
  return state.cache.bookings.find(b=>{
    const assignment = type==="room" ? b.room_id===id : b.cottage_id===id;
    if(!assignment || ["cancelled","checked_out"].includes(b.status)) return false;
    const start=b.check_in_date||b.booking_date, end=b.check_out_date||start;
    return date>=start && date<=end;
  });
}
function renderDashboard(){
  const m=$("#dashboardMonth").value||currentMonth(), cat=$("#dashboardBookingCategory").value, pay=$("#dashboardPaymentStatus").value;
  const bookings=state.cache.bookings.filter(b=>(b.check_in_date||b.booking_date||"").slice(0,7)===m && (!cat||b.booking_category_id===cat) && (!pay||b.payment_status===pay));
  const todayBookings=state.cache.bookings.filter(b=>(b.check_in_date||b.booking_date)===today());
  const roomsAvail=state.cache.rooms.filter(r=>r.is_active!==false && !bookingForUnit("room",r.id)).length;
  const cottagesAvail=state.cache.cottages.filter(c=>c.is_active!==false && !bookingForUnit("cottage",c.id)).length;
  const payments=state.cache.payments.filter(p=>(p.payment_date||p.created_at||"").slice(0,7)===m).reduce((s,p)=>s+Number(p.amount||0),0);
  const expenses=state.cache.expenses.filter(p=>(p.expense_date||p.created_at||"").slice(0,7)===m).reduce((s,p)=>s+Number(p.amount||0),0);
  const guests=bookings.reduce((s,b)=>s+Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0),0);
  const cards=[
    ["Rooms Available",roomsAvail,"Today"],["Cottages Available",cottagesAvail,"Today"],["Bookings",bookings.length,m],
    ["Guests",guests,"Selected month"],["Collections",money(payments),"Selected month"],["Net",money(payments-expenses),"Collections less expenses"]
  ];
  $("#dashboardStats").innerHTML=cards.map(c=>`<div class="stat-card"><span>${c[0]}</span><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join("");
  $("#dashboardLiveSummary").innerHTML=`
    <div class="mini-status"><strong>${state.cache.rooms.length}</strong><div class="muted">Total Rooms</div></div>
    <div class="mini-status"><strong>${state.cache.cottages.length}</strong><div class="muted">Total Cottages</div></div>
    <div class="mini-status"><strong>${state.cache.rooms.length-roomsAvail}</strong><div class="muted">Rooms in use</div></div>
    <div class="mini-status"><strong>${state.cache.cottages.length-cottagesAvail}</strong><div class="muted">Cottages in use</div></div>`;
  $("#dashboardBookings").innerHTML=todayBookings.length?todayBookings.slice(0,8).map(b=>`<div class="list-item"><div><strong>${esc(b.guest_name||"Guest")}</strong><small>${esc(b.booking_number||"")} · ${esc(b.status||"pending")}</small></div><strong>${money(b.total_amount||0)}</strong></div>`).join(""):`<div class="empty-state">No bookings for today.</div>`;
  $("#dashboardBookingCategory").innerHTML='<option value="">All categories</option>'+state.cache.categories.filter(x=>x.is_active!==false).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
}
$("#dashboardMonth").onchange=renderDashboard; $("#dashboardPaymentStatus").onchange=renderDashboard; $("#dashboardBookingCategory").onchange=renderDashboard;

function unitStatus(type,u,date){
  if(["maintenance","damaged","cleaning"].includes(u.status)) return u.status;
  const b=bookingForUnit(type,u.id,date); return b ? (b.status==="confirmed"?"reserved":"occupied") : "available";
}
function renderLive(){
  const date=$("#liveDate").value||today(), type=$("#liveType").value, status=$("#liveStatus").value, q=$("#liveSearch").value.toLowerCase().trim();
  let units=[
    ...state.cache.rooms.map(x=>({...x,unit_type:"room"})),
    ...state.cache.cottages.map(x=>({...x,unit_type:"cottage"}))
  ].filter(u=>u.is_active!==false);
  if(type)units=units.filter(u=>u.unit_type===type);
  units=units.map(u=>({...u,live_status:unitStatus(u.unit_type,u,date),booking:bookingForUnit(u.unit_type,u.id,date)}));
  if(status)units=units.filter(u=>u.live_status===status);
  if(q)units=units.filter(u=>`${u.name||u.unit_number||""} ${u.booking?.guest_name||""}`.toLowerCase().includes(q));
  const counts={available:0,occupied:0,reserved:0,other:0}; units.forEach(u=>counts[u.live_status]!==undefined?counts[u.live_status]++:counts.other++);
  $("#liveSummary").innerHTML=[["Available",counts.available],["Occupied",counts.occupied],["Reserved",counts.reserved],["Cleaning/Maint.",counts.other]].map(x=>`<div class="stat-card"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
  $("#liveQueueGrid").innerHTML=units.length?units.map(u=>{
    const b=u.booking, total=b?Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0):0;
    return `<article class="unit-card ${u.live_status}" data-unit-type="${u.unit_type}" data-unit-id="${u.id}">
      <div class="eyebrow">${u.unit_type.toUpperCase()}</div><h3>${esc(u.name||u.unit_number)}</h3>
      <span class="status">${esc(u.live_status)}</span>
      <div class="unit-meta">
        <span>${b?`Guest: ${esc(b.guest_name||"—")}`:"No active booking"}</span>
        <span>${b?`${total} guests · ${Number(b.adults||0)} adult · ${Number(b.kids||0)} kids · ${Number(b.babies||0)} baby`:`Capacity: ${u.capacity||"—"}`}</span>
        <span>${b?`Balance: ${money(b.balance||0)}`:`Rate: ${money(u.base_rate||u.rate||0)}`}</span>
      </div></article>`;
  }).join(""):`<div class="empty-state">No units match the selected filters.</div>`;
  $$(".unit-card").forEach(card=>card.onclick=()=>openUnitDetail(card.dataset.unitType,card.dataset.unitId,date));
}
["#liveDate","#liveType","#liveStatus","#liveSearch"].forEach(s=>$(s).addEventListener(s==="#liveSearch"?"input":"change",renderLive));
function openUnitDetail(type,id,date){
  const u=(type==="room"?state.cache.rooms:state.cache.cottages).find(x=>x.id===id), b=bookingForUnit(type,id,date);
  const total=b?Number(b.adults||0)+Number(b.kids||0)+Number(b.babies||0):0;
  openModal({title:u.name||u.unit_number,eyebrow:`${type.toUpperCase()} LIVE DETAILS`,body:`
    <div class="report-kpis">
      <div class="report-kpi"><span>Status</span><strong>${esc(unitStatus(type,u,date))}</strong></div>
      <div class="report-kpi"><span>Guests</span><strong>${total}</strong></div>
      <div class="report-kpi"><span>Capacity</span><strong>${u.capacity||"—"}</strong></div>
      <div class="report-kpi"><span>Balance</span><strong>${money(b?.balance||0)}</strong></div>
    </div>
    ${b?`<div class="panel"><strong>${esc(b.guest_name||"Guest")}</strong><p class="muted">${esc(b.booking_number||"")} · ${fmtDate(b.check_in_date)} to ${fmtDate(b.check_out_date)}</p><p>Adults: ${b.adults||0} · Kids: ${b.kids||0} · Babies: ${b.babies||0} · Senior: ${b.seniors||0} · PWD: ${b.pwd||0}</p></div>`:`<div class="empty-state">This unit is currently available.</div>`}
  `,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${b?`<button class="btn btn-primary" data-open-booking="${b.id}">View Booking</button>`:""}`});
  $("[data-modal-cancel]").onclick=closeModal;
  if(b)$("[data-open-booking]").onclick=()=>{closeModal();navigate("bookings");setTimeout(()=>openRecord("bookings",b.id),50)};
}
function openSecondScreen(){ window.open(`second-screen.html?date=${encodeURIComponent($("#liveDate")?.value||today())}`,"masusiLiveDisplay","popup,width=1400,height=900"); }
$("#openSecondScreenBtn").onclick=openSecondScreen; $("#fullScreenLiveBtn").onclick=openSecondScreen;

function moduleConfig(name){
  return {
    bookings:{table:"bookings",title:"Bookings",date:"check_in_date",fields:[
      ["booking_number","Booking No.","text"],["guest_name","Guest Name","text"],["contact_number","Contact","text"],["booking_category_id","Category","category"],
      ["check_in_date","Check-in","date"],["check_out_date","Check-out","date"],["room_id","Room","room"],["cottage_id","Cottage","cottage"],
      ["adults","Adults","number"],["kids","Kids","number"],["babies","Babies","number"],["seniors","Senior","number"],["pwd","PWD","number"],
      ["status","Status","select:pending|confirmed|checked_in|checked_out|cancelled|no_show"],["payment_status","Payment Status","select:unpaid|partial|paid|refunded"],
      ["total_amount","Total Amount","number"],["balance","Balance","number"],["notes","Notes","textarea"]
    ]},
    rooms:{table:"rooms",title:"Rooms",date:"created_at",fields:[["unit_number","Room No.","text"],["name","Room Name","text"],["room_type","Type","text"],["capacity","Capacity","number"],["base_rate","Base Rate","number"],["extra_person_rate","Extra Person","number"],["status","Status","select:available|cleaning|maintenance|damaged|inactive"],["amenities","Amenities","textarea"],["is_active","Active","boolean"]]},
    cottages:{table:"cottages",title:"Cottages",date:"created_at",fields:[["unit_number","Cottage No.","text"],["name","Cottage Name","text"],["cottage_type","Type","text"],["capacity","Capacity","number"],["base_rate","Base Rate","number"],["extra_person_rate","Extra Person","number"],["location","Location","text"],["status","Status","select:available|cleaning|maintenance|damaged|inactive"],["amenities","Amenities","textarea"],["is_active","Active","boolean"]]},
    guests:{table:"guests",title:"Guests",date:"created_at",fields:[["full_name","Full Name","text"],["contact_number","Contact","text"],["email","Email","email"],["address","Address","textarea"],["birthday","Birthday","date"],["is_senior","Senior","boolean"],["is_pwd","PWD","boolean"],["id_reference","ID Reference","text"],["notes","Notes","textarea"]]},
    payments:{table:"payments",title:"Payments",date:"payment_date",fields:[["booking_id","Booking ID","text"],["payment_date","Payment Date","date"],["amount","Amount","number"],["method","Method","select:Cash|GCash|Maya|Bank Transfer|Card|Other"],["reference_number","Reference No.","text"],["notes","Notes","textarea"]]},
    expenses:{table:"expenses",title:"Expenses",date:"expense_date",fields:[["expense_date","Date","date"],["category","Category","text"],["description","Description","textarea"],["amount","Amount","number"],["paid_to","Paid To","text"],["reference_number","Reference","text"],["notes","Notes","textarea"]]},
    damages:{table:"damage_reports",title:"Damages",date:"damage_date",fields:[["damage_number","Damage No.","text"],["damage_date","Date","date"],["unit_type","Unit Type","select:room|cottage|facility|equipment"],["unit_reference","Unit / Item","text"],["booking_id","Booking ID","text"],["guest_name","Guest","text"],["description","Description","textarea"],["estimated_cost","Estimated Cost","number"],["actual_cost","Actual Cost","number"],["guest_charge","Guest Charge","number"],["status","Status","select:reported|inspection|for_repair|repaired|charged|closed"]]},
    repairs:{table:"repair_records",title:"Repairs",date:"repair_date",fields:[["damage_report_id","Damage ID","text"],["repair_date","Repair Date","date"],["description","Description","textarea"],["technician","Technician","text"],["labor_cost","Labor Cost","number"],["material_cost","Material Cost","number"],["status","Status","select:scheduled|ongoing|completed|cancelled"],["notes","Notes","textarea"]]},
    inventory:{table:"inventory_items",title:"Inventory",date:"created_at",fields:[["item_code","Item Code","text"],["name","Item Name","text"],["category","Category","text"],["quantity","Quantity","number"],["unit","Unit","text"],["location","Location","text"],["condition","Condition","select:good|damaged|repair|retired"],["cost","Cost","number"],["notes","Notes","textarea"]]},
    billing:{table:"charges",title:"Billing / Charges",date:"charge_date",fields:[["booking_id","Booking ID","text"],["charge_date","Charge Date","date"],["charge_type","Charge Type","text"],["description","Description","text"],["quantity","Qty","number"],["unit_price","Unit Price","number"],["amount","Amount","number"],["discount_amount","Discount","number"],["notes","Notes","textarea"]]},
    invoices:{table:"invoices",title:"Invoices",date:"invoice_date",fields:[["invoice_number","Invoice No.","text"],["booking_id","Booking ID","text"],["invoice_date","Invoice Date","date"],["subtotal","Subtotal","number"],["discount_total","Discount","number"],["total_amount","Total","number"],["paid_amount","Paid","number"],["balance","Balance","number"],["status","Status","select:open|paid|void"],["notes","Notes","textarea"]]},
    users:{table:"profiles",title:"Users",date:"created_at",fields:[["full_name","Full Name","text"],["role","Role","select:admin|manager|reception|cashier|staff|display"],["is_active","Active","boolean"]]},
    audit:{table:"audit_logs",title:"Audit Logs",date:"created_at",readonly:true,fields:[["created_at","Date","text"],["user_email","User","text"],["action","Action","text"],["table_name","Table","text"],["record_id","Record","text"],["details","Details","textarea"]]}
  }[name];
}
async function renderModule(name){
  const c=moduleConfig(name); if(!c)return;
  const key=name==="damages"?"damages":name==="repairs"?"repairs":name==="inventory"?"inventory":name;
  if(!state.cache[key] || !["rooms","cottages","bookings","guests","payments","expenses","damages","repairs","inventory"].includes(key)){
    const {data}=await sb.from(c.table).select("*").order(c.date||"created_at",{ascending:false}); state.cache[key]=data||[];
  }
  const rows=state.cache[key]||[];
  const monthId=`${name}Month`, searchId=`${name}Search`;
  $(`#view-${name}`).innerHTML=`
    <div class="section-head"><div><p class="eyebrow">MASUSI FARM RESORT</p><h2>${c.title}</h2></div></div>
    <div class="table-panel">
      <div class="table-toolbar">
        <input class="grow" id="${searchId}" type="search" placeholder="Search ${c.title.toLowerCase()}...">
        <input id="${monthId}" type="month" value="${currentMonth()}">
        <select id="${name}Status"><option value="">All status</option></select>
        <button class="btn btn-soft" data-print-module="${name}">Print Month</button>
        ${c.readonly?"":`<button class="btn btn-primary" data-add-module="${name}">Add ${c.title.replace(/s$/,"")}</button>`}
      </div>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>#</th>${c.fields.slice(0,8).map(f=>`<th>${f[1]}</th>`).join("")}<th>Actions</th></tr></thead><tbody id="${name}Tbody"></tbody></table></div>
    </div>`;
  const statusValues=[...new Set(rows.map(x=>x.status).filter(Boolean))];
  $(`#${name}Status`).innerHTML='<option value="">All status</option>'+statusValues.map(x=>`<option>${esc(x)}</option>`).join("");
  const draw=()=>{
    const q=$(`#${searchId}`).value.toLowerCase().trim(), m=$(`#${monthId}`).value, st=$(`#${name}Status`).value;
    const filtered=autoSortRows(key,rows.filter(r=>{
      const search=Object.values(r).join(" ").toLowerCase().includes(q);
      const dv=r[c.date]; const monthOK=!m||!dv||String(dv).slice(0,7)===m;
      const stOK=!st||r.status===st; return search&&monthOK&&stOK;
    }));
    $(`#${name}Tbody`).innerHTML=filtered.length?filtered.map((r,i)=>`<tr data-id="${r.id}">
      <td><strong>${i+1}</strong></td>
      ${c.fields.slice(0,8).map(f=>`<td>${formatCell(r[f[0]],f[2])}</td>`).join("")}
      <td><div class="row-actions"><button data-view-record="${name}" data-id="${r.id}">View</button>${c.readonly?"":`<button data-edit-record="${name}" data-id="${r.id}">Edit</button><button data-delete-record="${name}" data-id="${r.id}">Archive</button>`}</div></td>
    </tr>`).join(""):`<tr><td colspan="${Math.min(c.fields.length,8)+2}" class="empty-state">No records found.</td></tr>`;
    $$(`[data-view-record="${name}"]`).forEach(b=>b.onclick=()=>openRecord(name,b.dataset.id));
    $$(`[data-edit-record="${name}"]`).forEach(b=>b.onclick=()=>openRecord(name,b.dataset.id,true));
    $$(`[data-delete-record="${name}"]`).forEach(b=>b.onclick=()=>archiveRecord(name,b.dataset.id));
  };
  $(`#${searchId}`).oninput=draw; $(`#${monthId}`).onchange=draw; $(`#${name}Status`).onchange=draw; draw();
  $(`[data-add-module="${name}"]`)?.addEventListener("click",()=>openRecord(name,null,true));
  $(`[data-print-module="${name}"]`).onclick=()=>printElementView(name);
}
function formatCell(v,type){
  if(v===null||v===undefined||v==="")return "—";
  if(type==="number" && /amount|rate|cost|price|balance|discount/i.test(String(v)))return esc(v);
  if(type==="boolean")return v?"Yes":"No";
  return esc(v);
}
function fieldInput(f,value=""){
  const [name,label,type]=f, val=value??"";
  if(type==="textarea")return `<label class="full">${label}<textarea name="${name}" rows="3">${esc(val)}</textarea></label>`;
  if(type==="boolean")return `<label>${label}<select name="${name}"><option value="true" ${val===true?"selected":""}>Yes</option><option value="false" ${val===false?"selected":""}>No</option></select></label>`;
  if(type.startsWith("select:")){const opts=type.split(":")[1].split("|");return `<label>${label}<select name="${name}"><option value="">Select...</option>${opts.map(o=>`<option value="${esc(o)}" ${val===o?"selected":""}>${esc(o)}</option>`).join("")}</select></label>`}
  if(type==="category")return `<label>${label}<select name="${name}"><option value="">Select...</option>${state.cache.categories.filter(x=>x.is_active!==false).map(x=>`<option value="${x.id}" ${val===x.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></label>`;
  if(type==="room")return `<label>${label}<select name="${name}"><option value="">None</option>${state.cache.rooms.filter(x=>x.is_active!==false).map(x=>`<option value="${x.id}" ${val===x.id?"selected":""}>${esc(x.name||x.unit_number)}</option>`).join("")}</select></label>`;
  if(type==="cottage")return `<label>${label}<select name="${name}"><option value="">None</option>${state.cache.cottages.filter(x=>x.is_active!==false).map(x=>`<option value="${x.id}" ${val===x.id?"selected":""}>${esc(x.name||x.unit_number)}</option>`).join("")}</select></label>`;
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(val)}"></label>`;
}
async function openRecord(name,id,edit=false){
  const c=moduleConfig(name), key=name==="damages"?"damages":name==="repairs"?"repairs":name==="inventory"?"inventory":name;
  const rows=state.cache[key]||[]; const rec=id?rows.find(x=>x.id===id):{};
  if(!edit){
    openModal({title:rec?.guest_name||rec?.name||rec?.full_name||rec?.booking_number||rec?.invoice_number||c.title.replace(/s$/,""),eyebrow:`${c.title.toUpperCase()} DETAILS`,
      body:`<div class="modal-form">${c.fields.map(f=>`<label><span>${f[1]}</span><div>${formatCell(rec?.[f[0]],f[2])}</div></label>`).join("")}</div>`,
      footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${c.readonly?"":`<button class="btn btn-primary" data-modal-edit>Edit</button>`}`});
    $("[data-modal-cancel]").onclick=closeModal; if(!c.readonly)$("[data-modal-edit]").onclick=()=>openRecord(name,id,true); return;
  }
  openModal({title:id?`Edit ${c.title.replace(/s$/,"")}`:`Add ${c.title.replace(/s$/,"")}`,eyebrow:id?"UPDATE RECORD":"NEW RECORD",
    body:`<form id="recordForm" class="modal-form">${c.fields.map(f=>fieldInput(f,rec?.[f[0]])).join("")}</form>`,
    footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" data-modal-save>Save</button>`,wide:true});
  $("[data-modal-cancel]").onclick=closeModal;
  $("[data-modal-save]").onclick=async()=>{
    const fd=new FormData($("#recordForm")), payload={};
    for(const f of c.fields){
      let v=fd.get(f[0]); if(f[2]==="number")v=v===""?0:Number(v); if(f[2]==="boolean")v=v==="true"; payload[f[0]]=v===""?null:v;
    }
    if(name==="bookings" && !payload.booking_number) payload.booking_number=`BK-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const query=id?sb.from(c.table).update(payload).eq("id",id):sb.from(c.table).insert(payload).select().single();
    const {error}=await query; if(error){toast(error.message,"error");return}
    closeModal(); await getTable(c.table,key); await writeAudit(id?"update":"insert",c.table,id||"",`${c.title} record`); toast(`${c.title.replace(/s$/,"")} saved.`); renderModule(name);
  };
}
function archiveRecord(name,id){
  const c=moduleConfig(name), key=name==="damages"?"damages":name==="repairs"?"repairs":name==="inventory"?"inventory":name;
  confirmModal(`Archive ${c.title.replace(/s$/,"")}`,"This record will be archived or marked inactive instead of permanently deleted.",async()=>{
    let payload={is_active:false}; if(name==="bookings")payload={status:"cancelled"}; else if(name==="users")payload={is_active:false}; else if(name==="inventory")payload={condition:"retired"};
    const {error}=await sb.from(c.table).update(payload).eq("id",id);
    if(error){toast(error.message,"error");return}
    closeModal(); await getTable(c.table,key); await writeAudit("archive",c.table,id,"Record archived"); toast("Record archived."); renderModule(name);
  },true);
}
async function writeAudit(action,table,record_id,details){
  try{ await sb.from("audit_logs").insert({user_id:state.session?.user?.id,user_email:state.session?.user?.email,action,table_name:table,record_id:String(record_id||""),details}); }catch{}
}
function printElementView(name){
  $$(".view").forEach(v=>v.classList.remove("print-target")); $(`#view-${name}`).classList.add("print-target"); window.print(); setTimeout(()=>$("#view-"+name).classList.remove("print-target"),200);
}

function renderAvailability(){
  const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()+i);return isoDate(d)});
  const units=[...state.cache.rooms.map(x=>({...x,t:"room"})),...state.cache.cottages.map(x=>({...x,t:"cottage"}))].filter(x=>x.is_active!==false);
  $("#view-availability").innerHTML=`<div class="section-head"><div><p class="eyebrow">14-DAY OPERATIONS CALENDAR</p><h2>Availability Calendar</h2></div></div><div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Unit</th>${days.map(d=>`<th>${fmtDate(d)}</th>`).join("")}</tr></thead><tbody>${units.map(u=>`<tr><td><strong>${esc(u.name||u.unit_number)}</strong><br><small>${u.t}</small></td>${days.map(d=>`<td><span class="badge">${esc(unitStatus(u.t,u,d))}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

// Barcode
$("#barcodeSearchBtn").onclick=scanBarcode;
$("#barcodeInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();scanBarcode()}});
async function scanBarcode(){
  const code=$("#barcodeInput").value.trim(); if(!code)return;
  const {data:bc}=await sb.from("barcodes").select("*").eq("code",code).eq("is_active",true).maybeSingle();
  let booking=null;
  if(bc?.booking_id) booking=state.cache.bookings.find(b=>b.id===bc.booking_id);
  if(!booking) booking=state.cache.bookings.find(b=>b.barcode===code || b.booking_number===code);
  if(!booking){$("#barcodeResult").innerHTML=`<div class="empty-state"><strong>Barcode not found</strong><p>${esc(code)}</p></div>`;return}
  const total=Number(booking.adults||0)+Number(booking.kids||0)+Number(booking.babies||0);
  const unit=booking.room_id?state.cache.rooms.find(x=>x.id===booking.room_id):state.cache.cottages.find(x=>x.id===booking.cottage_id);
  $("#barcodeResult").innerHTML=`<div class="report-kpis">
    <div class="report-kpi"><span>Guest</span><strong>${esc(booking.guest_name||"Guest")}</strong></div>
    <div class="report-kpi"><span>Unit</span><strong>${esc(unit?.name||unit?.unit_number||"—")}</strong></div>
    <div class="report-kpi"><span>Guests</span><strong>${total}</strong></div>
    <div class="report-kpi"><span>Balance</span><strong>${money(booking.balance||0)}</strong></div>
  </div><div class="panel"><p>${esc(booking.booking_number||"")} · ${esc(booking.status||"")}</p><p>Adults ${booking.adults||0} · Kids ${booking.kids||0} · Babies ${booking.babies||0} · Senior ${booking.seniors||0} · PWD ${booking.pwd||0}</p><button class="btn btn-primary" id="scanOpenBooking">Open Booking</button></div>`;
  $("#scanOpenBooking").onclick=()=>{navigate("bookings");setTimeout(()=>openRecord("bookings",booking.id),60)};
  $("#barcodeInput").select();
}

// Reports
$("#runReportBtn").onclick=runReport; $("#printReportBtn").onclick=()=>printElementView("reports");
async function runReport(){
  const type=$("#reportType").value, m=$("#reportsMonth").value||currentMonth();
  let rows=[], title="";
  if(type==="bookings"){rows=state.cache.bookings.filter(x=>(x.check_in_date||x.booking_date||"").slice(0,7)===m);title="Booking Report"}
  if(type==="payments"){rows=state.cache.payments.filter(x=>(x.payment_date||"").slice(0,7)===m);title="Payment Report"}
  if(type==="expenses"){rows=state.cache.expenses.filter(x=>(x.expense_date||"").slice(0,7)===m);title="Expense Report"}
  if(type==="damages"){rows=state.cache.damages.filter(x=>(x.damage_date||"").slice(0,7)===m);title="Damage Report"}
  if(type==="repairs"){rows=state.cache.repairs.filter(x=>(x.repair_date||"").slice(0,7)===m);title="Repair Report"}
  if(type==="occupancy"){rows=state.cache.bookings.filter(x=>(x.check_in_date||"").slice(0,7)===m);title="Occupancy Report"}
  const amount= type==="payments"?rows.reduce((s,x)=>s+Number(x.amount||0),0): type==="expenses"?rows.reduce((s,x)=>s+Number(x.amount||0),0): type==="bookings"?rows.reduce((s,x)=>s+Number(x.total_amount||0),0):0;
  const cols=rows.length?Object.keys(rows[0]).filter(k=>!["updated_at","created_by"].includes(k)).slice(0,8):[];
  $("#reportContent").innerHTML=`<div class="report-sheet">
    <div class="report-header"><div><p class="eyebrow">MASUSI FARM RESORT</p><h2>${title}</h2><p class="muted">${m}</p></div><div><strong>Generated</strong><br>${new Date().toLocaleString("en-PH")}</div></div>
    <div class="report-kpis"><div class="report-kpi"><span>Records</span><strong>${rows.length}</strong></div><div class="report-kpi"><span>Amount</span><strong>${money(amount)}</strong></div></div>
    <div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${esc(c.replaceAll("_"," "))}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${formatCell(r[c],"text")}</td>`).join("")}</tr>`).join("")||`<tr><td class="empty-state">No records for selected month.</td></tr>`}</tbody></table></div>
  </div>`;
}
$("#reportsMonth").onchange=runReport; $("#reportType").onchange=runReport;

// Settings
$("#generalSettingsForm").onsubmit=async e=>{
  e.preventDefault(); const fd=new FormData(e.currentTarget), payload=Object.fromEntries(fd.entries());
  const {error}=await sb.from("system_settings").upsert({id:1,...payload},{onConflict:"id"}); if(error)return toast(error.message,"error");
  state.settings={...state.settings,...payload};applyBrand();toast("Resort settings saved.");
};
$("#rulesSettingsForm").onsubmit=async e=>{
  e.preventDefault(); const fd=new FormData(e.currentTarget), payload={id:1};
  for(const [k,v] of fd.entries())payload[k]=Number(v);
  const {error}=await sb.from("system_settings").upsert(payload,{onConflict:"id"});if(error)return toast(error.message,"error");
  state.settings={...state.settings,...payload};toast("Guest and discount rules saved.");
};
$("#logoSettingsForm").onsubmit=async e=>{
  e.preventDefault(); const file=$("#logoFileInput").files[0]; if(!file)return toast("Choose a logo file first.","error");
  const ext=file.name.split(".").pop().toLowerCase(); const path=`branding/resort-logo-${Date.now()}.${ext}`;
  const {error:upErr}=await sb.storage.from(cfg.STORAGE_BUCKET||"resort-assets").upload(path,file,{upsert:true});
  if(upErr)return toast(upErr.message,"error");
  const {data}=sb.storage.from(cfg.STORAGE_BUCKET||"resort-assets").getPublicUrl(path); const logo_url=data.publicUrl;
  const {error}=await sb.from("system_settings").upsert({id:1,logo_url},{onConflict:"id"});if(error)return toast(error.message,"error");
  state.settings.logo_url=logo_url;applyBrand();toast("Logo uploaded and applied.");
};
$("#resetLogoBtn").onclick=async()=>{
  const {error}=await sb.from("system_settings").upsert({id:1,logo_url:null},{onConflict:"id"}); if(error)return toast(error.message,"error");
  state.settings.logo_url=null;applyBrand();toast("Placeholder logo restored.");
};

// Dashboard print
$('[data-action="print-dashboard"]').onclick=()=>printElementView("dashboard");

function setupRealtime(){
  if(state.realtimeChannel) sb.removeChannel(state.realtimeChannel);
  state.realtimeChannel=sb.channel("resort-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},async()=>{await getTable("bookings"); if(["dashboard","live","availability","bookings"].includes(state.currentView))renderCurrent()})
    .on("postgres_changes",{event:"*",schema:"public",table:"rooms"},async()=>{await getTable("rooms"); if(["dashboard","live","availability","rooms"].includes(state.currentView))renderCurrent()})
    .on("postgres_changes",{event:"*",schema:"public",table:"cottages"},async()=>{await getTable("cottages"); if(["dashboard","live","availability","cottages"].includes(state.currentView))renderCurrent()})
    .subscribe();
}

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});
boot();
