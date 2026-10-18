# Unirea Gospodarilor — Aplicatie comenzi magazine → depozit

## 1. Problema actuala
Lista de produse pe hartie (47 pozitii), trimisa de 2x/zi catre depozit. Vanzatoarele scriu
cantitatea solicitata; depozitul produce si livreaza a doua zi dimineata, cu aviz + NIR.
Probleme: transcriere manuala, lipsa centralizare, lipsa istoric, erori de citire.

## 2. Utilizatori si roluri
| Rol | Cine | Ce poate face |
|---|---|---|
| Vanzator | Kaufland, Bistrita | Introduce/editeaza cantitati pe comanda proprie, pana la ora limita. Vede istoricul magazinului. |
| Depozit | Productie / gestionar | Vede centralizat toate comenzile, totaluri pe produs, marcheaza cantitatea livrata, inchide comanda. |
| Admin | Patron | Toate cele de mai sus + editare catalog produse, preturi, utilizatori, magazine. |

## 3. Model de date
- **magazin**: id, nume, activ
- **produs**: nr_crt, nume, um (Kg/L/Buc), pret, categorie, activ, ordine
- **sesiune_comanda** (ciclu): id, data_livrare, tura (1 = pranz / 2 = dimineata), deadline, status (deschisa | blocata | livrata)
- **comanda**: id, sesiune_id, magazin_id, status (draft | trimisa | confirmata), trimisa_la, trimisa_de
- **linie_comanda**: comanda_id, produs_id, cant_solicitata (in BUCATI), cant_livrata (in U/M: Kg, L, Buc), lot, observatii
- **utilizator**: id, nume, rol, magazin_id, pin/parola

Preturile se stocheaza *pe linie* la momentul trimiterii (snapshot), ca sa nu se schimbe istoricul
cand modifici catalogul.

## 4. Flux
1. Sistemul deschide automat sesiunea pentru data de maine (2 sesiuni/zi, cu ore limita configurabile).
2. Vanzatoarea deschide PWA → ecran "Comanda pentru 18.10, tura seara" → lista produse cu un camp
   numeric per produs. Salvare automata locala (offline-first), sincronizare cand e net.
3. Apasa **Trimite comanda** → status `trimisa`. Poate modifica pana la deadline (versiune noua,
   cu istoric cine/cand).
4. La deadline sesiunea se blocheaza. Depozitul vede tabelul centralizator:
   `Produs | U/M | Kaufland | Bistrita | TOTAL | Livrat`
5. Depozitul completeaza cantitatea livrata si lotul, pe magazin. Diferentele (solicitat vs livrat)
   sunt evidentiate.
6. Export: PDF "Nota de comanda / Dispozitie de livrare / Aviz de insotire" identic cu formularul
   actual (un PDF per magazin).

## 5. Ecrane
**Vanzator (mobil)**
- Login (PIN)
- Comanda curenta: cautare produs, categorii (Carne pui / Lactate / Mezeluri / Carne porc / Diverse),
  tastatura numerica mare, badge "x produse completate", buton "Copiaza comanda de ieri".
- Rezumat inainte de trimitere (nr. pozitii + valoare estimata)
- Istoric comenzi

**Depozit (tableta/desktop)**
- Dashboard sesiuni: cine a trimis / cine lipseste, countdown pana la deadline
- Centralizator pe produs cu coloane per magazin si TOTAL (ecranul principal de productie)
- Vedere pe magazin pentru pregatirea avizului
- Buton export PDF / Excel

**Admin**
- Produse (adauga, dezactiveaza, pret), magazine, utilizatori, ore limita

## 6. Decizii tehnice propuse
- **PWA**: React + Vite + TypeScript, instalabila pe telefon, service worker pentru offline.
- **Backend**: Supabase (Postgres + Auth + Realtime + Row Level Security) — plan gratuit suficient
  pentru 3-5 utilizatori. Depozitul vede comenzile in timp real, fara refresh.
- **Hosting**: GitHub Pages sau Vercel (gratuit), cod pe GitHub.
- Alternativa fara backend propriu: Google Sheets ca baza de date — mai fragil, nu recomand.
- Fara legatura cu programul de gestiune. Magazinele sunt gestiuni ale aceleiasi firme, deci
  miscarea marfii e un transfer intern, nu o vanzare, si se face manual acolo. Aplicatia se
  opreste la comanda si centralizator.

## 7. Etape
- **Faza 1 (MVP)**: catalog, introducere comanda, trimitere, centralizator depozit, export PDF/Excel.
- **Faza 2**: cantitate livrata + lot, diferente, istoric si rapoarte (consum pe produs/saptamana).
- **Faza 3**: sugestie cantitate pe baza istoricului.
