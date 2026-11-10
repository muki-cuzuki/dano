/* ---------- Zagon: Supabase (baza, prijava, fotografije) ---------- */
const CFG = window.DANO_CONFIG || {};
const SB = (CFG.url && CFG.key && window.supabase) ? window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const BUCKET = 'dano';
const blobUrl = id => SB ? `${CFG.url}/storage/v1/object/public/${BUCKET}/${String(id).split('/').map(encodeURIComponent).join('/')}` : '';
const AUTH = { session: null, view: 'welcome', busy: false, msg: '', email: '' };

function sbErr(e){
  const m = (e && (e.message || e.error_description)) || String(e || '');
  if (/fetch|network|Load failed/i.test(m)) return { code: 'unavailable', message: m };
  if (e && (e.code === '42501' || /row-level security|permission denied/i.test(m))) return { code: 'revoked', message: m };
  return { code: 'error', message: m };
}

function sbStore(space){
  const cache = {}, subs = {}, loaded = {};
  COLS.forEach(c => { cache[c] = new Map(); subs[c] = []; });
  const snap = c => { const docs = [...cache[c].entries()].map(([id, v]) => ({ id, exists: true, data: () => v })); return { docs, size: docs.length, empty: !docs.length }; };
  const emit = c => subs[c].forEach(cb => cb(snap(c)));
  const clone = v => JSON.parse(JSON.stringify(v));
  async function fetchAll(){
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await SB.from('docs').select('col,id,data').eq('space', space).range(from, from + 999);
      if (error) throw sbErr(error);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    COLS.forEach(c => cache[c].clear());
    for (const r of rows) if (cache[r.col]) cache[r.col].set(r.id, r.data);
    COLS.forEach(c => { loaded[c] = true; emit(c); });
  }
  function apply(r){ if (!r || r.space !== space || !cache[r.col]) return; cache[r.col].set(r.id, r.data); emit(r.col); }
  const ch = SB.channel('space-' + space)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs', filter: 'space=eq.' + space }, p => apply(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs', filter: 'space=eq.' + space }, p => apply(p.new))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'docs' }, p => { const o = p.old || {}; if (o.space === space && cache[o.col] && cache[o.col].delete(o.id)) emit(o.col); })
    .subscribe();
  const now = () => new Date().toISOString();
  return {
    space, fetchAll,
    close(){ try { SB.removeChannel(ch); } catch (e) {} },
    collection(c){
      return {
        onSnapshot(cb){ subs[c].push(cb); if (loaded[c]) setTimeout(() => cb(snap(c)), 0); return () => { subs[c] = subs[c].filter(x => x !== cb); }; },
        doc(id){
          id = id || rid();
          return {
            id,
            async set(v){ const data = clone(v); const { error } = await SB.from('docs').upsert({ space, col: c, id, data, updated_at: now() }); if (error) throw sbErr(error); cache[c].set(id, data); emit(c); },
            async update(v){ const cur = cache[c].get(id); if (!cur) throw { code: 'not_found' }; const data = Object.assign(clone(cur), clone(v)); const { error } = await SB.from('docs').update({ data, updated_at: now() }).eq('space', space).eq('col', c).eq('id', id); if (error) throw sbErr(error); cache[c].set(id, data); emit(c); },
            async delete(){ const { error } = await SB.from('docs').delete().eq('space', space).eq('col', c).eq('id', id); if (error) throw sbErr(error); if (cache[c].delete(id)) emit(c); }
          };
        }
      };
    }
  };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
const sbAssets = space => ({
  async upload(blob, opts){
    const type = (opts && opts.type) || blob.type || 'image/jpeg';
    const name = (crypto.randomUUID ? crypto.randomUUID() : rid() + rid());
    const path = `${space}/${name}.${EXT[type] || 'bin'}`;
    const { error } = await SB.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (error) { const m = error.message || ''; throw { code: /size|large/i.test(m) ? 'too_large' : /mime|type/i.test(m) ? 'unsupported_type' : 'error' }; }
    return { id: path, contentType: type };
  }
});

