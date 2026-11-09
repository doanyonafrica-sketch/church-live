/* Réglages des téléphones depuis le PC : validation, protection (PC seulement), relais vers le bon téléphone, compatibilité anciens APK */
const assert=require('assert'),WebSocket=require('ws'),http=require('http');
const {createServer}=require('../server');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const open=(port,role,room)=>new Promise(r=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');w.q=[];w.on('message',d=>w.q.push(JSON.parse(d)));
  w.on('open',()=>{w.send(JSON.stringify({type:'join',role,room}));r(w)})});
const req=(port,method,path,body,headers={})=>new Promise(res=>{
  const data=body===undefined?null:(typeof body==='string'?body:JSON.stringify(body));
  const q=http.request({host:'127.0.0.1',port,path,method,headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...headers}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{let j=null;try{j=JSON.parse(b)}catch{}res({status:r.statusCode,json:j})})});
  q.on('error',()=>res({status:0}));if(data)q.write(data);q.end()});
const sets=w=>w.q.filter(m=>m.type==='set').map(m=>m.set);
(async()=>{
  const srv=createServer({grace:300,cameras:false});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
  const set=(room,s,h)=>req(port,'POST','/api/phone/'+room+'/set',{set:s},h);

  /* un téléphone récent rapporte ses réglages ; les valeurs étrangères ou fausses sont écartées */
  const p=await open(port,'publisher','camR'),old=await open(port,'publisher','camOld'),other=await open(port,'publisher','camAutre');
  p.send(JSON.stringify({type:'settings',q:1080,prio:'sharp',fluid:'off',codec:'h264',mvol:50,muted:false,torch:false,zoom:1.5,ctorch:true,zmin:1,zmax:8,zstep:.1,hack:'x',q2:5}));
  other.send(JSON.stringify({type:'settings',q:480,prio:'fluid',fluid:'on',codec:'vp8',mvol:20,muted:true}));
  await wait(150);
  const info=await req(port,'GET','/info');const rm=info.json.rooms.find(x=>x.room==='camR');
  assert(rm&&rm.settings&&rm.settings.q===1080&&rm.settings.codec==='h264'&&rm.settings.zmax===8&&rm.settings.ctorch===true,'réglages du téléphone lus par le PC');
  assert(!('hack' in rm.settings)&&!('q2' in rm.settings),'réglages inconnus écartés');
  assert(info.json.rooms.find(x=>x.room==='camOld').settings===null,'ancien téléphone : pas de réglages rapportés');

  /* envoi valide : seul le bon téléphone reçoit, avec uniquement les champs vérifiés */
  let r=await set('camR',{q:720,prio:'fluid',mvol:35,muted:true,torch:true,zoom:2.5,evil:'x'});
  assert(r.status===200&&r.json.ok,'ordre accepté');await wait(100);
  assert.deepStrictEqual(sets(p),[{q:720,prio:'fluid',mvol:35,muted:true,torch:true,zoom:2.5}],'le téléphone reçoit les valeurs vérifiées seulement');
  assert(!sets(other).length&&!sets(old).length,'les autres téléphones ne reçoivent rien');

  /* valeurs invalides refusées */
  for(const bad of [{q:999},{q:'720'},{prio:'x'},{fluid:1},{codec:'av1'},{mvol:150},{mvol:-5},{mvol:12.5},{muted:'oui'},{zoom:-1},{zoom:1e9},{zoom:'3'},{},{evil:1}]){
    r=await set('camR',bad);assert.strictEqual(r.status,400,'refusé : '+JSON.stringify(bad));}
  r=await req(port,'POST','/api/phone/camR/set','{pas du json');assert.strictEqual(r.status,400,'JSON illisible refusé');
  await wait(100);assert.strictEqual(sets(p).length,1,'rien d\'autre n\'est arrivé au téléphone');

  /* cas particuliers */
  r=await set('camOld',{q:720});assert.strictEqual(r.status,409,'ancien téléphone : on dit qu\'il faut le mettre à jour');
  r=await set('inconnue',{q:720});assert.strictEqual(r.status,404,'caméra absente');
  const v=await open(port,'viewer','camSeule');r=await set('camSeule',{q:720});assert.strictEqual(r.status,404,'OBS seul : pas de téléphone');v.close();

  /* protection : réservé au PC lui-même, comme les caméras IP */
  r=await set('camR',{q:480},{Host:'evil.example:'+port});assert.strictEqual(r.status,403,'DNS rebinding refusé');
  r=await set('camR',{q:480},{Origin:'http://evil.example'});assert.strictEqual(r.status,403,'autre site refusé');
  r=await set('camR',{q:480},{'Sec-Fetch-Site':'cross-site'});assert.strictEqual(r.status,403,'requête inter-sites refusée');
  await wait(100);assert.strictEqual(sets(p).length,1,'aucun ordre refusé n\'a atteint le téléphone');

  /* seul le téléphone peut rapporter ses réglages (OBS ne peut pas les falsifier) */
  const ov=await open(port,'viewer','camR');
  ov.send(JSON.stringify({type:'settings',q:480,prio:'fluid'}));await wait(150);
  const i2=await req(port,'GET','/info');assert.strictEqual(i2.json.rooms.find(x=>x.room==='camR').settings.q,1080,'un viewer ne peut pas écrire les réglages');
  ov.close();

  /* le téléphone parti, ses réglages disparaissent (pas de valeurs périmées affichées) */
  p.close();await wait(100);
  const i3=await req(port,'GET','/info');const r3=i3.json.rooms.find(x=>x.room==='camR');
  assert(!r3||r3.settings===null,'réglages effacés après départ du téléphone');
  other.close();old.close();srv.shutdown();
  console.log('OK réglages à distance (validation, protection PC seul, relais, anciens APK)');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
