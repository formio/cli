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
