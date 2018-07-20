'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('pdf <action> <pdf_file> <destination>')
    .description('Create or Update a new Form.io JSON form with a provided PDF file.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--dst-key [key]', 'The API Key to provide to the destination form')
    .option('--dst-username [username]', 'The destination username to authenticate with')
    .option('--dst-password [password]', 'The destination password')
    .action(series([
      require('../src/authenticate')({
        dst: 2
      }),
      require('../src/pdf')
    ], next));
};
