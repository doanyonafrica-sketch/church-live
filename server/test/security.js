/* Protection contre les pages malveillantes : origine, DNS rebinding, requêtes inter-sites */
const assert=require('assert'),WebSocket=require('ws'),http=require('http'),os=require('os'),fs=require('fs'),path=require('path');
const {createServer}=require('../server');
const {originOk,hostOk}=require('../security');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ws=(port,opt)=>new Promise(res=>{const w=new WebSocket('ws://127.0.0.1:'+port+'/ws',opt);
  w.on('open',()=>{w.close();res('open')});w.on('error',()=>res('refused'));w.on('unexpected-response',()=>res('refused'))});
const get=(port,p,headers)=>new Promise(res=>http.get({host:'127.0.0.1',port,path:p,headers},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res({status:r.statusCode,body:b}))}));
(async()=>{
  /* fonctions pures */
  assert(originOk(undefined,'a:1',true),'sans Origin : accepté');
  assert(originOk('http://a:1','a:1',true),'même hôte : accepté');
  assert(!originOk('http://evil.example','a:1',true),'autre site : refusé');
  assert(!originOk('null','a:1',false),'origine « null » : refusée');
  assert(originOk('http://localhost','192.168.1.5:3000',false),'application Android (distante) : acceptée');
  assert(!originOk('http://localhost','127.0.0.1:3000',true),'http://localhost sans port ne vaut pas sur le PC');
  assert(hostOk('localhost:3000')&&hostOk('127.0.0.1:3000')&&hostOk('[::1]:3000'),'hôtes locaux acceptés');
  assert(!hostOk('evil.example:3000'),'nom de domaine refusé (rebinding)');

  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tpr-'));
  const srv=createServer({grace:300,pin:'123456',dataDir:dir});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
  /* WebSocket */
  assert.strictEqual(await ws(port),'open','WebSocket sans Origin accepté');
  assert.strictEqual(await ws(port,{origin:'http://127.0.0.1:'+port}),'open','même origine acceptée');
  assert.strictEqual(await ws(port,{origin:'http://evil.example'}),'refused','page d\'un autre site refusée');
  assert.strictEqual(await ws(port,{headers:{Host:'evil.example:'+port}}),'refused','DNS rebinding refusé');
  /* API caméras */
  assert.strictEqual((await get(port,'/api/cameras')).status,200,'API locale normale');
  assert.strictEqual((await get(port,'/api/cameras',{Host:'evil.example:'+port})).status,403,'API : rebinding refusé');
  assert.strictEqual((await get(port,'/api/cameras',{Origin:'http://evil.example'})).status,403,'API : autre origine refusée');
  assert.strictEqual((await get(port,'/api/cameras',{'Sec-Fetch-Site':'cross-site'})).status,403,'API : requête inter-sites refusée');
  assert.strictEqual((await get(port,'/api/cameras',{'Sec-Fetch-Site':'same-origin'})).status,200,'API : même origine acceptée');
  /* le code d'appairage n'est pas divulgué à une page qui usurpe le PC */
  assert.strictEqual(JSON.parse((await get(port,'/info')).body).pin,'123456','le PC voit le code');
  assert.strictEqual(JSON.parse((await get(port,'/info',{Host:'evil.example:'+port})).body).pin,true,'le code est caché en cas de rebinding');
  /* anti-inondation : un appareil qui envoie des centaines de messages par seconde est coupé */
  const fl=new WebSocket('ws://127.0.0.1:'+port+'/ws');await new Promise(r=>fl.on('open',r));
  const closed=new Promise(r=>fl.on('close',r));for(let i=0;i<400;i++)fl.send('{"type":"ping"}');
  await Promise.race([closed,wait(2000).then(()=>{throw new Error('inondation non coupée')})]);
  /* au plus 16 caméras (salles) simultanées */
  const socks=[];for(let i=0;i<16;i++){const w=new WebSocket('ws://127.0.0.1:'+port+'/ws');await new Promise(r=>w.on('open',r));w.send(JSON.stringify({type:'join',role:'publisher',room:'r'+i,id:'p'+i}));socks.push(w)}
  await wait(200);
  const extra=new WebSocket('ws://127.0.0.1:'+port+'/ws');await new Promise(r=>extra.on('open',r));
  const ec=new Promise(r=>extra.on('close',c=>r(c)));extra.send(JSON.stringify({type:'join',role:'publisher',room:'r-de-trop',id:'px'}));
  assert.strictEqual(await Promise.race([ec,wait(2000).then(()=>0)]),1013,'17e caméra refusée');
  socks.forEach(w=>w.close());
  srv.shutdown();await wait(50);
  console.log('OK sécurité (origine, rebinding, inter-sites)');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
