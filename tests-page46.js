const https=require('https'),crypto=require('crypto'),{EventEmitter}=require('events');
const EL=require((process.env.JARVIS_DIR||'.')+'/jarvis-elevation.js'),AG=require((process.env.JARVIS_DIR||'.')+'/jarvis-agenda.js');
const b64u=EL.b64u,sha=b=>crypto.createHash('sha256').update(b).digest();
const CLE='cle-de-test-longue-et-aleatoire-page46',DEMAIN=AG.periodeDe('demain',Date.now(),'Europe/Paris').cle.slice(0,10);
const {privateKey:kF,publicKey:pF}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});const idF=crypto.randomBytes(32),jF=pF.export({format:'jwk'});
const {privateKey:kR}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const plans=[],evts=new Map(),appelsG=[];
https.request=(a,b,c)=>{
  if(typeof a==='string'){const q=new EventEmitter();let corps=null;q.write=x=>{corps=(corps||'')+x};q.destroy=()=>{};
    q.end=()=>setImmediate(()=>{const u=new URL(a);appelsG.push({m:b.method,u:a});let st=200,j={};
      if(u.hostname==='oauth2.googleapis.com')j={access_token:'tok',expires_in:3600};
      else{const id=(/\/events\/([^/?]+)/.exec(u.pathname)||[])[1];
        if(b.method==='POST'){const e=JSON.parse(corps);evts.set(e.id,{...e,status:'confirmed'});j=evts.get(e.id);}
        else if(b.method==='GET'){const e=evts.get(id);if(!e)st=404;else j=e;}
        else if(b.method==='DELETE'){const e=evts.get(id);if(e)e.status='cancelled';st=204;j=null;}}
      const r=new EventEmitter();r.statusCode=st;c(r);if(j)r.emit('data',Buffer.from(JSON.stringify(j)));r.emit('end');r.emit('close');});return q;}
  const q=new EventEmitter();let s='';q.write=x=>s+=x;q.end=()=>{const o=JSON.parse(s);const r=new EventEmitter();r.statusCode=200;b(r);
    const t=o.max_tokens===200?JSON.stringify(plans.shift()||{action:'AUCUNE'}):'Réponse.';r.emit('data',JSON.stringify({content:[{type:'text',text:t}]}));r.emit('end');};
  q.setTimeout=()=>q;q.destroy=()=>{};return q;};
Object.assign(process.env,{ANTHROPIC_API_KEY:'t',PORT:'3957',JARVIS_CLE_ACCES:CLE,JARVIS_GOOGLE_COMPTE:JSON.stringify({type:'service_account',client_email:'j@x.iam.gserviceaccount.com',private_key:kR.export({type:'pkcs8',format:'pem'})}),
  JARVIS_AGENDA_JARVIS:'c_x@group.calendar.google.com',JARVIS_PASSKEYS:b64u(JSON.stringify({id:b64u(idF),x:jF.x,y:jF.y})),JARVIS_CODE_SECOURS:'246810135790'});