async function chooseSpace(){
  const { data, error } = await SB.from('space_members').select('space, joined_at').eq('user_id', S.me.id).order('joined_at');
  if (error) throw sbErr(error);
  const saved = LS.get('dano.space');
  const row = (data || []).find(r => r.space === saved) || (data || [])[0];
  return row ? row.space : null;
}
async function createSpace(){
  const { data, error } = await SB.rpc('create_space');
  if (error) throw sbErr(error);
  return data;
}
async function openSpace(space){
  if (S.store && S.store.close) S.store.close();
  COLS.forEach(c => { S[c] = []; S.loaded[c] = false; });
  S.ownerDocTried = false;
  const { data } = await SB.from('spaces').select('owner').eq('id', space).maybeSingle();
  S.isOwner = !!data && data.owner === S.me.id;
  S.space = space; LS.set('dano.space', space);
  S.store = sbStore(space); S.assets = sbAssets(space);
  for (const c of COLS) {
    S.store.collection(c).onSnapshot(snap => { S[c] = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); S.loaded[c] = true; afterData(); });
  }
  await S.store.fetchAll();
}
async function ensureSpace(){
  if (!SB || S.store) return;
  await openSpace(await createSpace());
}
async function loadInviteInfo(code){
  const { data, error } = await SB.rpc('invite_info', { code });
  if (error || !data) { S.inviteExt = null; return; }
  S.inviteExt = { id: code, space: data.space, inv: Object.assign({ id: code }, data.invite || {}), pet: data.pet ? Object.assign({ id: data.petId }, data.pet) : null };
}
async function startSession(session){
  AUTH.session = session;
  S.me = { id: session.user.id };
  S.myName = (session.user.user_metadata && session.user.user_metadata.name) || '';
  S.mode = 'loading'; S.canWrite = true; render();
  try {
    let code = inviteCode();
    if (!code) { const pend = LS.get('dano.pendingInvite'); if (pend) { code = pend; history.replaceState(null, '', '#povabilo-' + pend); } }
    let space = await chooseSpace();
    if (code) await loadInviteInfo(code);
    if (!space && !code) space = await createSpace();
    S.mode = 'db';
    if (space) await openSpace(space);
    else COLS.forEach(c => { S.loaded[c] = true; });
  } catch (e) {
    console.warn(e);
    S.mode = 'db'; COLS.forEach(c => { S.loaded[c] = true; });
    toast('Povezava z bazo ni uspela. Osveži stran in poskusi znova.');
  }
  render();
}
function signedOut(){
  if (S.store && S.store.close) S.store.close();
  S.store = null; S.assets = null; S.space = null; S.isOwner = false; S.me = { id: null };
  COLS.forEach(c => { S[c] = []; S.loaded[c] = false; });
  AUTH.session = null; AUTH.view = 'welcome'; AUTH.busy = false; AUTH.msg = '';
  S.mode = 'auth'; render();
}

