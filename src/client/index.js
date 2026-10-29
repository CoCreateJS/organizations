import Observer from "@cocreate/observer";
import Actions from "@cocreate/actions";

const actionSelector = "[actions]";

function runOrganizationAction(action) {
    return import(/* webpackChunkName: "organizations-create" */ "./organization.js")
        .then((module) => module.create(action))
        .catch((error) => {
            console.error(
                "[CoCreateOrganizations] Failed to run organization action.",
                error
            );
            action.abort(error);
        });
}

function runEnvironmentsAction(action) {
    return import(/* webpackChunkName: "organizations-environments" */ "./environments.js")
        .then((module) => module.createEnvironment(action))
        .catch((error) => {
            console.error(
                "[CoCreateOrganizations] Failed to run environments action.",
                error
            );
            action.abort(error);
        });
}

// Register the action callbacks before any asynchronous segment can be needed.
Actions.init([
    {
        name: "createOrganization",
        endEvent: "createdOrganization",
        callback: runOrganizationAction
    },
    {
        name: "createEnvironments",
        endEvent: "createdEnvironments",
        callback: runEnvironmentsAction
    }
]);

function hasAction(element, name) {
    return (element.getAttribute("actions") || "")
        .split(/\s*,\s*/)
        .some((action) => action.split("(", 1)[0].trim() === name);
}

function loadCreateOrganization(element) {
    if (!hasAction(element, "createOrganization")) return;

    import(/* webpackChunkName: "organizations-create" */ "./organization.js")
        .catch((error) =>
            console.error(
                "[CoCreateOrganizations] Failed to load organization module.",
                error
            )
        );
}

function loadCreateEnvironments(element) {
    if (!hasAction(element, "createEnvironments")) return;

    import(/* webpackChunkName: "organizations-environments" */ "./environments.js")
        .catch((error) =>
            console.error(
                "[CoCreateOrganizations] Failed to load environments module.",
                error
            )
        );
}

function loadElement(element) {
    loadCreateOrganization(element);
    loadCreateEnvironments(element);
}

Observer.init([
    {
        name: "CoCreateOrganizationsCreateOrganizationLoader",
        types: ["addedNodes", "attributes"],
        attributeFilter: ["actions"],
        selector: actionSelector,
        callback: (mutation) => loadCreateOrganization(mutation.target)
    },
    {
        name: "CoCreateOrganizationsCreateEnvironmentsLoader",
        types: ["addedNodes", "attributes"],
        attributeFilter: ["actions"],
        selector: actionSelector,
        callback: (mutation) => loadCreateEnvironments(mutation.target)
    }
]);

document.querySelectorAll(actionSelector).forEach(loadElement);

const CoCreateOrganizations = {
    generateDB: (...args) =>
        import(/* webpackChunkName: "organizations-create" */ "./organization.js").then(
            (module) => module.generateDB(...args)
        ),
    create: (...args) =>
        import(/* webpackChunkName: "organizations-create" */ "./organization.js").then(
            (module) => module.create(...args)
        ),
    get: (...args) =>
        import(/* webpackChunkName: "organizations-create" */ "./organization.js").then(
            (module) => module.get(...args)
        )
};

export default CoCreateOrganizations;
