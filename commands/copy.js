'use strict';

var series = require('../src/series');

module.exports = function(program, next) {
  program
    .command('copy <type> <source> <destination>')
    .description('Copy a form or project from one source to a destination.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('-k, --key [key]', 'The API Key to provide to the destination forms.')
    .option('--src-key [key]', 'The API Key to provide to the source form')
    .option('--dst-key [key]', 'The API Key to provide to the destination form')
    .option('--src-admin-key [key]', 'The Admin API Key to provide to the source form')
    .option('--dst-admin-key [key]', 'The Admin API Key to provide to the destination form')
    .option('--full', 'Will copy full form or resource structure')
    .option(
      '--migrate-pdf-files [migratePdfFiles]',
      'Pass this option if you want to migrate PDF files from source PDF server to the destination for PDF forms',
      false
    )
    .action(series([
      require('../src/authenticate')({
        src: 1,
        dst: 2
      }),
      require('../src/copy')
    ], next));
};
