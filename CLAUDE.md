# Instrucțiuni pentru acest proiect

## Actualizează mereu versiunea de cache la orice modificare de cod

Aplicația e un PWA cu service worker (`sw.js`) care face cache pe `app.js`, `produse.js`, `config.js`, `index.html`. La **orice** modificare a acestor fișiere, trebuie urcat numărul de versiune în ambele locuri, altfel telefoanele/browserele cu aplicația deja instalată rămân pe codul vechi din cache:

1. `sw.js`:
   - `var VERSIUNE = "ug-comenzi-vNN";` → incrementează `NN`
   - în array-ul `FISIERE`, actualizează și query string-urile `?v=NN` pentru `app.js`, `produse.js`, `config.js`
2. `index.html`:
   - `<script src="config.js?v=NN">`, `produse.js?v=NN`, `app.js?v=NN` → același `NN` nou

Fă asta în același commit cu modificarea de cod, nu separat ulterior — uitarea acestui pas a fost deja o sursă de confuzie ("nu văd modificările în aplicație" deși push-ul a mers).
