#!/usr/bin/env node
const path = require("node:path");
const {
  openDatabase,
  loadStoreFromFile,
  seedFromStore,
  DB_PATH,
  LEGACY_STORE_PATH
} = require("../db");

function printHelp() {
  console.log("Usage: node scripts/seed-db.js [--reset] [--source <path>]");
  console.log("  --reset          vide les tables avant injection");
  console.log("  --source <path>  chemin du JSON source (defaut: data/store.json)");
}

function parseArgs(argv) {
  const options = {
    reset: false,
    source: LEGACY_STORE_PATH
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg === "--source") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--source requiert un chemin");
      }
      options.source = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    throw new Error(`Argument inconnu: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const db = openDatabase();
  try {
    const store = loadStoreFromFile(options.source);
    const stats = seedFromStore(db, store, { clearBefore: options.reset });
    console.log(`SQLite seed termine: ${DB_PATH}`);
    console.log(
      `patients=${stats.patients} biologists=${stats.biologists} protocols=${stats.protocols} messages=${stats.messages}`
    );
    console.log(`source=${options.source}`);
    console.log(`mode=${options.reset ? "reset" : "merge"}`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Erreur seed: ${error.message}`);
  process.exitCode = 1;
}
