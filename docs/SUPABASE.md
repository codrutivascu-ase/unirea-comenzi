# Sincronizare prin Supabase

Durează cam 10 minute și e gratuit pentru volumul nostru.

## 1. Proiect nou

1. Cont pe [supabase.com](https://supabase.com) → **New project**.
2. Alege regiunea `eu-central` (Frankfurt), e cea mai apropiată.

## 2. Tabela

În **SQL Editor**, rulează:

```sql
create table comenzi (
  id          text primary key,
  sesiune     text not null,          -- comanda curenta, ex. "r7"
  runda       integer,
  data        date not null default current_date,
  magazin     text not null,
  status      text not null default 'draft',
  linii       jsonb not null default '{}'::jsonb,
  altele      jsonb not null default '[]'::jsonb,
  modificat   timestamptz,            -- magazinul a mai adaugat ceva dupa finalizare
  actualizat  timestamptz not null default now()
);

create index comenzi_sesiune_idx on comenzi (sesiune);
create index comenzi_magazin_idx on comenzi (magazin, actualizat desc);

-- runda deschisa si catalogul de produse, controlate din depozit
create table setari (
  id          text primary key,
  valoare     jsonb not null,
  actualizat  timestamptz not null default now()
);

alter table comenzi enable row level security;
alter table setari  enable row level security;

-- faza de test: oricine are linkul poate citi si scrie
create policy "acces aplicatie" on comenzi
  for all using (true) with check (true);
create policy "acces setari" on setari
  for all using (true) with check (true);
```

> Dacă ai rulat o versiune mai veche a acestui fișier, adaugă coloana lipsă:
> `alter table comenzi add column if not exists modificat timestamptz;`

> Politica de mai sus e potrivită pentru test, pentru că linkul e privat.
> Când trecem pe lucru real punem autentificare pe magazin și înlocuim politica.

## 3. Cheile

**Settings → API**: copiază `Project URL` și cheia `anon public`, apoi pune-le în
`config.js` din acest repository:

```js
window.CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabaseKey: "eyJhbGciOi...",
  magazine: { kaufland: "Kaufland", bistrita: "Bistrița" }
};
```

Salvezi, dai push, și în câteva minute GitHub Pages servește versiunea nouă.
Aplicația trece singură din „mod local" în mod sincronizat — se vede pe ecranul de intrare.

## 4. Verificare

Deschide `#kaufland` pe un telefon și `#depozit` pe altul. Ce scrie magazinul
apare la depozit în maximum 8 secunde. Apasă „Finalizează” la depozit si cosul
magazinului se goleste pentru comanda urmatoare.
