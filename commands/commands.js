module.exports = function(program, next) {
    return {
        bootstrap: require('./bootstrap.js')(program, next),
        serve: require('./serve.js')(program, next)
    };
};