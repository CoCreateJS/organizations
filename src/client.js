import Crud from "@cocreate/crud-client";
import Action from "@cocreate/actions";
import Elements from "@cocreate/elements";
import { render } from "@cocreate/render";
import Config from "@cocreate/config";
import Indexeddb from "@cocreate/indexeddb";
import { uuid } from "@cocreate/utils";

async function generateDB(organization = {}, user = {}, key = []) {
    try {
        // Create organization
        organization._id = organization._id || Crud.ObjectId().toString();
        organization.name = organization.name || "untitiled";

        // Create user
        user._id = user._id || Crud.ObjectId().toString();
        user.firstname = user.firstname || "untitiled";
        user.lastname = user.lastname || "untitiled";

        // Create default key
        let defaultKey = {
            _id: Crud.ObjectId().toString(),
            type: "key",
            name: "Default",
            key: uuid(),
            hosts: ["*"],
            actions: {
                object: {
                    "*": {
                        users: {
                            "_id.$eq": "$user_id"
                        }
                    },
                    read: {
                        $array: ["ai", "blog-posts"]
                    }
                },
                checkSession: "true",
                signIn: "true",
                signUp: "true",
                acceptInvite: "true",
                forgotPassword: "true",
                resetPassword: "true",
                updateUserStatus: "true",
                isUnique: "true",
                inviteUser: "true"
            },
            default: true
        };

        // Create File key
        let fileKey = {
            _id: Crud.ObjectId().toString(),
            type: "key",
            key: uuid(),
            admin: "true"
        };

        // Create role
        let role_id = Crud.ObjectId().toString();
        let role = {
            _id: role_id,
            type: "role",
            name: "admin",
            admin: "true"
        };

        // Create user key
        let userKey = {
            _id: Crud.ObjectId().toString(),
            type: "user",
            name: user.name,
            key: user._id,
            array: "users", // could be any array
            roles: [role_id],
            email: user.email,
            password: user.password || btoa("0000")
        };

        return {
            organization,
            user,
            key: [defaultKey, fileKey, userKey, role]
        };
    } catch (error) {
        return false;
    }
}

function saveLocally(objects) {
    const organization_id = objects.organization._id;
    for (let key of Object.keys(objects)) {
        let data = {
            method: "object.create",
            storage: "indexeddb",
            database: organization_id,
            array: key + "s",
            object: objects[key],
            organization_id
        };
        Indexeddb.send(data);
    }
}

async function get() {
    let organization_id = await getOrganizationFromServiceWorker();
    if (!organization_id) {
        let data = await Indexeddb.send({ method: "database.read" });
        for (let database of data.database) {
            let name = database.name;
            if (name.match(/^[0-9a-fA-F]{24}$/)) {
                organization_id = name;
            }
        }
    }

    if (!organization_id) {
        let file = await fetch("/");
        organization_id = file.headers.get("organization");
    }

    if (!organization_id) organization_id = await createOrganization();

    if (organization_id) Config.set("organization_id", organization_id);

    return organization_id;
}

async function getOrganizationFromServiceWorker() {
    return new Promise((resolve, reject) => {
        if (!navigator.serviceWorker) return resolve();

        const handleMessage = (event) => {
            if (event.data.action === "getOrganization") {
                navigator.serviceWorker.removeEventListener(
                    "message",
                    handleMessage
                ); // Remove the event listener
                resolve(event.data.organization_id);
            }
        };

        navigator.serviceWorker.addEventListener("message", handleMessage);

        // Send message to Service Worker
        const msg = new MessageChannel();

        navigator.serviceWorker.ready
            .then((registration) => {
                if (navigator.serviceWorker.controller) {
                    // If there's an active controller, send the message
                    navigator.serviceWorker.controller.postMessage(
                        { action: "getOrganization" },
                        [msg.port1]
                    );
                } else {
                    // Listen for a new service worker to start controlling the page
                    navigator.serviceWorker.addEventListener(
                        "controllerchange",
                        () => {
                            if (navigator.serviceWorker.controller) {
                                navigator.serviceWorker.controller.postMessage(
                                    { action: "getOrganization" },
                                    [msg.port1]
                                );
                            }
                        }
                    );
                }
            })
            .catch((error) => {
                console.error(reject);
            });
    });
}

let organizationPromise = null;
async function createOrganizationPromise() {
    let createOrganization = document.querySelector(
        '[actions*="createOrganization"]'
    );
    if (createOrganization) return (Crud.socket.organization = "canceled");

    if (
        Crud.socket.organization == "canceled" ||
        Crud.socket.organization == "pending"
    )
        return;

    const organization_id = prompt(
        "An organization_id could not be found, if you already have an organization_id input it now.\n\nOr leave blank and click 'OK' to create a new organization"
    );

    if (organization_id) return organization_id;
    if (organization_id === null)
        return (Crud.socket.organization = "canceled");

    Crud.socket.organization = "pending";
    if (Indexeddb) {
        try {
            let org = { object: {} };
            if (organization_id) org.object._id = organization_id;
            let { organization, fileKey, user, key } = await generateDB(org);
            if (organization && key && user) {
                Crud.socket.apikey = key[0].key;
                Crud.socket.user_id = user._id;
                Config.set("organization_id", organization._id);
                Config.set("apikey", key[0].key);
                Config.set("user_id", user._id);
                Crud.socket.organization = true;
                saveLocally;
                ({ organization, user, key, fileKey });
                return organization._id;
            }
        } catch (error) {
            console.error("Failed to load the script:", error);
        }
    }
}

async function createOrganization() {
    return (
        organizationPromise ||
        (organizationPromise = createOrganizationPromise())
    );
}

async function create(action) {
    try {
        let form = action.form;
        if (!form) throw new Error("A form is required");

        let data = await Elements.getData(form);

        const entry = data.find(item => item.array === "organizations");
        const organization = Array.isArray(entry?.object) ? entry.object[0] : entry?.object;
        if (!organization) throw new Error("Organization form data are required");

        const response = await Crud.socket.send({
            method: "createOrganization",
            organization,
            broadcastClient: false
        });

        finishAction(action, response);
    } catch (error) {
        finishAction(action, { success: false, message: error.message });
    }
}

async function createEnvironment(action) {
    try {
        let form = action.form;
        if (!form) throw new Error("A form is required");

        let organization = form.querySelector("#organization");
        if (organization) {
            organization = organization.value;
        }

        let hostname = form.querySelector("#hostname");
        if (hostname) {
            hostname = hostname.value;
            hostname = ["dev." + hostname, "test." + hostname];
        }

        let response = await Crud.socket.send({
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

    const type = action.name || "createOrganization";
    const errorMessage = typeof response?.error === "string"
        ? response.error : response?.error?.message;
    render({
        selector: '[template~="notification"]',
        data: {
            type,
            status: success ? "success" : "error",
            success,
            message: response?.message || errorMessage || (success
                ? type === "createEnvironments" ? "Environments created" : "Organization created"
                : "Unable to complete the request. Please try again.")
        }
    });

    if (success) action.end(response);
}

Action.init({
    name: "createOrganization",
    endEvent: "createdOrganization",
    callback: create
});
Action.init({
    name: "createEnvironments",
    endEvent: "createdEnvironments",
    callback: createEnvironment
});

export default { generateDB, create, get };
