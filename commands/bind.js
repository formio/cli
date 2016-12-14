'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('bind [method] [url] [middleware]')
    .description('Bind to a form via websockets.')
    .option('-s, --server [server]', 'The server to use for binding.')
    .option('-k, --key [key]', 'An API Key for your project')
    .option('-u, --username [username]', 'The Form.io username to authenticate with')
    .option('--password [password]', 'The Form.io username password')
    .action(series([
      function(options, next) {
        var url = options.params[1];
        var parts = url.split('://');
        var subparts = parts[1].split('/');
        var hostparts = subparts[0].split('.');
        if (
          (hostparts.length > 2) ||
          ((hostparts.length > 1) && hostparts[1].indexOf('localhost') !== -1)
        ) {
          hostparts.shift();
        }
        options.server = parts[0] + '://' + hostparts.join('.');
        options.projectUrl = parts[0] + '://' + subparts[0];
        options.formPath = subparts[1];
        next();
      },
      require('../src/authenticate')({
        dst: 1
      }),
      require('../src/bind')
    ], next));
};
