The Form.io Command Line Interface
=================================
This project is the command line interface for Form.io, which allows you to quickly bootstrap full working projects as
well as interface with the Form.io API.

Installation
-------------------
Installation is easy... Simply type the following in your command line.

```
npm install -g formio-cli
```

Commands
-------------

 - ###Bootstrap

   ```
   formio bootstrap [GitHub Project]
   ```

   You can bootstrap any Form.io application within GitHub easily with our one line bootstrap command. First find a
   repository that you wish to bootstrap.  Here are a few...

    - https://github.com/formio/formio-app-todo
    - https://github.com/formio/formio-app-movie
    - https://github.com/formio/formio-app-formio
    - https://github.com/formio/formio-app-salesquote

   Example: If you wish to bootstrap the ToDo application, simply type the following in the command line.

   ```
   formio bootstrap formio/formio-app-todo
   ```

   This will ***download***, ***extract***, ***create***, ***configure*** and ***serve*** your application in one command!

 - ###Serve

   ```
   formio serve [directory]
   ```

   This command will serve a directory (to localhost) that has already been boostrapped.
