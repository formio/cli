'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('copy <type> <source> <destination>')
    .description('Copy a form or project from one source to a destination.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--username [username]', 'The source username to authenticate with')
    .option('--password [password]', 'The source password')
    .action(series([
      require('../src/authenticate'),
      require('../src/copy')
    ], next));
};
