// src/generate-license.js
// Script de línea de comandos para generar códigos de licencia.
//
// USO:
//   node src/generate-license.js <max_machines> ["nota opcional"]
//
// EJEMPLOS:
//   node src/generate-license.js 1
//   node src/generate-license.js 3 "Cliente: Juan Pérez - pedido #102"
//
// También se puede correr con: npm run generate-license -- 1 "nota"

const crypto = require("crypto");
const { createLicense } = require("./db");

function generateCode() {
  // Formato tipo XXXX-XXXX-XXXX-XXXX usando caracteres sin ambigüedad
  // visual (sin 0/O, 1/I, etc.) para que sea fácil de transcribir a mano.
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      const idx = crypto.randomInt(0, ALPHABET.length);
      group += ALPHABET[idx];
    }
    groups.push(group);
  }
  return groups.join("-");
}

function main() {
  const args = process.argv.slice(2);
  const maxMachinesArg = args[0];
  const note = args[1];

  const maxMachines = parseInt(maxMachinesArg, 10);

  if (![1, 3].includes(maxMachines)) {
    console.error("ERROR: el primer argumento debe ser 1 o 3 (número de PCs permitidas).");
    console.error('Uso: node src/generate-license.js <1|3> ["nota opcional"]');
    process.exit(1);
  }

  let code = generateCode();
  let attempts = 0;

  // Reintentar en el caso (extremadamente improbable) de colisión de código
  while (attempts < 5) {
    try {
      const license = createLicense(code, maxMachines, note);
      console.log("✅ Licencia generada con éxito:\n");
      console.log(`   Código:        ${license.code}`);
      console.log(`   Máquinas:      ${license.max_machines}`);
      console.log(`   Nota:          ${license.note || "(sin nota)"}`);
      console.log(`   Creada:        ${license.created_at}`);
      console.log("\nEntrega este código al cliente. Podrá activarlo en hasta");
      console.log(`${license.max_machines} PC${license.max_machines > 1 ? "s" : ""} distinta${license.max_machines > 1 ? "s" : ""}.`);
      return;
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
        code = generateCode();
        attempts++;
        continue;
      }
      throw err;
    }
  }

  console.error("ERROR: no se pudo generar un código único tras varios intentos. Intenta de nuevo.");
  process.exit(1);
}

main();
