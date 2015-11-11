module.exports = function(program, next) {
    return {
        bootstrap: require('./bootstrap.js')(program, next),
        deploy: require('./deploy.js')(program, next),
        serve: require('./serve.js')(program, next)
    };
};