const L=console.log;console.log=()=>{};console.error=()=>{};require((process.env.JARVIS_DIR||'.')+'/server.js');
const {JSDOM,VirtualConsole}=require(process.env.JSDOM||'jsdom');const B='http://localhost:3957';const dort=ms=>new Promise(r=>setTimeout(r,ms));
const R=[];const ok=(id,c,nom,info)=>R.push((c?'OK    ':'ECHEC ')+id+' '+nom+(info?'  ['+info+']':''));
(async()=>{await dort(400);
 const html=await fetch(B+'/').then(r=>r.text());const vc=new VirtualConsole();const err=[];vc.on('jsdomError',e=>err.push(e.message));
 const corps=[];let rec=null,creeAppels=0;
 const dom=new JSDOM(html,{url:B+'/',runScripts:'dangerously',virtualConsole:vc,pretendToBeVisual:true,beforeParse(w){
   w.localStorage.setItem('jarvis_cle',CLE);
   w.fetch=(u,o)=>{if(o&&o.body)corps.push({u:String(u),b:JSON.parse(o.body)});return fetch(new URL(u,B+'/').href,o);};
   w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
   w.webkitSpeechRecognition=class{start(){rec=this;}stop(){this.onend&&this.onend();}};
   w.PublicKeyCredential=function(){};
   const ab=b=>{const u=new Uint8Array(b);return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength);};
   let n=0;
   Object.defineProperty(w.navigator,'credentials',{configurable:true,value:{
     get:async(o)=>{const ch=b64u(Buffer.from(o.publicKey.challenge));const cd=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:ch,origin:'https://localhost'}));
       const c=Buffer.alloc(4);c.writeUInt32BE(++n);const ad=Buffer.concat([sha(Buffer.from('localhost')),Buffer.from([5]),c]);
       return {id:b64u(idF),response:{clientDataJSON:ab(cd),authenticatorData:ab(ad),signature:ab(crypto.sign('sha256',Buffer.concat([ad,sha(cd)]),kF))}};},
     create:async(o)=>{creeAppels++;const k=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),j=k.publicKey.export({format:'jwk'}),id=crypto.randomBytes(32);
       const cb=v=>{const t=(m,x)=>x<24?Buffer.from([m<<5|x]):Buffer.from([m<<5|24,x]);if(typeof v==='number')return v>=0?t(0,v):t(1,-1-v);if(Buffer.isBuffer(v))return Buffer.concat([t(2,v.length),v]);
         if(typeof v==='string')return Buffer.concat([t(3,Buffer.byteLength(v)),Buffer.from(v)]);return Buffer.concat([t(5,v.size),...[...v].flatMap(([a,x])=>[cb(a),cb(x)])]);};
       const l=Buffer.alloc(2);l.writeUInt16BE(32);
       const ad=Buffer.concat([sha(Buffer.from(o.publicKey.rp.id)),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),l,id,cb(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(j.x,'base64url')],[-3,Buffer.from(j.y,'base64url')]]))]);
       const cd=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:b64u(Buffer.from(o.publicKey.challenge)),origin:'https://localhost'}));
       return {id:b64u(id),response:{clientDataJSON:ab(cd),attestationObject:ab(cb(new Map([['fmt','none'],['attStmt',new Map()],['authData',ad]])))}};}}});
 }});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);await dort(1200);
 const clic=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 const dernier=()=>[...d.querySelectorAll('#fil .tour')].pop().textContent;
 ok('P1',!$('micro').hidden&&!$('blocFaceId').hidden,'micro visible (dictée possible), bloc Face ID visible (instance avec élévation)','micro '+!$('micro').hidden+', Face ID '+!$('blocFaceId').hidden);
 /* voix */
 clic($('micro'));rec.onresult({results:[[{transcript:'envoie les factures à luc@exemple.fr'}]]});rec.stop();
 const dicte=$('msg').value;plans.push({action:'SEND',resource:'EMAIL',target:'luc@exemple.fr'});clic($('envoyer'));await dort(700);
 const cv=corps.filter(x=>/\/api\/chat/.test(x.u)).pop();const bulle=[...d.querySelectorAll('#fil .tour.moi')].pop().textContent;
 ok('P2',dicte==='envoie les factures à luc@exemple.fr'&&cv.b.canal==='voix'&&/🎤/.test(bulle),"dictée : texte dans le champ, relu, puis envoyé avec canal « voix » et 🎤 dans la bulle",'canal '+cv.b.canal);
 $('msg').value='bonjour';plans.push({action:'AUCUNE'});clic($('envoyer'));await dort(500);
 ok('P3',!('canal' in corps.filter(x=>/\/api\/chat/.test(x.u)).pop().b),"message tapé ensuite : plus marqué voix");
 /* creation */
 plans.push({action:'CREATE',resource:'AGENDA_JARVIS',target:DEMAIN+'T18:30|90|Entraînement U18'});$('msg').value='ajoute entraînement demain 18h30';clic($('envoyer'));await dort(600);
 const carte=[...d.querySelectorAll('.creation')].pop();const posts=()=>appelsG.filter(x=>x.m==='POST'&&/events/.test(x.u)).length;
 ok('P4',carte&&/À confirmer/.test(carte.textContent)&&/18:30 → 20:00/.test(carte.textContent)&&carte.querySelector('[data-creer]')&&posts()===0,"carte de création : l'événement exact, « Créer » / « Ne pas créer », rien d'écrit",carte&&carte.querySelector('.evenement').textContent);
 clic(carte.querySelector('[data-creer]'));await dort(700);
 const fait=[...d.querySelectorAll('.creation')].pop();const tr=dernier();
 ok('P5',/Créé dans ton agenda JARVIS/.test(fait.textContent)&&fait.querySelector('[data-compenser]')&&posts()===1&&/toucher sur « Créer » \(revérifiée\).*effet réel confirmé/.test(tr)&&carte.querySelector('[data-creer]').disabled,"« Créer » : créé chez Google, carte « Supprimer », trace « ton toucher … effet réel confirmé »",tr.slice(0,120));
 clic(fait.querySelector('[data-compenser]'));await dort(700);
 const sup=fait.querySelector('[data-compenser]');
 ok('P6',sup.disabled&&sup.textContent==='Supprimé'&&/disparition vérifiée/.test(d.body.textContent)&&[...evts.values()][0].status==='cancelled',"« Supprimer » : supprimé chez Google, disparition vérifiée, bouton éteint");
 plans.push({action:'CREATE',resource:'AGENDA_JARVIS',target:DEMAIN+'T09:00|30|Test'});$('msg').value='ajoute test demain 9h';clic($('envoyer'));await dort(600);
 const c2=[...d.querySelectorAll('.creation')].pop();clic(c2.querySelector('[data-ignorer]'));await dort(200);
 ok('P7',c2.querySelector('[data-creer]').disabled&&/Rien n'a été créé/.test(dernier())&&posts()===1,"« Ne pas créer » : rien envoyé, boutons éteints");
 w.rendreDecision({decide:'CONFIRMATION_REQUISE',aConfirmer:{cible:'x" onmouseover="window.__pwn=1',lisible:'<img src=x onerror="window.__pwn=1">'}});
 const cx=[...d.querySelectorAll('.creation')].pop();
 ok('P8',!cx.querySelector('img')&&cx.querySelector('[data-creer]').dataset.creer==='x" onmouseover="window.__pwn=1'&&!w.__pwn,"injection dans la carte (titre, cible) : texte inerte");
 /* irreversible + Face ID */
 plans.push({action:'SEND',resource:'EMAIL',target:'pierre@exemple.fr'});$('msg').value='envoie les factures à pierre@exemple.fr';clic($('envoyer'));await dort(600);
 await dort(10400);clic([...d.querySelectorAll('button[data-finaliser]')].pop());await dort(900);
 const pan=[...d.querySelectorAll('.elevation')].pop();
 ok('P9',pan&&!pan.querySelector('[data-faceid]').disabled&&pan.querySelector('input.code')&&/bien toi/.test(pan.textContent),"confirmation d'un envoi : panneau « Face ID » (défi déjà prêt) + code de secours");
 clic(pan.querySelector('[data-faceid]'));await dort(1500);
 const txt=d.body.textContent;
 /* [v4.6.5 - S46] regle stricte : validé POUR CETTE ACTION ; plus d'état « actif 15 min » */
 ok('P10',/Face ID validé pour cette action/.test(pan.textContent)&&/Envoyé\./.test(txt)&&/confirmé par ton clic \+ Face ID/.test(txt)&&$('etatFaceId').textContent==='demandé à chaque action irréversible',"Face ID : validé pour cette action → envoi confirmé automatiquement, trace « + Face ID », état « demandé à chaque action »",$('etatFaceId').textContent);
 /* enregistrement */
 clic($('fidPreparer'));await dort(500);clic($('fidCreer'));await dort(900);
 ok('P11',creeAppels===1&&!$('fidResultat').hidden&&EL.lirePasskeys($('fidValeur').value).size===1,"enregistrer Face ID : la clé publique à coller dans Render s'affiche, relisible par le serveur");
 ok('P12',err.length===0,'aucune erreur JavaScript dans la page',err.slice(0,2).join(' | '));
 L('JARVIS — page v4.6 (jsdom, vrai serveur)\n');for(const x of R)L(x);const k=R.filter(x=>x.startsWith('ECHEC')).length;L('\n>>> '+(R.length-k)+'/'+R.length+' tests passent');process.exit(k?1:0) /* [v4.6.5] sortait toujours 0 : la CI ne voyait jamais un échec */;})();
