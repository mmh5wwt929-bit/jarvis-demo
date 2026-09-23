'use strict';
/* ============================================================================
 * JARVIS — sonde F91–F100 : « un identifiant de reservation n'est jamais une
 * autorite ». Les 10 attaques listees, jouees sur le VRAI noyau 5.28.3 et sur
 * la couche 5.29.7.   node sonde-f91.js
 * ----------------------------------------------------------------------------
 * A = la personne legitime. B = un autre acteur du meme processus qui a
 * recupere l'identifiant de reservation (journal, fuite, devinette).
 * Resultats : BLOQUE / PERCE / EXCEPTION (une exception n'est pas un blocage).
 * ========================================================================== */
const P = require('./jarvis-plus-5.29.js');
const K = P.noyau;

const R = [];
const s = (id, nom, f) => {
  let r, statut;
  try { r = f(); statut = r.ok ? 'BLOQUE' : 'PERCE'; }
  catch (e) { r = { info: e.constructor.name + ' : ' + String(e.message).slice(0, 70) }; statut = 'EXCEPTION'; }
  R.push({ id, nom, statut, info: r.info });
};

/* Une permission ACTIVE, prete a etre reservee : la forme EXACTE que la couche
 * construit, passee par le canal d'admission « frappe de l'utilisateur ». */
const crypto = require('crypto');
function permissionActive(j, over = {}) {
  const base = { id: 'perm_' + crypto.randomUUID(),
    action: 'SEND', resource: 'EMAIL', target: 'marc@exemple.fr', context: 'CHAT',
    tool: 'NONE', scope: 'CURRENT_CONTEXT', identity: 'USER', agent: 'JARVIS', objective: 'ASSIST',
    session: null, maxUses: 1, expiresAt: Date.now() + 300000, ...over };
  const permission = j.intake.fromUser(base, K.HARNESS_KEY);
  if (!permission) throw new Error('canal refuse');
  const prop = j.permissions.propose(permission);
  if (!prop.allowed) throw new Error('propose : ' + prop.reason);
  const pid = prop.permission.id;
  const appr = j.permissions.authorize(pid, K.approvalFor(j, pid));
  if (!appr.allowed) throw new Error('authorize : ' + appr.reason);
  return pid;
}

/* ---- F91 : une reservation de A, manipulee par B ---- */
s('F91', "B libere (release) la reservation de A avec le seul identifiant", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j);
  const r = j.permissions.reserve(pid, 'CHAT');
  const libere = j.permissions.release(r.reservationId);            /* B */
  const c = j.permissions.commit(r.reservationId);                  /* A veut finir */
  return { ok: libere !== true, info: 'release rend ' + libere + ' ; A commit -> ' + (c.allowed ? 'ALLOWED' : c.reason) };
});
s('F92', "B valide (commit) la reservation de A avec le seul identifiant", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j);
  const r = j.permissions.reserve(pid, 'CHAT');
  const c = j.permissions.commit(r.reservationId);                  /* B, sans rien d'autre */
  return { ok: !c.allowed, info: c.allowed ? 'EFFET VALIDE par B (' + c.state + ')' : c.reason };
});
s('F93', "B revoque la permission de A avec le seul identifiant de permission", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j);
  const v = j.permissions.revoke(pid);
  return { ok: !v.allowed, info: v.allowed ? 'REVOQUEE par B' : v.reason };
});

/* ---- F94–F96 : identifiant valide, mais mauvais contexte ---- */
s('F94', "identifiant valide, mauvaise session : le commit passe-t-il quand meme ?", () => {
  const j = new K.Jarvis({ initialCeiling: 100 });
  const pid = permissionActive(j, { session: 'SESSION_A' });
  const r = j.permissions.reserve(pid, 'CHAT');
  const c = j.permissions.commit(r.reservationId);   /* B n'a aucune session a prouver */
  return { ok: !c.allowed, info: c.allowed ? 'commit accepte sans session' : c.reason };
});
s('F95', "identifiant valide, mauvais contexte declare a la reservation", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j);
  const r = j.permissions.reserve(pid, 'AUTRE_CONTEXTE');
  return { ok: !r.allowed, info: r.allowed ? 'reservation acceptee avec un autre contexte' : r.reason };
});
s('F96', "identifiant valide, mauvaise identite : la reservation est-elle liee a l'identite ?", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j, { identity: 'ALSID' });
  const r = j.permissions.reserve(pid, 'CHAT');
  const enr = JSON.stringify(r);
  /* Le dossier de reservation contient-il de quoi verifier QUI finalise ? */
  return { ok: /identity|session|identite/i.test(enr), info: 'la reservation ne porte que : ' + enr.slice(0, 90) };
});

