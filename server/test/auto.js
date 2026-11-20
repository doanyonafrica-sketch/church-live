/* Contrôle automatique à la connexion : verdict d'un téléphone comparé au téléphone de référence (mémoire, Android, alimentation, mesures de la première minute) */
const assert=require('assert'),fs=require('fs'),path=require('path');
const {evaluateQuick,staticChecks,REFERENCE}=require('../journal');
const samples=(o,n)=>Array.from({length:n==null?30:n},(_,i)=>({t:i*2000,fps:30,rtt:9,loss:0,res:'1280×720',cfps:30,limit:'none',level:'ok',thermal:0,battery:80,charging:true,freq:5200,link:139,rssi:-60,...(o||{})}));
const UA=v=>'Mozilla/5.0 (Linux; Android '+v+'; moto one zoom Build/QPJ30) Chrome/120';
const ref={ua:UA(10),ram:4,cores:8,battery:80,charging:true,drops:0,step:2};

/* le modèle de référence lui-même est apte */
let r=evaluateQuick(samples(),ref);
assert.strictEqual(r.verdict,'apte','le téléphone de référence est apte');assert.strictEqual(r.title,'Apte au direct');assert(r.scope.includes('téléphone de référence'),'la référence est citée');
assert(r.checks.some(c=>c.key==='ram'&&c.status==='ok')&&r.checks.some(c=>c.key==='plug'&&c.status==='ok'),'contrôles de mémoire et d\'alimentation présents');
assert(!r.checks.some(c=>c.key==='bat'),'la batterie est jugée par le contrôle d\'alimentation');

/* bon téléphone mais non branché : apte sous conditions, avec quoi faire */
r=evaluateQuick(samples({charging:false}),{...ref,charging:false});
assert.strictEqual(r.verdict,'conditions');assert(r.advice.some(a=>/Branchez le téléphone/.test(a)),'conseil de brancher');

/* batterie presque vide et non branché : non apte */
r=evaluateQuick(samples({charging:false,battery:12}),{...ref,charging:false,battery:12});
assert.strictEqual(r.verdict,'non');assert(r.advice[0].includes('tout de suite'));

/* téléphone faible : 2 Go, caméra à 8 images/s, processeur limitant, non branché : non apte, cause = le téléphone */
r=evaluateQuick(samples({fps:8,cfps:8,limit:'cpu',charging:false}),{ua:UA(10),ram:2,cores:8,battery:60,charging:false,drops:0,step:2});
assert.strictEqual(r.verdict,'non');assert.strictEqual(r.cause.kind,'phone','cause : le téléphone');
assert(r.checks.some(c=>c.key==='ram'&&c.status==='warn')&&r.checks.some(c=>c.key==='fps'&&c.status==='fail'));
assert(r.advice.length>=2,'plusieurs actions à faire');

/* 2 Go mais mesures parfaites et branché : apte sous conditions (mémoire juste) */
r=evaluateQuick(samples(),{...ref,ram:2});assert.strictEqual(r.verdict,'conditions');assert(r.advice.some(a=>/Mémoire juste/.test(a)));
/* 1 Go : non apte même avec de bonnes mesures */
r=evaluateQuick(samples(),{...ref,ram:1});assert.strictEqual(r.verdict,'non');
/* ancien Android */
let s=staticChecks({ua:UA(8)});assert.strictEqual(s.find(c=>c.key==='android').status,'fail');
s=staticChecks({ua:UA(9)});assert.strictEqual(s.find(c=>c.key==='android').status,'warn');
/* informations absentes : aucune supposition */
assert.deepStrictEqual(staticChecks({}),[],'sans information, pas de contrôle inventé');

/* connexion qui coupe pendant le contrôle */
r=evaluateQuick(samples({}),{...ref,drops:3});assert.strictEqual(r.verdict,'non');assert(r.checks.some(c=>c.key==='drops'&&c.status==='fail'));
/* trop peu de mesures : pas de verdict sur les mesures, mais un téléphone à 1 Go reste non apte */
r=evaluateQuick(samples({},8),ref);assert.strictEqual(r.verdict,'insuffisant');assert.strictEqual(r.title,'Contrôle trop court');
r=evaluateQuick(samples({},8),{...ref,ram:1});assert.strictEqual(r.verdict,'non');
assert(REFERENCE.text.includes('4 Go'));

/* le test d'aptitude habituel n'est pas modifié (10 s par mesure, 30 premières secondes ignorées) */
const {evaluateDevice}=require('../journal');
const long=Array.from({length:30},(_,i)=>({t:i*10000,fps:30,rtt:9,loss:0,res:'1280×720',cfps:30,limit:'none',level:'ok',thermal:0,battery:80,charging:true,freq:5200,link:139}));
const e=evaluateDevice(long,{drops:0});assert.strictEqual(e.verdict,'apte');assert.strictEqual(e.fig.secs,270,'27 mesures de 10 s après les 30 premières secondes');

/* branchement dans le serveur et dans la fenêtre du PC */
const srv=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),ctl=fs.readFileSync(path.join(__dirname,'../public/control.html'),'utf8');
assert(srv.includes('evaluateQuick')&&srv.includes("jlog('auto-result'")&&srv.includes('clearInterval(autoT)'),'serveur : contrôle automatique branché');
assert(/auto:x\.auto\?/.test(srv),'/info expose le contrôle automatique');
assert(ctl.includes('function autoHtml')&&ctl.includes("notify('TPR Live : '+n+' : '+A.title"),'fenêtre du PC : fiche et notification du verdict');
console.log('OK contrôle automatique à la connexion (verdicts, conseils, référence fixe)');

/* la référence est fixe : elle ne dépend d'aucune salle (« Caméra 1 » ou autre) ; un téléphone faible sur l'emplacement « Caméra 1 » reste jugé faible */
const jr=fs.readFileSync(path.join(__dirname,'../journal.js'),'utf8'),ev=jr.slice(jr.indexOf('function staticChecks'),jr.indexOf('module.exports'));
assert(!/'main'|"main"/.test(ev),'aucune salle n\'entre dans le calcul du verdict');
