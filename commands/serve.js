'use strict';

var series = require('../src/series');
var fs = require('fs-extra');

module.exports = function(program, next) {
  program
    .command('serve [directory]')
    .description('Serves an application')
    .option('-p, --port [port]', 'The port you wish to serve the application.')
    .action(series([
      function(options, next) {
        options.directory = options.param;

        if (!fs.existsSync(options.directory)) {
          return next('Directory not found');
        }

        if (!fs.existsSync(options.directory + '/package.json')) {
          return next('package.json not found.');
        }

        // Get the package json file.
        var info = {};
        try {
          info = JSON.parse(fs.readFileSync(options.directory + '/package.json'));
        }
        catch (err) {
          return next(err);
        }

        // Change the document root if we need to.
        if (info.formio && info.formio.docRoot) {
          options.directory += '/' + info.formio.docRoot;
        }

        // Move onto the next item.
        next();
      },
      require('../src/serve')
    ], next));
};
