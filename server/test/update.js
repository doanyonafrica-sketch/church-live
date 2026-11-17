/* Détection de la nouvelle version par la page du téléphone, et affichage d'un échec d'installation (clé de signature différente, etc.).
   Le code de la page est extrait puis exécuté tel quel avec un faux réseau. */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/phone.html'),'utf8'),main=fs.readFileSync(path.join(__dirname,'../../mobile/patch/MainActivity.java'),'utf8');
const a=html.indexOf('let tick=0,dev={},updShown=false,updBusy=false;'),b=html.indexOf("checkUpdate();$('addr').addEventListener('change'");
assert(a>0&&b>a,'repères du code de mise à jour introuvables');
const code=html.slice(a,b);
const SHA1='a'.repeat(64),SHA2='b'.repeat(64);

function make({version,pc,gh,addr='192.168.1.10:3000',native=true}){
  const els={};const mk=id=>els[id]||(els[id]={id,textContent:'',children:[],style:{},href:'',appendChild(c){this.children.push(c);c.parent=this},append(...x){x.forEach(y=>this.children.push(y))},
    removeAttribute(k){delete this[k]},remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)},
    querySelector(sel){return this.children.find(c=>sel==='a'?c.tag==='a':sel==='.uf'?c.className==='uf':false)||null},addEventListener(){},
    value:id==='addr'?addr:'',disabled:false,dataset:{}});
  const log=[],msgs=[],installs=[];
  const ctx={VERSION:version,running:false,$:mk,msg:t=>msgs.push(t),plog:(ev,d)=>log.push([ev,d]),setInterval(){},setTimeout(){return 0},clearTimeout(){},navigator:{},
    document:{createElement:tag=>({tag,children:[],style:{},textContent:'',href:'',className:'',appendChild(c){this.children.push(c);c.parent=this},append(...x){x.forEach(y=>this.children.push(typeof y==='string'?{textContent:y}:y))},
      removeAttribute(k){delete this[k]},remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)},querySelector(){return null}}),createTextNode:t=>({textContent:t})},
    AbortController:class{constructor(){this.signal={}}abort(){}},
    TPRNative:native?{install:(u,s)=>installs.push([u,s]),uninstallSelf(){installs.push('uninstall')}}:undefined,
    fetch:async(u)=>{
      if(u.includes('apk-version.json')){if(!pc)throw new Error('réseau');return{ok:true,json:async()=>pc}}
      if(u.includes('api.github.com')){if(!gh)throw new Error('pas d\'Internet');if(gh.status)return{ok:false,status:gh.status};return{ok:true,json:async()=>({tag_name:'v'+gh.v,body:gh.sha?'sha256: '+gh.sha:'',assets:gh.url===false?[]:[{name:'church-live.apk',browser_download_url:'https://github.com/x/church-live.apk'}]})}}
      throw new Error('url inattendue '+u)}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,els,log,msgs,installs,link:()=>{const u=mk('upd');return u.children.find(c=>c.tag==='a')||null}};
}
const txt=n=>(n.textContent||'')+' '+(n.children||[]).map(txt).join(' ');
const stat=t=>(t.els.updstat||{textContent:''}).textContent;

