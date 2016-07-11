'use strict';

var AdmZip = require('adm-zip');
var fs = require('fs-extra');

module.exports = function(options, next) {
  // Skip if there isn't a zip file.
  if (!options.zipfile) {
    return next();
  }

  // Make sure we have a directory.
  if (!options.directory) {
    return next('No directory provided. Use -d to provide the directory.');
  }

  // Make sure that this directory is supposed to be overwritten.
  if (fs.existsSync(options.directory)) {
    if (!options.force) {
      console.log('Directory already exists, skipping extraction.');
      return next();
    }

    console.log('Deleting previous installation.');
    fs.removeSync(options.directory);
  }

  // Unzip the contents.
  console.log('Extracting contents...');
  var zip = new AdmZip(options.zipfile);
  zip.extractAllTo('', true);
  next();
};
