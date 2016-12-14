'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('migrate <source> <transformer> <destination>')
    .description('Migrate data from a source (CSV or Form) to a destination form.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--key [key]', 'The API Key to provide to the destination forms.')
    .option('--src-key [key]', 'The API Key to provide to the source form')
    .option('--dst-key [key]', 'The API Key to provide to the destination form')
    .option('--username [username]', 'The destination username to authenticate with')
    .option('--src-username [username]', 'The source username to authenticate with')
    .option('--dst-username [username]', 'The destination username to authenticate with')
    .option('--password [password]', 'The destination password')
    .option('--src-password [password]', 'The source password')
    .option('--dst-password [password]', 'The destination password')
    .action(series([
      require('../src/authenticate')({
        src: 0,
        dst: 2
      }),
      require('../src/migrate')
    ], next));
};
