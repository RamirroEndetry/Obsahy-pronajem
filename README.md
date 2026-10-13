# Obsahy pronájmů

Interní aplikace Digiday pro správu obsahu na digitálních panelech. Pronájmy se přebírají z NEXu (kopírováním tabulky), admin k nim vkládá odkazy na obsah od klientů a technici potvrzují, že je obsah nahraný na panelech.

- **Admin** vkládá a maže pronájmy, přidává a odebírá odkazy, píše poznámky.
- **Uživatel** otevírá a stahuje obsah a potvrzuje „Obsah je nahraný na panelech“.
- Přehled s připraveností na 7 dní, seznam pronájmů s filtry a kalendář na 14 dní.

## Jak to funguje

| Část | Kde | Co dělá |
|---|---|---|
| `public/index.html` | Cloudflare Pages | celé rozhraní aplikace |
| `functions/api/[[path]].js` | Cloudflare Pages Functions | API, přihlášení, kontrola rolí |
| `migrations/` | Cloudflare D1 | schéma databáze |

PINy se ověřují na serveru. V databázi ani v repozitáři nejsou, jen jejich otisky v tajné proměnné `USERS` na Cloudflare. Přihlášení drží zabezpečená cookie (HttpOnly, 30 dní). Po 5 špatných pokusech se účet na 5 minut zablokuje.

## Tajné hodnoty (nikdy do gitu)

| Soubor / proměnná | Obsah |
|---|---|
| `users.local.json` | uživatelé a jejich PINy, jen lokálně |
| `.dev.vars` | `USERS` a `PIN_PEPPER` pro lokální vývoj, vygeneruje `scripts/make-users.mjs` |
| `USERS`, `PIN_PEPPER` | tajné proměnné v Cloudflare Pages |

Vzor `users.local.json`:

```json
{
  "pepper": "dlouhy-nahodny-retezec",
  "users": {
    "jiri": { "name": "Jiří V.", "login": "Jiří.V", "color": "#2b57ff", "admin": true, "pin": "1234" }
  }
}
```

## Lokální vývoj

```bash
node scripts/make-users.mjs
npx wrangler d1 migrations apply obsahy-pronajmu --local
npx wrangler pages dev --port 8788
```

Aplikace pak běží na http://localhost:8788.

## Nasazení na Cloudflare (jednorázově)

> Na Windows, kde PowerShell blokuje skripty, pište místo `npx` příkaz `npx.cmd`.

Aplikace běží na **https://obsahy-pronajmu.pages.dev**.

1. `npx wrangler login`
2. `npx wrangler d1 create obsahy-pronajmu` a vrácené `database_id` vložit do `wrangler.toml`
3. `npx wrangler d1 migrations apply obsahy-pronajmu --remote`
4. `npx wrangler pages project create obsahy-pronajmu --production-branch main`
5. `node scripts/make-users.mjs` a vypsané hodnoty uložit jako tajné proměnné:
   `npx wrangler pages secret put USERS` a `npx wrangler pages secret put PIN_PEPPER`
6. `npx wrangler pages deploy`

Případně v Cloudflare dashboardu propojit projekt s tímto GitHub repozitářem. Pak se každý push do `main` nasadí sám.

## Změna PINu nebo přidání uživatele

Upravit `users.local.json`, spustit `node scripts/make-users.mjs` a nově vypsanou hodnotu `USERS` znovu uložit přes `npx wrangler pages secret put USERS`.
