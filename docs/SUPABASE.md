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
  sesiune     text not null,
  data        date not null,
  tura        text not null,
  magazin     text not null,
  status      text not null default 'draft',
  linii       jsonb not null default '{}'::jsonb,
  actualizat  timestamptz not null default now()
);

create index comenzi_sesiune_idx on comenzi (sesiune);
create index comenzi_magazin_idx on comenzi (magazin, actualizat desc);

alter table comenzi enable row level security;

-- faza de test: oricine are linkul poate citi si scrie comenzi
create policy "acces aplicatie" on comenzi
  for all using (true) with check (true);
```

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
apare la depozit în maximum 8 secunde.
