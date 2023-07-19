/**
 * Iterate through each component within a form.
 *
 * @param {Object} components
 *   The components to iterate.
 * @param {Function} fn
 *   The iteration function to invoke for each component.
 * @param {Boolean} includeAll
 *   Whether or not to include layout components.
 * @param {String} path
 *   The current data path of the element. Example: data.user.firstName
 * @param {Object} parent
 *   The parent object.
 */

const eachComponentAsync = async (components, fn, includeAll, path = '', parent) => {
  if (!components || !components.length || !fn) {
    return;
  }

  for (const component of components) {
    if (!component) {
      return;
    }
    const hasColumns = component.columns && Array.isArray(component.columns);
    const hasRows = component.rows && Array.isArray(component.rows);
    const hasComps = component.components && Array.isArray(component.components);
    let noRecurse = false;
    const newPath = component.key ? (path ? (`${path}.${component.key}`) : component.key) : '';

    // Keep track of parent references.
    if (parent) {
      // Ensure we don't create infinite JSON structures.
      component.parent = {...parent};
      delete component.parent.components;
      delete component.parent.componentMap;
      delete component.parent.columns;
      delete component.parent.rows;
    }

    // there's no need to add other layout components here because we expect that those would either have columns, rows or components
    const layoutTypes = ['htmlelement', 'content'];
    const isLayoutComponent = hasColumns || hasRows || hasComps || layoutTypes.indexOf(component.type) > -1;
    if (includeAll || component.tree || !isLayoutComponent) {
      noRecurse = await fn(component, newPath, components);
    }

    const subPath = () => {
      if (
        component.key &&
        !['panel', 'table', 'well', 'columns', 'fieldset', 'tabs', 'form'].includes(component.type) &&
        (
          ['datagrid', 'container', 'editgrid', 'address', 'dynamicWizard'].includes(component.type) ||
          component.tree
        )
      ) {
        return newPath;
      }
      else if (
        component.key &&
        component.type === 'form'
      ) {
        return `${newPath}.data`;
      }
      return path;
    };

    if (!noRecurse) {
      if (hasColumns) {
        for (const column of component.columns) {
          await eachComponentAsync(column.components, fn, includeAll, subPath(), parent ? component : null);
        }
      }
      else if (hasRows) {
        for (const row of component.rows) {
          if (Array.isArray(row)) {
            for (const column of row) {
              await eachComponentAsync(column.components, fn, includeAll, subPath(), parent ? component : null);
            }
          }
        }
      }
      else if (hasComps) {
        await eachComponentAsync(component.components, fn, includeAll, subPath(), parent ? component : null);
      }
    }
  }
}

module.exports = { eachComponentAsync };
