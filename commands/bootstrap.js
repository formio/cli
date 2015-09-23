var series = require('../src/series');
module.exports = function(formio, program, next) {
    program
        .version('0.0.1')
        .command('bootstrap [app]', 'Bootstrap an application')
        .option('-d, --directory [directory]', 'The output directory of the application')
        .option('-u, --username [username]', 'The Form.io username to authenticate with')
        .option('-f, --force [force]', 'Force overwrite of any previous directories.')
        .option('-z, --zipfile [zipfile]', 'Bootstrap from a zip file.')
        .option('-p, --port [port]', 'The port you wish to serve the application.')
        .action(series([
            require('../src/authenticate')(formio),
            require('../src/bootstrap')(formio)
        ], next));
};