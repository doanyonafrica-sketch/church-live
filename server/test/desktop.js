/* Programme Windows (desktop/main.js) testé avec un faux « electron » : confirmation de fermeture, anti-veille, journal d'erreurs,
   chiffrement des mots de passe de caméras, mises à jour jamais pendant un direct. */
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),net=require('net'),WebSocket=require('ws');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer().listen(0,()=>{const p=s.address().port;s.close(()=>r(p))})});
const get=(port,p)=>new Promise((res,rej)=>http.get({host:'127.0.0.1',port,path:p},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)))}).on('error',rej));
const post=(port,p,body)=>new Promise((res,rej)=>{const d=JSON.stringify(body),q=http.request({host:'127.0.0.1',port,path:p,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>res(JSON.parse(b)))});q.on('error',rej);q.end(d)});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'tpr-desk-')),data=path.join(tmp,'data'),app_=path.join(tmp,'app');
fs.mkdirSync(data);for(const m of ['electron','electron-updater'])fs.mkdirSync(path.join(app_,'node_modules',m),{recursive:true});
fs.copyFileSync(path.join(__dirname,'../../desktop/main.js'),path.join(app_,'main.js'));
fs.symlinkSync(path.join(__dirname,'..'),path.join(app_,'server'),'dir');
fs.writeFileSync(path.join(app_,'node_modules/electron/index.js'),`
const EE=require('events');
const g=global.__T=global.__T||{dialogs:[],answer:1,psb:0,lock:true,quit:0,focus:0,updater:{checks:0,downloads:0,available:false}};
const app=Object.assign(new EE(),{isPackaged:true,getPath:()=>process.env.TPR_TEST_DATA,requestSingleInstanceLock:()=>g.lock,whenReady:()=>Promise.resolve(),quit(){g.quit++}});
class BW extends EE{constructor(){super();g.win=this}loadURL(u){g.url=u}isDestroyed(){return false}focus(){g.focus++}isMinimized(){return false}}
module.exports={app,BrowserWindow:BW,Menu:{setApplicationMenu(){}},powerSaveBlocker:{start(t){g.psb++;g.psbType=t}},
 dialog:{showMessageBoxSync(w,o){g.dialogs.push(o);return g.answer},showMessageBox:async()=>({response:1}),showErrorBox(){}},
 safeStorage:{isEncryptionAvailable:()=>true,encryptString:t=>Buffer.from('CHIFFRE:'+t),decryptString:b=>b.toString().replace('CHIFFRE:','')}};`);
fs.writeFileSync(path.join(app_,'node_modules/electron-updater/index.js'),`
const EE=require('events');const g=global.__T;
const u=Object.assign(new EE(),{autoDownload:true,checkForUpdates:async()=>{g.updater.checks++;if(g.updater.available)u.emit('update-available',{version:'9.9.9'})},downloadUpdate:async()=>{g.updater.downloads++;setImmediate(()=>u.emit('error',new Error('fin simulée')))},quitAndInstall(){}});
module.exports={autoUpdater:u};`);
(async()=>{
  const port=await freePort();process.env.TPR_PORT=String(port);process.env.TPR_TEST_DATA=data;
  global.__T={dialogs:[],answer:1,psb:0,lock:true,quit:0,focus:0,updater:{checks:0,downloads:0,available:true}};
  /* on capture les minuteries du programme pour les déclencher à la main */
  const timers=[],realSet=global.setInterval;global.setInterval=(f,ms,...a)=>{timers.push({f,ms});return realSet(f,ms,...a)};
  require(path.join(app_,'main.js'));await wait(700);global.setInterval=realSet;
  const T=global.__T;
  assert(T.win,'fenêtre créée');assert.strictEqual(T.url,'http://localhost:'+port+'/control.html');
  assert.strictEqual(T.psb,1,'anti-veille activé');assert.strictEqual(T.psbType,'prevent-app-suspension');
  const upd=require(path.join(app_,'node_modules/electron-updater')).autoUpdater;
  assert.strictEqual(upd.autoDownload,false,'téléchargement automatique désactivé');
  assert.strictEqual(T.updater.downloads,1,'aucun direct : la mise à jour se télécharge');
  const app=require(path.join(app_,'node_modules/electron')).app;
  /* fermeture : sans direct, aucune question */
  let ev={prevented:false,preventDefault(){this.prevented=true}};T.win.emit('close',ev);
  assert.strictEqual(T.dialogs.length,0,'pas de question sans direct');assert(!ev.prevented);
  /* un téléphone en direct */
  const ws=new WebSocket('ws://127.0.0.1:'+port+'/ws');await new Promise(r=>ws.on('open',r));
  ws.send(JSON.stringify({type:'join',role:'publisher',room:'main',id:'t1'}));await wait(200);
  assert.strictEqual((await get(port,'/info')).publishers,1);
  T.answer=0;ev={prevented:false,preventDefault(){this.prevented=true}};T.win.emit('close',ev);
  assert.strictEqual(T.dialogs.length,1,'confirmation demandée pendant un direct');assert(/en direct/.test(T.dialogs[0].message));assert(ev.prevented,'« Continuer le direct » empêche la fermeture');
  T.answer=1;ev={prevented:false,preventDefault(){this.prevented=true}};T.win.emit('close',ev);assert(!ev.prevented,'« Quitter quand même » laisse fermer');
  /* mise à jour : rien ne se télécharge pendant un direct */
  T.updater.downloads=0;const before=T.updater.checks;
  upd.emit('update-available',{version:'9.9.9'});assert.strictEqual(T.updater.downloads,0,'pas de téléchargement pendant un direct');
  const chk=timers.find(t=>t.ms===30*60*1000);assert(chk,'vérification périodique présente');chk.f();await wait(50);
  assert.strictEqual(T.updater.downloads,0,'toujours rien tant que le direct dure');assert.strictEqual(T.updater.checks,before,'pas de vérification pendant un direct');
  ws.close();await wait(200);chk.f();await wait(50);
  assert.strictEqual(T.updater.downloads,1,'le téléchargement reprend dès la fin du direct');
  /* instance unique */
  app.emit('second-instance');assert.strictEqual(T.focus,1,'relancer ramène la fenêtre');
  /* journal d'erreurs : une erreur inattendue est notée, sans couper le programme */
  process.emit('uncaughtException',new Error('boum-test'));await wait(50);
  assert(/boum-test/.test(fs.readFileSync(path.join(data,'tpr-live.log'),'utf8')),'erreur écrite dans le journal');
  /* mots de passe des caméras chiffrés */
  const r=await post(port,'/api/cameras',{name:'Dôme',host:'127.0.0.1',port:9,user:'admin',pass:'motdepasse-secret'});assert(r.ok,JSON.stringify(r));
  const raw=fs.readFileSync(path.join(data,'cameras.json'),'utf8');
  assert(!raw.includes('motdepasse-secret'),'mot de passe absent du fichier');assert(raw.includes('"pass": "enc:'),'mot de passe chiffré');
  const {store}=require('../camera');const cipher={enc:t=>Buffer.from('CHIFFRE:'+t).toString('base64'),dec:b=>Buffer.from(b,'base64').toString().replace('CHIFFRE:','')};
  assert.strictEqual(store(data,cipher).list()[0].pass,'motdepasse-secret','relecture : mot de passe retrouvé');
  assert.strictEqual(store(data,null).list()[0].pass,'','sans la clé : mot de passe vide (jamais le texte chiffré)');
  console.log('OK programme Windows (fermeture, anti-veille, mises à jour, journal, chiffrement)');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
