/* Onglet « Caméras PTZ » de la fenêtre TPR Live : liste, image en direct, orientation, positions mémorisées */
(()=>{
const $=id=>document.getElementById(id),A='/api/cameras';
const store={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}};
async function api(method,url,body){
  const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  let d={};try{d=await r.json()}catch{}
  if(!r.ok)throw new Error(d.error||('Erreur '+r.status));return d}
const el=(t,p,txt)=>{const e=document.createElement(t);if(p)Object.assign(e,p);if(txt!=null)e.textContent=txt;return e};
const badge=(t,c)=>{const b=$('cm-st');b.textContent=t;b.className='badge '+(c||'')};

let cams=[],cur=null,speed=+(store.get('ptz-speed')||.5),ptzOk=true,tab='live',active=false;

/* ── Onglets ── */
function show(t){
  tab=t;
  for(const b of document.querySelectorAll('.tabs button'))b.setAttribute('aria-selected',b.dataset.tab===t);
  $('live').hidden=t!=='live';$('cam').hidden=t!=='cam';
  if(t==='cam'){load()}else{halt();stopImg()}
}
document.querySelector('.tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(b)show(b.dataset.tab)});

/* ── Liste des caméras ── */
async function load(){
  try{cams=await api('GET',A)}catch(e){cams=[]}
  const l=$('cm-list');l.textContent='';
  for(const c of cams){const b=el('button',{type:'button'},c.name);b.setAttribute('aria-pressed',c.id===(cur&&cur.id));b.onclick=()=>select(c.id);l.append(b)}
  $('cm-empty').hidden=cams.length>0;$('cm-main').hidden=!cams.length;
  if(!cams.length){cur=null;stopImg();return}
  const want=cams.find(c=>c.id===(cur&&cur.id))||cams.find(c=>c.id===store.get('ptz-cam'))||cams[0];
  select(want.id)
}
function select(id){
  const c=cams.find(x=>x.id===id);if(!c)return;
  const same=cur&&cur.id===id;cur=c;store.set('ptz-cam',id);
  for(const b of $('cm-list').children)b.setAttribute('aria-pressed',b.textContent===c.name);
  halt();if(!same||!active){start()}
  loadInfo();loadPresets();
}

/* ── Image en direct ── */
function start(){
  if(!cur||tab!=='cam')return;
  const img=$('cm-img'),msg=$('cm-msg');
  msg.hidden=false;msg.className='msg';msg.textContent='Connexion à la caméra…';badge('Connexion…','warn');
  active=true;const id=cur.id;
  img.onload=()=>{if(cur&&cur.id===id){msg.hidden=true;badge('En direct','ok')}};
  img.onerror=async()=>{
    if(!active||!cur||cur.id!==id)return;
    active=false;badge('Pas d\'image','bad');msg.hidden=false;msg.className='msg err';
    let why='L\'image n\'arrive pas.';
    try{await api('GET',A+'/'+id+'/info');
      const e=await api('GET',A+'/'+id+'/stream-error');
      why='La caméra répond, mais l\'image vidéo n\'arrive pas.'+(e.error?' ('+e.error.split('\n').pop()+')':'')+' Essayez d\'indiquer l\'adresse RTSP dans les Réglages.'}
    catch(e){why=e.message}
    msg.textContent=why};
  img.src=A+'/'+id+'/stream.mjpg?'+Date.now();
}
function stopImg(){active=false;const i=$('cm-img');i.onload=i.onerror=null;i.removeAttribute('src')}
$('cm-reload').onclick=()=>{stopImg();start()};
document.addEventListener('visibilitychange',()=>{if(document.hidden){halt();stopImg()}else if(tab==='cam'){start()}});

/* ── Informations, adresse OBS ── */
async function loadInfo(){
  const id=cur.id,obs=$('cm-obs');obs.textContent='';$('cm-info').textContent='';
  ptzOk=true;setPtz(true);
  try{const d=await api('GET',A+'/'+id+'/info');if(!cur||cur.id!==id)return;
    const i=d.info||{};$('cm-info').textContent=[i.manufacturer,i.model,d.resolution&&d.resolution!=='0×0'?d.resolution:''].filter(Boolean).join(' · ');
    ptzOk=!!d.ptz;setPtz(ptzOk);
    if(!ptzOk)$('cm-info').textContent+=(($('cm-info').textContent?' — ':'')+'Cette caméra ne propose pas la rotation par ONVIF : seule l\'image est disponible.');
    for(const [nm,u] of [['Qualité maximale',d.rtspMain],['Qualité réduite (moins de réseau)',d.rtspSub]]){
      if(!u||(nm.startsWith('Qualité réduite')&&u===d.rtspMain))continue;
      const row=el('div',{className:'addr'});row.append(el('span',{className:'nm'},nm),el('code',{},u),el('button',{type:'button'},'Copier'));row.lastChild.dataset.t=u;obs.append(row)}
  }catch(e){if(cur&&cur.id===id){$('cm-info').textContent=e.message;ptzOk=false;setPtz(false)}}
}
function setPtz(on){for(const b of document.querySelectorAll('#pad button,.zoom button,#cm-psave,#cm-pname'))b.disabled=!on;$('cm-ptz').style.opacity=$('cm-pre').style.opacity=on?'':.55}

/* ── Orientation : un ordre « stop » part toujours, dans l'ordre, à la fin de l'appui ── */
let moving=null,chain=Promise.resolve(),cmdErr='';
const ptz=(b)=>{const id=cur&&cur.id;if(!id)return Promise.resolve();
  chain=chain.then(()=>api('POST',A+'/'+id+'/ptz',b)).catch(e=>{cmdErr=e.message;if(tab==='cam')$('cm-info').textContent='Commande refusée : '+e.message});return chain};
function go(d,btn){
  if(!ptzOk||!cur)return;halt();const [x,y,z]=d.split(',').map(Number);
  btn&&btn.classList.add('on');
  const send=()=>ptz({action:'move',x:x*speed,y:y*speed,z:z});
  send();moving={t:setInterval(send,700),btn};
}
function halt(){if(!moving)return;clearInterval(moving.t);moving.btn&&moving.btn.classList.remove('on');moving=null;ptz({action:'stop'})}
for(const b of document.querySelectorAll('#pad button[data-d],.zoom button[data-d]')){
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);go(b.dataset.d,b)});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(ev,halt);
}
window.addEventListener('blur',halt);
$('cm-home').onclick=()=>{halt();ptz({action:'home'})};
/* Clavier */
const KEYS={ArrowUp:'0,1,0',ArrowDown:'0,-1,0',ArrowLeft:'-1,0,0',ArrowRight:'1,0,0','+':'0,0,1','=':'0,0,1','-':'0,0,-1','_':'0,0,-1'};
let keyHeld=null;
document.addEventListener('keydown',e=>{
  if(tab!=='cam'||$('cm-form').open||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))return;
  const d=KEYS[e.key];if(!d)return;e.preventDefault();keyHeld=e.key;
  go(d,document.querySelector('[data-d="'+d+'"]'))});
