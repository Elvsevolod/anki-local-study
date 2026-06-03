# Anki Local Study

Local Anki-style web app for importing `.apkg` decks and studying cards in the browser.
<img alt="image" src="https://github.com/user-attachments/assets/10c24a75-9b0f-4176-be51-e3dd24762585" />

## Online Version

Open the GitHub Pages version:

https://elvsevolod.github.io/anki-local-study/

## Run Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/Elvsevolod/anki-local-study.git
   cd anki-local-study
   ```

2. Start a local static server:

   ```bash
   python3 -m http.server 8000
   ```

   On Windows, use:

   ```bash
   python -m http.server 8000
   ```

3. Open the app:

   ```text
   http://localhost:8000
   ```

4. Click `Загрузить .apkg`, choose your Anki package, then study the imported cards.

## Notes

- The app runs locally in the browser. Your `.apkg` file is not uploaded to a backend server.
- Progress is saved in browser `localStorage`.
- The page loads JSZip, sql.js, fzstd, and lucide from CDN, so internet access is needed when opening the app for the first time.
- Modern Anki packages with `collection.anki21b` and Zstandard-compressed media are supported.
