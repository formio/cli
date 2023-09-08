@echo off
for /f %%A in ('node -e "console.log(require('@formio/keys/license').formioCliTestsOfflineLicense)"') do set LICENSE_KEY=%%A
