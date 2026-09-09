
/* ============================================================
   MASUSI FARM RESORT V2.9
   ROLES / PAGE ACCESS / SECURE USER MANAGEMENT
   Permissions: view, add, edit, delete, delete_all
   ============================================================ */

const V29_PAGES=[
  ['dashboard','Dashboard'],['live','Live Rooms & Cottages'],['cottage-bookings','Cottage + Ligo Bookings'],
  ['room-bookings','Room Bookings'],['bookings','All Bookings'],['availability','Availability Calendar'],
  ['rooms','Rooms'],['cottages','Cottages'],['guests','Guests'],['barcode','Barcode Scanner'],
  ['pos','Store / POS'],['services','Services Library'],['rates','Rates & Pricing'],['billing','Billing / Charges'],
  ['payments','Payments'],['invoices','Invoices'],['expenses','Expenses'],['damages','Damages'],['repairs','Repairs'],
  ['inventory','Inventory'],['reports','Reports'],['users','Users'],['roles','Roles & Access'],['audit','Audit Logs'],['settings','Settings']
];
const V29_ACTIONS=['view','add','edit','delete','delete_all'];
state.permissions={};state.roles=[];state.rolePermissions=[];

function v29Perm(page,action='view'){
  if(state.profile?.role==='admin')return true;
  return !!state.permissions?.[page]?.[action];
}
function v29PermissionLabel(action){return ({view:'View',add:'Add',edit:'Edit / Update',delete:'Delete',delete_all:'Delete All'})[action]||action;}
function v29PageLabel(page){return V29_PAGES.find(x=>x[0]===page)?.[1]||page;}

async function v29LoadAccess(){
  if(!state.session?.user?.id)return;
  const {data:profile}=await sb.from('profiles').select('*,roles(id,name,code,is_system)').eq('id',state.session.user.id).maybeSingle();
  if(profile){state.profile={...state.profile,...profile};}
  let roleId=state.profile?.role_id||state.profile?.roles?.id||null;
  let perms=[];
  if(roleId){
    const {data}=await sb.from('role_permissions').select('*').eq('role_id',roleId);perms=data||[];
  }
  state.permissions={};
  perms.forEach(p=>state.permissions[p.page_key]={view:p.can_view,add:p.can_add,edit:p.can_edit,delete:p.can_delete,delete_all:p.can_delete_all});
  if(state.profile?.role==='admin')V29_PAGES.forEach(([k])=>state.permissions[k]={view:true,add:true,edit:true,delete:true,delete_all:true});
  v29ApplyNavPermissions();
  const roleName=state.profile?.roles?.name||state.profile?.role||'staff';
  if($('#sidebarUserRole'))$('#sidebarUserRole').textContent=roleName;
}
function v29ApplyNavPermissions(){
  $$('.nav-link[data-view]').forEach(btn=>{
    const page=btn.dataset.view;
    btn.classList.toggle('hidden',!v29Perm(page,'view'));
  });
  // legacy admin-only should no longer override explicit permissions
  $$('.admin-only[data-view]').forEach(btn=>btn.classList.toggle('hidden',!v29Perm(btn.dataset.view,'view')));
}
function v29Denied(page){
  const view=$(`#view-${page}`);if(view)view.innerHTML=`<div class="permission-denied"><p class="eyebrow">ACCESS DENIED</p><h2>No permission for ${esc(v29PageLabel(page))}</h2><p class="muted">Your assigned role does not have View access to this page. Contact an administrator if access is required.</p></div>`;
  toast('You do not have permission to view this page.','error');
}

// Load permissions after successful login.
const v29AfterLoginBase=afterLogin;
afterLogin=async function(){
  state.session=(await sb.auth.getSession()).data.session;
  if(!state.session){showLogin();return;}
  await loadProfile();await v29LoadAccess();await loadSettings();await preload();setupRealtime();showApp();
  const first=V29_PAGES.find(([p])=>v29Perm(p,'view'))?.[0]||'dashboard';
  navigate(first);
};

// Last-layer navigation permission guard.
const v29NavigateBase=navigate;
navigate=function(view){
  if(!v29Perm(view,'view')){
    state.currentView=view;$$('.view').forEach(v=>v.classList.remove('active'));$(`#view-${view}`)?.classList.add('active');v29Denied(view);return;
  }
  v29NavigateBase(view);
};

const v29RenderCurrentBase=renderCurrent;
renderCurrent=async function(){
  if(!v29Perm(state.currentView,'view'))return v29Denied(state.currentView);
  if(state.currentView==='roles')return v29RenderRoles();
  if(state.currentView==='users')return v29RenderUsers();
  return v29RenderCurrentBase();
};

