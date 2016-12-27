'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('submissions <source> [each]')
    .description('Reads submissions from a form and either outputs that to the terminal or hands each submission to an each middleware')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--key [key]', 'The API Key to provide to the destination forms.')
    .option('--username [username]', 'The destination username to authenticate with')
    .option('--password [password]', 'The destination password')
    .action(series([
      require('../src/authenticate')({
        dst: 0
      }),
      require('../src/submissions')
    ], next));
};
