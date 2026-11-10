# Dano

Testna aplikacija za skrb za psa ali mačko: hranjenje, zdravila z zalogo, cepljenja in roki,
časovnica opažanj ter deljenje z družino in skrbniki. Vsi vidijo, kdo je kaj dal in kdaj.

- Spletna aplikacija (PWA): odpri jo v Safariju ali Chromu in jo dodaj na začetni zaslon.
- Podatki in prijava: Supabase (`supabase/schema.sql` je struktura baze).
- Gostovanje: Vercel, brez gradnje; vsaka sprememba na veji `main` se objavi sama.

Datoteke:
- `index.html` – celotna aplikacija (dizajn Dano 3 · Smaragd)
- `config.js` – naslov Supabase projekta in javni ključ
- `sw.js`, `manifest.webmanifest`, `icons/` – namestitev na telefon
- `src/` – izvorni deli, iz katerih je sestavljen `index.html` (`python3 src/build.py`)
