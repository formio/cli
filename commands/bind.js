var series = require('../src/series');
module.exports = function(program, next) {
    program
        .command('bind [method] [url]')
        .description('Bind to a form via websockets.')
        .option('-s, --server [server]', 'The server to use for binding.')
        .option('-u, --username [username]', 'The Form.io username to authenticate with')
        .option('--password [password]', 'The Form.io username password')
        .action(series([
            require('../src/authenticate'),
            require('../src/bind')
        ], next));
};