(async()=>{
  /* 1) le PC propose une version plus récente : bouton d'installation, adresse du PC, empreinte */
  let t=make({version:'1.0.5',pc:{version:'1.0.7',sha256:SHA1},gh:{v:'1.0.7',sha:SHA1}});
  await t.ctx.checkUpdate();let l=t.link();
  assert(l&&/Nouvelle version 1\.0\.7/.test(l.textContent)&&l.href==='http://192.168.1.10:3000/church-live.apk','version du PC proposée');
  l.onclick({preventDefault(){}});assert.deepStrictEqual(t.installs[0],['http://192.168.1.10:3000/church-live.apk',SHA1],'installation demandée au code Android avec l\'empreinte');

  /* 2) le PC propose un fichier différent de la version officielle : refusé */
  t=make({version:'1.0.5',pc:{version:'1.0.7',sha256:SHA1},gh:{v:'1.0.7',sha:SHA2}});await t.ctx.checkUpdate();
  assert(!t.link()&&/refusée/.test(t.msgs.join(' ')),'empreinte différente de GitHub : refus');

  /* 3) le PC n'est pas à jour mais GitHub répond : version GitHub proposée, et on le dit */
  t=make({version:'1.0.5',pc:{version:'1.0.5',sha256:SHA1},gh:{v:'1.0.7',sha:SHA2}});await t.ctx.checkUpdate(true);
  assert(t.link()&&/1\.0\.7/.test(t.link().textContent),'version de GitHub proposée');assert(/PC est encore en version 1\.0\.5/.test(stat(t)),'dit que le PC est en retard');

  /* 4) le PC n'est pas à jour et le téléphone n'a pas Internet : la recherche manuelle explique pourquoi on ne voit rien */
  t=make({version:'1.0.5',pc:{version:'1.0.5',sha256:SHA1},gh:null});await t.ctx.checkUpdate(true);
  assert(!t.link(),'rien à proposer');assert(/Ce téléphone : version 1\.0\.5/.test(stat(t))&&/PC : version 1\.0\.5/.test(stat(t))&&/GitHub : injoignable/.test(stat(t)),'versions et cause affichées : '+stat(t));

  /* 5) GitHub répond « limite atteinte » (Wi-Fi partagé) : message précis, et pas de fausse conclusion « à jour » */
  t=make({version:'1.0.5',pc:null,gh:{status:403}});await t.ctx.checkUpdate(true);
  assert(/limite de requêtes/.test(stat(t))&&!/dernière version/.test(stat(t)),'limite GitHub signalée : '+stat(t));

  /* 6) tout est à jour */
  t=make({version:'1.0.7',pc:{version:'1.0.7',sha256:SHA1},gh:{v:'1.0.7',sha:SHA1}});await t.ctx.checkUpdate(true);
  assert(!t.link()&&/dernière version/.test(stat(t)),'à jour : le dit');

  /* 7) rien ne répond du tout */
  t=make({version:'1.0.5',pc:null,gh:null,addr:''});await t.ctx.checkUpdate(true);
  assert(/adresse du PC non saisie/.test(stat(t))&&/ni le PC ni GitHub/.test(stat(t)),'ni PC ni GitHub : dit qu\'on ne peut pas vérifier : '+stat(t));

  /* 8) version publiée sans fichier ou sans empreinte */
  t=make({version:'1.0.5',pc:null,gh:{v:'1.0.7',sha:'',url:false}});await t.ctx.checkUpdate(true);
  assert(!t.link()&&/introuvable/.test(stat(t)),'sans empreinte : pas de bouton, explication');

  /* 9) version de développement : aucune vérification */
  t=make({version:'dev',pc:{version:'9.9.9',sha256:SHA1},gh:null});await t.ctx.checkUpdate(true);assert(!t.link()&&/développement/.test(stat(t)));

  /* 10) échec d'installation : message d'Android affiché, journalisé ; clé différente = bouton de désinstallation et adresse pour réinstaller */
  t=make({version:'1.0.5',pc:{version:'1.0.7',sha256:SHA1},gh:null});await t.ctx.checkUpdate();
  t.ctx.onTprUpdateFailed('Cette version est signée avec une autre clé.','signature');
  assert(/Échec de la mise à jour/.test(t.link().textContent),'le bouton propose de réessayer');
  const card=t.els.upd.children.find(c=>c.className==='uf');assert(card,'carte d\'explication affichée');
  const btn=card.children.find(c=>c.tag==='button'),addr=txt(card);
  assert(btn&&/Désinstaller/.test(btn.textContent)&&addr.includes('http://192.168.1.10:3000/church-live.apk'),'bouton de désinstallation et adresse du fichier');
  btn.onclick();assert.strictEqual(t.installs[0],'uninstall','le bouton appelle la désinstallation');
  assert(t.log.some(x=>x[0]==='update-failed'&&x[1].kind==='signature'),'échec noté dans le journal envoyé au PC');
  t.ctx.onTprUpdateFailed('Installation annulée.','aborted');assert.strictEqual(t.els.upd.children.filter(c=>c.className==='uf').length,1,'une seule carte à la fois');
  assert(!txt(t.els.upd.children.find(c=>c.className==='uf')).includes('Désinstaller'),'pas de bouton de désinstallation pour une simple annulation');

  /* 11) code Android : installation par PackageInstaller, contrôle de la clé et de la version AVANT, vraie raison d'un échec */
  for(const k of['PackageInstaller.SessionParams','getPackageArchiveInfo','getApkContentsSigners','STATUS_PENDING_USER_ACTION','EXTRA_STATUS_MESSAGE','abandonSession','canRequestPackageInstalls','uninstallSelf','scanWifi','appInfo'])
    assert(main.includes(k),'MainActivity.java doit contenir '+k);
  assert(/checkApk\(apk\)[\s\S]*installViaSession\(apk\)/.test(main),'le contrôle précède l\'installation');
  assert(/catch \(Throwable t\) \{\s*installViaView\(apk\)/.test(main),'secours : ancienne méthode si la session est refusée');
  console.log('OK mise à jour (détection, diagnostic, échec d\'installation, code Android)');process.exit(0);
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
