'use strict';
const Rekeyer = require('./Rekeyer');
module.exports = async function(mongoUrl, options) {
  const rekeyer = new Rekeyer(mongoUrl, options);
  try {
    await rekeyer.rekey();
  }
  catch (err) {
    console.error(err.message.red);
    process.exitCode = 1;
  }
};
