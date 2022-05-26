module.exports = function(record, next) {
  var metadata = record.metadata || {};
  metadata.from = record._id;
  return next(null, {
    data: record.data,
    metadata: metadata,
    created: record.created,
    modified: record.modified
  });
};