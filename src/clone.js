'use strict';
const Cloner = require('./Cloner');
module.exports = async function(source, destination, options) {
  const cloner = new Cloner(source, destination, options);
  await cloner.clone();
};
