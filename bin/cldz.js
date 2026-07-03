#!/usr/bin/env node
'use strict';

const { main } = require('../src/index.js');

main(process.argv.slice(2)).catch((err) => {
  if (err && err.code === 'CLDZ_ABORT') {
    // User cancelled a prompt. Exit quietly.
    process.exit(130);
  }
  console.error('cldz: ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
});
