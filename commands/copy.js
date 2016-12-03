'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('copy <type> <source> <destination>')
    .description('Copy a form or project from one source to a destination.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('-k, --key [key]', 'An API Key for your project')
    .option('-k, --dst-key [key]', 'An API Key for your project')
    .option('--username [username]', 'The source username to authenticate with')
    .option('--password [password]', 'The source password')
    .option('--dst-username [username]', 'The source username to authenticate with')
    .option('--dst-password [password]', 'The source password')
    .action(series([
      require('../src/copy')
    ], next));
};
