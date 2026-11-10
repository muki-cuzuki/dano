"""Sestavi index.html (PWA) iz src/app.html (ista aplikacija kot testna verzija na claude.ai)
in src/backend.js (Supabase: prijava, baza, fotografije)."""
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
app = (root / 'src/app.html').read_text(encoding='utf-8')
backend = (root / 'src/backend.js').read_text(encoding='utf-8')

def rep(s, old, new, count=1):
    n = s.count(old)
    if n != count:
        sys.exit(f'expected {count} of {old[:80]!r}, found {n}')
    return s.replace(old, new)

# 1) Glava dokumenta: lastna (PWA), pisave z lastnega strežnika
head_end = app.index('<style>')
css_start = head_end
css_end = app.index('</style>', css_start) + len('</style>')
css = app[css_start:css_end]
body = app[css_end:]

fonts = []
for w in (400, 500, 600, 700):
    fonts.append(f"@font-face{{font-family:'Barlow';font-style:normal;font-weight:{w};font-display:swap;src:url(fonts/barlow-latin-ext-{w}-normal.woff2) format('woff2');unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}}")
    fonts.append(f"@font-face{{font-family:'Barlow';font-style:normal;font-weight:{w};font-display:swap;src:url(fonts/barlow-latin-{w}-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}}")

head = f"""<!doctype html>
<html lang="sl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Dano</title>
<meta name="description" content="Hrana, zdravila in cepljenja za psa ali mačko. Vsi doma vidijo, kdo je kaj že dal.">
<meta name="theme-color" content="#F0F0EF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1715" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Dano">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preload" href="fonts/barlow-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
{chr(10).join(fonts)}
:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px)}}
img{{max-width:100%}}
[hidden]{{display:none!important}}
</style>
{css}
</head>
<body>"""

# 2) Skripta: Supabase namesto zmožnosti claude.ai
body = rep(body, "const ARTIFACT_URL = 'https://claude.ai/artifact/2a6NK5hL3wAny8Z6Wu83AS';", "const ARTIFACT_URL = location.origin + location.pathname;")
body = rep(body, "<script>\n(() => {", '<script src="vendor/supabase.js"></script>\n<script src="config.js"></script>\n<script>\n(() => {')
body = rep(body, "ph.id ? '/_blob/' + encodeURIComponent(ph.id)", "ph.id ? blobUrl(ph.id)")
body = rep(body, "/_blob/${encodeURIComponent(p.id)}", "${blobUrl(p.id)}", 3)
body = rep(body, "/_blob/${encodeURIComponent(id)}", "${blobUrl(id)}")

body = rep(body, "function currentMode(){\n", "function currentMode(){\n  if (S.mode === 'auth') return 'auth';\n")
body = rep(body, "  } else S.obKey = null;\n  el.dataset.m = m;", "  } else S.obKey = null;\n  if (m === 'auth') { const k = authKey(); if (el.dataset.m === 'auth' && S.authKey === k) return; S.authKey = k; } else S.authKey = null;\n  el.dataset.m = m;")
body = rep(body, "  if (m === 'invite') { el.innerHTML = inviteHtml(inviteCode()); return; }", "  if (m === 'auth') { el.innerHTML = authHtml(); return; }\n  if (m === 'invite') { el.innerHTML = inviteHtml(inviteCode()); return; }")

body = rep(body, "  const inv = S.invites.find(i => i.id === code);\n  if (!inv) return msgScreen('Povabilo ne obstaja'", "  const inv = S.invites.find(i => i.id === code) || (S.inviteExt && S.inviteExt.id === code ? S.inviteExt.inv : null);\n  if (!inv) return msgScreen('Povabilo ne obstaja'")
body = rep(body, "  const preview = S.isOwner || (inv.by && inv.by === S.me.id);", "  const preview = (S.isOwner && S.invites.some(i => i.id === code)) || (inv.by && inv.by === S.me.id);")
body = rep(body, "  const p = S.pets.find(x => x.id === inv.petId) || pet() || S.pets[0];", "  const p = S.pets.find(x => x.id === inv.petId) || (S.inviteExt && S.inviteExt.pet) || pet() || S.pets[0];")

