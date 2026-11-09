import { crudClient as Crud } from '@cocreate/crud/client';
import Actions from '@cocreate/actions';
import Elements from '@cocreate/elements';
import { render } from '@cocreate/render';

async function createAction(action) {
    try {
        const form = action.form;
        if (!form) throw new Error('A form is required');

        const data = await Elements.getData(form);
        const entry = data.find(item => item.array === 'organizations');
        const organization = Array.isArray(entry?.object) ? entry.object[0] : entry?.object;
        if (!organization) throw new Error('Organization form data are required');

        return await create(organization, action);
    } catch (error) {
        finishAction(action, { error: error.message });
    }
}

async function create(organization, action) {
    try {
        const response = await Crud.socket.send({
            method: 'createOrganization',
            organization,
            broadcastClient: false
        });

        if (action) {
            if (!response?.error && response?.redirect && action.element) {
                action.element.setAttribute('href', response.redirect);
            }

            finishAction(action, response);
        }

        return response;
    } catch (error) {
        if (!action) throw error;
        finishAction(action, { error: error.message });
    }
}

function finishAction(action, response) {
    const success = !response?.error;
    if (!success) action.abort();

    const type = action.name || 'createOrganization';
    const errorMessage =
        typeof response?.error === 'string'
            ? response.error
            : response?.error?.message;

    render({
        selector: '[template~="notification"]',
        data: {
            type,
            status: success ? 'success' : 'error',
            success,
            message:
                response?.message ||
                errorMessage ||
                (success
                    ? 'Organization created'
                    : 'Unable to complete the request. Please try again.')
        }
    });

    if (success) action.end(response);
}

Actions.init({
    name: 'createOrganization',
    endEvent: 'createdOrganization',
    callback: createAction
});

const Organizations = { create };

export { create, createAction };
export default Organizations;

/**
 * @name actions
 * @kind attribute
 * @environment client
 */

/**
 * @module organizations
 * @environment client
 */

/**
 * @name declarative-actions
 * @kind member
 * @actions
 * @environment client
 * @example
 * ```json
 * [
 *   {
 *     "name": "createOrganization"
 *   }
 * ]
 * ```
 */
