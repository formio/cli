'use strict';
module.exports = function(program, next) {
  program
    .command('clone <source> <destination>')
    .description('Clone a database (project) from one place to another.')
    .option('--deleted-after [timestamp]', 'Only clone items deleted after the provided UNIX timestamp.')
    .option('-a, --all', 'Include All items (including deleted items', false)
    .option('-p, --project <project_id>', 'The project ID that you wish to clone from one database to another.')
    .option('--src-ssl', 'If the source mongo url should be over ssl')
    .option('--dst-ssl', 'If the destination mongo url should be over ssl')
    .option('--src-ca', 'The CA certificate for the source mongo url')
    .option('--dst-ca', 'The CA certificate for the destination mongo url')
    .action((source, destination, options) => require('../src/clone')(source, destination, options));
};