# odstrani sprejem povabila iz osnovne verzije (nadomesti ga backend.js)
body, n = re.subn(r"async function acceptInvite\(code, btn\)\{.*?\n\}\n", "", body, count=1, flags=re.S)
if n != 1: sys.exit('acceptInvite not found')

body = rep(body, "  o.saving = true;\n  const id = rid();", "  o.saving = true;\n  try { await ensureSpace(); } catch (e) { o.saving = false; toast('Povezava z bazo ni uspela. Poskusi znova.'); return false; }\n  const id = rid();")
body = rep(body, "<ol class=\"steps\"><li>V meniju <b>Deli</b> dodaj osebo ${esc(name)} po e-pošti in ji dovoli urejanje. Sicer bo zapise samo gledala.</li><li>Pošlji ji to povezavo:</li></ol>",
           "<p style=\"margin:0\">Pošlji to povezavo osebi ${esc(name)}. Ko jo odpre ter se prijavi ali ustvari račun, sprejme povabilo in vidi iste zapise.</p>")
body = rep(body, "async function removeMember(id){\n", "async function removeMember(id){\n  if (SB && S.space) { const { error } = await SB.rpc('remove_member', { s: S.space, uid: id }); if (error) { toast('Odstranitev ni uspela. Poskusi znova.'); return; } }\n")
body = rep(body, "  h += `<p class=\"hint\" style=\"padding-top:18px\">${S.mode === 'db' ? 'Zapisi se shranjujejo za vse, ki imajo dostop do te strani.' : 'Predogled: zapisi ostanejo samo v tem brskalniku.'}</p>`;",
           "  h += (S.mode === 'db' && AUTH.session) ? `<section class=\"sec\"><h2>Račun</h2><div class=\"card\"><p style=\"margin:0\">Prijavljen si kot <b>${esc(AUTH.session.user.email)}</b>. Zapisi so v bazi in jih vidijo vsi člani družine.</p><div><button class=\"btn\" data-act=\"logout\">Odjava</button></div></div></section>` : '<p class=\"hint\" style=\"padding-top:18px\">Predogled: zapisi ostanejo samo v tem brskalniku.</p>';")
body = rep(body, "  return h + inviteCard();\n}", "  return h + installCard() + inviteCard();\n}")
body = rep(body, "    case 'toggle-done': showDone = !showDone; render(); break;",
           "    case 'toggle-done': showDone = !showDone; render(); break;\n"
           "    case 'logout': if (armed(t, 'Res se odjavim?')) { if (SB) await SB.auth.signOut(); } break;\n"
           "    case 'auth-view': AUTH.view = t.dataset.v; AUTH.msg = ''; render(); break;\n"
           "    case 'auth-reset': authReset(); break;\n"
           "    case 'hide-install': LS.set('dano.installHide', '1'); render(); break;")
body = rep(body, "    case 'close-invite': S.declined = null;", "    case 'close-invite': LS.set('dano.pendingInvite', ''); S.inviteExt = null; S.declined = null;")
body = rep(body, "    case 'decline-invite': S.declined = t.dataset.code;", "    case 'decline-invite': LS.set('dano.pendingInvite', ''); S.declined = t.dataset.code;")

# zagon: nadomesti z backend.js
start = body.index('/* ---------- Zagon ---------- */')
end = body.index('init();\n})();', start) + len('init();\n')
body = body[:start] + backend.rstrip('\n') + '\n' + body[end:]

out = head + body.rstrip('\n') + '\n</body>\n</html>\n'
(root / 'index.html').write_text(out, encoding='utf-8')
print('index.html', len(out))
