'use strict';

const series = require('../src/series');

const DEPRECATION_WARNING ='WARNING: This command is deprecated, and will be removed in the near future. ' +
  'Please review available commands for alternatives.';

module.exports = function(program, next) {
  const action = series([
    require('../src/authenticate')({
      src: 0,
      dst: 2
    }),
    require('../src/migrate')
  ], next);

  program
    .command('migrate <source> <transformer> <destination>')
    .description('(DEPRECATED) Migrate data from a source (CSV or Form) to a destination form.')
    .option('-p, --protocol [protocol]', 'Change the protocol.')
    .option('-h, --host [host]', 'Set the host for the copy.')
    .option('--key [key]', 'The API Key to provide to the destination forms.')
    .option('--src-key [key]', 'The API Key to provide to the source form')
    .option('--dst-key [key]', 'The API Key to provide to the destination form')
    .option('--src-admin-key [key]', 'The Admin API Key to provide to the source form')
    .option('--dst-admin-key [key]', 'The Admin API Key to provide to the destination form')
    .option(
      '--migrate-pdf-files [migratePdfFiles]',
      'Pass this option if you want to migrate PDF files from source PDF server to the destination for PDF forms',
      false
    )
    .option('--start-with [startWith]', 'Start the migration from a specific form. Useful to replay migrations.')
    .option('--delete [delete]', 'Deletes all submissions in the destination form before the migration occurs.')
    .option('--delete-previous [deletePrevious]', 'Deletes previous submissions that have been migrated with the migrate script.')
    .option('--delete-after [deleteAfter]', 'Provides the ability to delete submissions created in the Source after the provided timestamp. The timestamp should be in the format of 2022-05-30T12:00:00.000Z. Use with delete-before to create a delete "window".')
    .option('--delete-before [deleteBefore]', 'Provides the ability to delete submissions created in the Before after the provided timestamp. The timestamp should be in the format of 2022-05-30T12:00:00.000Z.  Use with delete-after to create a delete "window".')
    .action(function() {
      console.log(DEPRECATION_WARNING.yellow);
      action.apply(this, arguments);
    });
};
