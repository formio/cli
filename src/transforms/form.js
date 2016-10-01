module.exports = function(record, next) {
  return next(null, {data: record.data});
};