// ---------- USERS ----------
async function v29LoadRoles(){
  const {data,error}=await sb.from('roles').select('*').order('name');
  if(error){toast(error.message,'error');return [];}state.roles=data||[];return state.roles;
}
async function v29LoadUsers(){
  const {data,error}=await sb.from('profiles').select('*,roles(id,name,code)').order('created_at',{ascending:false});
  if(error){toast(error.message,'error');return [];}return data||[];
}
async function v29RenderUsers(){
  if(!v29Perm('users','view'))return v29Denied('users');
  const [roles,users]=await Promise.all([v29LoadRoles(),v29LoadUsers()]);
  const el=$('#view-users');
  el.innerHTML=`<div class="section-head"><div><p class="eyebrow">SECURE USER MANAGEMENT</p><h2>Users</h2></div><div class="filter-strip compact"><input id="v29UserSearch" type="search" placeholder="Search user..."><select id="v29UserRoleFilter"><option value="">All roles</option>${roles.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>${v29Perm('users','add')?'<button class="btn btn-primary" id="v29AddUserBtn">Add User</button>':''}</div></div>
  <div class="table-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody id="v29UsersBody"></tbody></table></div></div>`;
  const draw=()=>{
    const q=$('#v29UserSearch').value.toLowerCase().trim(),rf=$('#v29UserRoleFilter').value;
    const filtered=users.filter(u=>`${u.full_name||''} ${u.email||''} ${u.roles?.name||u.role||''}`.toLowerCase().includes(q)&&(!rf||u.role_id===rf));
    $('#v29UsersBody').innerHTML=filtered.length?filtered.map((u,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(u.full_name||'—')}</td><td>${esc(u.email||'—')}</td><td>${esc(u.roles?.name||u.role||'—')}</td><td><span class="badge">${u.is_active?'Active':'Inactive'}</span></td><td>${u.created_at?new Date(u.created_at).toLocaleDateString('en-PH'):'—'}</td><td><div class="row-actions"><button data-user-view="${u.id}">View</button>${v29Perm('users','edit')?`<button data-user-edit="${u.id}">Edit</button>`:''}${v29Perm('users','delete')&&u.id!==state.session.user.id?`<button data-user-disable="${u.id}">${u.is_active?'Disable':'Enable'}</button>`:''}</div></td></tr>`).join(''):'<tr><td colspan="7" class="empty-state">No users found.</td></tr>';
    $$('[data-user-view]').forEach(b=>b.onclick=()=>v29OpenUser(users.find(x=>x.id===b.dataset.userView),false));
    $$('[data-user-edit]').forEach(b=>b.onclick=()=>v29OpenUser(users.find(x=>x.id===b.dataset.userEdit),true));
    $$('[data-user-disable]').forEach(b=>b.onclick=()=>v29ToggleUser(users.find(x=>x.id===b.dataset.userDisable)));
  };
  $('#v29UserSearch').oninput=draw;$('#v29UserRoleFilter').onchange=draw;draw();
  if($('#v29AddUserBtn'))$('#v29AddUserBtn').onclick=()=>v29AddUserModal();
}
function v29RoleOptions(selected=''){return state.roles.map(r=>`<option value="${r.id}" ${selected===r.id?'selected':''}>${esc(r.name)}</option>`).join('');}
function v29AddUserModal(){
  if(!v29Perm('users','add'))return toast('No Add User permission.','error');
  openModal({title:'Add User',eyebrow:'CREATE STAFF ACCOUNT',body:`<form id="v29UserForm" class="modal-form"><label>Full Name<input name="full_name" required></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="8" required></label><label>Role<select name="role_id" required><option value="">Select role...</option>${v29RoleOptions()}</select></label><p class="tiny muted full">The account is created securely through a Supabase Edge Function. The service role key is never stored in this website.</p></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29CreateUserBtn">Create User</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v29CreateUserBtn').onclick=async()=>{
    const d=Object.fromEntries(new FormData($('#v29UserForm')).entries());
    if(!d.full_name||!d.email||!d.password||!d.role_id)return toast('Complete all required fields.','error');
    const {data,error}=await sb.functions.invoke('create-resort-user',{body:d});
    if(error)return toast(error.message||'Unable to create user.','error');
    if(data?.error)return toast(data.error,'error');
    closeModal();await writeAudit('create_user','profiles',data?.user_id||'',`Created user ${d.email}`);toast('User created successfully.');v29RenderUsers();
  };
}
function v29OpenUser(u,edit=false){
  if(!u)return;
  if(!edit){openModal({title:u.full_name||u.email,eyebrow:'USER DETAILS',body:`<div class="modal-form"><label>Email<div>${esc(u.email||'—')}</div></label><label>Role<div>${esc(u.roles?.name||u.role||'—')}</div></label><label>Status<div>${u.is_active?'Active':'Inactive'}</div></label><label>Created<div>${u.created_at?new Date(u.created_at).toLocaleString('en-PH'):'—'}</div></label></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Close</button>${v29Perm('users','edit')?'<button class="btn btn-primary" id="v29EditUserFromView">Edit</button>':''}`});$('[data-modal-cancel]').onclick=closeModal;if($('#v29EditUserFromView'))$('#v29EditUserFromView').onclick=()=>v29OpenUser(u,true);return;}
  if(!v29Perm('users','edit'))return toast('No Edit User permission.','error');
  openModal({title:'Edit User',eyebrow:u.email||'',body:`<form id="v29EditUserForm" class="modal-form"><label>Full Name<input name="full_name" value="${esc(u.full_name||'')}"></label><label>Role<select name="role_id">${v29RoleOptions(u.role_id)}</select></label><label>Status<select name="is_active"><option value="true" ${u.is_active?'selected':''}>Active</option><option value="false" ${!u.is_active?'selected':''}>Inactive</option></select></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29SaveUserBtn">Save Changes</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#v29SaveUserBtn').onclick=async()=>{const d=Object.fromEntries(new FormData($('#v29EditUserForm')).entries());const role=state.roles.find(r=>r.id===d.role_id);const {error}=await sb.from('profiles').update({full_name:d.full_name||null,role_id:d.role_id,is_active:d.is_active==='true',role:role?.code||'staff'}).eq('id',u.id);if(error)return toast(error.message,'error');closeModal();await writeAudit('update_user','profiles',u.id,'User profile/role updated');toast('User updated.');v29RenderUsers();};
}
function v29ToggleUser(u){
  if(!u||!v29Perm('users','delete'))return;
  const next=!u.is_active;
  confirmModal(next?'Enable User':'Disable User',`${next?'Enable':'Disable'} ${u.full_name||u.email}?`,async()=>{const {error}=await sb.from('profiles').update({is_active:next}).eq('id',u.id);if(error)return toast(error.message,'error');closeModal();await writeAudit(next?'enable_user':'disable_user','profiles',u.id,u.email||'');toast(`User ${next?'enabled':'disabled'}.`);v29RenderUsers();},!next);
}

// ---------- ROLES & PERMISSION MATRIX ----------
async function v29RenderRoles(){
  if(!v29Perm('roles','view'))return v29Denied('roles');
  const roles=await v29LoadRoles();
  const {data:rp,error}=await sb.from('role_permissions').select('*');if(error)return toast(error.message,'error');state.rolePermissions=rp||[];
  $('#view-roles').innerHTML=`<div class="section-head"><div><p class="eyebrow">ROLE-BASED ACCESS CONTROL</p><h2>Roles & Access</h2></div>${v29Perm('roles','add')?'<button class="btn btn-primary" id="v29AddRoleBtn">Add Role</button>':''}</div><div class="role-card-grid">${roles.map(r=>{const count=state.rolePermissions.filter(p=>p.role_id===r.id&&p.can_view).length;return `<article class="role-card"><div class="panel-head"><div><h3>${esc(r.name)}</h3><div class="meta">${esc(r.code)} · ${count} pages visible</div></div><span class="badge">${r.is_system?'System':'Custom'}</span></div><p class="muted">${esc(r.description||'No description')}</p><div class="row-actions"><button data-role-access="${r.id}">Access Checklist</button>${v29Perm('roles','edit')?`<button data-role-edit="${r.id}">Edit</button>`:''}${v29Perm('roles','delete')&&!r.is_system?`<button data-role-delete="${r.id}">Delete</button>`:''}</div></article>`}).join('')}</div>`;
  if($('#v29AddRoleBtn'))$('#v29AddRoleBtn').onclick=()=>v29RoleForm();
  $$('[data-role-access]').forEach(b=>b.onclick=()=>v29PermissionMatrix(roles.find(r=>r.id===b.dataset.roleAccess)));
  $$('[data-role-edit]').forEach(b=>b.onclick=()=>v29RoleForm(roles.find(r=>r.id===b.dataset.roleEdit)));
  $$('[data-role-delete]').forEach(b=>b.onclick=()=>v29DeleteRole(roles.find(r=>r.id===b.dataset.roleDelete)));
}
function v29RoleForm(role=null){
  if(role&&!v29Perm('roles','edit'))return;if(!role&&!v29Perm('roles','add'))return;
  openModal({title:role?'Edit Role':'Add Role',eyebrow:'ROLE LIBRARY',body:`<form id="v29RoleForm" class="modal-form"><label>Role Name<input name="name" required value="${esc(role?.name||'')}"></label><label>Role Code<input name="code" required value="${esc(role?.code||'')}" placeholder="example: front_desk"></label><label class="full">Description<textarea name="description" rows="3">${esc(role?.description||'')}</textarea></label></form>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-primary" id="v29SaveRoleBtn">Save Role</button>`});
  $('[data-modal-cancel]').onclick=closeModal;$('#v29SaveRoleBtn').onclick=async()=>{const d=Object.fromEntries(new FormData($('#v29RoleForm')).entries());d.code=String(d.code||'').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'');if(!d.name||!d.code)return toast('Role Name and Code are required.','error');const q=role?sb.from('roles').update(d).eq('id',role.id):sb.from('roles').insert(d).select().single();const {data,error}=await q;if(error)return toast(error.message,'error');closeModal();await writeAudit(role?'update_role':'add_role','roles',role?.id||data?.id||'',d.name);toast('Role saved.');v29RenderRoles();};
}
function v29PermissionMatrix(role){
  const current=state.rolePermissions.filter(p=>p.role_id===role.id);const get=(page,act)=>!!current.find(p=>p.page_key===page)?.[`can_${act}`];
  openModal({title:`${role.name} Access`,eyebrow:'PER-PAGE CHECKLIST',wide:true,body:`<div class="panel"><div class="panel-head"><div><h3>${esc(role.name)}</h3><p class="muted">Check exactly what this role is allowed to do on every page.</p></div></div><div class="bulk-select"><label><input class="permission-check" type="checkbox" id="v29SelectAllView"> View All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllAdd"> Add All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllEdit"> Edit All</label><label><input class="permission-check" type="checkbox" id="v29SelectAllDelete"> Delete All Pages</label><label><input class="permission-check" type="checkbox" id="v29SelectAllDeleteAll"> Grant Delete All</label></div></div><div class="table-scroll"><table class="permission-table"><thead><tr><th>Page</th>${V29_ACTIONS.map(a=>`<th>${v29PermissionLabel(a)}</th>`).join('')}</tr></thead><tbody>${V29_PAGES.map(([page,label])=>`<tr><td><strong>${esc(label)}</strong><br><small class="muted">${esc(page)}</small></td>${V29_ACTIONS.map(a=>`<td><input class="permission-check v29perm" type="checkbox" data-page="${page}" data-action="${a}" ${get(page,a)?'checked':''} ${role.code==='admin'?'disabled':''}></td>`).join('')}</tr>`).join('')}</tbody></table></div>${role.code==='admin'?'<p class="tiny muted">Administrator is permanently granted full access for system recovery and cannot be restricted here.</p>':''}`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button>${v29Perm('roles','edit')&&role.code!=='admin'?'<button class="btn btn-primary" id="v29SavePermsBtn">Save Access</button>':''}`});
  $('[data-modal-cancel]').onclick=closeModal;
  [['#v29SelectAllView','view'],['#v29SelectAllAdd','add'],['#v29SelectAllEdit','edit'],['#v29SelectAllDelete','delete'],['#v29SelectAllDeleteAll','delete_all']].forEach(([sel,act])=>{if($(sel))$(sel).onchange=e=>$$(`.v29perm[data-action="${act}"]`).forEach(c=>{if(!c.disabled)c.checked=e.target.checked;});});
  if($('#v29SavePermsBtn'))$('#v29SavePermsBtn').onclick=async()=>{const rows=V29_PAGES.map(([page])=>{const o={role_id:role.id,page_key:page};V29_ACTIONS.forEach(a=>o[`can_${a}`]=!!$(`.v29perm[data-page="${page}"][data-action="${a}"]`)?.checked);return o;});const {error}=await sb.from('role_permissions').upsert(rows,{onConflict:'role_id,page_key'});if(error)return toast(error.message,'error');closeModal();await writeAudit('update_permissions','role_permissions',role.id,`Updated access for ${role.name}`);toast('Role permissions saved.');if(role.id===state.profile?.role_id)await v29LoadAccess();v29RenderRoles();};
}
function v29DeleteRole(role){
  if(!v29Perm('roles','delete')||role.is_system)return;
  confirmModal('Delete Role',`Delete custom role "${role.name}"? Users assigned to this role must be reassigned first.`,async()=>{const {error}=await sb.from('roles').delete().eq('id',role.id);if(error)return toast(error.message,'error');closeModal();await writeAudit('delete_role','roles',role.id,role.name);toast('Role deleted.');v29RenderRoles();},true);
}

// ---------- PERMISSION-AWARE GENERIC MODULE ACTIONS ----------
const v29RenderModuleBase=renderModule;
renderModule=async function(name){
  if(name==='users')return v29RenderUsers();
  if(!v29Perm(name,'view'))return v29Denied(name);
  await v29RenderModuleBase(name);
  const root=$(`#view-${name}`);if(!root)return;
  const add=root.querySelector(`[data-add-module="${name}"]`);if(add&&!v29Perm(name,'add'))add.remove();
  root.querySelectorAll(`[data-edit-record="${name}"]`).forEach(b=>{if(!v29Perm(name,'edit'))b.remove();});
  root.querySelectorAll(`[data-delete-record="${name}"]`).forEach(b=>{if(!v29Perm(name,'delete'))b.remove();});
  const toolbar=root.querySelector('.table-toolbar');
  if(toolbar&&v29Perm(name,'delete_all')&&!['audit'].includes(name)&&!toolbar.querySelector('[data-v29-delete-all]')){
    const btn=document.createElement('button');btn.className='btn btn-danger';btn.dataset.v29DeleteAll=name;btn.textContent='Delete All';toolbar.appendChild(btn);btn.onclick=()=>v29DeleteAllModule(name);
  }
};

const v29OpenRecordBase=openRecord;
openRecord=async function(name,id,edit=false){
  if(edit && id && !v29Perm(name,'edit'))return toast('No Edit permission for this page.','error');
  if(edit && !id && !v29Perm(name,'add'))return toast('No Add permission for this page.','error');
  if(!edit && !v29Perm(name,'view'))return toast('No View permission for this page.','error');
  return v29OpenRecordBase(name,id,edit);
};
const v29ArchiveRecordBase=archiveRecord;
archiveRecord=function(name,id){if(!v29Perm(name,'delete'))return toast('No Delete permission for this page.','error');return v29ArchiveRecordBase(name,id);};

async function v29DeleteAllModule(name){
  if(!v29Perm(name,'delete_all'))return toast('No Delete All permission.','error');
  const c=moduleConfig(name);if(!c)return;
  openModal({title:`Delete All ${c.title}`,eyebrow:'DANGEROUS ACTION',body:`<div class="danger-zone"><h3>This affects ALL records on this page.</h3><p>For operational/financial history, the system uses archive/void/cancel states where possible rather than permanently removing audit history.</p><label>Type <strong>DELETE ALL</strong> to continue<input id="v29DeleteAllConfirm" autocomplete="off" placeholder="DELETE ALL"></label></div>`,footer:`<button class="btn btn-soft" data-modal-cancel>Cancel</button><button class="btn btn-danger" id="v29ConfirmDeleteAll">Delete All</button>`});
  $('[data-modal-cancel]').onclick=closeModal;
  $('#v29ConfirmDeleteAll').onclick=async()=>{
    if($('#v29DeleteAllConfirm').value.trim()!=='DELETE ALL')return toast('Type DELETE ALL exactly.','error');
    let error=null;
    if(name==='bookings')({error}=await sb.from(c.table).update({status:'cancelled'}).neq('status','cancelled'));
    else if(name==='inventory')({error}=await sb.from(c.table).update({is_active:false,condition:'retired'}).eq('is_active',true));
    else if(['rooms','cottages'].includes(name))({error}=await sb.from(c.table).update({is_active:false,status:'inactive'}).eq('is_active',true));
    else if(name==='users')return toast('Use individual Disable for users. Auth users are intentionally not mass-deleted.','error');
    else if(['payments','invoices','expenses','damages','repairs','billing'].includes(name))return toast('Mass permanent deletion of financial/history records is blocked. Use void/archive workflows instead.','error');
    else ({error}=await sb.from(c.table).delete().not('id','is',null));
    if(error)return toast(error.message,'error');
    closeModal();await writeAudit('delete_all',c.table,'*',`Delete All executed on ${name}`);toast(`${c.title} cleared/archived according to record policy.`);await preload();renderModule(name);
  };
}

// Reapply nav permissions after any later UI changes.
setTimeout(()=>{if(state.session)v29LoadAccess();},250);
