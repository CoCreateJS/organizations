import Actions from "@cocreate/actions";
import Crud from "@cocreate/crud-client";
import { render } from "@cocreate/render";

let initialized = false;

async function createEnvironment(action) {
    try {
        const form = action.form;
        if (!form) throw new Error("A form is required");

        let organization = form.querySelector("#organization");
        if (organization) organization = organization.value;

        let hostname = form.querySelector("#hostname");
        if (hostname) hostname = ["dev." + hostname.value, "test." + hostname.value];

        const response = await Crud.socket.send({
            method: "createEnvironments",
            organization,
            hostname,
            broadcastClient: false
        });

        finishAction(action, response);
    } catch (error) {
        finishAction(action, { success: false, message: error.message });
    }
}

function finishAction(action, response) {
    const success = response?.success === true && !response.error;
    if (!success) action.abort();

    const errorMessage =
        typeof response?.error === "string"
            ? response.error
            : response?.error?.message;
    render({
        selector: '[template~="notification"]',
        data: {
            type: action.name || "createEnvironments",
            status: success ? "success" : "error",
            success,
            message:
                response?.message ||
                errorMessage ||
                (success
                    ? "Environments created"
                    : "Unable to complete the request. Please try again.")
        }
    });

    if (success) action.end(response);
}

export function init() {
    if (initialized) return;
    initialized = true;

    Actions.init({
        name: "createEnvironments",
        endEvent: "createdEnvironments",
        callback: createEnvironment
    });
}

export { createEnvironment };
export default { init, createEnvironment };
