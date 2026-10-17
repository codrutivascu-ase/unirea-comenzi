# Comenzi Unirea Gospodarilor

Aplicație web (PWA) prin care magazinele trimit comanda zilnică la depozit, iar depozitul
vede centralizat ce are de pregătit.

## Linkuri

După ce GitHub Pages este pornit (Settings → Pages → Source: `main`, folder `/root`):

| Cine | Link |
|---|---|
| Magazin Kaufland | `https://codrutivascu-ase.github.io/unirea-comenzi/#kaufland` |
| Magazin Bistrița | `https://codrutivascu-ase.github.io/unirea-comenzi/#bistrita` |
| Depozit | `https://codrutivascu-ase.github.io/unirea-comenzi/#depozit` |

Pe telefon: deschizi linkul în Chrome (Android) sau Safari (iPhone) → meniu →
**Adaugă la ecranul principal**. De atunci se deschide ca o aplicație, pe tot ecranul,
și merge și fără semnal.

## Unde se salvează comenzile

- **Mod local** (implicit): comenzile rămân pe telefonul pe care au fost scrise.
  Bun pentru a încerca interfața, nu și pentru lucru real.
- **Supabase**: completezi `supabaseUrl` și `supabaseKey` în [config.js](config.js) și
  urmezi [docs/SUPABASE.md](docs/SUPABASE.md). De atunci magazinele și depozitul văd aceleași
  comenzi, de pe orice telefon.

## Fișiere

| Fișier | Ce conține |
|---|---|
| `index.html` | interfața și stilurile |
| `app.js` | logica: comenzi, centralizator, salvare |
| `produse.js` | catalogul de 47 de produse, cu U/M și preț |
| `config.js` | magazinele și datele de conectare la Supabase |
| `sw.js`, `manifest.webmanifest` | partea de PWA (instalare pe telefon, offline) |
| `docs/SPEC.md` | fluxul complet și etapele următoare |

## Ce urmează

1. Supabase, ca să se sincronizeze între magazine și depozit.
2. Aviz PDF în formatul actual („Notă de comandă / Dispoziție de livrare").
3. Integrare SmartBill: avizul emis direct din aplicație.
