'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('migrate <source> <transformer> <destination>')
    .description('Migrate data from a source (CSV or Form) to a destination form.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--key [key]', 'An API Key for your project')
    .option('--username [username]', 'The source username to authenticate with')
    .option('--password [password]', 'The source password')
    .action(series([
      require('../src/authenticate'),
      require('../src/migrate')
    ], next));
};