document.addEventListener('keyup',e=>{if(e.key===keyHeld){keyHeld=null;halt()}});
/* Vitesse */
function paintSpeed(){for(const b of $('cm-speed').children)b.setAttribute('aria-pressed',+b.dataset.s===speed)}
$('cm-speed').onclick=e=>{const b=e.target.closest('button');if(!b)return;speed=+b.dataset.s;store.set('ptz-speed',speed);paintSpeed()};
if(![.2,.5,1].includes(speed))speed=.5;paintSpeed();

/* ── Positions mémorisées ── */
async function loadPresets(){
  const id=cur.id,box=$('cm-pres');box.textContent='';
  try{const d=await api('POST',A+'/'+id+'/ptz',{action:'presets'});if(!cur||cur.id!==id)return;drawPresets(d.presets)}
  catch(e){box.append(el('span',{className:'hint'},'Positions indisponibles.'))}
}
function drawPresets(list){
  const box=$('cm-pres');box.textContent='';
  if(!list.length)box.append(el('span',{className:'hint',style:'margin:0'},'Aucune position mémorisée.'));
  for(const p of list){
    const w=el('div'),g=el('button',{type:'button',className:'g',title:p.name},p.name),x=el('button',{type:'button',className:'x',title:'Supprimer cette position'},'×');
    g.onclick=()=>{halt();ptz({action:'goto',token:p.token})};
    x.onclick=async()=>{if(!confirm('Supprimer la position « '+p.name+' » ?'))return;try{drawPresets((await api('POST',A+'/'+cur.id+'/ptz',{action:'remove',token:p.token})).presets)}catch(e){alert(e.message)}};
    w.append(g,x);box.append(w)}
}
$('cm-psave').onclick=async()=>{
  const name=$('cm-pname').value.trim();if(!name){$('cm-pname').focus();return}
  halt();const b=$('cm-psave');b.disabled=true;
  try{await chain;drawPresets((await api('POST',A+'/'+cur.id+'/ptz',{action:'save',name})).presets);$('cm-pname').value=''}
  catch(e){alert('Impossible de mémoriser la position : '+e.message)}
  b.disabled=!ptzOk};
