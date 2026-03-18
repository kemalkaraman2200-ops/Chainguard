# ChainGuard — Opsætning

## Krav
- Node.js 18 eller nyere (https://nodejs.org)
- Ingen npm-pakker nødvendige

## Start på 2 minutter

1. Læg begge filer i samme mappe:
   - server.js
   - chainguard-final.html

2. Åbn terminal i mappen og kør:
   ```
   node server.js
   ```

3. Åbn http://localhost:3000 i din browser

## CVR-opslag virker nu automatisk via proxy

- Søg på CVR-nummer (8 cifre) eller firmanavn
- Data hentes fra cvrapi.dk uden CORS-problemer
- "Tilføj til database" tilføjer leverandøren live i systemet

## Officiel Virk API (valgfri)

For adgang til Erhvervsstyrelsens officielle Virk API:
1. Kontakt: cvrselvbetjening@erst.dk
2. Anmodning om "System-til-system adgang til CVR-data"
3. Indtast brugernavn + adgangskode via ⚙ API-nøgle knappen i softwaren

Med officiel adgang får du:
- Fuzzy navnesøgning på tværs af alle ~2.2 mio. danske virksomheder
- Fuld historik, ejerstruktur og produktionsenheder
- Ingen rate-limiting

## Port

Standardport er 3000. Skift med:
```
PORT=8080 node server.js
```
