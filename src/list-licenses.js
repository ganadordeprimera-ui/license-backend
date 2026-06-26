// src/list-licenses.js
// Lista todas las licencias generadas, con su estado de activación
// (cuántas PCs ya la usan, sobre el máximo permitido).
//
// USO:
//   node src/list-licenses.js
//   node src/list-licenses.js XXXX-XXXX-XXXX-XXXX   (detalle de una licencia específica)

const { listLicenses, getLicense, getActivations } = require("./db");

function printLicenseDetail(code) {
  const license = getLicense(code);
  if (!license) {
    console.error(`No existe ninguna licencia con el código: ${code}`);
    process.exit(1);
  }
  const activations = getActivations(code);

  console.log(`\nLicencia: ${license.code}`);
  console.log(`  Máquinas permitidas: ${license.max_machines}`);
  console.log(`  Activaciones usadas: ${activations.length}/${license.max_machines}`);
  console.log(`  Estado: ${license.revoked ? "❌ REVOCADA" : "✅ Activa"}`);
  console.log(`  Nota: ${license.note || "(sin nota)"}`);
  console.log(`  Creada: ${license.created_at}`);

  if (activations.length > 0) {
    console.log(`\n  Máquinas activadas:`);
    activations.forEach((a, i) => {
      console.log(`   ${i + 1}. machine_id: ${a.machine_id}`);
      console.log(`      Activada: ${a.activated_at}  |  Última vez vista: ${a.last_seen_at}`);
    });
  }
  console.log("");
}

function printSummaryTable() {
  const licenses = listLicenses();

  if (licenses.length === 0) {
    console.log("Todavía no hay licencias generadas.");
    console.log('Usa: node src/generate-license.js <1|3> ["nota"]');
    return;
  }

  console.log(`\nTotal de licencias: ${licenses.length}\n`);
  console.log(
    "CÓDIGO".padEnd(22) +
      "MÁX".padEnd(6) +
      "USADAS".padEnd(9) +
      "ESTADO".padEnd(12) +
      "NOTA"
  );
  console.log("-".repeat(70));

  for (const lic of licenses) {
    const activations = getActivations(lic.code);
    const usados = `${activations.length}/${lic.max_machines}`;
    const estado = lic.revoked ? "REVOCADA" : "Activa";
    console.log(
      lic.code.padEnd(22) +
        String(lic.max_machines).padEnd(6) +
        usados.padEnd(9) +
        estado.padEnd(12) +
        (lic.note || "")
    );
  }
  console.log("");
}

function main() {
  const code = process.argv[2];
  if (code) {
    printLicenseDetail(code);
  } else {
    printSummaryTable();
  }
}

main();
