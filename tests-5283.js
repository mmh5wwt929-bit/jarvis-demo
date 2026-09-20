'use strict';
/* JARVIS 5.28.2 — TESTS DE NON-REGRESSION A1 / A4
 * A executer apres toute modification du noyau : node tests-5282.js
 * Chaque test fige un exploit VERIFIE sur 5.28.1 avant correctif.
 */
const J=require('./jarvis-5.28.3.js');
const {Jarvis,createPermission,approvalFor,identityContext,envelopeFor,HARNESS_KEY}=J;

const R=[];
const t=(id,nom,fn)=>{let ok=false,info='';try{const r=fn();ok=r===true||(r&&r.ok===true);info=(r&&r.info)||''}catch(e){ok=false;info='EXCEPTION '+e.message}R.push({id,nom,ok,info})};
const pollue=(champs,fn)=>{for(const k in champs)Object.prototype[k]=champs[k];try{return fn()}finally{for(const k in champs)delete Object.prototype[k]}};

function permissionValide(j,o={}){
  const q=j.permissions.propose(createPermission(j,{action:'READ',resource:'LOCAL',context:'CHAT',...o}));
  if(!q.allowed)return null;
  if(!j.permissions.authorize(q.permission.id,approvalFor(j,q.permission.id)).allowed)return null;
  return j.permissions.getPermission(q.permission.id,HARNESS_KEY);
}

/* ===================== A1 — POLLUTION DE PROTOTYPE ===================== */

t('T10','inspect() refuse un objet forge sous prototype pollue',()=>pollue({authoritySource:'USER'},()=>{
  const j=new Jarvis();
  const r=j.security.inspect({id:'x',nonce:'n',requestHash:'h',state:'ACTIVE'});
  return{ok:r.allowed===false&&r.reason==='UNTRUSTED_AUTHORITY_SOURCE',info:r.reason}}));

t('T11','authorizeExternal() refuse une permission forgee sous pollution',()=>pollue({authoritySource:'USER',state:'ACTIVE'},()=>{
  const j=new Jarvis();
  const forge={id:'x',nonce:'n',requestHash:'h'};
  const env={permissionId:'x',nonce:'n',requestHash:'h'};
  const r=j.security.authorizeExternal(forge,env);
  return{ok:r.allowed===false,info:r.reason}}));

t('T12','validateEnvelope() n herite pas l etat ACTIVE',()=>pollue({state:'ACTIVE'},()=>{
  const j=new Jarvis();
  const q=j.permissions.propose(createPermission(j,{action:'READ',resource:'LOCAL',context:'CHAT'}));
  const p=j.permissions.getPermission(q.permission.id,HARNESS_KEY); // PROPOSED, jamais approuvee
  const sansEtat={};for(const k of Object.keys(p))if(k!=='state')sansEtat[k]=p[k];
  const r=j.security.validateEnvelope(sansEtat,envelopeFor(p));
  return{ok:r.allowed===false&&r.reason==='PERMISSION_INACTIVE',info:r.reason}}));

t('T13','enveloppe amputee d un champ ne concorde pas par heritage',()=>{
  const j=new Jarvis();
  const p=permissionValide(j,{scope:'USER'});
  const env=envelopeFor(p);
  const envAmpute={};for(const k of Object.keys(env))if(k!=='scope')envAmpute[k]=env[k];
  return pollue({scope:'USER'},()=>{
    const r=j.security.validateEnvelope(p,envAmpute);
    return{ok:r.allowed===false&&r.reason==='BINDING_MISMATCH:scope',info:r.reason||'CONTOURNEMENT : champ ampute accepte'}});
});

t('T14','propose() refuse une source d autorite heritee',()=>pollue({authoritySource:'USER'},()=>{
  const j=new Jarvis();
  const req={id:'perm_forge',action:'READ',resource:'LOCAL',context:'CHAT',maxUses:1,expiresAt:Date.now()+60000};
  const r=j.permissions.propose(req);
  return{ok:r.allowed===false,info:r.reason}}));

/* ===================== A4 — TYPAGE DES CHAMPS DE DECISION ===================== */

t('T15','action non-chaine refusee a l entree',()=>{
  const j=new Jarvis();const refus=[];
  for(const bad of [['MODIFY_GOVERNANCE'],{v:'x'},123,true,{toString(){return 'READ'}}]){
    const r=j.permissions.propose(createPermission(j,{action:bad,resource:'LOCAL',context:'CHAT'}));
    refus.push(r.allowed===false&&String(r.reason).startsWith('INVALID_FIELD_TYPE'));
  }
  return{ok:refus.every(Boolean),info:refus.filter(Boolean).length+'/5 refusees'}});

t('T16','tous les champs de liaison sont types',()=>{
  const j=new Jarvis();const mauvais=[];
  for(const f of ['identity','session','agent','objective','action','resource','tool','target','scope','context']){
    const r=j.permissions.propose(createPermission(j,{action:'READ',resource:'LOCAL',context:'CHAT',[f]:{piege:1}}));
    if(r.allowed)mauvais.push(f);
  }
  return{ok:mauvais.length===0,info:mauvais.length?('non types: '+mauvais.join(',')):'10/10 types'}});

t('T17','aucune action illisible ne peut etre approuvee',()=>{
  const j=new Jarvis();
  const r=j.permissions.propose(createPermission(j,{action:{},resource:'LOCAL',context:'CHAT'}));
  return{ok:r.allowed===false,info:'propose='+r.allowed+' '+(r.reason||'')}});

t('T18','le chemin legitime reste intact',()=>{
  const j=new Jarvis();
  const p=permissionValide(j);
  if(!p)return{ok:false,info:'permission legitime refusee — REGRESSION'};
  const r=j.sas.execute(p.id,envelopeFor(p),identityContext(j,p),()=>({ok:true,texte:'reponse'}));
  return{ok:r.allowed===true&&j.audit.verify()&&j.ledger.consumed===1,info:'execute='+r.allowed+' audit='+j.audit.verify()+' consumed='+j.ledger.consumed}});

console.log('');
console.log('  ID    ETAT    TEST');
console.log('  ----- ------- ---------------------------------------------------------');
for(const x of R)console.log('  '+x.id.padEnd(5)+' '+(x.ok?' OK   ':'ECHEC ')+'  '+x.nom+(x.info?('  ['+x.info+']'):''));
const ko=R.filter(x=>!x.ok).length;
console.log('');
console.log('>>> '+(R.length-ko)+'/'+R.length+' tests passent');
process.exit(ko?1:0);
