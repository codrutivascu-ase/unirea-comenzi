/* Configurare aplicatie.
   Atata timp cat supabaseUrl e gol, aplicatia merge in "mod local":
   comenzile se salveaza pe telefonul pe care au fost scrise.
   Cand vrei sincronizare intre magazine si depozit, completeaza cele doua
   valori de mai jos cu datele proiectului Supabase (Settings > API)
   si pune in Supabase tabela descrisa in docs/SUPABASE.md. */
window.CONFIG = {
  supabaseUrl: "https://vvbxkorqigrjebrlrnef.supabase.co",
  supabaseKey: "sb_publishable_bS3pm33QGfDSbeR1bAK_gw_qE4gcCAA",
  magazine: { kaufland: "Kaufland", bistrita: "Bistrița" }
};
