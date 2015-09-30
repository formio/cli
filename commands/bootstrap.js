var series = require('../src/series');
module.exports = function(program, next) {
    program
        .command('bootstrap [app]')
        .description('Bootstrap a working application')
        .option('-d, --directory [directory]', 'The output directory of the application')
        .option('-u, --username [username]', 'The Form.io username to authenticate with')
        .option('--password [password]', 'The Form.io username password')
        .option('-f, --force [force]', 'Force overwrite of any previous directories.')
        .option('-z, --zipfile [zipfile]', 'Bootstrap from a zip file.')
        .option('-p, --port [port]', 'The port you wish to serve the application.')
        .option('-s, --server [server]', 'The server to use for deployment.')
        .action(series([
            require('../src/authenticate'),
            require('../src/bootstrap')
        ], next));
};