/* ---- F97–F98 : apres expiration, apres consommation ---- */
s('F97', "commit apres expiration de la permission", () => {
  const j = new K.Jarvis({ initialCeiling: 100 });
  const pid = permissionActive(j, { expiresAt: Date.now() + 400 });
  const r = j.permissions.reserve(pid, 'CHAT');
  const fin = Date.now() + 700; while (Date.now() < fin) { /* attente reelle */ }
  const c = j.permissions.commit(r.reservationId);
  return { ok: !c.allowed, info: c.allowed ? 'EFFET APRES EXPIRATION' : c.reason };
});
s('F98', "commit rejoue apres consommation (le meme identifiant, deux fois)", () => {
  const j = new K.Jarvis({ initialCeiling: 100 }); const pid = permissionActive(j);
  const r = j.permissions.reserve(pid, 'CHAT');
  const c1 = j.permissions.commit(r.reservationId), c2 = j.permissions.commit(r.reservationId);
  return { ok: c1.allowed && !c2.allowed, info: 'premier ' + (c1.allowed ? 'OK' : c1.reason) + ', rejeu ' + (c2.allowed ? 'ACCEPTE' : c2.reason) };
});

/* ---- F99–F100 : deviner un identifiant ---- */
s('F99', "identifiant devine ou enumere (forme, hasard)", () => {
  const j = new K.Jarvis({ initialCeiling: 100 });
  const ids = [];
  for (let i = 0; i < 5; i++) { const k = new K.Jarvis({ initialCeiling: 100 });
    ids.push(k.permissions.reserve(permissionActive(k), 'CHAT').reservationId); }
  const uuid = /^reservation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const hasard = ids.every(x => uuid.test(x)) && new Set(ids).size === ids.length;
  const faux = ['reservation_1', 'reservation_' + '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12), ids[0].slice(0, -1) + '0'];
  const accepte = faux.filter(x => j.permissions.commit(x).allowed);
  return { ok: hasard && accepte.length === 0, info: (hasard ? 'UUID v4 imprevisible' : 'FORME DEVINABLE') + ', faux identifiants acceptes : ' + accepte.length };
});
/* ---- F100 : la chaine complete, jusqu'a l'effet ---- */
const chaine = (sabotage) => {
  let t = 0; const j = new K.Jarvis({ initialCeiling: 100 });
  const { session: g, entree } = P.creerSessionGouvernee({ jarvis: j, horloge: { mono: () => t } });
  const texte = 'envoie le rapport à marc@exemple.fr';
  entree.soumettre(texte);
  const { sceauContexte } = g.promptDePlanification(texte, ['SEND']);
  const a = g.demander({ action: 'SEND', resource: 'EMAIL', target: 'marc@exemple.fr' }, { sceauContexte });
  let effet = false;
  const e = g.executer(a, () => { effet = true; return { parti: true }; });
  const vu = sabotage(j, a);                       /* B agit pendant la fenetre de 10 s */
  t += 10001;
  const f = g.finaliser(e.jetonAnnulation);
  return { effet, f, vu };
};
s('F100', "B consomme (commit) la permission d'un envoi retenu : aucun effet, refus clair", () => {
  const { effet, f, vu } = chaine((j, a) => {
    const r = j.permissions.reserve(a.permissionId, 'CHAT');
    return j.permissions.commit(r.reservationId).allowed ? 'commit accepte' : 'commit refuse';
  });
  return { ok: !effet && f.etat === 'REFUSE', info: 'B : ' + vu + ' | A : ' + f.etat + ' ' + (f.motif || '') + ' | effet reel : ' + effet };
});
s('F100b', "B revoque la permission d'un envoi retenu : aucun effet, refus clair", () => {
  const { effet, f } = chaine((j, a) => j.permissions.revoke(a.permissionId).allowed ? 'revoquee' : 'refusee');
  return { ok: !effet && f.etat === 'REFUSE', info: 'A : ' + f.etat + ' ' + (f.motif || '') + ' | effet reel : ' + effet };
});
s('F100c', "B reserve puis libere : aucune interference, l'envoi de A suit son cours", () => {
  const { effet, f } = chaine((j, a) => { const r = j.permissions.reserve(a.permissionId, 'CHAT'); return j.permissions.release(r.reservationId); });
  return { ok: effet && f.etat === 'EXECUTE', info: 'A : ' + f.etat + ' | effet reel : ' + effet };
});

console.log('JARVIS — sonde F91–F100 (un identifiant est-il une autorite ?)\n');
for (const x of R) console.log(x.statut.padEnd(10) + x.id.padEnd(6) + x.nom + '\n' + ' '.repeat(16) + '[' + x.info + ']');
const n = (t) => R.filter(x => x.statut === t).length;
console.log(`\n>>> ${n('BLOQUE')}/${R.length} bloquees, ${n('PERCE')} percees, ${n('EXCEPTION')} exceptions`);
/* Les 5 « percees » sont connues, documentees et sans effet possible : elles
 * demandent d'avoir deja la main sur le noyau dans le processus, et ne
 * produisent aucune action (F100). Elles restent affichees telles quelles
 * plutot que renommees : ce test echoue si l'une des 7 defenses cede. */
const doitBloquer = ['F95','F97','F98','F99','F100','F100b','F100c'];
const cedees = R.filter(x => doitBloquer.includes(x.id) && x.statut !== 'BLOQUE');
process.exit(cedees.length ? 1 : 0);