/* Prijava in registracija */
function authMsg(e){
  const m = (e && e.message) || '';
  if (/invalid login|invalid credentials/i.test(m)) return 'E-pošta ali geslo ni pravilno.';
  if (/not confirmed/i.test(m)) return 'Račun še ni potrjen. Klikni povezavo v e-pošti, ki smo ti jo poslali.';
  if (/already registered|already exists/i.test(m)) return 'Račun s to e-pošto že obstaja. Prijavi se.';
  if (/password/i.test(m) && /6|short|weak|characters/i.test(m)) return 'Geslo mora imeti vsaj 6 znakov.';
  if (/rate|too many|security purposes/i.test(m)) return 'Preveč poskusov. Počakaj minuto in poskusi znova.';
  if (/fetch|network|Load failed/i.test(m)) return 'Ni povezave. Preveri internet in poskusi znova.';
  return 'Ni uspelo. ' + m;
}
function authKey(){ return JSON.stringify([AUTH.view, AUTH.msg, AUTH.busy]); }
function welcomeHtml(){
  const inv = inviteCode() || LS.get('dano.pendingInvite');
  const feats = [['bowl', 'Hrana in zdravila z uro', 'Odkljukaš, ko daš. Ni več dvojnih odmerkov.'], ['syringe', 'Cepljenja in zajedavci', 'Opomnik, preden rok poteče.'], ['user', 'Družina in skrbniki', 'Vsi vidijo isto, varuh samo, kar rabi.']];
  return `<section class="ob welcome"><div class="ob-top">
    <span class="logo-tile">${I.logo}</span>
    <h1 class="wordmark">Dano</h1>
    <p class="ob-sub">${inv ? 'Imaš povabilo. Ustvari račun ali se prijavi, nato ga sprejmeš.' : 'Hrana, zdravila in cepljenja na enem mestu. Vsi doma vidijo, kdo je kaj že dal.'}</p>
    <div class="feats">${feats.map(([i, a, b]) => `<div class="feat"><span class="tile sm">${I[i]}</span><div><b>${a}</b><span>${b}</span></div></div>`).join('')}</div>
  </div><div class="ob-bot"><button class="btn btn-primary btn-wide" data-act="auth-view" data-v="register">Ustvari račun</button><button class="btn btn-wide" data-act="auth-view" data-v="login">Prijava</button></div></section>`;
}
function authHtml(){
  if (AUTH.view === 'welcome') return welcomeHtml();
  if (AUTH.view === 'check') return msgScreen('Preveri e-pošto', `Na ${esc(AUTH.email)} smo poslali povezavo za potrditev računa. Klikni jo, nato se tukaj prijavi.`, '<button class="btn btn-primary btn-wide" data-act="auth-view" data-v="login">Na prijavo</button>');
  if (AUTH.view === 'newpass') {
    return `<section class="ob"><div class="ob-top">${markHtml()}<h1 class="ob-title q">Novo geslo</h1>
      <form class="stack" id="passForm" novalidate><div class="field"><label class="lbl" for="a-new">Novo geslo</label><input id="a-new" name="password" type="password" autocomplete="new-password" minlength="6" required><small>Vsaj 6 znakov.</small></div>
      ${AUTH.msg ? `<p class="info" role="alert">${esc(AUTH.msg)}</p>` : ''}
      <button class="btn btn-primary btn-wide" type="submit" ${AUTH.busy ? 'disabled' : ''}>${AUTH.busy ? 'Počakaj …' : 'Shrani geslo'}</button></form></div><div class="ob-bot"></div></section>`;
  }
  const reg = AUTH.view === 'register';
  const inv = inviteCode() || LS.get('dano.pendingInvite');
  return `<section class="ob"><div class="ob-top"><div class="obbar"><button class="back" data-act="auth-view" data-v="welcome">${I.back}Nazaj</button></div>${markHtml()}
    <h1 class="ob-title">${reg ? 'Nov račun' : 'Prijava'}</h1>
    <p class="ob-sub">${inv ? 'Imaš povabilo. Prijavi se ali ustvari račun, nato ga sprejmeš.' : reg ? 'Z računom vidiš iste zapise na vseh napravah in jih deliš z družino.' : 'Hrana, zdravila in cepljenja na enem mestu. Vsi doma vidijo, kdo je kaj že dal.'}</p>
    <form class="stack" id="authForm" novalidate>
      ${reg ? `<div class="field"><label class="lbl" for="a-name">Tvoje ime</label><input id="a-name" name="name" autocomplete="given-name" required></div>` : ''}
      <div class="field"><label class="lbl" for="a-email">E-pošta</label><input id="a-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required value="${esc(AUTH.email)}"></div>
      <div class="field"><label class="lbl" for="a-pass">Geslo</label><input id="a-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required>${reg ? '<small>Vsaj 6 znakov.</small>' : ''}</div>
      ${AUTH.msg ? `<p class="info" role="alert">${esc(AUTH.msg)}</p>` : ''}
      <button class="btn btn-primary btn-wide" type="submit" ${AUTH.busy ? 'disabled' : ''}>${AUTH.busy ? 'Počakaj …' : reg ? 'Ustvari račun' : 'Prijava'}</button>
    </form></div>
    <div class="ob-bot">${reg ? '<button class="link" data-act="auth-view" data-v="login">Že imaš račun? Prijava</button>' : '<button class="link" data-act="auth-reset">Pozabljeno geslo</button><button class="link" data-act="auth-view" data-v="register">Še nimaš računa? Ustvari ga</button>'}</div></section>`;
}
async function authSubmit(f){
  const fd = new FormData(f);
  const email = String(fd.get('email') || '').trim(), password = String(fd.get('password') || ''), name = String(fd.get('name') || '').trim();
  AUTH.email = email;
  const reg = AUTH.view === 'register';
  if (!email || !password) { AUTH.msg = 'Vpiši e-pošto in geslo.'; render(); return; }
  if (reg && !name) { AUTH.msg = 'Vpiši svoje ime.'; render(); return; }
  if (reg && password.length < 6) { AUTH.msg = 'Geslo mora imeti vsaj 6 znakov.'; render(); return; }
  AUTH.busy = true; AUTH.msg = ''; render();
  try {
    if (reg) {
      const { data, error } = await SB.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) AUTH.view = 'check';
    } else {
      const { error } = await SB.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (e) { AUTH.msg = authMsg(e); }
  AUTH.busy = false;
  if (S.mode === 'auth') render();
}
async function passSubmit(f){
  const password = String(new FormData(f).get('password') || '');
  if (password.length < 6) { AUTH.msg = 'Geslo mora imeti vsaj 6 znakov.'; render(); return; }
  AUTH.busy = true; AUTH.msg = ''; render();
  const { error } = await SB.auth.updateUser({ password });
  AUTH.busy = false;
  if (error) { AUTH.msg = authMsg(error); render(); return; }
  AUTH.view = 'login';
  const { data } = await SB.auth.getSession();
  if (data && data.session) startSession(data.session); else render();
  toast('Geslo je shranjeno.');
}
async function authReset(){
  const el = $('#a-email'); const email = el ? el.value.trim() : AUTH.email;
  AUTH.email = email;
  if (!email) { AUTH.msg = 'Najprej vpiši e-pošto, nato klikni Pozabljeno geslo.'; render(); return; }
  const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  AUTH.msg = error ? authMsg(error) : `Na ${email} smo poslali povezavo za novo geslo.`;
  render();
}
document.addEventListener('submit', ev => {
  if (ev.target.id === 'authForm') { ev.preventDefault(); authSubmit(ev.target); }
  if (ev.target.id === 'passForm') { ev.preventDefault(); passSubmit(ev.target); }
});

/* Povabilo: sprejem prek baze */
async function acceptInvite(code, btn){
  if (!SB) { toast('Povabilo deluje samo na objavljeni aplikaciji.'); return; }
  const nm = ($('#inv-name') && $('#inv-name').value.trim()) || S.myName || '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sprejemam …'; }
  try {
    const { data: space, error } = await SB.rpc('join_space', { code });
    if (error) throw error;
    const inv = S.invites.find(i => i.id === code) || (S.inviteExt && S.inviteExt.inv) || {};
    await openSpace(space);
    await w(() => col('members').doc(S.me.id).set({ role: inv.role === 'skrbnik' ? 'skrbnik' : 'druzina', name: nm, until: inv.role === 'skrbnik' ? (inv.until || null) : null, pets: inv.petId ? [inv.petId] : [], invite: code, invitedBy: inv.by || null, joinedAt: Date.now() }));
    await w(() => col('invites').doc(code).update({ usedBy: S.me.id, usedAt: Date.now() }));
    if (inv.petId) { S.petId = inv.petId; LS.set('dano.pet', inv.petId); }
    S.inviteExt = null; LS.set('dano.pendingInvite', '');
    location.hash = 'danes';
    toast('Povabilo je sprejeto.');
  } catch (e) {
    const m = (e && e.message) || '';
    toast(/used/.test(m) ? 'To povabilo je že uporabljeno.' : /cancel/.test(m) ? 'Povabilo je preklicano.' : /not_found/.test(m) ? 'Povabilo ne obstaja.' : 'Povabila ni bilo mogoče sprejeti. Poskusi znova.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sprejmi povabilo'; }
  }
}

