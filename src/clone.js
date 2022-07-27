'use strict';
const mongodb = require('mongodb');
const async = require('async');
const _ = require('lodash');
const MongoClient = mongodb.MongoClient;

module.exports = function (source, destination, options) {
  // If the source and destination are the same, then we need to create new records.
  const createNew = (source === destination);
  const mongoConfig = (type) => {
    const config = {
      useNewUrlParser: true,
      useUnifiedTopology: true
    };
    if (options[`${type}Ca`]) {
      const caFile = options[`${type}Ca`];
      config.tls = true;
      config.tlsCAFile = `${process.cwd()}/${caFile}`;
      if (options[`${type}Cert`]) {
        const certFile = options[`${type}Cert`];
        config.tlsCertificateKeyFile = `${process.cwd()}/${certFile}`;
      }
      config.tlsAllowInvalidHostnames = true;
    }
    return config;
  };

  const srcConfig = mongoConfig('src');
  console.log(`Connecting to ${source} with config ${JSON.stringify(srcConfig, null, 2)}\n`);
  MongoClient.connect(source, srcConfig, (err, _src) => {
    if (err) {
      return console.log(`Could not connect to source database ${source}: ${err.message}`);
    }

    console.log(`Succesfully connected to ${source}`);
    const srcDb = _src.db(_src.s.options.dbName);
    const srcSubs = srcDb.collection('submissions');
    const src = {
      db: srcDb,
      projects: srcDb.collection('projects'),
      forms: srcDb.collection('forms'),
      submissions: srcSubs,
      roles: srcDb.collection('roles'),
      actions: srcDb.collection('actions'),
      formrevisions: srcDb.collection('formrevisions'),
      tags: srcDb.collection('tags')
    };

    const dstConfig = mongoConfig('dst');
    console.log(`\nConnecting to ${destination} with config ${JSON.stringify(dstConfig, null, 2)}\n`);
    MongoClient.connect(destination, dstConfig, (err, _dest) => {
      if (err) {
        return console.log(`Could not connect to destination database ${destination}`);
      }

      console.log(`Succesfully connected to ${destination}`);
      console.log('');
      const destDb = _dest.db(_dest.s.options.dbName);
      const destSubs = destDb.collection('submissions');
      const dest = {
        db: destDb,
        projects: destDb.collection('projects'),
        forms: destDb.collection('forms'),
        submissions: destSubs,
        roles: destDb.collection('roles'),
        actions: destDb.collection('actions'),
        formrevisions: destDb.collection('formrevisions'),
        tags: destDb.collection('tags')
      };

      // Iterate through each document within a cursor.
      const eachDocument = function (cursor, each, done) {
        let current = null;
        async.whilst(
          (test) => {
            cursor.next((err, doc) => {
              if (err) {
                current = null;
                return test(err);
              }
              current = doc;
              test(null, !!doc);
            });
          },
          (nextItem) => each(current, nextItem),
          done);
      };

      const findExisting = function(current) {
        return {_id: current._id}
      };

      // Upsert all documents within the collection provided a query.
      const upsertAll = function (collection, query, beforeEach, afterEach, done, findQuery) {
        if (!findQuery) {
          findQuery = findExisting;
        }
        eachDocument(src[collection].find(query), (current, nextItem) => {
          let cloned = _.cloneDeep(current);
          const onCreated = (err, copy) => {
            if (err) {
              console.error(`Error creating ${collection} ${current._id}`, err);
              return nextItem();
            }
            process.stdout.write('.');
            if (afterEach) {
              afterEach(current, copy, nextItem);
            }
            else {
              nextItem();
            }
          };

          if (createNew) {
            delete current._id;
            if (beforeEach) {
              beforeEach(cloned);
            }
            dest[collection].insertOne(cloned, (err, inserted) => {
              if (err) {
                return onCreated(err);
              }
              dest[collection].findOne({ _id: inserted.insertedId }, onCreated);
            });
          }
          else {
            dest[collection].findOne(findQuery(current), (err, destItem) => {
              if (err) {
                return onCreated(err);
              }
              if (beforeEach) {
                beforeEach(cloned, destItem);
              }
              dest[collection].replaceOne(findQuery(current), cloned, { upsert: true }, (err) => {
                if (err) {
                  return onCreated(err);
                }
                dest[collection].findOne(findQuery(current), onCreated);
              });
            });
          }
        }, done);
      };

      const getQuery = function (query) {
        let newQuery = _.cloneDeep(query);
        if (!options.all) {
          newQuery.deleted = { $eq: null };
        }
        return newQuery;
      };

      const srcProjectQuery = function (query) {
        const sourceProject = options.project || options.srcProject;
        if (sourceProject) {
          if (sourceProject.indexOf(',') === -1) {
            query._id = mongodb.ObjectID(sourceProject);
          }
          else {
            query._id = { $in: sourceProject.split(',').map((id) => mongodb.ObjectID(id)) };
          }
        }
        return query;
      };

      // Alter query to add deletedAfter and createdAfter filters.
      const getItemQuery = function (query) {
        let newQuery = _.cloneDeep(query);
        if (options.deletedAfter) {
          newQuery['$or'] = [
            { deleted: { $eq: null } },
            { deleted: { $gt: parseInt(options.deletedAfter, 10) } }
          ];
        }
        else {
          newQuery = getQuery(newQuery);
        }
        if (options.createdAfter) {
          newQuery.created = { $gt: new Date(parseInt(options.createdAfter, 10)) };
        }
        if (options.modifiedAfter) {
          newQuery.modified = { $gt: new Date(parseInt(options.modifiedAfter, 10)) };
        }
        return newQuery;
      };

      // Sets the submission collection for this form.
      const setCollection = function (form, srcProj, destProj) {
        const subsCollection = _.get(form, 'settings.collection');
        if (!subsCollection) {
          return;
        }
        console.log(`Using collection - ${subsCollection}`);
        src.submissions = subsCollection ? src.db.collection(`${srcProj.name}_${subsCollection}`) : srcSubs;
        dest.submissions = subsCollection ? dest.db.collection(`${destProj.name}_${subsCollection}`) : destSubs;
      };

      if (options.submissionsOnly) {
        console.log(`Cloning all submissions from project ${options.srcProject} to ${options.dstProject}.`);
        if (!options.dstProject) {
          return console.log(`You must provide a destination project. --dst-project=<project_id>`);
        }

        if (!options.srcProject) {
          return console.log(`You must provide a source project. --src-project=<project_id>`);
        }

        // Load the source project.
        src.projects.findOne({ _id: mongodb.ObjectID(options.srcProject) }, (err, srcProj) => {
          if (err) {
            return console.log(`Error loading source project: ${err.message}`);
          }

          // Load the destination project.
          dest.projects.findOne({ _id: mongodb.ObjectID(options.dstProject) }, (err, destProj) => {
            if (err) {
              return console.log(`Error loading destination project: ${err.message}`);
            }

            // Iterate through all forms.
            eachDocument(dest.forms.find(getQuery({
              project: mongodb.ObjectID(options.dstProject)
            })), (dstForm, nextForm) => {
              src.forms.findOne({
                project: mongodb.ObjectID(options.srcProject),
                name: dstForm.name
              }, (err, srcForm) => {
                if (err) {
                  return nextForm(err);
                }
                if (!srcForm) {
                  return nextForm();
                }

                setCollection(srcForm, srcProj, destProj);
                console.log('');
                let deletePromise = Promise.resolve();
                if (options.deleteSubmissions) {
                  console.log(`Deleting submissions from ${dstForm.title}`);
                  deletePromise = dest.submissions.deleteMany(getItemQuery({
                    project: dstForm.project,
                    form: dstForm._id
                  }));
                }

                deletePromise.then(() => {
                  process.stdout.write(`Cloning submissions from form ${srcForm.title}: `);
                  upsertAll('submissions', getItemQuery({
                    form: srcForm._id,
                    project: srcForm.project
                  }), (submission) => {
                    submission.form = dstForm._id;
                    submission.project = dstForm.project;
                  }, null, () => nextForm());
                });
              });
            }, () => {
              console.log('');
              console.log('DONE!');
            });
          });
        });
      }
      else {
        const itemQuery = getQuery({});
        process.stdout.write("\n");
        process.stdout.write(`Fetching formio project owner.`);
        dest.projects.findOne({ name: 'formio' }, (err, formioProject) => {
          if (err) {
            return console.log(`Error loading formio project: ${err.message}`);
          }
          const formioOwner = formioProject ? formioProject.owner : null;
          upsertAll('projects', srcProjectQuery({ ...itemQuery }), (project, dstProject) => {
            if (formioOwner) {
              project.owner = formioOwner;
            }
            // Keep the team access.
            if (project.access) {
              let newAccess = [];
              project.access.forEach((access) => {
                if (access.type.indexOf('team_') === -1) {
                  newAccess.push(access);
                }
              });
              if (dstProject) {
                dstProject.access.forEach((access) => {
                  if (access.type.indexOf('team_') === 0) {
                    newAccess.push(access);
                  }
                });
              }
              project.access = newAccess;
            }
          }, (project, clonedProject, nextProject) => {
            // Do not include the formio project
            if (project.name === 'formio') {
              return nextProject();
            }
            itemQuery.project = project._id;
            process.stdout.write("\n");
            process.stdout.write(`Cloning project ${project.title} (${project._id}): `);
            upsertAll('forms', itemQuery, (form) => {
              setCollection(form, project, clonedProject);
              form.project = clonedProject._id;
            }, (form, clonedForm, nextForm) => {
              itemQuery.form = form._id;
              process.stdout.write("\n");
              process.stdout.write(` - Cloning form ${form.title} (${form._id}): `);
              process.stdout.write("\n");
              process.stdout.write(`   - Submissions: : `);
              upsertAll('submissions', getItemQuery(itemQuery), (sub) => {
                sub.form = clonedForm._id;
                sub.project = clonedProject._id;
              }, null, () => {
                process.stdout.write("\n");
                process.stdout.write(`   - Actions: : `);
                delete itemQuery.project;
                upsertAll('actions', getItemQuery(itemQuery), (action) => {
                  action.form = clonedForm._id;
                }, null, () => nextForm());
              });
            }, () => {
              itemQuery.project = project._id;
              delete itemQuery.form;
              upsertAll('roles', itemQuery, (role) => {
                process.stdout.write("\n");
                process.stdout.write(` - Cloning role ${role.title} (${role._id}): `);
                role.project = clonedProject._id;
              }, null, () => {
                upsertAll('tags', getItemQuery(itemQuery), (tag) => {
                  process.stdout.write("\n");
                  process.stdout.write(` - Cloning tag ${tag.tag} (${tag._id}): `);
                  tag.project = clonedProject._id;
                }, null, () => {
                  upsertAll('formrevisions', getItemQuery(itemQuery), (revision) => {
                    process.stdout.write("\n");
                    process.stdout.write(` - Cloning revision ${revision.name} v${revision._vid} (${revision._id}): `);
                    process.stdout.write("\n");
                    revision.project = clonedProject._id;
                  }, null, () => nextProject(), (current) => {
                    return {
                      _rid: current._rid,
                      _vid: current._vid
                    };
                  });
                });
              });
            });
          }, () => {
            console.log('');
            console.log('DONE!');
          });
        });
      }
    });
  });
};
