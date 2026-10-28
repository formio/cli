## 3.0.0 - 2026-10-28
### Breaking Changes
 - Node.js 22.12.0 or newer is required.
 - The MongoDB Node.js driver was upgraded from version 5 to version 7. Make sure the MongoDB servers you clone from
   and to are supported by driver 7.
 - Removed the anonymous usage analytics (```universal-analytics```).
 - Removed dependencies the CLI no longer uses (```@formio/core```, ```formiojs```, ```formio-service```, ```adm-zip```,
   ```core-js```, ```express```, ```keycred```, ```nunjucks```, ```progress``` and others).

### Added
 - The ```rekey``` command, to re-encrypt the project settings and encrypted submission data of a database with a new
   DB_SECRET, for example after a clone was run with the wrong ```--dst-db-secret```.
 - ```formio clone --dry-run``` compares every submission of the source against the destination and reports what is
   missing or out of date, without changing anything. Add ```--extra``` to list the records themselves, including the
   ones only the destination has.
 - Progress for the clone command: the position of every project and form, and a progress bar with the rate and the
   time left for the submissions of each form.
 - ```--batch-size``` and ```--max-batch-bytes``` options for the clone command, which bound how much it holds in
   memory and how often it saves its resume point.
 - ```--no-update-existing``` option for the clone command, to leave the projects and forms the destination already
   has untouched.
 - ```yarn test:cli``` and ```yarn test:cloner``` test suites. The cloner suite only needs MongoDB.

### Changed
 - The ```migrate``` command is deprecated and prints a warning. It will be removed in a future release.
 - The clone command writes documents in batches, and with ```--update-existing-submissions``` reads only the
   timestamps of the source submissions, reading the data of a submission only when it is going to be written.
 - The clone command saves its resume point (```clonestate.json```) after every batch it writes, so a clone that is
   interrupted, terminated or killed continues from the last batch that was written. A clone that finishes removes
   the file.
 - A clone that could not write or clone every document exits with an error naming how many, instead of reporting
   success. Running it again retries them.
 - The crypto helpers moved to ```src/encryption.js```, and the database connection helpers to ```src/db.js```.
 - The project is developed with Yarn 4 (through Corepack) and ESLint 10.

### Fixed
 - The clone command crashed, or silently left encrypted fields empty, on Node.js 22 and newer when
   ```--src-db-secret``` or ```--dst-db-secret``` was given, because ```crypto.createCipher``` was removed. The data it
   writes is byte for byte the same as what the server writes and reads.
 - The clone command did not re-encrypt encrypted fields within the rows of a datagrid or an editgrid.
 - The clone command named custom submission collections after the unsanitized project and collection names, where
   the server never reads them, and cloned their revisions from and to the default revisions collection. It now
   uses the server's names (```myproject_records``` and ```myproject_records_revisions```), and warns when the
   destination still has submissions in a collection an earlier clone misnamed.
 - Encrypted values returned by an API source were not re-encrypted.
 - A clone could skip submissions that share the creation time of the last one cloned, and the resume point was
   shared by every form, so resuming could skip the submissions of other forms.
 - Re-running a clone did not retry the submissions it failed to write when newer submissions of the same form had
   been written.
 - Resuming a clone with ```--delete-submissions``` lost the submissions cloned before the resume point.
 - A submission removed from the source while the clone read it could cause the submissions after it to be skipped.
 - A project whose settings could not be decrypted (a wrong secret) stopped the clone. It is now reported and not
   created in the destination, the other projects are still cloned, and the settings a destination project already
   has are never replaced.
 - ```--deleted-after``` matched nothing on databases that store the deletion time as a number, as the server does,
   and ignored ```--all```.
 - ```--update-existing``` could not be turned off.
 - Absolute paths given to ```--ca``` and ```--cert``` were resolved against the working directory.
 - The password of a connection string was printed in the logs.

## 2.3.2
### Changed
 - Fixing the cloner to not skip if the destination item does not exist

## 2.3.1
### Changed
 - FIO-7615: Add option to migrate pdf files to copy and migrate commands
 - FIO-7554: Remove successful authentication message appeared before actual auth try
 - FIO-8319: Add settings into copying and migration forms
 - Fixing the compaison for dates

## 2.3.0
### Changed
 - Official Release

## 2.3.0-rc.1
### Changed
 - FIO-7661: fix self signed certificate error

## 2.2.0
### Changed
 - FIO-7371: API source for clone command and updated tests
 - FIO-7018: Add tests to CLI tool

## 2.1.0
### Changed
 - Fixing issues with updating the roles of submissions to the destination role ids
 - FIO-7179: fix object mutation that will clobber project settings
 - Fixed issue with migrating form roles.
 - Refactor clone 2
 - FIO-7165: Fixes forms migrated without type field

## 2.1.0-rc.3
### Changed
 - Fixing issues with the project query for src and dst clones
 - Fixed options for dest project

## 2.1.0-rc.2
### Changed
 - Fixing the role cloning

## 2.1.0-rc.1
### Changed
 - Making changes to speed up clone process [b29b2b4] (https://github.com/formio/cli/commit/b29b2b472c8d9b7e2ffeacd58036439956d0f393)
 - Another clone command refactor [a63adb2] (https://github.com/formio/cli/commit/a63adb250b38172273b915b46fb3dea2f1c46248)
 - More refactor and cleanup [101b5ce] (https://github.com/formio/cli/commit/101b5ce3d0181eadae8169eeef9c353477f1184d)

## 2.0.1
### Changed
 - Do not print out the submission revisions
 - Update Readme.md

## 2.0.0
### Changed
 - FIO-6963: Replace all formio-service mentions in src directory to node-fetch
 - Refactoring clone command [0602bc6] (https://github.com/formio/cli/commit/0602bc6826359ef938ceb28678435b54bb4793fb)
 - Fixing role ids cloning. [281e5a2] (https://github.com/formio/cli/commit/281e5a27c633062f2aaccf733b8909b9d2e83dc0)
 - multiple fixes and improvements [5b33a12] (https://github.com/formio/cli/commit/5b33a127d4bbf6633ada8a40190e5e233f7aae16)
 - bump up the version to 2.x and change the repo name
 - FIO-6935: Fix cloning source project to new DB and add helper method to find last element in the collection
 - FIO-6935: Adds db connections closing, improved submissions with references mapping, fixed submissions only option
 - FIO-6935: Fixes encrypted fields and access migration
 - FIO-6935: Fixes cloning from OSS project
 - FIO-6935: Update logo
 - FIO-6935: Disable --update-existing option for OSS
