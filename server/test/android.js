/* Cohérence entre la page téléphone, le code Android (mobile/patch) et le workflow de publication.
   Ces fichiers ne sont compilés que par GitHub : ce test empêche qu'un oubli ne s'y découvre qu'au moment de publier. */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'../..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const phone=read('server/public/phone.html'),main=read('mobile/patch/MainActivity.java'),svc=read('mobile/patch/LiveService.java'),rel=read('.github/workflows/release.yml');

/* 1) toute méthode TPRNative appelée par la page existe côté Android avec @JavascriptInterface (sinon : appel qui échoue en silence) */
const used=new Set([...phone.matchAll(/TPRNative\.(\w+)/g)].map(m=>m[1]));
const exposed=new Set([...main.matchAll(/@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(/g)].map(m=>m[1]));
assert(used.size>=4,'méthodes TPRNative repérées dans la page : '+[...used]);
for(const m of used)assert(exposed.has(m),'TPRNative.'+m+' est appelée par la page mais absente de MainActivity.java');

/* 2) service « direct en cours » : démarré une fois la caméra ouverte, arrêté à la fin, sans jamais gêner le direct */
assert(phone.indexOf('await cam();running=true;keepAlive(true)')>0,'le service démarre après l\'ouverture de la caméra');
assert(phone.includes('if(running){keepAlive(false);'),'le service s\'arrête à la fin du direct');
const helper=/const keepAlive=on=>\{[^\n]*\};/.exec(phone);assert(helper,'fonction keepAlive de la page');
const run=(g)=>{const calls=[];const ctx={calls,...g(calls)};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(helper[0]+';keepAlive(true);keepAlive(false)',ctx);return calls};
assert.deepStrictEqual(run(c=>({TPRNative:{keepAlive:on=>c.push(on)}})),[true,false],'appelé avec true puis false');
assert.doesNotThrow(()=>run(()=>({})),'navigateur sans application : aucune erreur');
assert.doesNotThrow(()=>run(()=>({TPRNative:{status(){}}})),'ancien APK sans keepAlive : aucune erreur');
assert.doesNotThrow(()=>run(()=>({TPRNative:{keepAlive(){throw new Error('refus Android')}}})),'Android refuse : le direct continue');
assert(/class LiveService extends Service/.test(svc)&&/package africa\.doanyon\.churchlive;/.test(svc));
assert(/try\s*\{[\s\S]*startForeground[\s\S]*\}\s*catch\s*\(Throwable[\s\S]*stopSelf\(\)/.test(svc),'échec de startForeground : le service s\'arrête sans planter');
assert(/FOREGROUND_SERVICE_TYPE_CAMERA\s*\|\s*ServiceInfo\.FOREGROUND_SERVICE_TYPE_MICROPHONE/.test(svc),'types caméra + micro');
assert(/stopService\(new Intent\(this, LiveService\.class\)\)/.test(main),'MainActivity arrête le service en se fermant');

/* 3) workflow : le service et ses permissions sont ajoutés au manifeste, l'APK est de type release, signé, et contrôlé */
assert(rel.includes('cp patch/LiveService.java'),'LiveService.java copié dans le projet Android');
assert(/<service android:name="\.LiveService"[^>]*android:foregroundServiceType="camera\|microphone"/.test(rel),'service déclaré dans le manifeste');
for(const p of['FOREGROUND_SERVICE','FOREGROUND_SERVICE_CAMERA','FOREGROUND_SERVICE_MICROPHONE','POST_NOTIFICATIONS','CAMERA','RECORD_AUDIO'])
  assert(rel.includes('android.permission.'+p+'"'),'permission '+p+' déclarée');
assert(rel.includes('assembleRelease')&&!rel.includes('assembleDebug'),'APK de type release');
assert(rel.includes('apksigner')&&rel.includes('zipalign'),'APK aligné puis signé');
assert(rel.includes('application-debuggable'),'contrôle : l\'APK ne doit pas être débogable');
assert(rel.includes('ANDROID_KEYSTORE_B64'),'clé de signature privée');
console.log('OK Android (appels de la page, service direct en cours, workflow de publication)');
