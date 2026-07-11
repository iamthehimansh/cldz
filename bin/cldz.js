#!/usr/bin/env node
'use strict';

const { main } = require('../src/index.js');
const tty = require('../src/tty.js');

main(process.argv.slice(2))
  .then(() => {
    // Release any open prompt interface so the process can exit (e.g. after
    // `--config`'s "Save & exit"). The run path exits via the spawned child.
    tty.close();
  })
  .catch((err) => {
    tty.close();
    if (err && err.code === 'CLDZ_ABORT') {
      // User cancelled a prompt. Exit quietly.
      process.exit(130);
    }
    console.error('cldz: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
