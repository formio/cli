module.exports = function(program, next) {
    return {
        bootstrap: require('./bootstrap.js')(program, next)
    };
};