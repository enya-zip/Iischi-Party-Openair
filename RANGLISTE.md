# Rangliste einrichten (Supabase)

Die Rangliste speichert Name, E-Mail-Adresse und Punkte in einer kostenlosen Supabase-Datenbank.
Andere Spieler sehen nur **Platz, Name und Punkte**. E-Mail-Adressen sind nur im Supabase-Dashboard sichtbar.

## 1. Supabase-Projekt anlegen
1. Auf https://supabase.com einloggen und **New project** wählen.
2. Name z. B. `iischi-party`, ein Datenbank-Passwort festlegen (gut aufbewahren, wird fürs Spiel nicht gebraucht).
3. Als Region **Central EU (Zurich)** oder **Frankfurt** wählen (Daten bleiben in Europa).

## 2. Datenbank vorbereiten
1. Im Projekt links **SQL Editor** öffnen.
2. Den ganzen Inhalt von [`supabase/rangliste.sql`](supabase/rangliste.sql) einfügen und auf **Run** klicken.

## 3. Spiel verbinden
1. Die Projekt-Adresse (oben auf **Connect**, sieht aus wie `https://abcdefgh.supabase.co`) und den
   **Publishable key** (beginnt mit `sb_publishable_`, unter **Project Settings → API Keys**) kopieren.
2. Beide in [`app/public/leaderboard-config.js`](app/public/leaderboard-config.js) eintragen:

```js
export const LEADERBOARD = Object.freeze({
  url: "https://DEIN-PROJEKT.supabase.co",
  key: "sb_publishable_..."
});
```

Der Publishable key darf öffentlich im Spiel stehen. Den **Secret key** (`sb_secret_…`) niemals eintragen.

## Einträge ansehen
Supabase → **Table Editor**:
- `rangliste`: bestes Ergebnis pro Spieler mit Platz, Name, E-Mail, Punkten, Trefferquote, bester Serie, Anzahl Läufe und Datum.
  Daraus lassen sich am Schluss die Top 5 für die 4-Tagespässe ablesen.
- `iischi_scores`: alle einzelnen Einträge. Hier lassen sich Einträge löschen
  (z. B. bei Auskunfts- oder Löschanfragen nach Datenschutzgesetz oder bei verdächtigen Punktzahlen).

## Gut zu wissen
- Pro E-Mail-Adresse zählt nur das beste Ergebnis.
- Pro E-Mail-Adresse sind höchstens 20 Einträge pro Stunde möglich (Spam-Schutz).
- Die Punkte werden im Browser berechnet. Wer sich mit Technik auskennt, könnte eine falsche Punktzahl einsenden.
  Die höchste mögliche Punktzahl liegt bei 27'600. Verdächtige Einträge vor der Gewinnerauswahl prüfen.
- Falls das Spiel auf einer Website mit Content-Security-Policy eingebettet wird, muss `connect-src` die Supabase-Adresse erlauben.
