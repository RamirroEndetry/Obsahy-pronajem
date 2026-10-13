// Vytvoří hodnotu tajné proměnné USERS (otisky PINů) z lokálního souboru users.local.json.
// users.local.json se do gitu NEnahrává (viz .gitignore).
//
// Použití:
//   node scripts/make-users.mjs            -> vypíše USERS a PIN_PEPPER, zapíše .dev.vars pro lokální vývoj
//
// Formát users.local.json:
// {
//   "pepper": "náhodný-dlouhý-řetězec",
//   "users": {
//     "jiri": { "name": "Jiří V.", "login": "Jiří.V", "color": "#2b57ff", "admin": true, "pin": "1234" }
//   }
// }
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const cfg = JSON.parse(readFileSync(new URL("../users.local.json", import.meta.url), "utf8"));
if (!cfg.pepper || cfg.pepper.length < 16) throw new Error("V users.local.json chybí 'pepper' (aspoň 16 znaků).");

const out = {};
for (const [id, u] of Object.entries(cfg.users)) {
  if (!/^\d{4,8}$/.test(String(u.pin))) throw new Error(`PIN uživatele ${id} musí mít 4–8 číslic.`);
  out[id] = {
    name: u.name, login: u.login, color: u.color, admin: !!u.admin,
    pinHash: createHash("sha256").update(`${cfg.pepper}:${id}:${u.pin}`).digest("hex"),
  };
}
const users = JSON.stringify(out);
writeFileSync(new URL("../.dev.vars", import.meta.url), `PIN_PEPPER='${cfg.pepper}'\nUSERS='${users}'\n`);
console.log("Zapsáno .dev.vars pro lokální vývoj.\n");
console.log("PIN_PEPPER:\n" + cfg.pepper + "\n");
console.log("USERS:\n" + users);