$('cm-pname').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('cm-psave').click()}});

/* ── Formulaire d'ajout / de modification ── */
const dlg=$('cm-form');let editing=null;
const res=(t,c)=>{const r=$('f-res');r.hidden=!t;r.textContent=t||'';r.className='res '+(c||'')};
function openForm(c){
  editing=c||null;res('');$('cm-ft').textContent=c?'Réglages de la caméra':'Ajouter une caméra';
  $('f-name').value=c?c.name:'';$('f-host').value=c?c.host:'';$('f-port').value=c?c.port:80;$('f-user').value=c?c.user:'';
  $('f-pass').value='';$('f-pass').placeholder=c&&c.hasPass?'(inchangé)':'';$('f-rtsp').value=c?c.rtsp:'';
  $('f-del').hidden=!c;dlg.showModal();$('f-host').focus();
}
const body=()=>({name:$('f-name').value,host:$('f-host').value.trim(),port:+$('f-port').value||80,user:$('f-user').value,pass:$('f-pass').value,rtsp:$('f-rtsp').value.trim()});
$('cm-add').onclick=()=>openForm();
$('cm-edit').onclick=()=>cur&&openForm(cur);
$('f-cancel').onclick=()=>dlg.close();
$('f-test').onclick=async()=>{
  const b=$('f-test');b.disabled=true;res('Recherche de la caméra…');
  try{const d=await api('POST',A+'/probe',{...body(),id:editing&&editing.id,autoport:true});
    if(d.port!==(+$('f-port').value||80)){$('f-port').value=d.port}
    const i=d.info||{};
    res('Connexion réussie'+(i.model?' : '+[i.manufacturer,i.model].filter(Boolean).join(' '):'')+' ('+d.resolution+(d.ptz?', rotation PTZ disponible':', sans rotation PTZ')+').','ok')}
  catch(e){res(e.message+(/refusé|introuvable|délai|Connexion/.test(e.message)?'':' Vérifiez l\'adresse, le port et l\'identifiant.'),'bad')}
  b.disabled=false};
$('cm-f').onsubmit=async e=>{
  e.preventDefault();const b=$('f-ok');b.disabled=true;
  try{const d=editing?await api('PUT',A+'/'+editing.id,body()):await api('POST',A,body());
    store.set('ptz-cam',d.camera.id);dlg.close();cur=null;await load()}
  catch(err){res(err.message,'bad')}
  b.disabled=false};
$('f-del').onclick=async()=>{
  if(!editing||!confirm('Supprimer la caméra « '+editing.name+' » de TPR Live ?'))return;
  try{await api('DELETE',A+'/'+editing.id);dlg.close();cur=null;stopImg();await load()}catch(err){res(err.message,'bad')}};
})();