/* Namestitev na začetni zaslon */
function installCard(){
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (standalone || LS.get('dano.installHide') || !SB) return '';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const how = ios ? 'V Safariju tapni Deli in izberi Dodaj na začetni zaslon.' : 'V meniju brskalnika izberi Namesti aplikacijo ali Dodaj na začetni zaslon.';
  return `<section class="sec"><div class="invite-card"><b>Dodaj Dano na začetni zaslon</b><p>${how} Potem se odpre čez cel zaslon, kot prava aplikacija.</p><div class="btns"><button class="link" data-act="hide-install">V redu</button></div></div></section>`;
}

async function resolveNames(){ /* imena so v zapisih članov */ }
function afterData(){
  if (allLoaded()) {
    const pets = sortedPets();
    if (!pets.find(p => p.id === S.petId)) S.petId = pets.length ? pets[0].id : null;
    if (S.mode === 'db' && S.isOwner && S.me.id && S.canWrite && !myMember() && !S.ownerDocTried) {
      S.ownerDocTried = true;
      w(() => col('members').doc(S.me.id).set({ role: 'lastnik', name: S.myName || '', joinedAt: Date.now() }));
    }
  }
  render();
}
async function init(){
  document.querySelectorAll('.ni[data-i]').forEach(el => { el.innerHTML = I[el.dataset.i] || ''; });
  $('#careNote').innerHTML = I.note + 'Vpiši opažanje';
  window.addEventListener('hashchange', () => {
    S.confirm = null;
    const code = inviteCode();
    if (code) { LS.set('dano.pendingInvite', code); if (SB && AUTH.session && !S.invites.some(i => i.id === code)) loadInviteInfo(code).then(render); }
    else S.declined = null;
    render(); window.scrollTo(0, 0);
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (view() === 'zdravje' && currentMode() === 'app') render(); }, 250); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (S.store && S.store.fetchAll) S.store.fetchAll().catch(() => {}); render(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (inviteCode()) LS.set('dano.pendingInvite', inviteCode());
  if (!SB) {
    S.mode = 'local'; S.store = localStore(); S.me = { id: 'local' }; S.isOwner = true;
    render();
    for (const c of COLS) S.store.collection(c).onSnapshot(snap => { S[c] = snap.docs.map(d => Object.assign({ id: d.id }, d.data())); S.loaded[c] = true; afterData(); });
  } else {
    S.mode = 'loading'; render();
    SB.auth.onAuthStateChange((ev, session) => {
      setTimeout(() => {
        if (ev === 'PASSWORD_RECOVERY') { AUTH.view = 'newpass'; S.mode = 'auth'; render(); return; }
        if (session && (!AUTH.session || AUTH.session.user.id !== session.user.id)) { if (AUTH.view !== 'newpass') startSession(session); }
        else if (session) AUTH.session = session;
        else if (!session && (AUTH.session || S.mode !== 'auth')) signedOut();
      }, 0);
    });
  }
  setInterval(() => { const m = currentMode(); if (m !== 'onboard' && m !== 'auth' && !sheet.open) render(); }, 60000);
}
init();
